// Nextcloud with a login name and an app password (HTTP Basic): OCS,
// WebDAV, the Notes and Deck apps, and file previews cached on disk (they
// need the credentials, which a picture shown by the launcher can't carry).

import { Icons, type Item, open, storage } from "@backslash/api";
import {
  basicAuth,
  cleanSecret,
  type DavEntry,
  encodePath,
  freePath,
  normalizeUrl,
  ocsData,
  type OcsEnvelope,
  parseMultistatus,
  PROPFIND_BODY,
} from "./lib.ts";

export class SetupError extends Error {
  constructor(message: string, readonly kind: "url" | "auth" | "down" | "app", readonly base?: string) {
    super(message);
  }
}

export interface Server {
  base: string;
  user: string;
  auth: string;
  /** The account id (can differ from the login name, e.g. an e-mail address). */
  id?: string;
}

const describe = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function server(preferences: Record<string, unknown>): Server {
  const base = normalizeUrl(preferences.url);
  if (!base) throw new SetupError("Add the address of your Nextcloud", "url");
  try {
    new URL(base);
  } catch {
    throw new SetupError(`“${preferences.url}” is not an address`, "url");
  }
  const user = String(preferences.user ?? "").trim();
  const password = cleanSecret(preferences.appPassword);
  if (!user || !password) throw new SetupError("Add your user name and an app password", "auth", base);
  return { base, user, auth: basicAuth(user, password) };
}

export async function request(
  s: Server,
  path: string,
  o: {
    method?: string;
    body?: unknown;
    raw?: BodyInit;
    headers?: Record<string, string>;
    signal?: AbortSignal;
    timeout?: number;
    /** What a 404 means here, e.g. "the Notes app isn't installed". */
    missing?: string;
  } = {},
): Promise<Response> {
  const timeout = AbortSignal.timeout(o.timeout ?? 20_000);
  let res: Response;
  try {
    res = await fetch(`${s.base}${path}`, {
      method: o.method ?? "GET",
      signal: o.signal ? AbortSignal.any([o.signal, timeout]) : timeout,
      headers: {
        Authorization: s.auth,
        "OCS-APIRequest": "true",
        Accept: "application/json",
        ...(o.body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...o.headers,
      },
      body: o.raw ?? (o.body === undefined ? undefined : JSON.stringify(o.body)),
    });
  } catch (e) {
    if (o.signal?.aborted) throw e;
    if (/certificate|tls|ssl/i.test(describe(e))) {
      throw new SetupError(`Nextcloud's certificate isn't trusted: ${describe(e)}`, "down", s.base);
    }
    throw new SetupError(`Can't reach Nextcloud at ${new URL(s.base).host}: ${describe(e)}`, "down", s.base);
  }
  if (res.status === 401) {
    await res.body?.cancel();
    throw new SetupError("Nextcloud refused the user name or app password: check them in Settings", "auth", s.base);
  }
  if (res.status === 503 && res.headers.has("x-nextcloud-maintenance-mode")) {
    await res.body?.cancel();
    throw new Error("Nextcloud is in maintenance mode: try again in a few minutes");
  }
  if (!res.ok && res.status !== 207) {
    const text = (await res.text().catch(() => "")).trim();
    let detail = "";
    try {
      const body = JSON.parse(text);
      detail = body?.ocs?.meta?.message ?? body?.message ?? "";
    } catch {
      detail = /<s:message>([^<]+)</.exec(text)?.[1] ?? "";
    }
    if (res.status === 404 && o.missing) throw new SetupError(o.missing, "app", s.base);
    if (res.status === 403) throw new Error(`Nextcloud: not allowed${detail ? ` (${detail})` : ""}`);
    throw new Error(`Nextcloud answered ${res.status}${detail ? `: ${detail}` : ""}`);
  }
  return res;
}

export async function json<T>(s: Server, path: string, o: Parameters<typeof request>[2] = {}): Promise<T> {
  const res = await request(s, path, o);
  const text = await res.text();
  if (/^\s*</.test(text)) {
    throw new SetupError(`${s.base} answers, but not as Nextcloud: check the address`, "url", s.base);
  }
  return (text ? JSON.parse(text) : undefined) as T;
}

export async function ocs<T>(s: Server, path: string, o: Parameters<typeof request>[2] = {}): Promise<T> {
  const sep = path.includes("?") ? "&" : "?";
  return ocsData(await json<OcsEnvelope<T>>(s, `${path}${sep}format=json`, o));
}

/** The account id, for WebDAV paths and "assigned to me" (cached per login). */
export async function userId(s: Server, signal?: AbortSignal): Promise<string> {
  if (s.id) return s.id;
  const key = `user:${s.base}:${s.user}`;
  const cached = await storage.get<string>(key).catch(() => undefined);
  if (cached) return (s.id = cached);
  const me = await ocs<{ id: string }>(s, "/ocs/v1.php/cloud/user", { signal });
  s.id = me.id || s.user;
  await storage.set(key, s.id).catch(() => {});
  return s.id;
}

// ---------------------------------------------------------------------------
// Files

export const davRoot = (id: string) => `/remote.php/dav/files/${encodeURIComponent(id)}`;

export async function listFolder(s: Server, path: string, signal?: AbortSignal): Promise<DavEntry[]> {
  const id = await userId(s, signal);
  const root = davRoot(id);
  const res = await request(s, `${root}/${encodePath(path)}${path === "/" ? "" : "/"}`, {
    method: "PROPFIND",
    headers: { Depth: "1", "Content-Type": "application/xml; charset=utf-8", Accept: "application/xml" },
    raw: PROPFIND_BODY,
    signal,
  });
  const entries = parseMultistatus(await res.text(), root);
  const self = path.replace(/\/+$/, "") || "/";
  return entries.filter((e) => e.path !== self);
}

/** A public, read-only link (share type 3); an existing one is reused. */
export async function publicLink(s: Server, path: string): Promise<string> {
  const existing = await ocs<{ share_type: number; url?: string }[]>(
    s,
    `/ocs/v2.php/apps/files_sharing/api/v1/shares?path=${encodeURIComponent(path)}&reshares=false`,
  ).catch(() => []);
  const link = existing.find((x) => x.share_type === 3 && x.url);
  if (link?.url) return link.url;
  const created = await ocs<{ url: string }>(s, "/ocs/v2.php/apps/files_sharing/api/v1/shares", {
    method: "POST",
    body: { path, shareType: 3, permissions: 1 },
  });
  return created.url;
}

export async function setFavorite(s: Server, path: string, on: boolean): Promise<void> {
  const id = await userId(s);
  const res = await request(s, `${davRoot(id)}/${encodePath(path)}`, {
    method: "PROPPATCH",
    headers: { "Content-Type": "application/xml; charset=utf-8", Accept: "application/xml" },
    raw:
      `<?xml version="1.0"?><d:propertyupdate xmlns:d="DAV:" xmlns:oc="http://owncloud.org/ns"><d:set><d:prop><oc:favorite>${
        on ? 1 : 0
      }</oc:favorite></d:prop></d:set></d:propertyupdate>`,
  });
  await res.body?.cancel();
}

const env = (k: string) => {
  try {
    return Deno.env.get(k) ?? "";
  } catch {
    return "";
  }
};
export const HOME = env("HOME");
export const DOWNLOADS = `${HOME}/Downloads`;
export const CACHE = `${HOME}/.cache/backslash/nextcloud`;

const exists = (p: string) => {
  try {
    Deno.statSync(p);
    return true;
  } catch {
    return false;
  }
};

/** Saves a file in ~/Downloads under its own name; returns the path. */
export async function download(s: Server, e: DavEntry): Promise<string> {
  const id = await userId(s);
  const res = await request(s, `${davRoot(id)}/${encodePath(e.path)}`, {
    timeout: 600_000,
    headers: { Accept: "*/*" },
  });
  await Deno.mkdir(DOWNLOADS, { recursive: true });
  const path = freePath(DOWNLOADS, e.name, exists);
  const file = await Deno.open(path, { write: true, createNew: true });
  try {
    await res.body!.pipeTo(file.writable);
  } catch (err) {
    await Deno.remove(path).catch(() => {});
    throw err;
  }
  return path;
}

/** Previews (`/index.php/core/preview`) of pictures and documents as files, cached by file id and etag. */
export async function previews(
  s: Server,
  entries: DavEntry[],
  o: { deadline?: number; signal?: AbortSignal } = {},
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!HOME) return out;
  const dir = `${CACHE}/${encodeURIComponent(new URL(s.base).host)}`;
  await Deno.mkdir(dir, { recursive: true }).catch(() => {});
  const missing: { e: DavEntry; file: string }[] = [];
  for (const e of entries) {
    if (!e.hasPreview || !e.fileId) continue;
    const file = `${dir}/${e.fileId}-${(e.etag ?? "").replace(/\W/g, "")}`;
    if (exists(file)) out.set(e.path, file);
    else missing.push({ e, file });
  }
  const until = Date.now() + (o.deadline ?? 2000);
  const worker = async () => {
    while (missing.length && Date.now() < until && !o.signal?.aborted) {
      const { e, file } = missing.shift()!;
      try {
        const res = await fetch(`${s.base}/index.php/core/preview?fileId=${e.fileId}&x=512&y=512&a=1`, {
          headers: { Authorization: s.auth },
          signal: AbortSignal.timeout(Math.max(500, until - Date.now())),
        });
        if (!res.ok || !(res.headers.get("content-type") ?? "image/").startsWith("image/")) {
          await res.body?.cancel();
          continue;
        }
        const data = new Uint8Array(await res.arrayBuffer());
        if (data.length < 100) continue;
        await Deno.writeFile(`${file}.tmp`, data);
        await Deno.rename(`${file}.tmp`, file);
        out.set(e.path, file);
      } catch {
        // No preview this time.
      }
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  return out;
}

// ---------------------------------------------------------------------------
// Setup

const CONFIGURE = "**Settings → Extensions → Nextcloud → Configure**";

export function setupItem(e: SetupError): Item {
  const md: Record<SetupError["kind"], string[]> = {
    url: [
      "## Connect Nextcloud",
      "",
      `In ${CONFIGURE}, set the address you open in the browser (\`https://cloud.example.com\`), your user name and an app password.`,
    ],
    auth: [
      "## Create an app password",
      "",
      "In Nextcloud, open **Personal settings → Security → Devices & sessions**, type `Backslash` as the app name and **Create new app password**.",
      "",
      `Paste the login name and the password it shows in ${CONFIGURE}. With two-factor authentication, an app password is the only way in.`,
    ],
    down: [
      "## Nextcloud doesn't answer",
      "",
      `Check that it opens at \`${e.base ?? "https://…"}\`. The address is in ${CONFIGURE}.`,
    ],
    app: [
      "## App missing",
      "",
      `${e.message}. An admin can install it from **Apps** in Nextcloud.`,
    ],
  };
  return {
    id: "setup",
    title: e.message,
    subtitle: "Nextcloud settings",
    icon: { source: e.kind === "auth" ? Icons.key : e.kind === "app" ? Icons.package : Icons.plug, tint: "orange" },
    detail: { markdown: md[e.kind].join("\n") },
    actions: e.base
      ? [
        open(e.kind === "auth" ? `${e.base}/index.php/settings/user/security` : e.base, "Open Nextcloud", {
          icon: Icons.globe,
        }),
      ]
      : [],
  };
}
