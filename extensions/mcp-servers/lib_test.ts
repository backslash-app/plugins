import { assert, assertEquals, assertThrows } from "@std/assert";
import { find, JsoncError, parseJsonc, parseTree, setProperty } from "./jsonc.ts";
import {
  approvalLists,
  canStart,
  claudeAddCommand,
  claudeAddJsonCommand,
  configEntry,
  group,
  groupState,
  isLocalUrl,
  jsonConfig,
  mask,
  maskArgs,
  maskHeader,
  maskUrl,
  normalize,
  packageOf,
  parseClaudeJson,
  parseCodex,
  parseLines,
  parseMcpJson,
  parseMcpServers,
  parseSse,
  parseVscode,
  parseZed,
  readInit,
  readTools,
  type Server,
  target,
  vscodeAddCommand,
} from "./lib.ts";
import { probeStdio } from "./probe.ts";

Deno.test("JSONC: comments, trailing commas, positions", () => {
  const text = `{
  // Zed settings
  "theme": "One Dark", /* inline */
  "context_servers": {
    "fs": { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-filesystem"], },
  },
}`;
  assertEquals(parseJsonc(text), {
    theme: "One Dark",
    context_servers: { fs: { command: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem"] } },
  });
  const tree = parseTree(text);
  const theme = find(tree, ["theme"])!;
  assertEquals(text.slice(theme.start, theme.end), '"One Dark"');
  assertThrows(() => parseTree('{"a": }'), JsoncError, "line 1");
  assertEquals(parseJsonc('"tab\\tquote\\"\\u00e9"'), 'tab\tquote"é');
});

Deno.test("JSONC: setting a value keeps the rest of the file", () => {
  const text = `{
  // my servers
  "context_servers": {
    "fs": {
      "command": "npx", // the launcher
      "args": []
    }
  }
}`;
  const off = setProperty(text, ["context_servers", "fs", "enabled"], false);
  assertEquals(
    off,
    `{
  // my servers
  "context_servers": {
    "fs": {
      "command": "npx", // the launcher
      "args": [],
      "enabled": false
    }
  }
}`,
  );
  const on = setProperty(off, ["context_servers", "fs", "enabled"], true);
  assert(on.includes('"enabled": true') && on.includes("// the launcher"));
  assertEquals(setProperty('{"a": {}}', ["a", "b"], [1, 2]), '{"a": {\n  "b": [1, 2]\n}}');
  assertEquals(setProperty('{"a": 1}', ["b"], "x"), '{"a": 1, "b": "x"}');
  assertEquals(setProperty('{\n\t"a": 1,\n}', ["b"], true), '{\n\t"a": 1,\n\t"b": true,\n}');
  assertThrows(() => setProperty("{}", ["missing", "x"], 1));
});

Deno.test("normalizing each client's spelling", () => {
  assertEquals(normalize("a", { command: "npx", args: ["-y", "x"], env: { K: "v" } }).transport, "stdio");
  assertEquals(normalize("a", { url: "https://h/mcp" }).transport, "http");
  assertEquals(normalize("a", { url: "https://h/sse" }).transport, "sse");
  assertEquals(normalize("a", { type: "streamable-http", url: "https://h/x" }).transport, "http");
  assertEquals(normalize("a", { serverUrl: "https://h/mcp" }).url, "https://h/mcp"); // Windsurf
  assertEquals(normalize("a", { httpUrl: "https://h/mcp" }).transport, "http"); // Gemini CLI
  const zedOld = normalize("a", { command: { path: "/usr/bin/node", args: ["s.js"], env: { A: "1" } } });
  assertEquals([zedOld.command, zedOld.args, zedOld.env], ["/usr/bin/node", ["s.js"], { A: "1" }]);
  assertEquals(normalize("a", { source: "extension", settings: {} }).transport, "extension");
  assertEquals(normalize("a", { command: "x", http_headers: { A: "b" } }).headers, { A: "b" });
});

const CLAUDE = {
  mcpServers: {
    github: { type: "http", url: "https://api.githubcopilot.com/mcp/", headers: { Authorization: "Bearer ghp_x" } },
  },
  projects: {
    "/home/u/Projects/app": {
      mcpServers: { db: { command: "uvx", args: ["mcp-server-sqlite", "--db-path", "app.db"] } },
      enabledMcpjsonServers: ["fs"],
      disabledMcpjsonServers: ["old"],
    },
    "/home/u/Projects/web": { enableAllProjectMcpServers: true },
  },
};

Deno.test("Claude Code: user, local and project servers", () => {
  const { entries, projects } = parseClaudeJson(CLAUDE, "/home/u/.claude.json");
  assertEquals(entries.map((e) => [e.server.name, e.source.scope, e.source.path]), [
    ["github", "User", ["mcpServers", "github"]],
    ["db", "Local", ["projects", "/home/u/Projects/app", "mcpServers", "db"]],
  ]);
  const app = projects[0];
  const mcp = { mcpServers: { fs: { command: "npx" }, old: { command: "npx" }, fresh: { command: "npx" } } };
  const states = parseMcpJson(mcp, "/home/u/Projects/app/.mcp.json", app).map((e) => [e.server.name, e.source.enabled]);
  assertEquals(states, [["fs", true], ["old", false], ["fresh", undefined]]);
  assertEquals(parseMcpJson(mcp, "x", projects[1]).every((e) => e.source.enabled), true);
  assertEquals(parseMcpJson(mcp, "x", { path: "/p" })[0].source.toggle, undefined);
  assertEquals(approvalLists(app, "old", true), { enabled: ["fs", "old"], disabled: [] });
  assertEquals(approvalLists(app, "fs", false), { enabled: [], disabled: ["old", "fs"] });
});

Deno.test("other clients", () => {
  const ws = parseMcpServers({ mcpServers: { a: { command: "npx", disabled: true } } }, "f", "windsurf", "User");
  assertEquals([ws[0].source.enabled, ws[0].source.toggle], [false, { kind: "flag", key: "disabled" }]);
  const cursor = parseMcpServers({ mcpServers: { a: { command: "npx", disabled: true } } }, "f", "cursor", "User");
  assertEquals([cursor[0].source.enabled, cursor[0].source.toggle], [true, undefined]);
  assertEquals(parseVscode({ servers: { a: { type: "stdio", command: "x" } } }, "f", "User")[0].source.path, [
    "servers",
    "a",
  ]);
  assertEquals(parseVscode({ mcp: { servers: { a: { command: "x" } } } }, "f", "User")[0].source.path, [
    "mcp",
    "servers",
    "a",
  ]);
  const zed = parseZed({ context_servers: { a: { command: "x", enabled: false } } }, "f");
  assertEquals([zed[0].source.enabled, zed[0].source.toggle?.kind], [false, "flag"]);
  assertEquals(parseCodex({ mcp_servers: { a: { command: "x", args: ["y"] } } }, "f")[0].server.args, ["y"]);
  assertEquals(parseMcpServers(null, "f", "cursor", "User"), []);
});

Deno.test("grouping across clients", () => {
  const a = parseMcpServers(
    { mcpServers: { fs: { command: "npx", args: ["-y", "fs"], env: { A: "1" } } } },
    "1",
    "cursor",
    "User",
  );
  const b = parseMcpServers(
    { mcpServers: { fs: { command: "npx", args: ["-y", "fs"], disabled: true } } },
    "2",
    "windsurf",
    "User",
  );
  const c = parseMcpServers({ mcpServers: { fs: { command: "npx", args: ["-y", "other"] } } }, "3", "cline", "User");
  const groups = group([...a, ...b, ...c]);
  assertEquals(groups.length, 2);
  assertEquals(groups[0].sources.map((s) => s.client), ["cursor", "windsurf"]);
  assertEquals(groups[0].server.env, { A: "1" });
  assertEquals(groupState(groups[0]), "on");
  assertEquals(groupState({ ...groups[0], sources: [b[0].source] }), "off");
});

const STDIO: Server = {
  name: "github",
  transport: "stdio",
  command: "npx",
  args: ["-y", "@modelcontextprotocol/server-github", "--token=ghp_secret"],
  env: { GITHUB_TOKEN: "ghp_123456", LOG: "${env:LOG}" },
  headers: {},
};
const HTTP: Server = {
  name: "remote",
  transport: "http",
  url: "https://mcp.example.com/mcp?api_key=abc&x=1",
  args: [],
  env: {},
  headers: { Authorization: "Bearer abc" },
};

Deno.test("secrets are masked", () => {
  assertEquals(mask("ghp_123456"), "••••••••••");
  assertEquals(mask("${input:token}"), "${input:token}");
  assertEquals(
    maskArgs(["--api-key", "abc", "--token=xyz", "-y", "pkg"]),
    ["--api-key", "•••", "--token=••••", "-y", "pkg"]
      .map((x) => x === "•••" ? "••••" : x),
  );
  assertEquals(maskUrl("https://u:pw@h/mcp?api_key=abc&x=1"), "https://u:••••@h/mcp?api_key=••••&x=1");
  assertEquals(maskHeader("Bearer abc"), "Bearer ••••");
  assertEquals(target(STDIO), "npx -y @modelcontextprotocol/server-github --token=••••••••••");
  assertEquals(packageOf(STDIO), "@modelcontextprotocol/server-github");
  assertEquals(packageOf({ ...STDIO, command: "uvx", args: ["mcp-server-fetch@1.2"] }), "mcp-server-fetch");
});

Deno.test("copying configs and commands", () => {
  assertEquals(JSON.parse(jsonConfig(STDIO)).mcpServers.github.env.GITHUB_TOKEN, "ghp_123456");
  const masked = JSON.parse(jsonConfig(STDIO, false)).mcpServers.github;
  assertEquals(masked.env, { GITHUB_TOKEN: "<YOUR_VALUE>", LOG: "${env:LOG}" });
  assertEquals(
    claudeAddCommand(STDIO, "user"),
    "claude mcp add --transport stdio --scope user github --env GITHUB_TOKEN=ghp_123456 --env 'LOG=${env:LOG}' -- npx -y @modelcontextprotocol/server-github --token=ghp_secret",
  );
  assertEquals(
    claudeAddCommand(HTTP),
    "claude mcp add --transport http remote 'https://mcp.example.com/mcp?api_key=abc&x=1' --header 'Authorization: Bearer abc'",
  );
  assertEquals(configEntry(HTTP), { type: "http", url: HTTP.url, headers: { Authorization: "Bearer abc" } });
  assert(claudeAddJsonCommand(HTTP).startsWith('claude mcp add-json remote \'{"type":"http"'));
  assert(vscodeAddCommand(STDIO).startsWith(`code --add-mcp '{"name":"github","type":"stdio"`));
  assert(canStart(STDIO));
  assert(!canStart({ ...STDIO, command: "/opt/bin/my-server" }));
  assert(isLocalUrl("http://localhost:3000/mcp"));
  assert(!isLocalUrl("https://mcp.example.com"));
});

Deno.test("handshake messages", () => {
  assertEquals(parseLines('log line\n{"jsonrpc":"2.0","id":1,"result":{}}\n\n{bad'), [{
    jsonrpc: "2.0",
    id: 1,
    result: {},
  }]);
  assertEquals(parseSse('event: message\ndata: {"id":1}\n\n: ping\n\ndata: {"id":2}\n\n'), [{ id: 1 }, { id: 2 }]);
  const info = readInit({
    protocolVersion: "2025-06-18",
    capabilities: { tools: {}, prompts: {} },
    serverInfo: { name: "demo", version: "1.2.0" },
  });
  assertEquals([info.name, info.version, info.capabilities], ["demo", "1.2.0", ["prompts", "tools"]]);
  assertEquals(readTools({ tools: [{ name: "a", description: "A" }], nextCursor: "2" }), {
    tools: [{ name: "a", description: "A" }],
    next: "2",
  });
});

const FAKE_SERVER = `
const decoder = new TextDecoder();
let buffer = "";
const send = (m) => Deno.stdout.writeSync(new TextEncoder().encode(JSON.stringify(m) + "\\n"));
console.error("fake server starting");
for await (const chunk of Deno.stdin.readable) {
  buffer += decoder.decode(chunk);
  let i;
  while ((i = buffer.indexOf("\\n")) >= 0) {
    const line = buffer.slice(0, i);
    buffer = buffer.slice(i + 1);
    const m = JSON.parse(line);
    if (m.method === "initialize") {
      send({ jsonrpc: "2.0", id: m.id, result: { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "fake", version: "0.0.1" } } });
    } else if (m.method === "tools/list") {
      if (!m.params?.cursor) send({ jsonrpc: "2.0", id: m.id, result: { tools: [{ name: "echo", description: "Echoes" }], nextCursor: "p2" } });
      else send({ jsonrpc: "2.0", id: m.id, result: { tools: [{ name: "add" }] } });
    }
  }
}
`;

Deno.test("Test Start against a local stdio server", async () => {
  const dir = await Deno.makeTempDir({ prefix: "mcp-servers-" });
  try {
    await Deno.writeTextFile(`${dir}/server.js`, FAKE_SERVER);
    const r = await probeStdio({
      name: "fake",
      transport: "stdio",
      command: Deno.execPath(),
      args: ["run", "--quiet", "--no-config", `${dir}/server.js`],
      env: { NO_COLOR: "1" },
      headers: {},
    });
    assertEquals(r.error, undefined);
    assertEquals([r.ok, r.info?.name, r.info?.version], [true, "fake", "0.0.1"]);
    assertEquals(r.tools.map((t) => t.name), ["echo", "add"]);
    assert(r.stderr.includes("fake server starting"));
    const missing = await probeStdio({ ...STDIO, command: "node-that-does-not-exist" });
    assertEquals(missing.ok, false);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("reading and toggling a whole home", async () => {
  const home = await Deno.makeTempDir({ prefix: "mcp-home-" });
  const old = Deno.env.get("HOME");
  try {
    await Deno.mkdir(`${home}/Projects/app`, { recursive: true });
    await Deno.mkdir(`${home}/.config/zed`, { recursive: true });
    await Deno.mkdir(`${home}/.codeium/windsurf`, { recursive: true });
    await Deno.mkdir(`${home}/.cursor`, { recursive: true });
    const claude = {
      ...CLAUDE,
      projects: { [`${home}/Projects/app`]: CLAUDE.projects["/home/u/Projects/app"], "/elsewhere": {} },
    };
    await Deno.writeTextFile(`${home}/.claude.json`, JSON.stringify(claude, null, 2));
    await Deno.writeTextFile(
      `${home}/Projects/app/.mcp.json`,
      JSON.stringify({ mcpServers: { fs: { command: "npx" }, fresh: { command: "npx" } } }),
    );
    await Deno.writeTextFile(
      `${home}/.config/zed/settings.json`,
      `{\n  // comment\n  "context_servers": {\n    "fs": { "command": "npx", "args": [] }\n  }\n}\n`,
    );
    await Deno.writeTextFile(
      `${home}/.codeium/windsurf/mcp_config.json`,
      JSON.stringify({ mcpServers: { fs: { command: "npx", args: [] } } }, null, 2),
    );
    await Deno.writeTextFile(`${home}/.cursor/mcp.json`, "{ broken");
    Deno.env.set("HOME", home);
    const { loadAll, setEnabled } = await import("./sources.ts");
    const loaded = await loadAll();
    const names = loaded.entries.map((e) => `${e.source.client}:${e.server.name}`).sort();
    assertEquals(names, [
      "claude-code:db",
      "claude-code:fresh",
      "claude-code:fs",
      "claude-code:github",
      "windsurf:fs",
      "zed:fs",
    ]);
    assertEquals(loaded.problems.length, 1);
    assertEquals(loaded.unreadable, ["/elsewhere"]);

    const find = (client: string, name: string) =>
      loaded.entries.find((e) => e.source.client === client && e.server.name === name)!.source;
    await setEnabled(find("zed", "fs"), "fs", false);
    const zed = await Deno.readTextFile(`${home}/.config/zed/settings.json`);
    assert(zed.includes("// comment") && /"enabled": false/.test(zed));
    await setEnabled(find("windsurf", "fs"), "fs", false);
    assertEquals(
      JSON.parse(await Deno.readTextFile(`${home}/.codeium/windsurf/mcp_config.json`)).mcpServers.fs.disabled,
      true,
    );
    await setEnabled(find("claude-code", "fresh"), "fresh", true);
    const project = JSON.parse(await Deno.readTextFile(`${home}/.claude.json`)).projects[`${home}/Projects/app`];
    assertEquals([project.enabledMcpjsonServers, project.disabledMcpjsonServers], [["fs", "fresh"], ["old"]]);
    const again = await loadAll();
    const fresh = again.entries.find((e) => e.server.name === "fresh");
    assertEquals(fresh?.source.enabled, true);
  } finally {
    if (old) Deno.env.set("HOME", old);
    await Deno.remove(home, { recursive: true });
  }
});
