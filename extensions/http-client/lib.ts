// HTTP requests: parsing what the user types (or a pasted curl command), sending, formatting. Pure, tested in lib_test.ts.

export const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];

export interface Request {
  method: string;
  url: string;
  headers: [string, string][];
  body?: string;
}

export interface SavedRequest extends Request {
  id: string;
  name: string;
}

export interface HistoryEntry extends Request {
  status: number;
  ms: number;
  /** Unix ms. */
  at: number;
}

export interface Response {
  status: number;
  statusText: string;
  ms: number;
  size: number;
  url: string;
  redirected: boolean;
  headers: [string, string][];
  contentType: string;
  /** Undefined for binary bodies. */
  text?: string;
}

/** Splits a command line like a POSIX shell: quotes, backslashes, line continuations. */
export function shellWords(line: string): string[] {
  const words: string[] = [];
  let word = "";
  let inWord = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === "\\" && line[i + 1] === "\n") {
      i++;
    } else if (/\s/.test(c)) {
      if (inWord) words.push(word);
      word = "";
      inWord = false;
    } else if (c === "'") {
      const end = line.indexOf("'", i + 1);
      if (end < 0) throw new Error("Unterminated ' quote");
      word += line.slice(i + 1, end);
      i = end;
      inWord = true;
    } else if (c === '"') {
      let j = i + 1;
      for (; j < line.length && line[j] !== '"'; j++) {
        if (line[j] === "\\" && '"\\$`\n'.includes(line[j + 1])) j++;
        word += line[j];
      }
      if (j >= line.length) throw new Error('Unterminated " quote');
      i = j;
      inWord = true;
    } else if (c === "$" && line[i + 1] === "'") {
      // $'…' with \n, \t and \' escapes.
      let j = i + 2;
      for (; j < line.length && line[j] !== "'"; j++) {
        if (line[j] === "\\") {
          const e = line[++j];
          word += ({ n: "\n", t: "\t", r: "\r", "'": "'", "\\": "\\" } as Record<string, string>)[e] ?? `\\${e}`;
        } else word += line[j];
      }
      i = j;
      inWord = true;
    } else if (c === "\\") {
      word += line[++i] ?? "";
      inWord = true;
    } else {
      word += c;
      inWord = true;
    }
  }
  if (inWord) words.push(word);
  return words;
}

/** `example.com/x` → `https://example.com/x`; `localhost:8000` → `http://localhost:8000`. */
export function normalizeUrl(input: string): string {
  const t = input.trim();
  if (/^https?:\/\//i.test(t)) return t;
  if (/^(localhost|127\.|0\.0\.0\.0|\[::1\]|10\.|192\.168\.|[\w-]+\.local\b)/i.test(t)) return `http://${t}`;
  return `https://${t}`;
}

export function looksLikeUrl(word: string): boolean {
  return /^https?:\/\//i.test(word) ||
    /^(localhost|[\w-]+(\.[\w-]+)+|\d{1,3}(\.\d{1,3}){3}|\[[0-9a-f:]+\])(:\d+)?([/?#].*)?$/i.test(word);
}

export function parseHeader(line: string): [string, string] | undefined {
  const i = line.indexOf(":");
  if (i <= 0) return undefined;
  return [line.slice(0, i).trim(), line.slice(i + 1).trim()];
}

/** `Key: value` lines of a text area. */
export function parseHeaders(text: string): [string, string][] {
  return text.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#")).map((l) => {
    const h = parseHeader(l);
    if (!h) throw new Error(`“${l}” is not a header: write Name: value`);
    return h;
  });
}

export const headerText = (headers: [string, string][]) => headers.map(([k, v]) => `${k}: ${v}`).join("\n");

const header = (headers: [string, string][], name: string) =>
  headers.find(([k]) => k.toLowerCase() === name.toLowerCase())?.[1];

/** The usual curl flags; others are ignored when harmless, refused otherwise. */
export function parseCurl(words: string[]): Request {
  let method: string | undefined;
  let url: string | undefined;
  const headers: [string, string][] = [];
  const data: string[] = [];
  let head = false;
  let get = false;
  const IGNORED = new Set([
    "-L",
    "--location",
    "-s",
    "--silent",
    "-S",
    "--show-error",
    "-v",
    "--verbose",
    "-i",
    "--include",
    "-k",
    "--insecure",
    "--compressed",
    "-f",
    "--fail",
    "-#",
    "--http1.1",
    "--http2",
  ]);
  const WITH_VALUE = new Set([
    "-o",
    "--output",
    "-m",
    "--max-time",
    "--connect-timeout",
    "-w",
    "--write-out",
    "--retry",
  ]);
  // `-fsSL` is `-f -s -S -L`.
  words = words.flatMap((w) => /^-[sSLkivfIG#]{2,}$/.test(w) ? [...w.slice(1)].map((c) => `-${c}`) : [w]);
  for (let i = 1; i < words.length; i++) {
    const w = words[i];
    const value = () => {
      const v = words[++i];
      if (v === undefined) throw new Error(`${w} needs a value`);
      return v;
    };
    if (w === "-X" || w === "--request") method = value().toUpperCase();
    else if (w.startsWith("-X") && w.length > 2) method = w.slice(2).toUpperCase();
    else if (w === "-H" || w === "--header") {
      const h = parseHeader(value());
      if (h) headers.push(h);
    } else if (["-d", "--data", "--data-raw", "--data-binary", "--data-ascii"].includes(w)) {
      const v = value();
      if (v.startsWith("@") && w !== "--data-raw") throw new Error("Bodies read from files (@file) aren't supported");
      data.push(v);
    } else if (w === "--data-urlencode") {
      const v = value();
      const eq = v.indexOf("=");
      data.push(eq >= 0 ? `${v.slice(0, eq + 1)}${encodeURIComponent(v.slice(eq + 1))}` : encodeURIComponent(v));
    } else if (w === "--json") {
      data.push(value());
      if (!header(headers, "content-type")) headers.push(["Content-Type", "application/json"]);
      if (!header(headers, "accept")) headers.push(["Accept", "application/json"]);
    } else if (w === "-u" || w === "--user") headers.push(["Authorization", `Basic ${btoa(value())}`]);
    else if (w === "-A" || w === "--user-agent") headers.push(["User-Agent", value()]);
    else if (w === "-e" || w === "--referer") headers.push(["Referer", value()]);
    else if (w === "-b" || w === "--cookie") headers.push(["Cookie", value()]);
    else if (w === "-I" || w === "--head") head = true;
    else if (w === "-G" || w === "--get") get = true;
    else if (w === "--url") url = value();
    else if (IGNORED.has(w)) continue;
    else if (WITH_VALUE.has(w)) value();
    else if (w.startsWith("-")) throw new Error(`curl option ${w} isn't supported here`);
    else url = w;
  }
  if (!url) throw new Error("No URL in this curl command");
  let body = data.length ? data.join("&") : undefined;
  url = normalizeUrl(url);
  if (get && body) {
    url += (url.includes("?") ? "&" : "?") + body;
    body = undefined;
  }
  if (body && !header(headers, "content-type")) headers.push(["Content-Type", "application/x-www-form-urlencoded"]);
  return { method: method ?? (head ? "HEAD" : body ? "POST" : "GET"), url, headers, body };
}

/**
 * What the user typed: `GET https://…`, `POST api.example.com/items {"a":1}`,
 * a bare URL, or a pasted curl command. Undefined when it isn't a request.
 */
export function parseInput(input: string): Request | undefined {
  const t = input.trim();
  if (!t) return undefined;
  if (/^curl\s/.test(t)) return parseCurl(shellWords(t));
  const m = t.match(/^(?:([A-Za-z]+)\s+)?(\S+)(?:\s+([\s\S]*))?$/);
  if (!m) return undefined;
  const method = m[1]?.toUpperCase();
  if ((method && !METHODS.includes(method)) || !looksLikeUrl(m[2])) return undefined;
  const body = m[3]?.trim() || undefined;
  const headers: [string, string][] = [];
  if (body && /^[[{]/.test(body)) headers.push(["Content-Type", "application/json"]);
  return { method: method ?? (body ? "POST" : "GET"), url: normalizeUrl(m[2]), headers, body };
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

export function validate(r: Request): void {
  if (!METHODS.includes(r.method)) throw new Error(`Unknown method ${r.method}: use ${METHODS.join(", ")}`);
  let u: URL;
  try {
    u = new URL(r.url);
  } catch {
    throw new Error(`“${r.url}” is not a valid URL`);
  }
  if (!/^https?:$/.test(u.protocol)) throw new Error("Only http:// and https:// URLs can be sent");
  if (r.body && (r.method === "GET" || r.method === "HEAD")) {
    throw new Error(`A ${r.method} request can't have a body: use POST, PUT or PATCH`);
  }
}

const TEXTUAL =
  /^(text\/|application\/(json|.*\+json|xml|.*\+xml|javascript|ecmascript|x-www-form-urlencoded|yaml|toml|graphql|x-ndjson|problem\+json)|image\/svg\+xml)/i;

export const isTextual = (contentType: string) => !contentType || TEXTUAL.test(contentType);

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
    body: r.body,
    signal: options.signal,
    redirect: "follow",
  });
  const bytes = new Uint8Array(await res.arrayBuffer());
  const ms = Math.round(now() - start);
  const headers = [...res.headers.entries()] as [string, string][];
  const contentType = res.headers.get("content-type") ?? "";
  const charset = contentType.match(/charset=([\w-]+)/i)?.[1];
  let text: string | undefined;
  if (isTextual(contentType)) {
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
    redirected: res.redirected,
    headers,
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
  if (/x-ndjson/.test(type)) {
    try {
      return {
        lang: "json",
        text: trimmed.split("\n").map((l) => JSON.stringify(JSON.parse(l), null, 2)).join("\n"),
      };
    } catch { /* keep raw */ }
  }
  if (/html/.test(type)) return { lang: "html", text };
  if (/xml/.test(type)) return { lang: "xml", text };
  if (/x-www-form-urlencoded/.test(type)) {
    return { lang: "", text: [...new URLSearchParams(trimmed)].map(([k, v]) => `${k} = ${v}`).join("\n") };
  }
  return { lang: "", text };
}

/** The title of an HTML page, if any. */
export const htmlTitle = (html: string) =>
  html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1].replace(/\s+/g, " ").trim() || undefined;

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export const formatMs = (ms: number) => ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(2)} s`;

export type Tint = "green" | "blue" | "purple" | "orange" | "red" | "gray";

export function statusTint(status: number): Tint {
  if (status >= 500) return "red";
  if (status >= 400) return "orange";
  if (status >= 300) return "purple";
  if (status >= 200) return "green";
  return "blue";
}

/** Standard reason phrases, for HTTP/2 responses that carry none. */
const REASONS: Record<number, string> = {
  200: "OK",
  201: "Created",
  202: "Accepted",
  204: "No Content",
  206: "Partial Content",
  301: "Moved Permanently",
  302: "Found",
  303: "See Other",
  304: "Not Modified",
  307: "Temporary Redirect",
  308: "Permanent Redirect",
  400: "Bad Request",
  401: "Unauthorized",
  403: "Forbidden",
  404: "Not Found",
  405: "Method Not Allowed",
  409: "Conflict",
  410: "Gone",
  415: "Unsupported Media Type",
  422: "Unprocessable Content",
  429: "Too Many Requests",
  500: "Internal Server Error",
  502: "Bad Gateway",
  503: "Service Unavailable",
  504: "Gateway Timeout",
};

export const reason = (status: number, text: string) => text || REASONS[status] || "";

/** Keeps the newest entries, one per method and URL. */
export function addHistory(history: HistoryEntry[], entry: HistoryEntry, max = 30): HistoryEntry[] {
  return [entry, ...history.filter((h) => !(h.method === entry.method && h.url === entry.url))].slice(0, max);
}

/** "api.example.com/v1/items" for a list subtitle. */
export function shortUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.host}${u.pathname === "/" ? "" : u.pathname}${u.search}`;
  } catch {
    return url;
  }
}

/** "2 min ago", "3 h ago", "yesterday", "12 Oct". */
export function ago(ms: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 172800) return "yesterday";
  return new Date(ms).toLocaleDateString("en", { day: "numeric", month: "short" });
}

/** Headers that carry credentials: copies of the request are kept out of clipboard histories. */
export const hasSecret = (r: Request) =>
  r.headers.some(([k]) => /^(authorization|proxy-authorization|cookie|x-api-key|x-auth-token|private-token)$/i.test(k));
