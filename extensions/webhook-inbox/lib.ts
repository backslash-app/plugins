// Webhook Inbox logic: webhook.site tokens and requests, how a request is
// shown, and how it is replayed to a local server. Pure, tested in lib_test.ts.

export const SITE = "https://webhook.site";

/** A webhook.site token: the inbox behind one URL. */
export interface Token {
  uuid: string;
  created_at?: string;
  expiry?: boolean;
  default_status?: number;
  default_content?: string;
  default_content_type?: string;
  latest_request_at?: string | null;
}

/** One request caught by webhook.site. */
export interface Hook {
  uuid: string;
  type?: "web" | "email" | "dns" | string;
  ip?: string;
  hostname?: string;
  method: string;
  user_agent?: string | null;
  content?: string | null;
  query?: Record<string, string | string[]> | [] | null;
  request?: Record<string, unknown> | [] | null;
  headers?: Record<string, string | string[]> | [] | null;
  url: string;
  size?: number;
  files?: unknown;
  created_at: string;
}

export interface Page {
  data: Hook[];
  total: number;
  is_last_page?: boolean;
}

/** What the extension remembers about an inbox. */
export interface Inbox {
  uuid: string;
  /** Unix ms. */
  created: number;
  label?: string;
}

export const webhookUrl = (uuid: string) => `${SITE}/${uuid}`;
export const viewUrl = (uuid: string, request?: string) => `${SITE}/#!/view/${uuid}${request ? `/${request}` : ""}`;

/** webhook.site dates are UTC without a zone: "2026-10-29 10:12:30". */
export function parseDate(s: string | undefined): number | undefined {
  if (!s) return undefined;
  const iso = /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(s) ? `${s.replace(" ", "T")}Z` : s;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : undefined;
}

/** The path the sender called, after the token: `/stripe/events`. */
export function requestPath(url: string, uuid: string): { path: string; search: string } {
  try {
    const u = new URL(url);
    let path = u.pathname;
    const i = path.indexOf(uuid);
    if (i >= 0) path = path.slice(i + uuid.length);
    // Subdomain URLs (https://<uuid>.webhook.site/x) keep the whole path.
    return { path: path || "/", search: u.search };
  } catch {
    return { path: "/", search: "" };
  }
}

/** Headers as name/value pairs (webhook.site gives arrays of values). */
export function headerList(h: Hook["headers"]): [string, string][] {
  if (!h || Array.isArray(h)) return [];
  return Object.entries(h).flatMap(([k, v]) =>
    (Array.isArray(v) ? v : [v]).map((x) => [k, String(x)] as [string, string])
  );
}

export function queryList(q: Hook["query"]): [string, string][] {
  if (!q || Array.isArray(q)) return [];
  return Object.entries(q).flatMap(([k, v]) =>
    (Array.isArray(v) ? v : [v]).map((x) => [k, String(x)] as [string, string])
  );
}

export const header = (pairs: [string, string][], name: string) =>
  pairs.find(([k]) => k.toLowerCase() === name.toLowerCase())?.[1];

/** Who probably sent it, from the user agent or a well-known header. */
export function senderOf(h: Hook): string | undefined {
  const headers = headerList(h.headers);
  const has = (n: string) => header(headers, n) !== undefined;
  if (has("stripe-signature")) return "Stripe";
  if (has("x-github-event")) return `GitHub · ${header(headers, "x-github-event")}`;
  if (has("x-gitlab-event")) return `GitLab · ${header(headers, "x-gitlab-event")}`;
  if (has("x-shopify-topic")) return `Shopify · ${header(headers, "x-shopify-topic")}`;
  if (has("x-slack-signature")) return "Slack";
  if (has("svix-id")) return "Svix";
  if (has("x-twilio-signature")) return "Twilio";
  if (has("paypal-transmission-id")) return "PayPal";
  const ua = h.user_agent ?? header(headers, "user-agent");
  if (!ua) return undefined;
  const m = /^([A-Za-z][\w.-]*)(?:\/[\w.-]+)?/.exec(ua);
  return m?.[1];
}

// ---------------------------------------------------------------------------
// Showing

/** The body for a code block: JSON indented, forms as key = value, the rest as is. */
export function prettyBody(contentType: string | undefined, text: string): { lang: string; text: string } {
  const type = (contentType ?? "").toLowerCase();
  const t = text.trim();
  if (/json/.test(type) || /^[[{]/.test(t)) {
    try {
      return { lang: "json", text: JSON.stringify(JSON.parse(t), null, 2) };
    } catch { /* not JSON */ }
  }
  if (/x-www-form-urlencoded/.test(type)) {
    return { lang: "", text: [...new URLSearchParams(t)].map(([k, v]) => `${k} = ${v}`).join("\n") };
  }
  if (/xml/.test(type) || /^<\?xml/.test(t)) return { lang: "xml", text };
  if (/html/.test(type)) return { lang: "html", text };
  return { lang: "", text };
}

export const fence = (text: string, lang = "") => {
  const longest = Math.max(2, ...(text.match(/`+/g) ?? []).map((t) => t.length));
  const f = "`".repeat(longest + 1);
  return `${f}${lang}\n${text}\n${f}`;
};

const LIMIT = 20_000;

export function hookMarkdown(h: Hook, uuid: string): string {
  const { path, search } = requestPath(h.url, uuid);
  const headers = headerList(h.headers);
  const query = queryList(h.query);
  const body = h.content ?? "";
  const out = [`### ${h.method} ${path}${search}`];
  if (query.length) out.push("**Query**", fence(query.map(([k, v]) => `${k} = ${v}`).join("\n")));
  if (headers.length) out.push("**Headers**", fence(headers.map(([k, v]) => `${k}: ${v}`).join("\n")));
  if (body) {
    const pretty = prettyBody(header(headers, "content-type"), body);
    out.push(
      "**Body**",
      fence(pretty.text.length > LIMIT ? `${pretty.text.slice(0, LIMIT)}\n…` : pretty.text, pretty.lang),
    );
  } else if (hasFiles(h)) out.push("_Multipart body with files: see it on webhook.site._");
  else out.push("_No body._");
  return out.join("\n\n");
}

export const hasFiles = (h: Hook) => !!h.files && typeof h.files === "object" && Object.keys(h.files).length > 0;

export const METHOD_COLORS: Record<string, "green" | "blue" | "orange" | "purple" | "red" | "gray"> = {
  GET: "green",
  POST: "blue",
  PUT: "orange",
  PATCH: "purple",
  DELETE: "red",
};

export function formatBytes(n: number | undefined): string {
  if (!n) return "0 B";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** "just now", "5 min ago", "3 h ago", "2 d ago". */
export function ago(ms: number | undefined, now = Date.now()): string {
  if (ms === undefined) return "";
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 45) return "just now";
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}

export const formatMs = (ms: number) => ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(2)} s`;

// ---------------------------------------------------------------------------
// Replaying

/** Hosts a request may be replayed to: the `net` permission lists exactly these. */
export const LOCAL_HOSTS = ["localhost", "127.0.0.1"];

/** `3000`, `:3000`, `localhost:3000/api` or `http://127.0.0.1:8080/hooks` → a base URL, checked. */
export function parseTarget(input: string): string {
  let t = input.trim();
  if (!t) throw new Error("Enter where to replay, e.g. http://localhost:3000");
  if (/^:?\d{1,5}(\/.*)?$/.test(t)) t = `localhost:${t.replace(/^:/, "")}`;
  if (!/^https?:\/\//i.test(t)) t = `http://${t}`;
  let u: URL;
  try {
    u = new URL(t);
  } catch {
    throw new Error(`“${input}” is not a URL`);
  }
  if (!LOCAL_HOSTS.includes(u.hostname)) {
    throw new Error(`Requests can only be replayed to this computer (localhost or 127.0.0.1), not ${u.hostname}`);
  }
  return `${u.protocol}//${u.host}${u.pathname.replace(/\/+$/, "")}${u.search}`;
}

/** Where the replay goes: the target, plus the original path when `keepPath`, plus the query. */
export function replayUrl(target: string, h: Hook, uuid: string, keepPath: boolean): string {
  const base = parseTarget(target);
  const { path, search } = requestPath(h.url, uuid);
  const u = new URL(base);
  const joined = keepPath && path !== "/" ? `${u.pathname.replace(/\/+$/, "")}${path}` : u.pathname || "/";
  const params = new URLSearchParams(u.search);
  for (const [k, v] of new URLSearchParams(search)) params.append(k, v);
  const q = params.toString();
  return `${u.protocol}//${u.host}${joined || "/"}${q ? `?${q}` : ""}`;
}

/** Headers added on the way (proxies, CDN) or that `fetch` sets itself are left out. */
const DROPPED =
  /^(host|content-length|connection|keep-alive|transfer-encoding|te|upgrade|proxy-.*|x-forwarded-.*|x-real-ip|forwarded|via|cf-.*|cdn-loop|true-client-ip|x-amzn-.*|x-request-start|accept-encoding|php-auth-.*)$/i;

export function replayHeaders(h: Hook): [string, string][] {
  return headerList(h.headers).filter(([k]) => !DROPPED.test(k));
}

export interface Replay {
  method: string;
  url: string;
  headers: [string, string][];
  body?: string;
}

export function replayRequest(target: string, h: Hook, uuid: string, keepPath: boolean): Replay {
  const method = h.method.toUpperCase();
  const body = method === "GET" || method === "HEAD" ? undefined : h.content || undefined;
  return { method, url: replayUrl(target, h, uuid, keepPath), headers: replayHeaders(h), body };
}

const quote = (s: string) => /^[\w@%+=:,./-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`;

/** A curl command sending the same request again. */
export function toCurl(r: Replay): string {
  const parts = ["curl"];
  if (r.method !== "GET" && !(r.method === "POST" && r.body)) parts.push("-X", r.method);
  parts.push(quote(r.url));
  for (const [k, v] of r.headers) parts.push("-H", quote(`${k}: ${v}`));
  if (r.body) parts.push("--data-raw", quote(r.body));
  return parts.join(" ");
}

// ---------------------------------------------------------------------------
// Inboxes

/** Newest first, one per token. */
export const addInbox = (all: Inbox[], inbox: Inbox) =>
  [inbox, ...all.filter((i) => i.uuid !== inbox.uuid)].slice(0, 20);

export const removeInbox = (all: Inbox[], uuid: string) => all.filter((i) => i.uuid !== uuid);

/** The inbox in use: the one picked if it still exists, else the newest. */
export const currentInbox = (all: Inbox[], picked: string | undefined) => all.find((i) => i.uuid === picked) ?? all[0];

export const shortId = (uuid: string) => uuid.slice(0, 8);
