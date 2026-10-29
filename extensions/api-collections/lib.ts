// Request files of the usual API clients: Bruno (.bru), REST Client / JetBrains
// (.http, .rest) and Hurl (.hurl). Parsing, variables, curl and response
// formatting. Pure, tested in lib_test.ts.

export type Format = "bruno" | "http" | "hurl";

export const FORMAT_NAMES: Record<Format, string> = { bruno: "Bruno", http: "HTTP file", hurl: "Hurl" };

export const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];

/** A request as written in the file, `{{variables}}` unresolved. */
export interface RequestDef {
  name: string;
  method: string;
  url: string;
  headers: [string, string][];
  body?: string;
  /** A body read from a file (`< ./body.json` in .http files), relative to the request file. */
  bodyFile?: string;
  /** Variables set by the request itself (Bruno's vars:pre-request). */
  vars?: Record<string, string>;
  /** Parts that can't be sent from here (multipart bodies, scripts…). */
  notes?: string[];
  /** Order in the collection (Bruno's seq, or position in the file). */
  seq: number;
  /** 1-based line of the request in its file. */
  line?: number;
}

/** A request ready to send. */
export interface Request {
  method: string;
  url: string;
  headers: [string, string][];
  body?: string;
}

// ---------------------------------------------------------------------------
// Bruno

export interface BruBlock {
  name: string;
  /** `key: value` lines of a dictionary block; `~key` (disabled) lines are left out. */
  dict: [string, string][];
  /** The raw content of a text block (body:json…), dedented. */
  text: string;
  /** Items of a list block (`vars:secret [ … ]`). */
  list: string[];
}

/** The top-level blocks of a .bru file: `name {` … `}` or `name [` … `]` at the start of a line. */
export function parseBru(text: string): BruBlock[] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const blocks: BruBlock[] = [];
  for (let i = 0; i < lines.length; i++) {
    const open = /^([\w:.-]+)\s*([{[])\s*$/.exec(lines[i]);
    if (!open) continue;
    const close = open[2] === "{" ? "}" : "]";
    const body: string[] = [];
    let j = i + 1;
    for (; j < lines.length && lines[j].trimEnd() !== close; j++) body.push(lines[j]);
    i = j;
    const dedented = body.map((l) => l.replace(/^ {2}/, ""));
    const dict: [string, string][] = [];
    for (const l of dedented) {
      const m = /^([^:\s][^:]*?)\s*:\s?(.*)$/.exec(l.trim());
      if (m && !m[1].startsWith("~")) dict.push([m[1], m[2].trim()]);
    }
    blocks.push({
      name: open[1],
      dict,
      text: dedented.join("\n").replace(/^\n+|\s+$/g, ""),
      list: open[2] === "[" ? body.map((l) => l.trim().replace(/,$/, "")).filter((l) => l && !l.startsWith("~")) : [],
    });
  }
  return blocks;
}

const block = (blocks: BruBlock[], name: string) => blocks.find((b) => b.name === name);
const dictOf = (b: BruBlock | undefined) => Object.fromEntries(b?.dict ?? []);

export interface BruAuth {
  mode: string;
  headers: [string, string][];
  /** Query parameters (API key placed in the query). */
  query: [string, string][];
}

/** Auth of a request or of collection.bru, from its `auth:<mode>` block. */
export function bruAuth(blocks: BruBlock[], mode: string): BruAuth {
  const out: BruAuth = { mode, headers: [], query: [] };
  if (mode === "bearer") {
    const token = dictOf(block(blocks, "auth:bearer")).token;
    if (token) out.headers.push(["Authorization", `Bearer ${token}`]);
  } else if (mode === "basic") {
    const b = dictOf(block(blocks, "auth:basic"));
    if (b.username || b.password) {
      out.headers.push(["Authorization", `Basic {{__basic:${b.username ?? ""}:${b.password ?? ""}}}`]);
    }
  } else if (mode === "apikey") {
    const b = dictOf(block(blocks, "auth:apikey"));
    if (b.key) (b.placement === "queryparams" ? out.query : out.headers).push([b.key, b.value ?? ""]);
  }
  return out;
}

/** What collection.bru (or folder.bru) adds to every request: headers, auth, variables. */
export interface BruDefaults {
  headers: [string, string][];
  auth?: BruAuth;
  vars: Record<string, string>;
}

export function bruDefaults(text: string): BruDefaults {
  const blocks = parseBru(text);
  const mode = dictOf(block(blocks, "auth")).mode;
  return {
    headers: block(blocks, "headers")?.dict ?? [],
    auth: mode && mode !== "none" ? bruAuth(blocks, mode) : undefined,
    vars: dictOf(block(blocks, "vars:pre-request")),
  };
}

const BODY_TYPES: Record<string, string> = {
  json: "application/json",
  text: "text/plain",
  xml: "application/xml",
  sparql: "application/sparql-query",
  formUrlEncoded: "application/x-www-form-urlencoded",
  graphql: "application/json",
};

/** A .bru request file; undefined for other .bru files (environments, collection, folder). */
export function bruRequest(text: string, fileName: string, defaults?: BruDefaults): RequestDef | undefined {
  const blocks = parseBru(text);
  const verb = blocks.find((b) => METHODS.includes(b.name.toUpperCase()));
  if (!verb) return undefined;
  const m = dictOf(block(blocks, "meta"));
  const v = dictOf(verb);
  let url = v.url ?? "";
  // Path parameters: /users/:id with params:path { id: 42 }.
  for (const [k, value] of block(blocks, "params:path")?.dict ?? []) {
    url = url.replace(new RegExp(`:${k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=/|$|\\?|#)`, "g"), value);
  }
  const headers: [string, string][] = [...(defaults?.headers ?? [])];
  for (const h of block(blocks, "headers")?.dict ?? []) {
    const i = headers.findIndex(([k]) => k.toLowerCase() === h[0].toLowerCase());
    if (i >= 0) headers.splice(i, 1);
    headers.push(h);
  }
  const mode = v.auth ?? "none";
  const auth = mode === "inherit" ? defaults?.auth : mode !== "none" ? bruAuth(blocks, mode) : undefined;
  const notes: string[] = [];
  for (const [k, value] of auth?.headers ?? []) {
    if (!headers.some(([h]) => h.toLowerCase() === k.toLowerCase())) headers.push([k, value]);
  }
  if (auth?.query.length) {
    const q = auth.query.map(([k, value]) => `${encodeURIComponent(k)}=${value}`).join("&");
    url += (url.includes("?") ? "&" : "?") + q;
  }
  if (auth && !["bearer", "basic", "apikey", "none"].includes(auth.mode)) {
    notes.push(`${auth.mode} authentication isn't applied here`);
  }
  let body: string | undefined;
  const bodyType = v.body ?? "none";
  if (bodyType === "formUrlEncoded") {
    const fields = block(blocks, "body:form-urlencoded")?.dict ?? [];
    body = fields.map(([k, value]) => `${encodeURIComponent(k)}=${encodeURIComponent(value)}`).join("&") || undefined;
  } else if (bodyType === "graphql") {
    const query = block(blocks, "body:graphql")?.text ?? "";
    const varsText = block(blocks, "body:graphql:vars")?.text;
    let variables: unknown;
    try {
      variables = varsText ? JSON.parse(varsText) : undefined;
    } catch {
      notes.push("The GraphQL variables aren't valid JSON: they were left out");
    }
    body = JSON.stringify(variables === undefined ? { query } : { query, variables });
  } else if (bodyType === "multipartForm") {
    notes.push("Multipart bodies aren't sent from here");
  } else if (bodyType !== "none") {
    body = block(blocks, `body:${bodyType}`)?.text || undefined;
  }
  const type = BODY_TYPES[bodyType];
  if (body !== undefined && type && !headers.some(([k]) => k.toLowerCase() === "content-type")) {
    headers.push(["Content-Type", type]);
  }
  if (block(blocks, "script:pre-request") || block(blocks, "script:post-response")) {
    notes.push("Scripts don't run here");
  }
  const name = m.name || fileName.replace(/\.bru$/, "");
  return {
    name,
    method: verb.name.toUpperCase(),
    url,
    headers,
    body,
    vars: { ...dictOf(block(blocks, "vars:pre-request")) },
    notes,
    seq: Number(m.seq) || 0,
  };
}

/** An environment file of a Bruno collection (`environments/Local.bru`). */
export function bruEnvironment(text: string): { vars: Record<string, string>; secrets: string[] } {
  const blocks = parseBru(text);
  return { vars: dictOf(block(blocks, "vars")), secrets: block(blocks, "vars:secret")?.list ?? [] };
}

// ---------------------------------------------------------------------------
// .http / .rest (VS Code REST Client, JetBrains HTTP Client)

const REQUEST_LINE = new RegExp(
  `^(?:(${
    [...METHODS, "CONNECT", "TRACE"].join("|")
  })\\s+)?((?:https?:\\/\\/|\\{\\{|\\/|localhost)\\S*)(?:\\s+HTTP\\/[\\d.]+)?\\s*$`,
  "i",
);

/** Variables (`@name = value`) and requests (separated by `###`) of a .http file. */
export function parseHttpFile(text: string): { vars: Record<string, string>; requests: RequestDef[] } {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const vars: Record<string, string> = {};
  const requests: RequestDef[] = [];
  let chunk: { title: string; start: number; lines: string[] } = { title: "", start: 1, lines: [] };
  const flush = () => {
    const r = httpRequest(chunk.lines, chunk.title, chunk.start, requests.length + 1);
    if (r) requests.push(r);
  };
  lines.forEach((line, i) => {
    const sep = /^###+\s*(.*)$/.exec(line);
    if (sep) {
      flush();
      chunk = { title: sep[1].trim(), start: i + 2, lines: [] };
      return;
    }
    const v = /^@([\w.-]+)\s*=\s*(.*)$/.exec(line.trim());
    if (v) {
      vars[v[1]] = v[2].trim();
      chunk.lines.push("");
      return;
    }
    chunk.lines.push(line);
  });
  flush();
  return { vars, requests };
}

const isComment = (l: string) => /^\s*(#|\/\/)/.test(l);

function httpRequest(lines: string[], title: string, start: number, seq: number): RequestDef | undefined {
  let name = "";
  let i = 0;
  for (; i < lines.length; i++) {
    const l = lines[i];
    if (!l.trim()) continue;
    if (isComment(l)) {
      const n = /^\s*(?:#|\/\/)\s*@name\s*[= ]\s*(.+)$/.exec(l);
      if (n) name = n[1].trim();
      continue;
    }
    break;
  }
  const m = REQUEST_LINE.exec(lines[i]?.trim() ?? "");
  if (!m) return undefined;
  const line = start + i;
  let url = m[2];
  i++;
  // Query parameters continued on the next lines: `    ?page=2` / `    &limit=10`.
  for (; i < lines.length && /^\s+[?&]/.test(lines[i]); i++) url += lines[i].trim();
  const headers: [string, string][] = [];
  for (; i < lines.length && lines[i].trim(); i++) {
    if (isComment(lines[i])) continue;
    const h = /^([^:\s]+)\s*:\s*(.*)$/.exec(lines[i].trim());
    if (h) headers.push([h[1], h[2].trim()]);
  }
  const rest = lines.slice(i + 1);
  // Response handlers and redirections (`> {% … %}`, `>> file`, `<> file`) aren't part of the body.
  const cut = rest.findIndex((l) => /^(>\s|>>|<>)/.test(l));
  const bodyLines = (cut >= 0 ? rest.slice(0, cut) : rest).filter((l) => !/^\s*(#|\/\/)\s*@/.test(l));
  while (bodyLines.length && !bodyLines.at(-1)!.trim()) bodyLines.pop();
  while (bodyLines.length && !bodyLines[0].trim()) bodyLines.shift();
  const notes: string[] = [];
  if (cut >= 0 && /^>\s*\{%/.test(rest[cut])) notes.push("Response handler scripts don't run here");
  let body: string | undefined = bodyLines.join("\n") || undefined;
  let bodyFile: string | undefined;
  const file = body && /^<\s+(\S.*)$/.exec(body.trim());
  if (file && !body!.trim().includes("\n")) {
    bodyFile = file[1].trim();
    body = undefined;
  }
  const method = (m[1] ?? "GET").toUpperCase();
  return {
    name: name || title || `${method} ${url.replace(/^https?:\/\/[^/]+/, "") || "/"}`,
    method,
    url,
    headers,
    body,
    bodyFile,
    notes,
    seq,
    line,
  };
}

/** JetBrains environments (http-client.env.json, and its .private twin merged over it). */
export function parseHttpEnvironments(...texts: string[]): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {};
  for (const text of texts) {
    if (!text.trim()) continue;
    let data: unknown;
    try {
      data = JSON.parse(stripJsonComments(text));
    } catch {
      continue;
    }
    if (!data || typeof data !== "object") continue;
    for (const [env, vars] of Object.entries(data as Record<string, unknown>)) {
      if (!vars || typeof vars !== "object" || Array.isArray(vars)) continue;
      out[env] ??= {};
      for (const [k, v] of Object.entries(vars as Record<string, unknown>)) {
        if (v === null || typeof v === "object") continue;
        out[env][k] = String(v);
      }
    }
  }
  return out;
}

/** `//` and `/* *\/` comments and trailing commas out of JSONC, strings untouched. */
export function stripJsonComments(text: string): string {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      let j = i + 1;
      for (; j < text.length && text[j] !== '"'; j++) if (text[j] === "\\") j++;
      out += text.slice(i, j + 1);
      i = j;
    } else if (c === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      out += "\n";
    } else if (c === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      i = end < 0 ? text.length : end + 1;
    } else out += c;
  }
  return out.replace(/,(\s*[}\]])/g, "$1");
}

// ---------------------------------------------------------------------------
// Hurl

const HURL_REQUEST = /^([A-Z]+)\s+(\S+)\s*$/;
const HURL_METHODS = [...METHODS, "CONNECT", "TRACE"];
const isHurlRequest = (line: string) => HURL_REQUEST.test(line) && HURL_METHODS.includes(line.split(/\s/)[0]);
const HURL_RESPONSE = /^HTTP(\/[\d.]+)?\s+(\d{3}|\*)/;
const HURL_SECTION = /^\[([A-Za-z]+)\]\s*$/;

/** The requests of a .hurl file; their response parts (status, asserts, captures) are skipped. */
export function parseHurl(text: string): RequestDef[] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const out: RequestDef[] = [];
  let comment = "";
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const t = raw.trim();
    if (!t) continue;
    if (t.startsWith("#")) {
      comment = t.replace(/^#+\s*/, "") || comment;
      continue;
    }
    const m = isHurlRequest(t) ? HURL_REQUEST.exec(t) : null;
    if (!m) {
      comment = "";
      continue;
    }
    const line = i + 1;
    const method = m[1];
    let url = m[2];
    const headers: [string, string][] = [];
    const query: [string, string][] = [];
    const form: [string, string][] = [];
    const notes: string[] = [];
    let section = "";
    let body: string | undefined;
    i++;
    for (; i < lines.length; i++) {
      const l = lines[i];
      const lt = l.trim();
      if (!lt || lt.startsWith("#")) continue;
      if (HURL_RESPONSE.test(lt) || isHurlRequest(lt)) break;
      const s = HURL_SECTION.exec(lt);
      if (s) {
        section = s[1];
        if (/^(Multipart|MultipartFormData)$/.test(section)) notes.push("Multipart bodies aren't sent from here");
        continue;
      }
      // Bodies: JSON, XML, ``` multiline strings, `one line` strings.
      if (/^[{[]/.test(lt) && !HURL_SECTION.test(lt)) {
        const start = i;
        let depth = 0;
        for (; i < lines.length; i++) {
          depth += jsonDepthDelta(lines[i]);
          if (depth <= 0) break;
        }
        body = lines.slice(start, i + 1).join("\n");
        continue;
      }
      if (lt.startsWith("```")) {
        const end = lines.findIndex((x, j) => j > i && x.trim() === "```");
        body = lines.slice(i + 1, end < 0 ? lines.length : end).join("\n");
        i = end < 0 ? lines.length : end;
        continue;
      }
      if (lt.startsWith("<")) {
        const start = i;
        while (i + 1 < lines.length && lines[i + 1].trim() && !HURL_RESPONSE.test(lines[i + 1].trim())) i++;
        body = lines.slice(start, i + 1).join("\n");
        continue;
      }
      if (/^`.*`$/.test(lt)) {
        body = lt.slice(1, -1);
        continue;
      }
      if (/^(file|base64|hex),/.test(lt)) {
        notes.push("Bodies from files or encoded bytes aren't sent from here");
        continue;
      }
      const kv = /^([^:\s][^:]*?)\s*:\s*(.*)$/.exec(lt);
      if (!kv) continue;
      const value = unquoteHurl(kv[2]);
      if (!section) headers.push([kv[1], value]);
      else if (/^(Query|QueryStringParams)$/.test(section)) query.push([kv[1], value]);
      else if (/^(Form|FormParams)$/.test(section)) form.push([kv[1], value]);
      else if (section === "BasicAuth") headers.push(["Authorization", `Basic {{__basic:${kv[1]}:${value}}}`]);
      else if (section === "Cookies") {
        const c = headers.find(([k]) => k.toLowerCase() === "cookie");
        if (c) c[1] += `; ${kv[1]}=${value}`;
        else headers.push(["Cookie", `${kv[1]}=${value}`]);
      }
    }
    // The response part: skip to the next request, keeping the comment just above it.
    let next = "";
    for (; i < lines.length; i++) {
      const lt = lines[i].trim();
      if (isHurlRequest(lt)) {
        i--;
        break;
      }
      if (lt.startsWith("#")) next = lt.replace(/^#+\s*/, "") || next;
      else if (lt) next = "";
    }
    if (query.length) {
      url += (url.includes("?") ? "&" : "?") + query.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&");
    }
    if (form.length) {
      body = form.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");
      if (!headers.some(([k]) => k.toLowerCase() === "content-type")) {
        headers.push(["Content-Type", "application/x-www-form-urlencoded"]);
      }
    }
    if (body !== undefined && /^\s*[{[]/.test(body) && !headers.some(([k]) => k.toLowerCase() === "content-type")) {
      headers.push(["Content-Type", "application/json"]);
    }
    out.push({
      name: comment || `${method} ${url.replace(/^(https?:\/\/[^/]+|\{\{[^}]+\}\})/, "") || "/"}`,
      method,
      url,
      headers,
      body,
      notes,
      seq: out.length + 1,
      line,
    });
    comment = next;
  }
  return out;
}

function jsonDepthDelta(line: string): number {
  let d = 0;
  let inString = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inString) {
      if (c === "\\") i++;
      else if (c === '"') inString = false;
    } else if (c === '"') inString = true;
    else if (c === "{" || c === "[") d++;
    else if (c === "}" || c === "]") d--;
  }
  return d;
}

const unquoteHurl = (v: string) => /^".*"$/.test(v.trim()) ? v.trim().slice(1, -1).replace(/\\"/g, '"') : v.trim();

// ---------------------------------------------------------------------------
// Variables

/** Built-in variables of the three clients: `{{$guid}}`, `{{$timestamp}}`, `{{$random.uuid}}`… */
export function dynamicVariable(name: string, now = Date.now()): string | undefined {
  const [fn, ...args] = name.trim().split(/\s+/);
  switch (fn) {
    case "$guid":
    case "$uuid":
    case "$random.uuid":
    case "$randomUUID":
      return crypto.randomUUID();
    case "$timestamp":
      return String(Math.floor(now / 1000));
    case "$isoTimestamp":
      return new Date(now).toISOString();
    case "$datetime":
    case "$localDatetime":
      return args[0] === "rfc1123" ? new Date(now).toUTCString() : new Date(now).toISOString();
    case "$randomInt":
    case "$random.integer": {
      const min = Number(args[0] ?? 0) || 0;
      const max = Number(args[1] ?? 1000) || 1000;
      return String(Math.floor(min + Math.random() * Math.max(1, max - min)));
    }
  }
  return undefined;
}

const base64 = (s: string) => btoa(String.fromCharCode(...new TextEncoder().encode(s)));

export interface Resolved {
  text: string;
  missing: string[];
}

/**
 * Replaces `{{name}}` (spaces allowed inside the braces) with `vars`, then
 * built-in ones. Variables may refer to others (`@url = {{host}}/v1`). Names
 * that can't be resolved are kept as they are and returned in `missing`.
 */
export function interpolate(text: string, vars: Record<string, string>, now = Date.now()): Resolved {
  const missing = new Set<string>();
  const lookup = (name: string, depth: number): string | undefined => {
    if (name in vars) return depth > 8 ? undefined : sub(vars[name], depth + 1);
    const env = /^(?:process\.env\.|\$dotenv\s+|\$processEnv\s+)(\w+)$/.exec(name);
    if (env && `process.env.${env[1]}` in vars) return vars[`process.env.${env[1]}`];
    const basic = /^__basic:([^:]*):(.*)$/.exec(name);
    if (basic) return base64(`${sub(basic[1], depth)}:${sub(basic[2], depth)}`);
    if (name.startsWith("$")) return dynamicVariable(name, now);
    return undefined;
  };
  // Several passes, for variables inside others: {{__basic:{{user}}:{{password}}}}.
  const sub = (s: string, depth: number): string => {
    for (let pass = 0; pass < 4; pass++) {
      const next = s.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (all, name: string) => {
        const v = lookup(name, depth);
        if (v === undefined) {
          missing.add(name);
          return all;
        }
        return v;
      });
      if (next === s) break;
      s = next;
    }
    return s;
  };
  const out = sub(text, 0);
  return { text: out, missing: [...missing].filter((m) => !m.startsWith("__basic:")) };
}

/** The request to send: variables applied, `missing` names those still unknown. */
export function resolveRequest(def: RequestDef, vars: Record<string, string>, now = Date.now()) {
  const all = { ...vars, ...(def.vars ?? {}) };
  const missing = new Set<string>();
  const apply = (s: string) => {
    const r = interpolate(s, all, now);
    r.missing.forEach((m) => missing.add(m));
    return r.text;
  };
  const request: Request = {
    method: def.method,
    url: apply(def.url),
    headers: def.headers.map(([k, v]) => [apply(k), apply(v)] as [string, string]),
    body: def.body === undefined ? undefined : apply(def.body),
  };
  return { request, missing: [...missing] };
}

/** Names of all the `{{variables}}` a request uses (built-ins left out). */
export function variablesOf(def: RequestDef): string[] {
  const text = [def.url, ...def.headers.flat(), def.body ?? ""].join("\n");
  const names = [...text.matchAll(/\{\{\s*([^{}$]+?)\s*\}\}/g)].map((m) => m[1]).filter((n) => !n.startsWith("__"));
  return [...new Set(names)];
}

/** `KEY=value` lines of a .env file (quotes removed, comments skipped), as `process.env.KEY`. */
export function parseDotenv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_]\w*)\s*=\s*(.*)$/.exec(raw);
    if (!m) continue;
    let v = m[2].trim();
    if (/^(["']).*\1$/.test(v)) v = v.slice(1, -1);
    else v = v.replace(/\s+#.*$/, "");
    out[`process.env.${m[1]}`] = v;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Sending and showing

export function validate(r: Request): void {
  if (!METHODS.includes(r.method)) throw new Error(`${r.method} requests can't be sent from here`);
  let u: URL;
  try {
    u = new URL(r.url);
  } catch {
    throw new Error(`“${r.url}” is not a valid URL`);
  }
  if (!/^https?:$/.test(u.protocol)) throw new Error("Only http:// and https:// URLs can be sent");
}

const quote = (s: string) => /^[\w@%+=:,./-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`;

/** A curl command doing the same request. */
export function toCurl(r: Request): string {
  const parts = ["curl"];
  if (r.method === "HEAD") parts.push("-I");
  else if (r.method !== "GET" && !(r.method === "POST" && r.body)) parts.push("-X", r.method);
  parts.push(quote(r.url));
  for (const [k, v] of r.headers) parts.push("-H", quote(`${k}: ${v}`));
  if (r.body) parts.push("--data-raw", quote(r.body));
  return parts.join(" ");
}

export interface Response {
  status: number;
  statusText: string;
  ms: number;
  size: number;
  url: string;
  headers: [string, string][];
  contentType: string;
  /** Undefined for binary bodies. */
  text?: string;
}

const TEXTUAL =
  /^(text\/|application\/(json|.*\+json|xml|.*\+xml|javascript|x-www-form-urlencoded|yaml|graphql|x-ndjson)|image\/svg\+xml)/i;

/** Sends the request; `fetchFn` is replaceable for tests. */
export async function send(
  r: Request,
  options: { signal?: AbortSignal; fetchFn?: typeof fetch; now?: () => number } = {},
): Promise<Response> {
  validate(r);
  const now = options.now ?? (() => performance.now());
  const start = now();
  const res = await (options.fetchFn ?? fetch)(r.url, {
    method: r.method,
    headers: r.headers,
    body: r.method === "GET" || r.method === "HEAD" ? undefined : r.body,
    signal: options.signal,
  });
  const bytes = new Uint8Array(await res.arrayBuffer());
  const ms = Math.round(now() - start);
  const contentType = res.headers.get("content-type") ?? "";
  let text: string | undefined;
  if (!contentType || TEXTUAL.test(contentType)) {
    const charset = contentType.match(/charset=([\w-]+)/i)?.[1];
    try {
      text = new TextDecoder(charset ?? "utf-8").decode(bytes);
    } catch {
      text = new TextDecoder().decode(bytes);
    }
  }
  return {
    status: res.status,
    statusText: res.statusText,
    ms,
    size: bytes.byteLength,
    url: res.url || r.url,
    headers: [...res.headers.entries()] as [string, string][],
    contentType,
    text,
  };
}

/** The body for a code block: JSON indented, the rest as is. */
export function prettyBody(contentType: string, text: string): { lang: string; text: string } {
  const type = contentType.toLowerCase();
  const trimmed = text.trim();
  if (/json/.test(type) || (!type && /^[[{]/.test(trimmed))) {
    try {
      return { lang: "json", text: JSON.stringify(JSON.parse(trimmed), null, 2) };
    } catch { /* not JSON after all */ }
  }
  if (/html/.test(type)) return { lang: "html", text };
  if (/xml/.test(type)) return { lang: "xml", text };
  if (/x-www-form-urlencoded/.test(type)) {
    return { lang: "", text: [...new URLSearchParams(trimmed)].map(([k, v]) => `${k} = ${v}`).join("\n") };
  }
  return { lang: "", text };
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export const formatMs = (ms: number) => ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(2)} s`;

export function statusTint(status: number): "green" | "blue" | "purple" | "orange" | "red" {
  if (status >= 500) return "red";
  if (status >= 400) return "orange";
  if (status >= 300) return "purple";
  if (status >= 200) return "green";
  return "blue";
}

export const METHOD_COLORS: Record<string, "green" | "blue" | "orange" | "purple" | "red" | "gray"> = {
  GET: "green",
  POST: "blue",
  PUT: "orange",
  PATCH: "purple",
  DELETE: "red",
};

/** "api.example.com/v1/items" for a list subtitle; templates are kept as written. */
export function shortUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.host}${u.pathname === "/" ? "" : u.pathname}${u.search}`;
  } catch {
    return url.replace(/^https?:\/\//, "");
  }
}

/** Headers that carry credentials: shown masked, copies kept out of clipboard histories. */
export const SECRET_HEADER =
  /^(authorization|proxy-authorization|cookie|x-api-key|x-auth-token|private-token|api-key)$/i;

export const hasSecret = (r: Request) => r.headers.some(([k]) => SECRET_HEADER.test(k));

/** Environment variable names that hold secrets. */
export const isSecretName = (name: string) => /token|secret|password|passwd|key|auth|cookie|session/i.test(name);

// ---------------------------------------------------------------------------
// Files and folders

/** The format of a request file, by its name. */
export function fileFormat(name: string): Format | undefined {
  if (/\.bru$/i.test(name)) return "bruno";
  if (/\.(http|rest)$/i.test(name)) return "http";
  if (/\.hurl$/i.test(name)) return "hurl";
  return undefined;
}

export const SKIP_DIRS = new Set([
  "node_modules",
  "vendor",
  "target",
  "dist",
  "build",
  "out",
  "venv",
  "__pycache__",
  "coverage",
  "bower_components",
]);

export const DEFAULT_FOLDERS =
  "~/Projects, ~/projects, ~/code, ~/Code, ~/src, ~/dev, ~/git, ~/repos, ~/workspace, ~/work";

/** The folders preference, `~` expanded, duplicates and relative paths dropped. */
export function parseFolders(pref: string | undefined, home: string): string[] {
  const raw = (pref?.trim() || DEFAULT_FOLDERS).split(/[,\n]/).map((f) => f.trim()).filter(Boolean);
  const expanded = raw.map((f) => f.replace(/^~(?=\/|$)/, home).replace(/\/+$/, "") || "/");
  return [...new Set(expanded)].filter((f) => f.startsWith("/"));
}

export const tilde = (path: string, home: string) =>
  home && (path === home || path.startsWith(`${home}/`)) ? `~${path.slice(home.length)}` : path;

const dirOf = (file: string) => file.replace(/\/[^/]*$/, "");

/** Requests in the order of the collection: by folder, then Bruno's seq or file position, then name. */
export function sortRequests<T extends { def: RequestDef; file: string }>(all: T[]): T[] {
  return [...all].sort((a, b) =>
    dirOf(a.file).localeCompare(dirOf(b.file)) || (a.def.seq || 1e9) - (b.def.seq || 1e9) ||
    a.file.localeCompare(b.file) || a.def.name.localeCompare(b.def.name)
  );
}
