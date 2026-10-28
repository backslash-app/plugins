// Parsing ~/.ssh/config and ~/.ssh/known_hosts. Pure, tested in lib_test.ts.

/** One `Host` (or `Match`) block, in file order. */
export interface Block {
  patterns: string[];
  /** `[key in lowercase, Key as written, value]` */
  options: [string, string, string][];
  file: string;
  line: number;
  /** The block as written, for the side panel. */
  raw: string[];
  /** `Match` blocks are kept out of the resolution: their conditions need a live ssh. */
  match?: boolean;
}

export interface Host {
  alias: string;
  hostName?: string;
  user?: string;
  port?: string;
  identityFiles: string[];
  proxyJump?: string;
  /** Other options that apply, first value wins (as ssh does), `[Key, value]`. */
  options: [string, string][];
  /** Where the host is defined. */
  file?: string;
  line?: number;
  raw: string[];
  source: "config" | "known_hosts";
  /** known_hosts: key types and other names (IP addresses) of the host. */
  keyTypes?: string[];
  addresses?: string[];
}

/** `Key value`, `Key=value`, `Key "quoted value"`. */
export function splitLine(line: string): [string, string] | undefined {
  const m = line.match(/^\s*([A-Za-z][A-Za-z0-9]*)\s*(?:=\s*|\s+)(.*?)\s*$/);
  if (!m || line.trimStart().startsWith("#")) return undefined;
  let value = m[2];
  if (/^"[^"]*"$/.test(value)) value = value.slice(1, -1);
  return [m[1], value];
}

/** Words of a value, honoring double quotes: `a "b c"` → `["a", "b c"]`. */
export const words = (value: string) => [...value.matchAll(/"([^"]*)"|(\S+)/g)].map((m) => m[1] ?? m[2]);

const isPattern = (p: string) => /[*?!]/.test(p);

/** ssh_config(5) patterns: `*`, `?`, and `!negation` within a list. */
export function matches(patterns: string[], host: string): boolean {
  let hit = false;
  for (const p of patterns) {
    const negated = p.startsWith("!");
    const glob = negated ? p.slice(1) : p;
    const re = new RegExp(
      `^${glob.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".")}$`,
      "i",
    );
    if (re.test(host)) {
      if (negated) return false;
      hit = true;
    }
  }
  return hit;
}

/** Files read for an `Include` pattern, already expanded by the caller (globs, `~`). */
export type Resolver = (pattern: string) => { file: string; text: string }[];

/**
 * The blocks of a config file, `Include`s inlined in place. Lines before the
 * first `Host` apply to every host (as if under `Host *`).
 */
export function parseBlocks(text: string, file: string, include: Resolver, depth = 0): Block[] {
  const blocks: Block[] = [];
  let current: Block = { patterns: ["*"], options: [], file, line: 0, raw: [] };
  const push = () => {
    if (current.options.length || current.raw.length) blocks.push(current);
  };
  text.split(/\r?\n/).forEach((line, i) => {
    const kv = splitLine(line);
    if (!kv) {
      if (line.trim() && current.raw.length) current.raw.push(line);
      return;
    }
    const [key, value] = kv;
    const lower = key.toLowerCase();
    if (lower === "host" || lower === "match") {
      push();
      current = {
        patterns: lower === "host" ? words(value) : [],
        options: [],
        file,
        line: i + 1,
        raw: [line],
        match: lower === "match",
      };
      return;
    }
    current.raw.push(line);
    if (lower === "include") {
      if (depth >= 8) return; // ssh's own limit: guards against loops
      for (const pattern of words(value)) {
        for (const inc of include(pattern)) {
          const inner = parseBlocks(inc.text, inc.file, include, depth + 1);
          // Lines at the top of an included file belong to the block that includes it.
          for (const b of inner) {
            if (b.line === 0) current.options.push(...b.options);
            else {
              push();
              blocks.push(b);
              current = { ...current, options: [], raw: [] };
            }
          }
        }
      }
      return;
    }
    current.options.push([lower, key, value]);
  });
  push();
  return blocks;
}

const MULTI = new Set([
  "identityfile",
  "localforward",
  "remoteforward",
  "dynamicforward",
  "certificatefile",
  "sendenv",
]);

/** Every concrete host of the config with the options that apply to it, in file order. */
export function resolveHosts(blocks: Block[]): Host[] {
  const aliases: string[] = [];
  for (const b of blocks) {
    if (b.match) continue;
    for (const p of b.patterns) if (!isPattern(p) && !aliases.includes(p)) aliases.push(p);
  }
  return aliases.map((alias) => {
    const own = blocks.find((b) => !b.match && b.patterns.includes(alias))!;
    const values = new Map<string, [string, string][]>();
    for (const b of blocks) {
      if (b.match || !matches(b.patterns, alias)) continue;
      for (const [lower, key, value] of b.options) {
        const seen = values.get(lower);
        if (!seen) values.set(lower, [[key, value]]);
        else if (MULTI.has(lower)) seen.push([key, value]);
      }
    }
    const one = (k: string) => values.get(k)?.[0][1];
    const hostName = one("hostname")?.replace(/%h/g, alias).replace(/%%/g, "%");
    const known = new Set(["hostname", "user", "port", "identityfile", "proxyjump"]);
    return {
      alias,
      hostName,
      user: one("user"),
      port: one("port"),
      identityFiles: (values.get("identityfile") ?? []).map(([, v]) => v),
      proxyJump: one("proxyjump"),
      options: [...values].filter(([k]) => !known.has(k)).flatMap(([, kvs]) => kvs),
      file: own.file,
      line: own.line,
      raw: own.raw,
      source: "config" as const,
    };
  });
}

const IP = /^(\d{1,3}(\.\d{1,3}){3}|[0-9a-f:]*:[0-9a-f:.]+)$/i;

/** Hosts of a known_hosts file; hashed entries, markers and patterns are skipped. */
export function parseKnownHosts(text: string): Host[] {
  const byName = new Map<string, Host>();
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#") || t.startsWith("@") || t.startsWith("|")) continue;
    const [names, keyType] = t.split(/\s+/);
    if (!names || !keyType) continue;
    const parsed = names.split(",").filter((n) => n && !isPattern(n)).map((n) => {
      const m = n.match(/^\[([^\]]+)\]:(\d+)$/);
      return m ? { host: m[1], port: m[2] } : { host: n, port: undefined };
    });
    if (!parsed.length) continue;
    const main = parsed.find((p) => !IP.test(p.host)) ?? parsed[0];
    const id = main.port ? `[${main.host}]:${main.port}` : main.host;
    const entry = byName.get(id) ?? {
      alias: main.host,
      hostName: main.host,
      port: main.port,
      identityFiles: [],
      options: [],
      raw: [],
      source: "known_hosts" as const,
      keyTypes: [],
      addresses: [],
    };
    if (!entry.keyTypes!.includes(keyType)) entry.keyTypes!.push(keyType);
    for (const p of parsed) {
      if (p.host !== main.host && !entry.addresses!.includes(p.host)) entry.addresses!.push(p.host);
    }
    byName.set(id, entry);
  }
  return [...byName.values()];
}

/** Known hosts that the config does not already cover (by alias or HostName). */
export function extraKnownHosts(config: Host[], known: Host[]): Host[] {
  const covered = new Set(config.flatMap((h) => [h.alias, h.hostName ?? ""]).map((n) => n.toLowerCase()));
  return known.filter((k) => !covered.has(k.alias.toLowerCase()));
}

/** `ssh alias`, or `ssh -p 2222 host` for a host that only is in known_hosts. */
export function sshCommand(h: Host): string[] {
  if (h.source === "config") return ["ssh", h.alias];
  return ["ssh", ...(h.port && h.port !== "22" ? ["-p", h.port] : []), h.alias];
}

/** For GVfs / KIO: aliases work there too, as they run ssh with your config. */
export function sftpUrl(h: Host): string {
  if (h.source === "config") return `sftp://${h.alias}/`;
  const host = h.alias.includes(":") ? `[${h.alias}]` : h.alias;
  return `sftp://${host}${h.port && h.port !== "22" ? `:${h.port}` : ""}/`;
}

/** `deploy@10.0.0.5:2222`, defaults left out. */
export function address(h: Host): string {
  const host = h.hostName ?? h.alias;
  return `${h.user ? `${h.user}@` : ""}${host}${h.port && h.port !== "22" ? `:${h.port}` : ""}`;
}

/** Recently opened first (newest first), then the config order, then known hosts by name. */
export function sortHosts(hosts: Host[], recent: Record<string, number>): Host[] {
  const order = new Map(hosts.map((h, i) => [h, i]));
  return [...hosts].sort((a, b) =>
    (recent[b.alias] ?? 0) - (recent[a.alias] ?? 0) ||
    Number(a.source === "known_hosts") - Number(b.source === "known_hosts") ||
    (a.source === "known_hosts" ? a.alias.localeCompare(b.alias) : order.get(a)! - order.get(b)!)
  );
}

/** "3h ago" */
export function ago(ms: number, now = Date.now()): string {
  const s = Math.max(0, (now - ms) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d ago`;
  return new Date(ms).toLocaleDateString("en", { day: "numeric", month: "short", year: "numeric" });
}

/** A glob's last path component as a RegExp: `*.conf` → /^.*\.conf$/. */
export function globRegExp(glob: string): RegExp {
  return new RegExp(`^${glob.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".")}$`);
}
