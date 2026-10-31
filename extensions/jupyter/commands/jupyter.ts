import {
  type Accessory,
  type Action,
  action,
  copy,
  Icons,
  type Item,
  list,
  meta,
  type Metadata,
  open,
  refresh,
  toast,
  updateCommandMetadata,
} from "@backslash/api";
import {
  type Kernel,
  kernelLanguage,
  kernelName,
  notebookUrl,
  orphanKernels,
  type Recent,
  serverFor,
  type Session,
  since,
  sortSessions,
  splitPath,
  stateLook,
  tilde,
  tokenUrl,
} from "../lib.ts";
import { api, discover, HOME, type Live, live, recents } from "../jupyter.ts";

interface Prefs {
  interface?: string;
}

/** `http://localhost:8888/user/ada/` → `localhost:8888/user/ada`. */
function hostOf(url: string): string {
  try {
    const u = new URL(url);
    return `${u.host}${u.pathname.replace(/\/+$/, "")}`;
  } catch {
    return url;
  }
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

function kernelActions(l: Live, kernel: Kernel, session?: Session): Action[] {
  const name = session ? splitPath(session.path).name : kernelName(kernel.name, l.specs);
  const call = (method: string, path: string, done: string) => async () => {
    await api(l.server, path, { method, timeout: 15_000 });
    await toast(done, { style: "success" });
    return refresh();
  };
  return [
    action("Interrupt Kernel", call("POST", `api/kernels/${kernel.id}/interrupt`, `Interrupted ${name}`), {
      icon: Icons.stop,
      shortcut: "<Ctrl>i",
      section: "Kernel",
    }),
    action(
      "Restart Kernel",
      call("POST", `api/kernels/${kernel.id}/restart`, `Restarted ${name}'s kernel`),
      {
        icon: Icons.refresh,
        shortcut: "<Ctrl><Shift>r",
        confirm: `Restart the kernel of ${name}? Its variables are lost.`,
        section: "Kernel",
      },
    ),
    action(
      "Shut Down Kernel",
      call(
        "DELETE",
        session ? `api/sessions/${session.id}` : `api/kernels/${kernel.id}`,
        `Shut down ${name}'s kernel`,
      ),
      {
        icon: Icons.power,
        shortcut: "<Ctrl><Shift>x",
        destructive: true,
        confirm: `Shut down the kernel of ${name}? Unsaved variables are lost.`,
        section: "Kernel",
      },
    ),
  ];
}

function kernelLines(l: Live, kernel: Kernel): Metadata[] {
  const look = stateLook(kernel.execution_state);
  const language = kernelLanguage(kernel.name, l.specs);
  return [
    meta.text("State", look.text, { icon: look.icon, color: look.tint }),
    meta.text("Kernel", kernelName(kernel.name, l.specs), { icon: Icons.cpu }),
    ...(language ? [meta.text("Language", language, { icon: Icons.code })] : []),
    ...(kernel.last_activity ? [meta.text("Last activity", since(kernel.last_activity), { icon: Icons.clock })] : []),
    meta.text("Connections", kernel.connections ?? 0, { icon: Icons.plug }),
    meta.text("Kernel ID", kernel.id),
  ];
}

function sessionItem(l: Live, session: Session, prefs: Prefs): Item {
  const kernel = session.kernel;
  const look = stateLook(kernel?.execution_state);
  const { name, dir } = splitPath(session.path);
  const root = l.server.root.replace(/\/+$/, "");
  const abs = root ? `${root}/${session.path}` : session.path;
  const url = notebookUrl(l.server, session.path, prefs.interface ?? "lab");
  const type = session.type && session.type !== "notebook" ? session.type : "";
  const accessories: Accessory[] = [
    ...(kernel ? [{ tag: look.text, color: look.tint }] : [{ tag: "No kernel", color: "gray" as const }]),
    ...(kernel ? [{ text: kernelName(kernel.name, l.specs), tooltip: "Kernel" }] : []),
    ...(kernel?.last_activity
      ? [{ text: since(kernel.last_activity), icon: Icons.clock, tooltip: "Last activity" }]
      : []),
  ];
  return {
    id: `session:${l.server.port}:${session.id}`,
    title: name || session.path,
    subtitle: [dir, type].filter(Boolean).join(" · ") || undefined,
    icon: { source: kernel ? look.icon : Icons.book, tint: kernel ? look.tint : "gray" },
    section: type ? "Consoles and Files" : "Running Notebooks",
    keywords: [session.path, kernel?.name ?? "", look.text, String(l.server.port)],
    accessories,
    detail: {
      markdown: `**${session.path}**\n\nOn \`${l.server.url}\``,
      metadata: [
        ...(kernel ? kernelLines(l, kernel) : [meta.text("Kernel", "None")]),
        meta.separator(),
        meta.text("Path", tilde(abs, HOME), { icon: Icons.file }),
        meta.text("Server", `Port ${l.server.port}`, { icon: Icons.server }),
      ],
    },
    actions: [
      open(url, "Open in Browser", { icon: Icons.globe }),
      ...(kernel ? kernelActions(l, kernel, session) : []),
      copy(abs, "Copy Path", { shortcut: "<Ctrl><Shift>c", section: "Copy" }),
      copy(url, "Copy URL with Token", { icon: Icons.link, concealed: true, section: "Copy" }),
      ...(root ? [open(splitPath(abs).dir || root, "Open Folder", { icon: Icons.folder, section: "Copy" })] : []),
    ],
  };
}

function kernelItem(l: Live, kernel: Kernel): Item {
  const look = stateLook(kernel.execution_state);
  return {
    id: `kernel:${l.server.port}:${kernel.id}`,
    title: kernelName(kernel.name, l.specs),
    subtitle: `Kernel ${kernel.id.slice(0, 8)}, no notebook`,
    icon: { source: look.icon, tint: look.tint },
    section: "Other Kernels",
    keywords: [kernel.name, kernel.id, look.text],
    accessories: [
      { tag: look.text, color: look.tint },
      ...(kernel.last_activity ? [{ text: since(kernel.last_activity), icon: Icons.clock }] : []),
    ],
    detail: {
      markdown: "A kernel no notebook uses: started from a console, an editor or a notebook that was closed.",
      metadata: [...kernelLines(l, kernel), meta.separator(), meta.text("Server", `Port ${l.server.port}`)],
    },
    actions: [
      open(tokenUrl(l.server, "lab"), "Open Server", { icon: Icons.globe }),
      ...kernelActions(l, kernel),
      copy(kernel.id, "Copy Kernel ID", { section: "Copy" }),
    ],
  };
}

function serverItem(l: Live, prefs: Prefs): Item {
  const s = l.server;
  const busy = l.kernels.filter((k) => k.execution_state === "busy").length;
  const root = s.root ? tilde(s.root, HOME) : "";
  const auth = s.token ? "Token" : s.password ? "Password" : "None";
  const lines: Metadata[] = [
    meta.text("Status", l.error ? l.error : "Running", {
      icon: l.error ? Icons.alert : Icons.check,
      color: l.error ? "orange" : "green",
    }),
    meta.link("URL", s.url, tokenUrl(s)),
    ...(root ? [meta.text("Root", root, { icon: Icons.folder })] : []),
    ...(s.version
      ? [meta.text("Version", `${s.flavor === "notebook" ? "Notebook" : "Jupyter Server"} ${s.version}`)]
      : []),
    ...(l.error
      ? []
      : [meta.text("Kernels", `${l.kernels.length}${busy ? `, ${busy} busy` : ""}`, { icon: Icons.cpu })]),
    ...(l.status?.connections !== undefined ? [meta.text("Connections", l.status.connections)] : []),
    ...(l.status?.started ? [meta.text("Started", since(l.status.started), { icon: Icons.clock })] : []),
    ...(l.status?.last_activity ? [meta.text("Last activity", since(l.status.last_activity))] : []),
    meta.separator(),
    meta.text("Auth", auth, { icon: Icons.key }),
    ...(s.pid ? [meta.text("PID", s.pid)] : []),
  ];
  return {
    id: `server:${s.port}`,
    title: root || s.url,
    subtitle: hostOf(s.url),
    icon: { source: Icons.server, tint: l.error ? "orange" : "green" },
    section: "Servers",
    keywords: [s.url, String(s.port), s.root, "server"],
    accessories: [
      ...(l.error ? [{ tag: "Not answering", color: "orange" as const, tooltip: l.error }] : []),
      ...(!l.error ? [{ text: plural(l.kernels.length, "kernel"), icon: Icons.cpu }] : []),
      ...(busy ? [{ tag: `${busy} busy`, color: "yellow" as const }] : []),
      ...(s.version ? [{ text: s.version, tooltip: "Version" }] : []),
    ],
    detail: { metadata: lines },
    actions: [
      open(tokenUrl(s, s.flavor === "notebook" || prefs.interface === "notebook" ? "tree" : "lab"), "Open in Browser", {
        icon: Icons.globe,
      }),
      copy(tokenUrl(s), "Copy URL with Token", { icon: Icons.link, concealed: true, shortcut: "<Ctrl><Shift>c" }),
      ...(s.token ? [copy(s.token, "Copy Token", { icon: Icons.key, concealed: true, section: "Copy" })] : []),
      ...(s.root ? [open(s.root, "Open Root Folder", { icon: Icons.folder, section: "Copy" })] : []),
      action("Shut Down Server", async () => {
        await api(s, "api/shutdown", { method: "POST", timeout: 10_000 });
        await toast(`Stopped the server on port ${s.port}`, { style: "success" });
        return refresh();
      }, {
        icon: Icons.power,
        destructive: true,
        confirm: `Shut down the server on port ${s.port}${
          l.kernels.length ? ` and its ${plural(l.kernels.length, "kernel")}` : ""
        }?`,
        shortcut: "<Ctrl><Shift>q",
        section: "Danger",
      }),
    ],
  };
}

function recentItem(r: Recent, lives: Live[], prefs: Prefs): Item {
  const { name, dir } = splitPath(r.path);
  const running = lives.filter((l) => !l.error).map((l) => l.server);
  const at = r.absolute ? serverFor(running, r.path, HOME) : undefined;
  const fallback = !r.absolute && running.length === 1 ? { server: running[0], rel: r.path } : undefined;
  const target = at ?? fallback;
  const url = target ? notebookUrl(target.server, target.rel, prefs.interface ?? "lab") : undefined;
  return {
    id: `recent:${r.path}`,
    title: name,
    subtitle: dir ? tilde(dir, HOME) : undefined,
    icon: { source: Icons.book, tint: "orange" },
    section: "Recent Notebooks",
    keywords: [r.path, r.workspace],
    accessories: [
      ...(r.when ? [{ text: since(new Date(r.when).toISOString()), tooltip: "Workspace saved" }] : []),
    ],
    detail: {
      metadata: [
        meta.text("Path", tilde(r.path, HOME), { icon: Icons.file }),
        meta.text("Workspace", r.workspace, { icon: Icons.layers }),
        ...(target
          ? [meta.text("Opens on", `Port ${target.server.port}`, { icon: Icons.server })]
          : [meta.text("Opens with", "Your default app (no server serves it)", { icon: Icons.external })]),
      ],
    },
    actions: [
      ...(url
        ? [open(url, "Open in Jupyter", { icon: Icons.globe })]
        : r.absolute
        ? [open(r.path, "Open with Default App")]
        : []),
      copy(r.path, "Copy Path", { shortcut: "<Ctrl><Shift>c" }),
      ...(r.absolute ? [open(splitPath(r.path).dir, "Open Folder", { icon: Icons.folder })] : []),
    ],
  };
}

function nothingRunning(): Item {
  return {
    id: "none",
    title: "No Jupyter server running",
    subtitle: "Start one with jupyter lab in your project",
    icon: { source: Icons.book, tint: "gray" },
    detail: {
      markdown: [
        "## No server found",
        "",
        "Start JupyterLab in a project folder:",
        "",
        "```sh",
        "jupyter lab",
        "```",
        "",
        "Servers appear here with their notebooks and kernels, including those started from a virtualenv.",
        "Recent notebooks come from JupyterLab's saved workspaces (`~/.jupyter/lab/workspaces`).",
      ].join("\n"),
    },
    actions: [copy("jupyter lab", "Copy Command"), open("https://jupyter.org/install", "Install Jupyter")],
  };
}

let summary = "";

export default list({
  placeholder: "Filter notebooks, kernels and servers…",
  empty: { title: "Nothing found", description: "No server, notebook or kernel matches.", icon: Icons.book },
  status: () => summary,
  actions: [action("Reload", () => refresh(), { icon: Icons.refresh, shortcut: "<Ctrl>r" })],
  async *items({ preferences, signal }) {
    const prefs = preferences as Prefs;
    const [servers, recent] = await Promise.all([discover(signal), recents()]);
    const lives = (await Promise.all(servers.map((s) => live(s, signal)))).filter((l) => !l.stale);
    const items: Item[] = [];
    let busy = 0, kernels = 0;
    for (const l of lives) {
      items.push(serverItem(l, prefs));
      kernels += l.kernels.length;
      busy += l.kernels.filter((k) => k.execution_state === "busy").length;
    }
    for (const l of lives) items.push(...sortSessions(l.sessions).map((s) => sessionItem(l, s, prefs)));
    for (const l of lives) items.push(...orphanKernels(l.kernels, l.sessions).map((k) => kernelItem(l, k)));
    const opened = new Set(
      lives.flatMap((l) => l.sessions.map((s) => `${l.server.root.replace(/\/+$/, "")}/${s.path}`)),
    );
    items.push(...recent.filter((r) => !opened.has(r.path)).map((r) => recentItem(r, lives, prefs)));
    if (!lives.length) items.unshift(nothingRunning());
    summary = lives.length
      ? `${plural(lives.length, "server")} · ${plural(kernels, "kernel")}${busy ? ` · ${busy} busy` : ""}`
      : "No server running";
    updateCommandMetadata({
      subtitle: lives.length ? `${plural(kernels, "kernel")}${busy ? `, ${busy} busy` : ""}` : null,
    }).catch(() => {});
    yield items;
  },
});
