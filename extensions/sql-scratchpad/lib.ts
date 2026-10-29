// SQL Scratchpad logic: connection URLs, splitting and classifying SQL, the
// command lines of psql / mysql / sqlite3, parsing their output, exports and
// query files. No I/O here; tested in lib_test.ts.

export type Kind = "postgres" | "mysql" | "sqlite";

export const KIND_NAMES: Record<Kind, string> = { postgres: "PostgreSQL", mysql: "MySQL / MariaDB", sqlite: "SQLite" };
export const KIND_COLORS = { postgres: "blue", mysql: "orange", sqlite: "teal" } as const;

export interface Connection {
  name: string;
  kind: Kind;
  host?: string;
  port?: number;
  user?: string;
  password?: string;
  database?: string;
  /** SQLite file. */
  path?: string;
  /** Query parameters of the URL (sslmode…). */
  params: [string, string][];
}

// ---------------------------------------------------------------------------
// Connections

const SCHEMES: Record<string, Kind> = {
  postgres: "postgres",
  postgresql: "postgres",
  mysql: "mysql",
  mariadb: "mysql",
  sqlite: "sqlite",
  sqlite3: "sqlite",
  file: "sqlite",
};

/**
 * A connection URL: `postgresql://user:pw@host:5432/db?sslmode=require`,
 * `mysql://user@host/db`, `sqlite:///abs/file.db`, `sqlite:~/app.db`, or a
 * bare path to a SQLite file. The same URLs as the Databases extension.
 */
export function parseUrl(url: string, home: string, name?: string): Connection {
  const u = url.trim();
  if (/^(~|\/)/.test(u)) return sqliteConnection(u, home, name);
  const m = /^([a-z][a-z0-9+.-]*):(.*)$/i.exec(u);
  const kind = m && SCHEMES[m[1].toLowerCase().replace(/\+.*$/, "")];
  if (!m || !kind) {
    throw new Error(`“${u.slice(0, 40)}” is not a postgresql://, mysql:// or sqlite:// URL`);
  }
  if (kind === "sqlite") return sqliteConnection(m[2].replace(/^\/\/(?=\/|~)/, ""), home, name);
  let parsed: URL;
  try {
    parsed = new URL(`http:${m[2]}`);
  } catch {
    throw new Error(`“${u.replace(/:[^:@/]*@/, ":****@")}” is not a valid URL`);
  }
  const database = decodeURIComponent(parsed.pathname.replace(/^\//, "")) || undefined;
  const host = parsed.hostname.replace(/^\[|\]$/g, "") || undefined;
  return {
    name: name || database || host || KIND_NAMES[kind],
    kind,
    host,
    port: parsed.port ? Number(parsed.port) : undefined,
    user: parsed.username ? decodeURIComponent(parsed.username) : undefined,
    password: parsed.password ? decodeURIComponent(parsed.password) : undefined,
    database,
    params: [...parsed.searchParams],
  };
}

function sqliteConnection(path: string, home: string, name?: string): Connection {
  let p = decodeURIComponent(path.replace(/\?.*$/, ""));
  if (p.startsWith("~/")) p = home + p.slice(1);
  if (!p.startsWith("/")) throw new Error(`Use an absolute path (or ~/…) for the SQLite file, not “${p}”`);
  return {
    name: name || p.split("/").pop()!.replace(/\.(db|sqlite3?|db3)$/i, ""),
    kind: "sqlite",
    path: p,
    params: [],
  };
}

/**
 * The Connections preference: `name=url` entries separated by `;` or new
 * lines (`\;` escapes a semicolon), or a bare URL named after its database.
 */
export function parseConnections(text: unknown, home: string): { connections: Connection[]; errors: string[] } {
  const entries: string[] = [];
  let cur = "";
  const s = String(text ?? "");
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "\\" && s[i + 1] === ";") cur += s[++i];
    else if (s[i] === ";" || s[i] === "\n") entries.push(cur), cur = "";
    else cur += s[i];
  }
  entries.push(cur);
  const connections: Connection[] = [];
  const errors: string[] = [];
  for (const raw of entries.map((e) => e.trim()).filter(Boolean)) {
    // `name=url`: the name is before the first `=` when it isn't part of the URL.
    const m = /^([^=:/~]+?)\s*=\s*(.+)$/.exec(raw);
    try {
      const c = m ? parseUrl(m[2], home, m[1].trim()) : parseUrl(raw, home);
      if (connections.some((x) => x.name === c.name)) c.name = `${c.name} (${connections.length + 1})`;
      connections.push(c);
    } catch (e) {
      errors.push((e as Error).message);
    }
  }
  return { connections, errors };
}

const hostPart = (host: string) => host.includes(":") ? `[${host}]` : host;

/** The URL again; the password is masked unless `reveal`. */
export function connectionUrl(c: Connection, reveal = false): string {
  if (c.kind === "sqlite") return `sqlite://${c.path}`;
  const scheme = c.kind === "postgres" ? "postgresql" : "mysql";
  const pw = c.password ? `:${reveal ? encodeURIComponent(c.password) : "****"}` : "";
  const auth = c.user || pw ? `${encodeURIComponent(c.user ?? "")}${pw}@` : "";
  const port = c.port ? `:${c.port}` : "";
  const db = c.database ? `/${encodeURIComponent(c.database)}` : "";
  const query = c.params.length ? `?${new URLSearchParams(c.params)}` : "";
  return `${scheme}://${auth}${hostPart(c.host ?? "localhost")}${port}${db}${query}`;
}

/** `user@host/db` or `~/app.db`, for a subtitle. */
export function describe(c: Connection, home = ""): string {
  if (c.kind === "sqlite") return home && c.path!.startsWith(`${home}/`) ? `~${c.path!.slice(home.length)}` : c.path!;
  return `${c.user ? `${c.user}@` : ""}${c.host ?? "localhost"}${c.port ? `:${c.port}` : ""}${
    c.database ? `/${c.database}` : ""
  }`;
}

// ---------------------------------------------------------------------------
// SQL

/**
 * Splits a script into statements on `;`, outside strings, quoted names,
 * comments and Postgres dollar quotes; a trigger body (`BEGIN … END;`) stays whole.
 */
export function splitStatements(sql: string, kind: Kind = "postgres"): string[] {
  const out: string[] = [];
  let start = 0;
  let i = 0;
  const n = sql.length;
  const push = (end: number) => {
    const s = sql.slice(start, end).trim();
    if (stripComments(s, kind).trim()) out.push(s);
  };
  while (i < n) {
    const c = sql[i];
    const next = sql[i + 1];
    if (c === "-" && next === "-" || (c === "#" && kind === "mysql")) {
      while (i < n && sql[i] !== "\n") i++;
    } else if (c === "/" && next === "*") {
      const end = sql.indexOf("*/", i + 2);
      i = end < 0 ? n : end + 2;
    } else if (c === "'" || c === '"' || c === "`") {
      i++;
      while (i < n) {
        if (sql[i] === "\\" && kind === "mysql" && c !== "`") i += 2;
        else if (sql[i] === c && sql[i + 1] === c) i += 2;
        else if (sql[i] === c) break;
        else i++;
      }
      i++;
    } else if (c === "$" && kind === "postgres") {
      const tag = /^\$([A-Za-z_]\w*)?\$/.exec(sql.slice(i));
      if (tag) {
        const end = sql.indexOf(tag[0], i + tag[0].length);
        i = end < 0 ? n : end + tag[0].length;
      } else i++;
    } else if (c === ";") {
      const current = stripComments(sql.slice(start, i), kind);
      // CREATE TRIGGER … BEGIN …; …; END;
      if (/^\s*create\s+(temp\w*\s+)?trigger\b/i.test(current) && !/\bend\s*$/i.test(current)) {
        i++;
        continue;
      }
      push(i);
      start = i + 1;
      i++;
    } else i++;
  }
  push(n);
  return out;
}

/** The SQL without comments, strings and quoted names replaced by `''` (for keyword checks). */
export function stripComments(sql: string, kind: Kind = "postgres"): string {
  return sql
    .replace(/\$([A-Za-z_]\w*)?\$[\s\S]*?\$\1\$/g, kind === "postgres" ? "''" : "$&")
    .replace(/'(?:[^'\\]|''|\\.)*'|"(?:[^"]|"")*"|`(?:[^`]|``)*`/g, "''")
    .replace(/--[^\n]*/g, " ")
    .replace(kind === "mysql" ? /#[^\n]*/g : /(?!)/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ");
}

const READ_ONLY_START = /^\s*\(?\s*(select|with|show|explain|describe|desc|values|table|pragma)\b/i;
/** Session and transaction statements: they change no data by themselves. */
const SESSION = /^\s*(set|reset|use|begin|start\s+transaction|commit|rollback|end|savepoint|release)\b/i;

/**
 * Keywords that make a statement change something: everything that isn't
 * SELECT / WITH / SHOW / EXPLAIN / DESCRIBE / VALUES / read-only PRAGMA, plus
 * data-changing CTEs (`WITH x AS (DELETE …)`), `SELECT … INTO`, `EXPLAIN ANALYZE`
 * of a change, and locking reads (`FOR UPDATE`).
 */
export function statementWrites(statement: string, kind: Kind = "postgres"): string | undefined {
  const s = stripComments(statement, kind).trim();
  if (!s) return undefined;
  const first = /^\(?\s*([a-z]+)/i.exec(s)?.[1]?.toUpperCase() ?? "?";
  if (SESSION.test(s) && !/\bread\s+write\b|transaction_read_only/i.test(s)) return undefined;
  if (!READ_ONLY_START.test(s)) return first;
  // PRAGMA name = value changes a setting; PRAGMA name and PRAGMA name(arg) read.
  if (first === "PRAGMA") return /=/.test(s) ? "PRAGMA" : undefined;
  if (first === "EXPLAIN" && !/\banaly[sz]e\b/i.test(s)) return undefined;
  if (first === "SHOW" || first === "DESCRIBE" || first === "DESC") return undefined;
  const body = first === "EXPLAIN" ? s.replace(/^explain\s+(\([^)]*\)\s*)?(analy[sz]e\s+)?(verbose\s+)?/i, "") : s;
  const inner = /\b(insert|update|delete|merge)\b/i.exec(body);
  if (inner && !/\bfor\s+update\b/i.test(body.slice(Math.max(0, inner.index - 4), inner.index + 6))) {
    return inner[1].toUpperCase();
  }
  if (/\bfor\s+(no\s+key\s+)?update\b|\bfor\s+(key\s+)?share\b/i.test(body)) return "SELECT … FOR UPDATE";
  if (/^\s*select\b[\s\S]*\binto\s+(?!@|outfile|dumpfile)\w/i.test(body) && kind === "postgres") return "SELECT INTO";
  if (/\binto\s+(outfile|dumpfile)\b/i.test(body)) return "SELECT INTO OUTFILE";
  return undefined;
}

/** The kinds of change a script makes, in order (`["UPDATE", "DROP"]`), empty for a read-only one. */
export function writes(sql: string, kind: Kind = "postgres"): string[] {
  const found = splitStatements(sql, kind).map((s) => statementWrites(s, kind)).filter((w): w is string => !!w);
  return [...new Set(found)];
}

/** Used by the dangerous-change warning: DROP, TRUNCATE, DELETE or UPDATE without WHERE. */
export function dangerous(sql: string, kind: Kind = "postgres"): string[] {
  const out: string[] = [];
  for (const st of splitStatements(sql, kind)) {
    const s = stripComments(st, kind).trim();
    if (/^(drop|truncate)\b/i.test(s)) out.push(`${/^\w+/.exec(s)![0].toUpperCase()} cannot be undone`);
    else if (/^(delete|update)\b/i.test(s) && !/\bwhere\b/i.test(s)) {
      out.push(`${/^\w+/.exec(s)![0].toUpperCase()} without WHERE changes every row`);
    }
  }
  return [...new Set(out)];
}

// ---------------------------------------------------------------------------
// Running

export interface Invocation {
  program: string;
  args: string[];
  env: Record<string, string>;
  stdin: string;
}

export const MARKER = "__backslash_result__";

const counted = (w: string | undefined) => !!w && /^(INSERT|UPDATE|DELETE|REPLACE)$/.test(w);

const terminated = (s: string) => /;\s*$/.test(s) ? s : `${s};`;

/**
 * How to run `sql` on `c`, showing only the last statement's result. When
 * `readOnly`, the session refuses changes on its own: Postgres's
 * default_transaction_read_only, MySQL's READ ONLY transactions, sqlite3 -readonly.
 */
export function invocation(c: Connection, sql: string, readOnly: boolean): Invocation {
  const statements = splitStatements(sql, c.kind);
  if (!statements.length) throw new Error("The query is empty");
  const last = statements.at(-1)!;
  const before = statements.slice(0, -1).map(terminated);
  const lastWrites = statementWrites(last, c.kind);
  switch (c.kind) {
    case "postgres": {
      const env: Record<string, string> = { PGCONNECT_TIMEOUT: "10", PGAPPNAME: "Backslash SQL Scratchpad" };
      if (c.password) env.PGPASSWORD = c.password;
      // Earlier statements' output goes nowhere: only the last result is printed.
      const script = [
        "\\o /dev/null",
        ...(readOnly ? ["SET default_transaction_read_only = on;"] : []),
        ...before,
        "\\o",
        terminated(last),
        "",
      ].join("\n");
      return {
        program: "psql",
        args: [
          "--no-psqlrc",
          "--csv",
          "--set=ON_ERROR_STOP=1",
          "--dbname",
          connectionUrl({ ...c, password: undefined }),
          "--file=-",
        ],
        env,
        stdin: script,
      };
    }
    case "mysql": {
      const env: Record<string, string> = {};
      if (c.password) env.MYSQL_PWD = c.password;
      const args = ["--batch", "--default-character-set=utf8mb4", "--connect-timeout=10"];
      if (c.host) args.push("--host", c.host);
      if (c.port) args.push("--port", String(c.port));
      if (c.user) args.push("--user", c.user);
      const ssl = c.params.find(([k]) => /^ssl[-_]?mode$/i.test(k))?.[1];
      if (ssl) args.push(`--ssl-mode=${ssl.toUpperCase()}`);
      if (c.database) args.push(c.database);
      // mysql prints every result: a marker row tells where the last one starts.
      const script = [
        ...(readOnly ? ["SET SESSION TRANSACTION READ ONLY;"] : []),
        ...before,
        `SELECT '${MARKER}' AS ${MARKER};`,
        terminated(last),
        ...(counted(lastWrites) ? ["SELECT ROW_COUNT() AS rows_affected;"] : []),
        "",
      ].join("\n");
      return { program: "mysql", args, env, stdin: script };
    }
    case "sqlite": {
      const script = [
        ".bail on",
        ".output /dev/null",
        ...before,
        ".output",
        terminated(last),
        ...(counted(lastWrites) ? ["SELECT changes() AS rows_affected;"] : []),
        "",
      ].join("\n");
      return {
        program: "sqlite3",
        args: [...(readOnly ? ["-readonly"] : []), "-bail", "-csv", "-header", c.path!],
        env: {},
        stdin: script,
      };
    }
  }
}

export interface Result {
  columns: string[];
  rows: string[][];
  /** A command tag without rows: "UPDATE 3", "CREATE TABLE". */
  message?: string;
}

/** RFC 4180 CSV, as psql --csv and sqlite3 -csv print it. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  let any = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') cell += c, i++;
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true, any = true;
    else if (c === ",") row.push(cell), cell = "", any = true;
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      any = false;
    } else cell += c, any = true;
  }
  if (any || cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

const PG_TAG = /^(INSERT \d+ \d+|[A-Z]+( [A-Z]+)*( \d+)?)$/;

/**
 * What psql printed for the last statement: CSV with a header and, for a
 * statement that changes something, its command tag ("UPDATE 3") after it.
 */
export function parsePsql(out: string, writes = false): Result {
  const lines = out.replace(/\s+$/, "").split("\n");
  let message: string | undefined;
  if (writes && lines.length && PG_TAG.test(lines.at(-1)!)) message = lines.pop();
  const text = lines.join("\n");
  if (!text.trim()) return { columns: [], rows: [], message };
  const [columns, ...rows] = parseCsv(text);
  return { columns, rows, message };
}

export function parseSqlite(out: string): Result {
  if (!out.trim()) return { columns: [], rows: [], message: "Done" };
  const [columns, ...rows] = parseCsv(out.replace(/\r?\n$/, ""));
  return { columns, rows };
}

const unescapeMysql = (s: string) =>
  s.replace(
    /\\(.)/g,
    (_, c: string) => ({ n: "\n", t: "\t", r: "\r", "0": "\0", "\\": "\\" } as Record<string, string>)[c] ?? c,
  );

/** `mysql --batch` output: tab-separated with a header, after the marker row. */
export function parseMysql(out: string): Result {
  let lines = out.replace(/\n$/, "").split("\n");
  const at = lines.indexOf(MARKER);
  if (at >= 0) lines = lines.slice(at + 2);
  if (!lines.length || (lines.length === 1 && !lines[0])) return { columns: [], rows: [], message: "Done" };
  const [head, ...rest] = lines.map((l) => l.split("\t").map(unescapeMysql));
  if (head.length === 1 && head[0] === "rows_affected" && rest.length === 1) {
    const n = Number(rest[0][0]);
    return { columns: [], rows: [], message: `${n} row${n === 1 ? "" : "s"} affected` };
  }
  return { columns: head, rows: rest };
}

/** The result of {@link invocation}'s run; `writes` when the last statement changes something. */
export function parseOutput(kind: Kind, out: string, writes = false): Result {
  const r = kind === "postgres" ? parsePsql(out, writes) : kind === "mysql" ? parseMysql(out) : parseSqlite(out);
  if (kind === "sqlite" && r.columns.length === 1 && r.columns[0] === "rows_affected" && r.rows.length === 1) {
    const n = Number(r.rows[0][0]);
    return { columns: [], rows: [], message: `${n} row${n === 1 ? "" : "s"} affected` };
  }
  return r;
}

/** The useful line of a client's error ("psql: error: connection to server … failed: …"). */
export function cleanError(stderr: string, program: string): string {
  const lines = stderr.split("\n").map((l) => l.trim()).filter(Boolean)
    .filter((l) => !/Using a password on the command line|\[Warning\]/i.test(l));
  const text = lines.join("\n")
    .replace(new RegExp(`^${program}:(\\s*error:)?\\s*`, "i"), "")
    .replace(/^(psql:)?<stdin>:\d+:\s*/gm, "")
    .replace(/^(ERROR|FATAL):\s+/gm, "")
    .replace(/^(Parse|Runtime) error near line \d+:\s*/m, "")
    .replace(/^ERROR \d+ \([\w\d]+\) at line \d+:\s*/m, "");
  return text.slice(0, 600) || `${program} failed`;
}

export function installHint(kind: Kind): string {
  switch (kind) {
    case "postgres":
      return "Install psql: sudo apt install postgresql-client (Fedora: postgresql, Arch: postgresql)";
    case "mysql":
      return "Install the mysql client: sudo apt install mariadb-client (Fedora: mariadb, Arch: mariadb-clients)";
    case "sqlite":
      return "Install sqlite3: sudo apt install sqlite3 (Fedora and Arch: sqlite)";
  }
}

// ---------------------------------------------------------------------------
// Schema

/** Tables and views of the database, as (schema, name, type) rows. */
export function tablesQuery(kind: Kind): string {
  switch (kind) {
    case "postgres":
      return "SELECT table_schema, table_name, table_type FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog', 'information_schema') ORDER BY table_schema = 'public' DESC, table_schema, table_name";
    case "mysql":
      return "SELECT table_schema, table_name, table_type FROM information_schema.tables WHERE table_schema = COALESCE(DATABASE(), table_schema) AND table_schema NOT IN ('mysql', 'information_schema', 'performance_schema', 'sys') ORDER BY table_schema, table_name";
    case "sqlite":
      return "SELECT 'main' AS table_schema, name AS table_name, type AS table_type FROM sqlite_master WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%' ORDER BY name";
  }
}

export function quoteIdent(name: string, kind: Kind): string {
  return kind === "mysql" ? `\`${name.replace(/`/g, "``")}\`` : `"${name.replace(/"/g, '""')}"`;
}

/** `SELECT * FROM "schema"."table" LIMIT 100`; the schema is left out where it's the default. */
export function previewQuery(kind: Kind, schema: string, table: string, limit = 100): string {
  const qualified = kind === "sqlite" || (kind === "postgres" && schema === "public")
    ? quoteIdent(table, kind)
    : `${quoteIdent(schema, kind)}.${quoteIdent(table, kind)}`;
  return `SELECT * FROM ${qualified} LIMIT ${limit};`;
}

// ---------------------------------------------------------------------------
// Exports

const csvCell = (s: string) => /[",\n\r]|^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;

export function toCsv(r: Result): string {
  return [r.columns, ...r.rows].map((row) => row.map(csvCell).join(",")).join("\n") + "\n";
}

/** Numbers stay numbers when the text is exactly one (no leading zero, safe size); the rest are strings. */
const jsonValue = (s: string): string | number => /^-?(0|[1-9]\d{0,14})(\.\d+)?$/.test(s) ? Number(s) : s;

export function toJson(r: Result, typed = true): string {
  const rows = r.rows.map((row) =>
    Object.fromEntries(r.columns.map((c, i) => [c, typed ? jsonValue(row[i] ?? "") : row[i] ?? ""]))
  );
  return JSON.stringify(rows, null, 2);
}

const mdCell = (s: string) => s.replace(/\|/g, "\\|").replace(/\r?\n/g, " ").slice(0, 200) || " ";

export function toMarkdown(r: Result, max = Infinity): string {
  if (!r.columns.length) return r.message ?? "";
  const rows = r.rows.slice(0, max);
  return [
    `| ${r.columns.map(mdCell).join(" | ")} |`,
    `| ${r.columns.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${r.columns.map((_, i) => mdCell(row[i] ?? "")).join(" | ")} |`),
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Query files

export interface Query {
  /** File name, `active-users.sql`. */
  file: string;
  name: string;
  connection?: string;
  sql: string;
}

/** A .sql file: `-- name:` and `-- connection:` lines at the top, then the SQL. */
export function parseQueryFile(file: string, text: string): Query {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  let name = "";
  let connection: string | undefined;
  let i = 0;
  for (; i < lines.length; i++) {
    const m = /^--\s*(name|connection|title|db)\s*:\s*(.*)$/i.exec(lines[i].trim());
    if (!m) break;
    if (/name|title/i.test(m[1])) name = m[2].trim();
    else connection = m[2].trim() || undefined;
  }
  return {
    file,
    name: name || file.replace(/\.sql$/i, "").replace(/[-_]+/g, " "),
    connection,
    sql: lines.slice(i).join("\n").trim(),
  };
}

export function formatQueryFile(q: Omit<Query, "file">): string {
  return [`-- name: ${q.name}`, ...(q.connection ? [`-- connection: ${q.connection}`] : []), "", q.sql.trim(), ""].join(
    "\n",
  );
}

/** `Active users (prod)` → `active-users-prod.sql`, avoiding names already taken. */
export function fileNameFor(name: string, taken: string[]): string {
  const base = name.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "query";
  let file = `${base}.sql`;
  for (let n = 2; taken.includes(file); n++) file = `${base}-${n}.sql`;
  return file;
}

/** One line of SQL for a subtitle. */
export const oneLine = (sql: string, max = 90) => {
  const s = stripComments(sql).replace(/\s+/g, " ").trim() || sql.replace(/\s+/g, " ").trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
};

export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export const formatMs = (ms: number) => ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(2)} s`;
