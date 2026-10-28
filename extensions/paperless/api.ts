// Paperless-ngx REST API with a token (Authorization: Token …), names
// cached in storage, and thumbnails cached on disk: `/thumb/` needs the
// token in a header, which a picture shown by the launcher can't carry.

import { Icons, type Item, open, storage } from "@backslash/api";
import {
  cleanToken,
  type Doc,
  fileNameFrom,
  freePath,
  isAllowedHost,
  mimeOf,
  type Named,
  type Names,
  namesFrom,
  namesMissing,
  normalizeUrl,
  type Page,
  type Tag,
  type Task,
} from "./lib.ts";

export class SetupError extends Error {
  constructor(message: string, readonly kind: "url" | "token" | "host" | "down", readonly base?: string) {
    super(message);
  }
}

export interface Server {
  base: string;
  token: string;
}

const describe = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function server(preferences: Record<string, unknown>): Server {
  const base = normalizeUrl(preferences.url);
  if (!base) throw new SetupError("Add the address of your Paperless-ngx", "url");
  let host: string;
  try {
    host = new URL(base).hostname;
  } catch {
    throw new SetupError(`“${preferences.url}” is not an address`, "url");
  }
  if (!isAllowedHost(host)) throw new SetupError(`${host} is outside the networks this extension may reach`, "host");
  const token = cleanToken(preferences.token);
  if (!token) throw new SetupError("Add an API token", "token", base);
  return { base, token };
}

export async function request(
  s: Server,
  path: string,
  o: { method?: string; body?: unknown; form?: FormData; signal?: AbortSignal; timeout?: number } = {},
): Promise<Response> {
  const timeout = AbortSignal.timeout(o.timeout ?? 20_000);
  let res: Response;
  try {
    res = await fetch(`${s.base}${path}`, {
      method: o.method ?? "GET",
      signal: o.signal ? AbortSignal.any([o.signal, timeout]) : timeout,
      headers: {
        Authorization: `Token ${s.token}`,
        Accept: "application/json",
        ...(o.body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: o.form ?? (o.body === undefined ? undefined : JSON.stringify(o.body)),
    });
  } catch (e) {
    if (o.signal?.aborted) throw e;
    if (e instanceof Deno.errors.NotCapable || e instanceof Deno.errors.PermissionDenied) {
      throw new SetupError(`${new URL(s.base).hostname} is outside the networks this extension may reach`, "host");
    }
    throw new SetupError(`Can't reach Paperless-ngx at ${new URL(s.base).host}: ${describe(e)}`, "down", s.base);
  }
  if (res.status === 401) {
    await res.body?.cancel();
    throw new SetupError("Paperless-ngx refused the API token: check it in Settings", "token", s.base);
  }
  if (!res.ok) {
    const text = (await res.text().catch(() => "")).trim();
    let detail = text.slice(0, 200);
    try {
      const body = JSON.parse(text);
      detail = typeof body === "string"
        ? body
        : body.detail ?? Object.entries(body).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(" ") : v}`).join(", ");
    } catch {
      if (/^\s*</.test(text)) detail = "";
    }
    if (res.status === 403) throw new Error(`Paperless-ngx: permission denied${detail ? ` (${detail})` : ""}`);
    if (res.status === 404 && !detail) {
      throw new SetupError(`No Paperless-ngx API at ${s.base}: check the address`, "url", s.base);
    }
    throw new Error(`Paperless-ngx answered ${res.status}${detail ? `: ${detail}` : ""}`);
  }
  return res;
}

export async function json<T>(s: Server, path: string, o: Parameters<typeof request>[2] = {}): Promise<T> {
  const res = await request(s, path, o);
  const text = await res.text();
  if (/^\s*</.test(text)) throw new SetupError(`${s.base} answers, but not as Paperless-ngx: check the address`, "url");
  return (text ? JSON.parse(text) : undefined) as T;
}

// ---------------------------------------------------------------------------
// Names of correspondents, document types, storage paths and tags

const NAMES_TTL = 60 * 60_000;
let memory: { base: string; names: Names } | undefined;

async function all<T>(s: Server, path: string, signal?: AbortSignal): Promise<T[]> {
  const out: T[] = [];
  for (let page = 1; page <= 20; page++) {
    const r = await json<Page<T>>(s, `${path}?page_size=1000&page=${page}`, { signal });
    out.push(...r.results);
    if (!r.next || out.length >= r.count) break;
  }
  return out;
}

export async function loadNames(s: Server, signal?: AbortSignal): Promise<Names> {
  const [correspondents, types, tags, paths] = await Promise.all([
    all<Named>(s, "/api/correspondents/", signal),
    all<Named>(s, "/api/document_types/", signal),
    all<Tag>(s, "/api/tags/", signal),
    all<Named>(s, "/api/storage_paths/", signal).catch(() => []),
  ]);
  const names = namesFrom(correspondents, types, tags, paths);
  memory = { base: s.base, names };
  await storage.set(`names:${s.base}`, names as unknown as Record<string, never>).catch(() => {});
  return names;
}

/** Cached names, refreshed when old or when `docs` refer to one we don't know. */
export async function names(s: Server, docs: Doc[] = [], signal?: AbortSignal): Promise<Names> {
  let n = memory?.base === s.base ? memory.names : undefined;
  if (!n) {
    n = (await storage.get(`names:${s.base}`).catch(() => undefined)) as unknown as Names | undefined;
    if (n) memory = { base: s.base, names: n };
  }
  if (!n || Date.now() - n.fetched > NAMES_TTL || namesMissing(n, docs)) return await loadNames(s, signal);
  return n;
}

// ---------------------------------------------------------------------------
// Documents

export async function searchDocuments(
  s: Server,
  query: string,
  o: { inbox?: number[]; signal?: AbortSignal } = {},
): Promise<{ count: number; docs: Doc[] }> {
  const p = new URLSearchParams({ page_size: "30", truncate_content: "true" });
  if (query) p.set("query", query);
  else p.set("ordering", "-created");
  if (o.inbox?.length) p.set("tags__id__in", o.inbox.join(","));
  const page = await json<Page<Doc>>(s, `/api/documents/?${p}`, { signal: o.signal });
  return { count: page.count, docs: page.results };
}

export const getDocument = (s: Server, id: number, signal?: AbortSignal) =>
  json<Doc>(s, `/api/documents/${id}/`, { signal });

export async function setTags(s: Server, id: number, tags: number[]): Promise<void> {
  await json(s, `/api/documents/${id}/`, { method: "PATCH", body: { tags } });
}

export async function shareLink(s: Server, id: number, original: boolean): Promise<string> {
  const r = await json<{ slug: string }>(s, "/api/share_links/", {
    method: "POST",
    body: { document: id, expiration: null, file_version: original ? "original" : "archive" },
  });
  return r.slug;
}

const env = (k: string) => {
  try {
    return Deno.env.get(k) ?? "";
  } catch {
    return "";
  }
};
export const HOME = env("HOME");
export const CACHE = `${HOME}/.cache/backslash/paperless`;
export const DOWNLOADS = `${HOME}/Downloads`;

const exists = (p: string) => {
  try {
    Deno.statSync(p);
    return true;
  } catch {
    return false;
  }
};

/** Saves the original (or archived PDF) in ~/Downloads under its own name; returns the path. */
export async function download(s: Server, doc: { id: number; title: string }, original = true): Promise<string> {
  const res = await request(s, `/api/documents/${doc.id}/download/${original ? "?original=true" : ""}`, {
    timeout: 120_000,
  });
  const name = fileNameFrom(res.headers.get("content-disposition"), `${doc.title || `document-${doc.id}`}.pdf`);
  await Deno.mkdir(DOWNLOADS, { recursive: true });
  const path = freePath(DOWNLOADS, name, exists);
  const file = await Deno.open(path, { write: true, createNew: true });
  await res.body!.pipeTo(file.writable);
  return path;
}

/** Thumbnails as files (WebP or PNG, as Paperless made them): cached ones at once, others until `deadline`. */
export async function thumbnails(
  s: Server,
  ids: number[],
  o: { deadline?: number; signal?: AbortSignal } = {},
): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  if (!HOME) return out;
  const dir = `${CACHE}/thumbs/${encodeURIComponent(new URL(s.base).host)}`;
  await Deno.mkdir(dir, { recursive: true }).catch(() => {});
  const missing: number[] = [];
  for (const id of ids) {
    const file = `${dir}/${id}`;
    if (exists(file)) out.set(id, file);
    else missing.push(id);
  }
  const until = Date.now() + (o.deadline ?? 1500);
  const worker = async () => {
    while (missing.length && Date.now() < until && !o.signal?.aborted) {
      const id = missing.shift()!;
      try {
        const res = await fetch(`${s.base}/api/documents/${id}/thumb/`, {
          headers: { Authorization: `Token ${s.token}` },
          signal: AbortSignal.timeout(Math.max(500, until - Date.now())),
        });
        if (!res.ok || !(res.headers.get("content-type") ?? "image/").startsWith("image/")) {
          await res.body?.cancel();
          continue;
        }
        const data = new Uint8Array(await res.arrayBuffer());
        if (data.length < 100) continue;
        await Deno.writeFile(`${dir}/${id}.tmp`, data);
        await Deno.rename(`${dir}/${id}.tmp`, `${dir}/${id}`);
        out.set(id, `${dir}/${id}`);
      } catch {
        // No picture this time.
      }
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  return out;
}

/** Hands a file to the consumer; returns the task id to follow. */
export async function upload(
  s: Server,
  path: string,
  o: { title?: string; tags?: number[]; correspondent?: number; documentType?: number } = {},
): Promise<string> {
  const data = await Deno.readFile(path);
  const name = path.split("/").pop()!;
  const form = new FormData();
  form.append("document", new Blob([data], { type: mimeOf(name) }), name);
  if (o.title) form.append("title", o.title);
  for (const t of o.tags ?? []) form.append("tags", String(t));
  if (o.correspondent) form.append("correspondent", String(o.correspondent));
  if (o.documentType) form.append("document_type", String(o.documentType));
  const r = await json<string | { task_id?: string }>(s, "/api/documents/post_document/", {
    method: "POST",
    form,
    timeout: 300_000,
  });
  return typeof r === "string" ? r : r?.task_id ?? "";
}

export async function task(s: Server, id: string, signal?: AbortSignal): Promise<Task | undefined> {
  const r = await json<Task[] | Page<Task>>(s, `/api/tasks/?task_id=${encodeURIComponent(id)}`, { signal });
  return (Array.isArray(r) ? r : r.results)?.[0];
}

// ---------------------------------------------------------------------------
// Setup

const CONFIGURE = "**Settings → Extensions → Paperless-ngx → Configure**";

export function setupItem(e: SetupError): Item {
  const md: Record<SetupError["kind"], string[]> = {
    url: [
      "## Connect Paperless-ngx",
      "",
      `In ${CONFIGURE}, set the address you open in the browser, e.g. \`http://paperless.local:8000\` or \`http://192.168.1.20:8000\`, and an API token.`,
    ],
    token: [
      "## Create an API token",
      "",
      "In Paperless-ngx, open your profile (top right) → **My Profile** → **API Auth Token** → generate, then copy it.",
      "",
      `Paste it in ${CONFIGURE}.`,
    ],
    host: [
      "## Address not reachable from Backslash",
      "",
      "Extensions declare the hosts they may reach. This one covers this computer, local names (`*.local`, `*.lan`, `*.home`, `*.home.arpa`, `*.internal`, `paperless`), private networks (`192.168.x.x`, `10.x.x.x`, `172.16–31.x.x`), Tailscale (`100.64.x.x`, `*.ts.net`) and DuckDNS (`*.duckdns.org`).",
      "",
      `Use the server's local IP address in ${CONFIGURE}.`,
    ],
    down: [
      "## Paperless-ngx doesn't answer",
      "",
      `Check that it is running and opens at \`${e.base ?? "http://…:8000"}\`. The address is in ${CONFIGURE}.`,
    ],
  };
  return {
    id: "setup",
    title: e.message,
    subtitle: "Paperless-ngx settings",
    icon: { source: e.kind === "token" ? Icons.key : Icons.plug, tint: "orange" },
    detail: { markdown: md[e.kind].join("\n") },
    actions: e.base && e.kind !== "host" ? [open(e.base, "Open Paperless-ngx", { icon: Icons.globe })] : [],
  };
}
