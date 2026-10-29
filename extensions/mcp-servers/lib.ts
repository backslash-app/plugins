// Reading the MCP server definitions of each client into one shape, grouping them, masking secrets,
// building `claude mcp add` and JSON configs, and the MCP handshake messages. Pure, tested in lib_test.ts.

// ---------------------------------------------------------------------------
// Clients

export type ClientId =
  | "claude-code"
  | "claude-desktop"
  | "cursor"
  | "vscode"
  | "zed"
  | "windsurf"
  | "cline"
  | "codex"
  | "gemini";

export const CLIENTS: Record<ClientId, string> = {
  "claude-code": "Claude Code",
  "claude-desktop": "Claude Desktop",
  cursor: "Cursor",
  vscode: "VS Code",
  zed: "Zed",
  windsurf: "Windsurf",
  cline: "Cline",
  codex: "Codex",
  gemini: "Gemini CLI",
};

export type Transport = "stdio" | "http" | "sse" | "extension";

export interface Server {
  name: string;
  transport: Transport;
  command?: string;
  args: string[];
  env: Record<string, string>;
  cwd?: string;
  url?: string;
  headers: Record<string, string>;
}

/** How a client turns a server off, when it says so in its config file. */
export type Toggle =
  /** `"disabled": true` (Windsurf, Cline) or `"enabled": false` (Zed) on the entry. */
  | { kind: "flag"; key: "disabled" | "enabled" }
  /** Claude Code's `.mcp.json` servers: the project's approval lists in ~/.claude.json. */
  | { kind: "claude-approval"; project: string };

export interface Source {
  client: ClientId;
  /** User, Local, Project, Workspace. */
  scope: string;
  project?: string;
  file: string;
  /** Where the entry is in the file, as object keys. */
  path: string[];
  /** `undefined` when the client decides at run time (Claude Code asking for approval). */
  enabled?: boolean;
  status?: string;
  toggle?: Toggle;
}

export interface Entry {
  server: Server;
  source: Source;
}

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown) => typeof v === "string" ? v : undefined;
const strings = (v: unknown) => Array.isArray(v) ? v.map((x) => String(x)) : [];
const dict = (v: unknown): Record<string, string> =>
  isObj(v) ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, String(x ?? "")])) : {};

/** One server entry, whatever the client's spelling: `type`, `url`, `serverUrl`, `httpUrl`, Zed's `command.path`… */
export function normalize(name: string, raw: Obj): Server {
  const nested = isObj(raw.command) ? raw.command : undefined; // Zed before 0.190: { command: { path, args, env } }
  const command = str(nested?.path) ?? str(raw.command);
  const url = str(raw.url) ?? str(raw.serverUrl) ?? str(raw.httpUrl);
  const type = String(raw.type ?? raw.transport ?? "").toLowerCase().replace(/[^a-z]/g, "");
  let transport: Transport;
  if (type === "stdio") transport = "stdio";
  else if (type === "sse") transport = "sse";
  else if (["http", "streamablehttp", "streamable"].includes(type)) transport = "http";
  else if (command) transport = "stdio";
  else if (str(raw.httpUrl)) transport = "http";
  else if (url) transport = /\/sse\/?(\?|$)/.test(url) ? "sse" : "http";
  else transport = raw.source === "extension" ? "extension" : "stdio";
  return {
    name,
    transport,
    command,
    args: strings(nested?.args ?? raw.args),
    env: dict(nested?.env ?? raw.env),
    cwd: str(raw.cwd),
    url,
    headers: { ...dict(raw.headers), ...dict(raw.http_headers) },
  };
}

function entries(
  servers: unknown,
  base: Omit<Source, "path" | "enabled"> & { path: string[] },
  state?: (name: string, raw: Obj) => Pick<Source, "enabled" | "status" | "toggle">,
): Entry[] {
  if (!isObj(servers)) return [];
  return Object.entries(servers).filter(([, raw]) => isObj(raw)).map(([name, raw]) => ({
    server: normalize(name, raw as Obj),
    source: { ...base, path: [...base.path, name], ...(state?.(name, raw as Obj) ?? { enabled: true }) },
  }));
}

/** `"disabled": true` on the entry, as Windsurf, Cline and Claude Desktop extensions write it. */
const disabledFlag = (_: string, raw: Obj) => ({
  enabled: raw.disabled !== true,
  toggle: { kind: "flag", key: "disabled" } as Toggle,
});

export interface ClaudeProject {
  path: string;
  enabled: string[];
  disabled: string[];
  enableAll: boolean;
}

/** ~/.claude.json: user servers, each project's local servers, and how its `.mcp.json` servers were approved. */
export function parseClaudeJson(data: unknown, file: string): { entries: Entry[]; projects: ClaudeProject[] } {
  if (!isObj(data)) return { entries: [], projects: [] };
  const out = entries(data.mcpServers, { client: "claude-code", scope: "User", file, path: ["mcpServers"] });
  const projects: ClaudeProject[] = [];
  if (isObj(data.projects)) {
    for (const [path, p] of Object.entries(data.projects)) {
      if (!isObj(p)) continue;
      projects.push({
        path,
        enabled: strings(p.enabledMcpjsonServers),
        disabled: strings(p.disabledMcpjsonServers),
        enableAll: p.enableAllProjectMcpServers === true,
      });
      out.push(
        ...entries(p.mcpServers, {
          client: "claude-code",
          scope: "Local",
          project: path,
          file,
          path: ["projects", path, "mcpServers"],
        }),
      );
    }
  }
  return { entries: out, projects };
}

/** A project's `.mcp.json`, shared with the team; Claude Code asks before starting its servers. */
export function parseMcpJson(data: unknown, file: string, project: ClaudeProject | { path: string }): Entry[] {
  const p = project as Partial<ClaudeProject> & { path: string };
  return entries(isObj(data) ? data.mcpServers : undefined, {
    client: "claude-code",
    scope: "Project",
    project: p.path,
    file,
    path: ["mcpServers"],
  }, (name) => {
    const toggle: Toggle | undefined = "enabled" in p ? { kind: "claude-approval", project: p.path } : undefined;
    if (p.disabled?.includes(name)) return { enabled: false, status: "Rejected in Claude Code", toggle };
    if (p.enableAll || p.enabled?.includes(name)) return { enabled: true, toggle };
    return { enabled: undefined, status: "Claude Code will ask to approve it", toggle };
  });
}

/** `{ "mcpServers": { … } }`: Cursor, Claude Desktop, Windsurf, Cline, Gemini CLI. */
export function parseMcpServers(
  data: unknown,
  file: string,
  client: ClientId,
  scope: string,
  project?: string,
): Entry[] {
  const flag = client === "windsurf" || client === "cline" ? disabledFlag : undefined;
  return entries(
    isObj(data) ? data.mcpServers : undefined,
    { client, scope, project, file, path: ["mcpServers"] },
    flag,
  );
}

/** VS Code: `servers` in mcp.json, or `mcp.servers` in settings.json. */
export function parseVscode(data: unknown, file: string, scope: string, project?: string): Entry[] {
  if (!isObj(data)) return [];
  if (isObj(data.servers)) return entries(data.servers, { client: "vscode", scope, project, file, path: ["servers"] });
  const mcp = data.mcp;
  if (isObj(mcp) && isObj(mcp.servers)) {
    return entries(mcp.servers, { client: "vscode", scope, project, file, path: ["mcp", "servers"] });
  }
  return [];
}

/** Zed's settings.json: `context_servers`, turned off with `"enabled": false`. */
export function parseZed(data: unknown, file: string): Entry[] {
  return entries(isObj(data) ? data.context_servers : undefined, {
    client: "zed",
    scope: "User",
    file,
    path: ["context_servers"],
  }, (_name, raw) => ({ enabled: raw.enabled !== false, toggle: { kind: "flag", key: "enabled" } }));
}

/** Codex's config.toml: `[mcp_servers.name]`. */
export function parseCodex(data: unknown, file: string): Entry[] {
  return entries(isObj(data) ? data.mcp_servers : undefined, {
    client: "codex",
    scope: "User",
    file,
    path: ["mcp_servers"],
  }, (_name, raw) => ({ enabled: raw.enabled !== false }));
}

/** New approval lists for a Claude Code project when a `.mcp.json` server is turned on or off. */
export function approvalLists(
  project: Pick<ClaudeProject, "enabled" | "disabled">,
  name: string,
  enable: boolean,
): { enabled: string[]; disabled: string[] } {
  const enabled = project.enabled.filter((n) => n !== name);
  const disabled = project.disabled.filter((n) => n !== name);
  (enable ? enabled : disabled).push(name);
  return { enabled, disabled };
}

// ---------------------------------------------------------------------------
// Grouping: one row per server, with the clients using it

export interface Group {
  key: string;
  server: Server;
  sources: Source[];
}

export const signature = (s: Server) => JSON.stringify([s.name, s.transport, s.command ?? "", s.args, s.url ?? ""]);

export function group(all: Entry[]): Group[] {
  const map = new Map<string, Group>();
  for (const e of all) {
    const key = signature(e.server);
    const g = map.get(key);
    if (g) {
      g.sources.push(e.source);
      // Keep the most complete env and headers (one client may leave secrets to another file).
      g.server = {
        ...g.server,
        env: { ...e.server.env, ...g.server.env },
        headers: { ...e.server.headers, ...g.server.headers },
      };
    } else map.set(key, { key, server: e.server, sources: [e.source] });
  }
  return [...map.values()].sort((a, b) => a.server.name.localeCompare(b.server.name));
}

/** On if any client runs it; off only when every client has it turned off. */
export function groupState(g: Group): "on" | "off" | "pending" {
  if (g.sources.some((s) => s.enabled === true)) return "on";
  if (g.sources.some((s) => s.enabled === undefined)) return "pending";
  return "off";
}

// ---------------------------------------------------------------------------
// Secrets

/** `${input:token}`, `${env:KEY}`, `$KEY`: a reference, not a secret. */
export const isReference = (v: string) => /^\$\{[^}]+\}$|^\$[A-Za-z_]\w*$/.test(v.trim());

export function mask(value: string): string {
  if (!value) return "(empty)";
  if (isReference(value)) return value;
  return "•".repeat(Math.min(12, Math.max(4, value.length)));
}

const SECRET_FLAG = /(key|token|secret|password|passwd|pat|auth|credential)/i;

/** Arguments with `--api-key=…`, `--token …` or a URL's `?key=` masked. */
export function maskArgs(args: string[]): string[] {
  return args.map((a, i) => {
    const eq = /^(--?[\w-]+)=(.+)$/.exec(a);
    if (eq && SECRET_FLAG.test(eq[1])) return `${eq[1]}=${mask(eq[2])}`;
    const prev = args[i - 1];
    if (prev && /^--?[\w-]+$/.test(prev) && SECRET_FLAG.test(prev) && !a.startsWith("-")) return mask(a);
    return maskUrl(a);
  });
}

/** `https://x/mcp?api_key=…` → the key masked; user:password@ too. */
export function maskUrl(url: string): string {
  if (!/^https?:\/\//.test(url)) return url;
  return url
    .replace(/\/\/([^/@:]+):([^/@]+)@/, (_m, u) => `//${u}:••••@`)
    .replace(/([?&][^=&]*(?:key|token|secret|auth)[^=&]*=)([^&#]+)/gi, (_m, k) => `${k}••••`);
}

/** Header values masked, except for the scheme: `Bearer ••••`. */
export const maskHeader = (v: string) => /^(Bearer|Basic|Token)\s+/i.test(v) ? v.replace(/\s+.+$/, " ••••") : mask(v);

// ---------------------------------------------------------------------------
// Copying

const SHELL_SAFE = /^[\w@%+=:,./-]+$/;
export const shellQuote = (s: string) => SHELL_SAFE.test(s) ? s : `'${s.replace(/'/g, "'\\''")}'`;

export function commandLine(s: Server, secrets = true): string {
  const env = Object.entries(s.env).map(([k, v]) => `${k}=${shellQuote(secrets ? v : mask(v))}`);
  return [...env, ...[s.command ?? "", ...(secrets ? s.args : maskArgs(s.args))].map(shellQuote)].join(" ");
}

/** The server as Claude Code, Cursor and Claude Desktop write it. */
export function configEntry(s: Server, secrets = true): Obj {
  const value = (v: string) => secrets || isReference(v) ? v : "<YOUR_VALUE>";
  const values = (o: Record<string, string>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, value(v)]));
  if (s.transport === "http" || s.transport === "sse") {
    return {
      type: s.transport,
      url: secrets ? s.url : maskUrl(s.url ?? ""),
      ...(Object.keys(s.headers).length ? { headers: values(s.headers) } : {}),
    };
  }
  return {
    ...(s.transport === "stdio" ? { type: "stdio" } : {}),
    command: s.command ?? "",
    args: secrets ? s.args : maskArgs(s.args),
    ...(Object.keys(s.env).length ? { env: values(s.env) } : {}),
    ...(s.cwd ? { cwd: s.cwd } : {}),
  };
}

export const jsonConfig = (s: Server, secrets = true) =>
  JSON.stringify({ mcpServers: { [s.name]: configEntry(s, secrets) } }, null, 2);

/** `claude mcp add`, the way Claude Code's docs write it. */
export function claudeAddCommand(s: Server, scope?: "user" | "project" | "local", secrets = true): string {
  const parts = ["claude", "mcp", "add"];
  const value = (v: string) => secrets || isReference(v) ? v : "<YOUR_VALUE>";
  if (s.transport === "http" || s.transport === "sse") {
    parts.push("--transport", s.transport);
    if (scope) parts.push("--scope", scope);
    parts.push(s.name, secrets ? s.url ?? "" : maskUrl(s.url ?? ""));
    for (const [k, v] of Object.entries(s.headers)) parts.push("--header", `${k}: ${value(v)}`);
    return parts.map(shellQuote).join(" ");
  }
  parts.push("--transport", "stdio");
  if (scope) parts.push("--scope", scope);
  parts.push(s.name);
  for (const [k, v] of Object.entries(s.env)) parts.push("--env", `${k}=${value(v)}`);
  parts.push("--", s.command ?? "", ...(secrets ? s.args : maskArgs(s.args)));
  return parts.map(shellQuote).join(" ");
}

/** `claude mcp add-json name '{…}'`. */
export const claudeAddJsonCommand = (s: Server, scope?: string) =>
  ["claude", "mcp", "add-json", ...(scope ? ["--scope", scope] : []), s.name, JSON.stringify(configEntry(s))]
    .map(shellQuote).join(" ");

/** `code --add-mcp '{"name":…}'`: VS Code adds it to the user's mcp.json. */
export const vscodeAddCommand = (s: Server) =>
  ["code", "--add-mcp", JSON.stringify({ name: s.name, ...configEntry(s) })].map(shellQuote).join(" ");

/** The Claude Code scope a source maps to. */
export function claudeScope(src: Source): "user" | "project" | "local" | undefined {
  if (src.client !== "claude-code") return undefined;
  return src.scope === "Project" ? "project" : src.scope === "Local" ? "local" : "user";
}

// ---------------------------------------------------------------------------
// Testing a server: the MCP handshake

export const PROTOCOL_VERSION = "2025-06-18";

export const initializeRequest = (id: number) => ({
  jsonrpc: "2.0",
  id,
  method: "initialize",
  params: {
    protocolVersion: PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: { name: "backslash-mcp-servers", version: "1.0.0" },
  },
});

export const initializedNotification = { jsonrpc: "2.0", method: "notifications/initialized" };

export const listRequest = (id: number, what: "tools" | "prompts" | "resources", cursor?: string) => ({
  jsonrpc: "2.0",
  id,
  method: `${what}/list`,
  ...(cursor ? { params: { cursor } } : {}),
});

export interface InitInfo {
  name: string;
  version: string;
  title?: string;
  protocol: string;
  capabilities: string[];
  instructions?: string;
}

export function readInit(result: unknown): InitInfo {
  const r = isObj(result) ? result : {};
  const info = isObj(r.serverInfo) ? r.serverInfo : {};
  return {
    name: str(info.name) ?? "(unnamed)",
    version: str(info.version) ?? "?",
    title: str(info.title),
    protocol: str(r.protocolVersion) ?? "?",
    capabilities: isObj(r.capabilities) ? Object.keys(r.capabilities).sort() : [],
    instructions: str(r.instructions),
  };
}

export interface Tool {
  name: string;
  description?: string;
}

export function readTools(result: unknown): { tools: Tool[]; next?: string } {
  const r = isObj(result) ? result : {};
  const list = Array.isArray(r.tools)
    ? r.tools
    : Array.isArray(r.prompts)
    ? r.prompts
    : Array.isArray(r.resources)
    ? r.resources
    : [];
  return {
    tools: list.filter(isObj).map((t) => ({ name: String(t.name ?? t.uri ?? "?"), description: str(t.description) })),
    next: str(r.nextCursor),
  };
}

/** JSON-RPC messages from a stream of lines: blank lines and logs printed on stdout are skipped. */
export function parseLines(chunk: string): unknown[] {
  return chunk.split("\n").map((l) => l.trim()).filter((l) => l.startsWith("{")).flatMap((l) => {
    try {
      return [JSON.parse(l)];
    } catch {
      return [];
    }
  });
}

/** The messages of a `text/event-stream` body (Streamable HTTP answers either JSON or SSE). */
export function parseSse(body: string): unknown[] {
  const out: unknown[] = [];
  for (const event of body.replace(/\r\n/g, "\n").split("\n\n")) {
    const data = event.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trimStart()).join("\n");
    if (!data) continue;
    try {
      out.push(JSON.parse(data));
    } catch {
      // A keep-alive or a non-JSON event.
    }
  }
  return out;
}

/** The programs Test Start may launch (they must be in the manifest's `run` permission). */
export const RUNNERS = ["npx", "node", "uvx", "uv", "python3", "python", "docker", "deno", "bunx", "bun", "pnpm"];

export const runner = (command: string | undefined) => (command ?? "").split("/").pop() ?? "";

export const canStart = (s: Server) => s.transport === "stdio" && RUNNERS.includes(runner(s.command));

/** Only local HTTP servers can be tested: remote ones would need the whole network, and usually a sign-in. */
export function isLocalUrl(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const host = new URL(url).hostname;
    return host === "localhost" || host === "127.0.0.1";
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Display helpers

export const tilde = (path: string, home: string) =>
  home && (path === home || path.startsWith(`${home}/`)) ? `~${path.slice(home.length)}` : path;

export const TRANSPORT_TITLE: Record<Transport, string> = {
  stdio: "stdio",
  http: "HTTP",
  sse: "SSE",
  extension: "Zed extension",
};

/** What the row's subtitle shows: the command line or the URL, secrets masked. */
export function target(s: Server): string {
  if (s.transport === "http" || s.transport === "sse") return maskUrl(s.url ?? "");
  if (s.transport === "extension") return "Provided by a Zed extension";
  return [s.command ?? "", ...maskArgs(s.args)].join(" ");
}

/** The package a launcher runs, for keywords: `npx -y @scope/pkg@1` → `@scope/pkg`. */
export function packageOf(s: Server): string | undefined {
  const r = runner(s.command);
  if (!["npx", "bunx", "uvx", "pnpm", "pipx"].includes(r)) return undefined;
  const arg = s.args.find((a) => !a.startsWith("-") && !["dlx", "run", "exec"].includes(a));
  return arg?.replace(/(.)@[^@/]*$/, "$1");
}

export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
