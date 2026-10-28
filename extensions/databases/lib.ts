// Pure logic of the Databases extension: config file parsers, URLs, client
// command lines and status interpretation. No I/O here.

export type DbType = "postgres" | "mysql" | "sqlite" | "redis";
export type Source = "saved" | "pgpass" | "service" | "mycnf";

export const TYPES: DbType[] = ["postgres", "mysql", "sqlite", "redis"];

export const TYPE_NAMES: Record<DbType, string> = {
  postgres: "PostgreSQL",
  mysql: "MySQL / MariaDB",
  sqlite: "SQLite",
  redis: "Redis",
};

export const TYPE_COLORS = { postgres: "blue", mysql: "orange", sqlite: "teal", redis: "red" } as const;

export const DEFAULT_PORTS: Record<DbType, number | undefined> = {
  postgres: 5432,
  mysql: 3306,
  sqlite: undefined,
  redis: 6379,
};

export const SOURCE_NAMES: Record<Source, string> = {
  saved: "Saved",
  pgpass: "~/.pgpass",
  service: "~/.pg_service.conf",
  mycnf: "~/.my.cnf",
};

/** A connection as listed. Passwords are never part of it: they are looked up when needed. */
export interface Connection {
  id: string;
  name: string;
  type: DbType;
  source: Source;
  host?: string;
  port?: number;
  database?: string;
  user?: string;
  /** SQLite database file. */
  path?: string;
  /** pg_service.conf section. */
  service?: string;
  /** my.cnf option group suffix (`_prod` for `[client_prod]`, "" for `[client]`). */
  group?: string;
  /** Unix socket (my.cnf). */
  socket?: string;
}

/** What is kept in storage for a saved connection (no password, ever). */
export interface SavedConnection {
  name: string;
  type: DbType;
  host?: string;
  port?: number;
  database?: string;
  user?: string;
  path?: string;
}

// --- ~/.pgpass ---------------------------------------------------------------

export interface PgpassEntry {
  host: string;
  port: string;
  database: string;
  user: string;
  password: string;
}

/** Splits a pgpass line on unescaped colons (`\:` and `\\` are escapes). */
function splitPgpass(line: string): string[] {
  const fields: string[] = [];
  let cur = "";
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === "\\" && i + 1 < line.length) cur += line[++i];
    else if (c === ":") {
      fields.push(cur);
      cur = "";
    } else cur += c;
  }
  fields.push(cur);
  return fields;
}

export function parsePgpass(text: string): PgpassEntry[] {
  const out: PgpassEntry[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.replace(/\r$/, "");
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const f = splitPgpass(line);
    if (f.length < 5) continue;
    // A password may itself contain unescaped colons in sloppy files: keep the rest.
    out.push({ host: f[0], port: f[1], database: f[2], user: f[3], password: f.slice(4).join(":") });
  }
  return out;
}

/** The first pgpass entry matching a connection, as libpq picks it. */
export function matchPgpass(
  entries: PgpassEntry[],
  c: { host?: string; port?: number; database?: string; user?: string },
): PgpassEntry | undefined {
  const host = c.host || "localhost";
  const port = String(c.port ?? 5432);
  const user = c.user ?? "";
  const db = c.database || user;
  const ok = (pattern: string, value: string) => pattern === "*" || pattern === value;
  return entries.find((e) =>
    ok(e.host, host) && ok(e.port, port) && ok(e.database, db) && (e.user === "*" || !user || e.user === user)
  );
}

const portOf = (s: string | undefined) => {
  const n = Number(s);
  return s && Number.isInteger(n) && n > 0 && n < 65536 ? n : undefined;
};

/** One connection per pgpass line with a concrete host (wildcard hosts are credential templates). */
export function pgpassConnections(entries: PgpassEntry[]): Connection[] {
  const seen = new Set<string>();
  const out: Connection[] = [];
  for (const e of entries) {
    if (e.host === "*") continue;
    const database = e.database === "*" ? undefined : e.database;
    const user = e.user === "*" ? undefined : e.user;
    const port = e.port === "*" ? undefined : portOf(e.port);
    const id = `pgpass:${user ?? ""}@${e.host}:${port ?? ""}/${database ?? ""}`;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      name: `${database ?? "any database"} on ${e.host}`,
      type: "postgres",
      source: "pgpass",
      host: e.host,
      port,
      database,
      user,
    });
  }
  return out;
}

// --- INI files (pg_service.conf, my.cnf) -----------------------------------------

export type Ini = { section: string; values: Record<string, string> }[];

export function parseIni(text: string): Ini {
  const out: Ini = [];
  let cur: Ini[number] | undefined;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || line.startsWith(";") || line.startsWith("!")) continue;
    const head = /^\[([^\]]+)\]$/.exec(line);
    if (head) {
      cur = { section: head[1].trim(), values: {} };
      out.push(cur);
      continue;
    }
    if (!cur) continue;
    const eq = line.indexOf("=");
    const key = (eq < 0 ? line : line.slice(0, eq)).trim().toLowerCase().replace(/-/g, "_");
    let value = eq < 0 ? "" : line.slice(eq + 1).trim();
    if (/^(["']).*\1$/.test(value) && value.length >= 2) value = value.slice(1, -1);
    cur.values[key] = value;
  }
  return out;
}

export interface PgService {
  name: string;
  host?: string;
  port?: number;
  database?: string;
  user?: string;
  password?: string;
}

export function parsePgService(text: string): PgService[] {
  return parseIni(text).map(({ section, values: v }) => ({
    name: section,
    host: v.host || v.hostaddr || undefined,
    port: portOf(v.port),
    database: v.dbname || undefined,
    user: v.user || undefined,
    password: v.password || undefined,
  }));
}

export function serviceConnections(services: PgService[]): Connection[] {
  return services.map((s) => ({
    id: `service:${s.name}`,
    name: s.name,
    type: "postgres" as const,
    source: "service" as const,
    service: s.name,
    host: s.host,
    port: s.port,
    database: s.database,
    user: s.user,
  }));
}

export interface MyCnfGroup {
  /** "" for `[client]` / `[mysql]`, else the suffix (`_prod`). */
  suffix: string;
  host?: string;
  port?: number;
  database?: string;
  user?: string;
  password?: string;
  socket?: string;
}

/**
 * Client option groups of a my.cnf: `[client]` and `[mysql]` make the default
 * connection, `[client_x]` / `[mysql_x]` are read by `--defaults-group-suffix=_x`.
 */
export function parseMyCnf(text: string): MyCnfGroup[] {
  const groups = new Map<string, Record<string, string>>();
  for (const { section, values } of parseIni(text)) {
    const m = /^(client|mysql|mariadb-client|mariadb)(.*)$/i.exec(section);
    if (!m) continue;
    let suffix = m[2];
    if (m[1].toLowerCase().startsWith("mariadb") && suffix.startsWith("-client")) suffix = suffix.slice(7);
    const merged = { ...(groups.get(suffix) ?? {}), ...values };
    groups.set(suffix, merged);
  }
  const out: MyCnfGroup[] = [];
  for (const [suffix, v] of groups) {
    if (!v.host && !v.user && !v.database && !v.socket) continue;
    out.push({
      suffix,
      host: v.host || undefined,
      port: portOf(v.port),
      database: v.database || undefined,
      user: v.user || undefined,
      password: v.password ?? v.pass ?? undefined,
      socket: v.socket || undefined,
    });
  }
  return out;
}

export function myCnfConnections(groups: MyCnfGroup[]): Connection[] {
  return groups.map((g) => ({
    id: `mycnf:${g.suffix}`,
    name: g.suffix ? g.suffix.replace(/^[_-]/, "") : `${g.user ?? "default"}@${g.host ?? "localhost"}`,
    type: "mysql" as const,
    source: "mycnf" as const,
    group: g.suffix,
    host: g.host,
    port: g.port,
    database: g.database,
    user: g.user,
    socket: g.socket,
  }));
}

// --- Saved connections and their secret preference ------------------------------

export function savedConnections(saved: unknown): Connection[] {
  if (!Array.isArray(saved)) return [];
  return saved.filter((s): s is SavedConnection =>
    !!s && typeof s === "object" && typeof s.name === "string" && TYPES.includes(s.type)
  ).map((s) => ({
    id: `saved:${s.name}`,
    name: s.name,
    type: s.type,
    source: "saved" as const,
    host: s.type === "sqlite" ? undefined : s.host,
    port: s.type === "sqlite" ? undefined : s.port,
    database: s.type === "sqlite" ? undefined : s.database,
    user: s.type === "sqlite" ? undefined : s.user,
    path: s.type === "sqlite" ? s.path : undefined,
  }));
}

/**
 * The "Passwords" secret preference: `name=password` pairs separated by `;`
 * or new lines. `\;` and `\\` escape inside a password.
 */
export function parsePasswords(text: unknown): Map<string, string> {
  const out = new Map<string, string>();
  const s = String(text ?? "");
  let cur = "";
  const flush = () => {
    const eq = cur.indexOf("=");
    if (eq > 0) out.set(cur.slice(0, eq).trim(), cur.slice(eq + 1));
    cur = "";
  };
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "\\" && i + 1 < s.length) cur += s[++i];
    else if (c === ";" || c === "\n") flush();
    else cur += c;
  }
  flush();
  return out;
}

export interface FormInput {
  name?: string;
  type?: string;
  host?: string;
  port?: string;
  database?: string;
  user?: string;
}

/** Validates the form; for SQLite, `database` is the file path. */
export function toSaved(v: FormInput, home: string): SavedConnection {
  const name = (v.name ?? "").trim();
  if (!name) throw new Error("Give the connection a name");
  const type = (v.type ?? "postgres") as DbType;
  if (!TYPES.includes(type)) throw new Error(`Unknown type ${v.type}`);
  if (type === "sqlite") {
    let path = (v.database ?? "").trim();
    if (!path) throw new Error("Enter the path of the SQLite file in Database");
    if (path.startsWith("~/")) path = home + path.slice(1);
    if (!path.startsWith("/")) throw new Error("Use an absolute path (or ~/…) for the SQLite file");
    return { name, type, path };
  }
  const portText = (v.port ?? "").trim();
  const port = portText ? portOf(portText) : DEFAULT_PORTS[type];
  if (port === undefined) throw new Error(`Port must be a number from 1 to 65535, not “${portText}”`);
  const out: SavedConnection = { name, type, host: (v.host ?? "").trim() || "localhost", port };
  const database = (v.database ?? "").trim();
  const user = (v.user ?? "").trim();
  if (database) out.database = database;
  if (user) out.user = user;
  return out;
}

/** Replaces (by name, or `previous` when renaming) or adds a saved connection. */
export function upsertSaved(all: SavedConnection[], next: SavedConnection, previous?: string): SavedConnection[] {
  const rest = all.filter((s) => s.name !== (previous ?? next.name));
  if (rest.some((s) => s.name === next.name)) throw new Error(`A connection named “${next.name}” already exists`);
  return [...rest, next].sort((a, b) => a.name.localeCompare(b.name));
}

// --- URLs and command lines -------------------------------------------------------

const hostPart = (host: string) => host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;

/** A connection URL; the password is masked unless `reveal`. */
export function connectionUrl(c: Connection, password?: string, reveal = false): string {
  if (c.type === "sqlite") return `sqlite://${c.path ?? ""}`;
  if (c.type === "postgres" && c.service) return `postgresql://?service=${encodeURIComponent(c.service)}`;
  const scheme = { postgres: "postgresql", mysql: "mysql", redis: "redis" }[c.type];
  const pw = password ? `:${reveal ? encodeURIComponent(password) : "****"}` : "";
  const user = c.user ? encodeURIComponent(c.user) : "";
  const auth = user || pw ? `${user}${pw}@` : "";
  const port = c.port ? `:${c.port}` : "";
  const db = c.database ? `/${encodeURIComponent(c.database)}` : "";
  return `${scheme}://${auth}${hostPart(c.host ?? "localhost")}${port}${db}`;
}

export type Client = "psql" | "pgcli" | "mysql" | "mariadb" | "mycli" | "sqlite3" | "litecli" | "redis-cli";

export const CLIENTS: Record<DbType, Client[]> = {
  postgres: ["psql", "pgcli"],
  mysql: ["mysql", "mariadb", "mycli"],
  sqlite: ["sqlite3", "litecli"],
  redis: ["redis-cli"],
};

/** Environment variable each client reads a password from (kept out of argv). */
const PASSWORD_ENV: Partial<Record<Client, string>> = {
  psql: "PGPASSWORD",
  pgcli: "PGPASSWORD",
  mysql: "MYSQL_PWD",
  mariadb: "MYSQL_PWD",
  mycli: "MYSQL_PWD",
  "redis-cli": "REDISCLI_AUTH",
};

export interface Invocation {
  argv: string[];
  env: Record<string, string>;
}

/**
 * How to open `c` with `client`. Files the clients read themselves
 * (pgpass, pg_service.conf, my.cnf) need no password here.
 */
export function clientCommand(c: Connection, client: Client, password?: string): Invocation {
  const env: Record<string, string> = {};
  const envName = PASSWORD_ENV[client];
  if (password && envName) env[envName] = password;
  const argv: string[] = [client];
  switch (c.type) {
    case "postgres":
      if (c.service) {
        argv.push(`service=${c.service}`);
        break;
      }
      if (c.host) argv.push("-h", c.host);
      if (c.port) argv.push("-p", String(c.port));
      if (c.user) argv.push("-U", c.user);
      if (c.database) argv.push("-d", c.database);
      break;
    case "mysql":
      if (c.source === "mycnf") {
        if (c.group) argv.push(`--defaults-group-suffix=${c.group}`);
        break;
      }
      if (c.host) argv.push("-h", c.host);
      if (c.port) argv.push("-P", String(c.port));
      if (c.user) argv.push("-u", c.user);
      if (c.database) argv.push(c.database);
      break;
    case "sqlite":
      argv.push(c.path ?? "");
      break;
    case "redis":
      if (c.host) argv.push("-h", c.host);
      if (c.port) argv.push("-p", String(c.port));
      if (c.user) argv.push("--user", c.user);
      if (c.database && /^\d+$/.test(c.database)) argv.push("-n", c.database);
      break;
  }
  return { argv, env };
}

// --- Status -----------------------------------------------------------------------

export type Health = "up" | "auth" | "rejecting" | "down" | "missing" | "unknown";

export interface Status {
  health: Health;
  text: string;
}

export const HEALTH_COLORS = {
  up: "green",
  auth: "green",
  rejecting: "orange",
  down: "red",
  missing: "gray",
  unknown: "gray",
} as const;

/** The program and arguments that check whether the server answers. */
export function statusCommand(c: Connection): string[] | undefined {
  switch (c.type) {
    case "postgres":
      if (c.service) return ["pg_isready", "-t", "3", "-d", `service=${c.service}`];
      return [
        "pg_isready",
        "-t",
        "3",
        "-h",
        c.host ?? "localhost",
        "-p",
        String(c.port ?? 5432),
        ...(c.user ? ["-U", c.user] : []),
        ...(c.database ? ["-d", c.database] : []),
      ];
    case "mysql":
      return [
        "mysqladmin",
        ...(c.source === "mycnf" && c.group ? [`--defaults-group-suffix=${c.group}`] : []),
        "--connect-timeout=3",
        ...(c.source !== "mycnf" || c.host ? ["-h", c.host ?? "localhost"] : []),
        ...(c.port ? ["-P", String(c.port)] : []),
        ...(c.source !== "mycnf" && c.user ? ["-u", c.user] : []),
        "ping",
      ];
    case "redis":
      return ["redis-cli", "-h", c.host ?? "localhost", "-p", String(c.port ?? 6379), "ping"];
    case "sqlite":
      return c.path
        ? ["sqlite3", "-readonly", c.path, "select count(*) from sqlite_master where type = 'table'"]
        : undefined;
  }
}

/** `exec` errors read "prog exited with N: message". */
export function exitCode(err: unknown): number | undefined {
  const m = /exited with (\d+)/.exec(err instanceof Error ? err.message : String(err));
  return m ? Number(m[1]) : undefined;
}

const errorText = (err: unknown) =>
  (err instanceof Error ? err.message : String(err)).replace(/^[\w-]+ exited with \d+: /, "");

/** Reads the result of {@link statusCommand}: its output, or the error it threw. */
export function interpretStatus(type: DbType, out: string | undefined, err?: unknown): Status {
  if (err !== undefined) {
    const text = errorText(err);
    if (type === "postgres") {
      const code = exitCode(err);
      if (code === 1) return { health: "rejecting", text: "Rejecting connections" };
      if (code === 2) return { health: "down", text: "No response" };
      if (code === 3) return { health: "unknown", text: text || "Invalid parameters" };
    }
    if (type === "mysql" && /Access denied/i.test(text)) return { health: "auth", text: "Up (access denied)" };
    if (type === "sqlite") {
      if (/unable to open|no such file/i.test(text)) return { health: "down", text: "File not found" };
      if (/not a database|encrypted/i.test(text)) return { health: "rejecting", text: "Not a SQLite database" };
    }
    if (/refused|can't connect|could not connect|timed out|timeout|unknown host|name or service/i.test(text)) {
      return { health: "down", text: "Unreachable" };
    }
    return { health: "unknown", text: text.split("\n")[0].slice(0, 80) || "Unknown" };
  }
  const o = (out ?? "").trim();
  switch (type) {
    case "postgres":
      return { health: "up", text: "Accepting connections" };
    case "mysql":
      return /alive/i.test(o) ? { health: "up", text: "Alive" } : { health: "unknown", text: o || "Unknown" };
    case "redis":
      if (/^PONG$/i.test(o)) return { health: "up", text: "PONG" };
      if (/NOAUTH|WRONGPASS|NOPERM/i.test(o)) return { health: "auth", text: "Up (needs auth)" };
      if (/LOADING/i.test(o)) return { health: "rejecting", text: "Loading dataset" };
      if (/Could not connect|refused/i.test(o)) return { health: "down", text: "Unreachable" };
      return { health: "unknown", text: o.slice(0, 80) || "No answer" };
    case "sqlite": {
      const n = Number(o);
      return Number.isFinite(n)
        ? { health: "up", text: `${n} table${n === 1 ? "" : "s"}` }
        : { health: "unknown", text: o || "Unknown" };
    }
  }
}

// --- Display -------------------------------------------------------------------

/** `user@host:port/db`, `service=prod` or the file path. */
export function describe(c: Connection, home = ""): string {
  if (c.type === "sqlite") {
    return home && c.path?.startsWith(home + "/") ? `~${c.path.slice(home.length)}` : c.path ?? "";
  }
  if (c.service) return `service=${c.service}`;
  if (c.socket && !c.host) return `${c.user ? `${c.user}@` : ""}${c.socket}`;
  const port = c.port && c.port !== DEFAULT_PORTS[c.type] ? `:${c.port}` : "";
  return `${c.user ? `${c.user}@` : ""}${c.host ?? "localhost"}${port}${c.database ? `/${c.database}` : ""}`;
}

export function sortConnections(all: Connection[]): Connection[] {
  const order: Source[] = ["saved", "service", "pgpass", "mycnf"];
  return [...all].sort((a, b) => order.indexOf(a.source) - order.indexOf(b.source) || a.name.localeCompare(b.name));
}

// --- Installing clients ------------------------------------------------------------

export type Family = "debian" | "fedora" | "arch" | "suse";

export function osFamily(osRelease: string): Family | undefined {
  const field = (k: string) => osRelease.match(new RegExp(`^${k}="?([^"\\n]*)"?`, "m"))?.[1]?.toLowerCase() ?? "";
  const ids = `${field("ID")} ${field("ID_LIKE")}`.split(/\s+/);
  if (ids.some((i) => ["arch", "manjaro", "endeavouros", "cachyos"].includes(i))) return "arch";
  if (ids.some((i) => ["debian", "ubuntu", "linuxmint", "pop"].includes(i))) return "debian";
  if (ids.some((i) => ["fedora", "rhel", "centos"].includes(i))) return "fedora";
  if (ids.some((i) => i.startsWith("opensuse") || i === "suse")) return "suse";
  return undefined;
}

const PACKAGES: Record<DbType, Record<Family, string>> = {
  postgres: { debian: "postgresql-client", fedora: "postgresql", arch: "postgresql", suse: "postgresql" },
  mysql: { debian: "mariadb-client", fedora: "mariadb", arch: "mariadb-clients", suse: "mariadb-client" },
  sqlite: { debian: "sqlite3", fedora: "sqlite", arch: "sqlite", suse: "sqlite3" },
  redis: { debian: "redis-tools", fedora: "redis", arch: "redis", suse: "redis" },
};

const MANAGERS: Record<Family, string> = {
  debian: "sudo apt install",
  fedora: "sudo dnf install",
  arch: "sudo pacman -S",
  suse: "sudo zypper install",
};

/** The install command for the client of `type`, for this distribution (Debian's when unknown). */
export function installCommand(type: DbType, family: Family | undefined): string {
  const f = family ?? "debian";
  return `${MANAGERS[f]} ${PACKAGES[type][f]}`;
}
