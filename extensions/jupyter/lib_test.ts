import { assert, assertEquals } from "@std/assert";
import { parse } from "@std/toml";
import {
  expand,
  isServerFile,
  kernelName,
  mergeRecents,
  mergeServers,
  notebookUrl,
  orphanKernels,
  parseServer,
  parseServerList,
  parseWorkspace,
  serverFor,
  type Session,
  since,
  sortSessions,
  splitPath,
  stateLook,
  tilde,
  tokenUrl,
} from "./lib.ts";

const HOME = "/home/ada";

// `jupyter server list --json` (Jupyter Server 2.14): one object per line.
const LIST =
  `{"base_url": "/", "hostname": "localhost", "password": false, "pid": 41230, "port": 8888, "root_dir": "/home/ada/work", "secure": false, "sock": "", "token": "8c2f0d5e9a4b4c1d", "url": "http://localhost:8888/", "version": "2.14.2"}
[W 2024-10-30 09:12:01.123 ServerApp] some warning
{"base_url": "/user/ada/", "hostname": "0.0.0.0", "password": true, "pid": 41300, "port": 8890, "root_dir": "/home/ada/research", "secure": false, "sock": "", "token": "", "url": "http://ada-laptop:8890/user/ada/", "version": "2.14.2"}
`;

// nbserver-<pid>.json from classic Notebook 6.
const NBSERVER = {
  base_url: "/",
  hostname: "localhost",
  notebook_dir: "/home/ada/old",
  password: false,
  pid: 999,
  port: 8889,
  secure: false,
  sock: "",
  token: "abc",
  url: "http://localhost:8889/",
};

Deno.test("parseServerList reads JSON lines and skips log lines", () => {
  const servers = parseServerList(LIST);
  assertEquals(servers.length, 2);
  assertEquals(servers[0], {
    url: "http://localhost:8888/",
    base: "http://localhost:8888/",
    port: 8888,
    token: "8c2f0d5e9a4b4c1d",
    password: false,
    root: "/home/ada/work",
    version: "2.14.2",
    pid: 41230,
    sock: undefined,
    flavor: "server",
    listed: true,
  });
  // Bound to every interface: reached on 127.0.0.1, with its base URL.
  assertEquals(servers[1].base, "http://127.0.0.1:8890/user/ada/");
  assertEquals(servers[1].url, "http://ada-laptop:8890/user/ada/");
  assert(servers[1].password);
});

Deno.test("parseServerList reads --jsonlist arrays", () => {
  const out = JSON.stringify([JSON.parse(LIST.split("\n")[0])]);
  assertEquals(parseServerList(out).map((s) => s.port), [8888]);
  assertEquals(parseServerList(""), []);
  assertEquals(parseServerList("Currently running servers:"), []);
});

Deno.test("parseServer handles classic Notebook files and junk", () => {
  const s = parseServer(NBSERVER)!;
  assertEquals(s.flavor, "notebook");
  assertEquals(s.root, "/home/ada/old");
  assertEquals(s.listed, false);
  assertEquals(parseServer({ port: "x" }), undefined);
  assertEquals(parseServer(null), undefined);
  // No url: built from the parts.
  assertEquals(parseServer({ port: 9000, hostname: "0.0.0.0", base_url: "lab" })!.url, "http://localhost:9000/lab/");
});

Deno.test("isServerFile keeps server descriptions only", () => {
  assert(isServerFile("jpserver-41230.json"));
  assert(isServerFile("nbserver-999.json"));
  assert(!isServerFile("jpserver-41230-open.html"));
  assert(!isServerFile("kernel-3f1c.json"));
});

Deno.test("mergeServers keeps one per port, the CLI's first", () => {
  const listed = parseServerList(LIST);
  const file = { ...parseServer(JSON.parse(LIST.split("\n")[0]))!, root: "/elsewhere" };
  const merged = mergeServers(listed, [file, parseServer(NBSERVER)!]);
  assertEquals(merged.map((s) => s.port), [8888, 8889, 8890]);
  assertEquals(merged[0].root, "/home/ada/work");
  assertEquals(merged[0].listed, true);
});

Deno.test("tokenUrl and notebookUrl", () => {
  const [s, pw] = parseServerList(LIST);
  assertEquals(tokenUrl(s), "http://localhost:8888/?token=8c2f0d5e9a4b4c1d");
  assertEquals(tokenUrl(pw, "lab"), "http://ada-laptop:8890/user/ada/lab");
  assertEquals(
    notebookUrl(s, "analysis/Q3 sales.ipynb", "lab"),
    "http://localhost:8888/lab/tree/analysis/Q3%20sales.ipynb?token=8c2f0d5e9a4b4c1d",
  );
  assertEquals(notebookUrl(s, "a.ipynb", "notebook"), "http://localhost:8888/notebooks/a.ipynb?token=8c2f0d5e9a4b4c1d");
  assertEquals(
    notebookUrl(parseServer(NBSERVER)!, "a.ipynb", "lab"),
    "http://localhost:8889/notebooks/a.ipynb?token=abc",
  );
});

Deno.test("tilde, expand and serverFor", () => {
  assertEquals(tilde("/home/ada/work", HOME), "~/work");
  assertEquals(tilde("/home/adam", HOME), "/home/adam");
  assertEquals(expand("~/work", HOME), "/home/ada/work");
  const servers = mergeServers(parseServerList(LIST), [{ ...parseServer(NBSERVER)!, root: "/home/ada" }]);
  const hit = serverFor(servers, "/home/ada/work/analysis/sales.ipynb", HOME)!;
  assertEquals(hit.server.port, 8888); // the closest root wins
  assertEquals(hit.rel, "analysis/sales.ipynb");
  assertEquals(serverFor(servers, "/srv/x.ipynb", HOME), undefined);
});

const SESSIONS: Session[] = [
  {
    id: "s1",
    path: "analysis/sales.ipynb",
    name: "sales.ipynb",
    type: "notebook",
    kernel: { id: "k1", name: "python3", last_activity: "2024-10-30T09:00:00.000Z", execution_state: "idle" },
  },
  {
    id: "s2",
    path: "train.ipynb",
    type: "notebook",
    kernel: { id: "k2", name: "python3", last_activity: "2024-10-30T08:00:00.000Z", execution_state: "busy" },
  },
  { id: "s3", path: "notes.md", type: "file", kernel: null },
];

Deno.test("sortSessions puts busy kernels first, then recent activity", () => {
  assertEquals(sortSessions(SESSIONS).map((s) => s.id), ["s2", "s1", "s3"]);
});

Deno.test("orphanKernels finds kernels without a session", () => {
  const kernels = [{ id: "k1", name: "python3" }, { id: "k9", name: "ir" }];
  assertEquals(orphanKernels(kernels, SESSIONS).map((k) => k.id), ["k9"]);
});

Deno.test("kernelName uses the spec's display name", () => {
  const specs = {
    default: "python3",
    kernelspecs: { python3: { name: "python3", spec: { display_name: "Python 3 (ipykernel)" } } },
  };
  assertEquals(kernelName("python3", specs), "Python 3 (ipykernel)");
  assertEquals(kernelName("ir", specs), "ir");
});

Deno.test("stateLook", () => {
  assertEquals(stateLook("busy").tint, "yellow");
  assertEquals(stateLook("idle").text, "Idle");
  assertEquals(stateLook("dead").tint, "red");
  assertEquals(stateLook("restarting").text, "Restarting");
  assertEquals(stateLook(undefined).text, "Unknown");
});

Deno.test("since and splitPath", () => {
  const now = new Date("2024-10-30T10:00:00Z");
  assertEquals(since("2024-10-30T09:59:30Z", now), "just now");
  assertEquals(since("2024-10-30T09:00:00Z", now), "1h");
  assertEquals(since("2024-10-27T10:00:00Z", now), "3d");
  assertEquals(since(undefined, now), "");
  assertEquals(splitPath("a/b/c.ipynb"), { name: "c.ipynb", dir: "a/b" });
  assertEquals(splitPath("c.ipynb"), { name: "c.ipynb", dir: "" });
});

// ~/.jupyter/lab/workspaces/default-37a8.jupyterlab-workspace (JupyterLab 4.2).
const WORKSPACE = JSON.stringify({
  data: {
    "layout-restorer:data": {
      main: { dock: { type: "tab-area", currentIndex: 0, widgets: ["notebook:analysis/sales.ipynb"] } },
    },
    "notebook:analysis/sales.ipynb": { data: { path: "analysis/sales.ipynb", factory: "Notebook" } },
    "notebook:scratch.ipynb": { data: { path: "scratch.ipynb", factory: "Notebook" } },
    "editor:README.md": { data: { path: "README.md", factory: "Editor" } },
    "docmanager:recents": {
      opened: [
        { root: "~/work", path: "analysis/sales.ipynb", contentType: "notebook" },
        { root: "/home/ada/work", path: "README.md", contentType: "file" },
      ],
      closed: [{ root: "/home/ada/work", path: "old/eda.ipynb", contentType: "notebook" }],
    },
  },
  metadata: { id: "default", last_modified: "2024-10-29T18:00:00.000000+00:00", created: "2024-09-01T10:00:00+00:00" },
});

Deno.test("parseWorkspace reads recents and open notebooks", () => {
  const r = parseWorkspace(WORKSPACE, HOME);
  assertEquals(r.map((x) => x.path), [
    "/home/ada/work/analysis/sales.ipynb",
    "/home/ada/work/old/eda.ipynb",
    "analysis/sales.ipynb",
    "scratch.ipynb",
  ]);
  assertEquals(r[0].workspace, "default");
  assertEquals(r[0].when, Date.parse("2024-10-29T18:00:00Z"));
  assertEquals(parseWorkspace("not json", HOME), []);
});

Deno.test("mergeRecents drops duplicates and relative copies of known paths", () => {
  const merged = mergeRecents([parseWorkspace(WORKSPACE, HOME), parseWorkspace(WORKSPACE, HOME)]);
  assertEquals(merged.map((x) => x.path), [
    "/home/ada/work/analysis/sales.ipynb",
    "/home/ada/work/old/eda.ipynb",
    "scratch.ipynb",
  ]);
});

Deno.test("the manifest reads the folders the code reads", async () => {
  const manifest = parse(await Deno.readTextFile(new URL("./backslash.toml", import.meta.url))) as {
    permissions: { read: string[]; net: string[] };
  };
  assertEquals(manifest.permissions.read, ["~/.local/share/jupyter/runtime", "~/.jupyter/lab/workspaces"]);
  assertEquals(manifest.permissions.net, ["localhost", "127.0.0.1"]);
});
