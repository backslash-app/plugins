// Frigate's HTTP API (port 5000, or 8971 with a user), its websocket for detection on/off, and pictures cached on disk.

import { storage } from "@backslash/api";
import {
  type Camera,
  type Event,
  parseCameras,
  parseEvents,
  parseSnapshotName,
  type RawConfig,
  type RawEvent,
  type RawStats,
  safeId,
  snapshotName,
} from "./lib.ts";
import { checkBase, failureDetail, httpClient, request, SetupError } from "./net.ts";

export interface Server {
  base: string;
  user?: string;
  password?: string;
  client?: Deno.HttpClient;
}

export function server(preferences: Record<string, unknown>): Server {
  const base = checkBase(preferences.url, "Frigate server");
  const user = String(preferences.username ?? "").trim();
  return {
    base,
    user: user || undefined,
    password: user ? String(preferences.password ?? "") : undefined,
    client: httpClient(preferences.certificate),
  };
}

// ---------------------------------------------------------------------------
// Authentication: port 8971 wants a JWT cookie from /api/login

const COOKIE_KEY = "frigate-cookie";

async function login(s: Server): Promise<string> {
  const res = await request(`${s.base}/api/login`, {
    method: "POST",
    client: s.client,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ user: s.user, password: s.password }),
  }, "Frigate");
  if (res.status === 401 || res.status === 400) {
    throw new SetupError("Frigate rejected the user name or password", "auth", s.base);
  }
  if (res.status === 429) throw new Error("Frigate: too many sign-ins, try again in a minute");
  const cookie = res.headers.getSetCookie().map((c) => c.split(";")[0]).find((c) => c.startsWith("frigate_token="));
  await res.body?.cancel();
  if (!cookie) throw new SetupError("Frigate didn't hand out a session", "auth", s.base);
  await storage.set(COOKIE_KEY, { base: s.base, user: s.user ?? "", cookie }).catch(() => {});
  return cookie;
}

let cookie: string | undefined;

async function currentCookie(s: Server, fresh = false): Promise<string | undefined> {
  if (!s.user) return undefined;
  if (fresh) return cookie = await login(s);
  if (cookie) return cookie;
  const saved = await storage.get<{ base: string; user: string; cookie: string }>(COOKIE_KEY).catch(() => undefined);
  cookie = saved && saved.base === s.base && saved.user === s.user ? saved.cookie : await login(s);
  return cookie;
}

async function call(s: Server, path: string, init: { method?: string; signal?: AbortSignal } = {}): Promise<Response> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const c = await currentCookie(s, attempt > 0);
    const res = await request(`${s.base}/api${path}`, {
      method: init.method ?? "GET",
      signal: init.signal,
      client: s.client,
      headers: c ? { Cookie: c } : {},
    }, "Frigate");
    if (res.status === 401 && attempt === 0 && s.user) {
      await res.body?.cancel();
      continue;
    }
    if (res.status === 401 || res.status === 403) {
      await res.body?.cancel();
      throw new SetupError(
        s.user ? "Frigate refused this user" : "This Frigate port needs a user: add one, or use port 5000",
        "auth",
        s.base,
      );
    }
    return res;
  }
  throw new SetupError("Frigate rejected the session", "auth", s.base);
}

async function json<T>(s: Server, path: string, signal?: AbortSignal): Promise<T> {
  const res = await call(s, path, { signal });
  if (res.status === 404 && path === "/config") {
    throw new SetupError(`No Frigate at ${new URL(s.base).host}`, "unknown", s.base);
  }
  if (!res.ok) throw new Error(`Frigate answered ${res.status} for ${path}: ${await failureDetail(res)}`);
  return await res.json() as T;
}

export async function cameras(s: Server, signal?: AbortSignal): Promise<{ cameras: Camera[]; version?: string }> {
  const [config, stats] = await Promise.all([
    json<RawConfig>(s, "/config", signal),
    json<RawStats>(s, "/stats", signal).catch(() => undefined),
  ]);
  return { cameras: parseCameras(config, stats), version: stats?.service?.version };
}

export async function events(
  s: Server,
  o: { camera?: string; limit?: number; signal?: AbortSignal } = {},
): Promise<Event[]> {
  const q = new URLSearchParams({ limit: String(o.limit ?? 50), include_thumbnails: "0" });
  if (o.camera) q.set("cameras", o.camera);
  return parseEvents(await json<RawEvent[]>(s, `/events?${q}`, o.signal));
}

/** Keeps an event forever (Frigate's star), or lets retention apply again. */
export async function retain(s: Server, id: string, keep: boolean): Promise<void> {
  const res = await call(s, `/events/${id}/retain`, { method: keep ? "POST" : "DELETE" });
  if (!res.ok) throw new Error(`Frigate answered ${res.status}: ${await failureDetail(res)}`);
  await res.body?.cancel();
}

export async function deleteEvent(s: Server, id: string): Promise<void> {
  const res = await call(s, `/events/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`Frigate answered ${res.status}: ${await failureDetail(res)}`);
  await res.body?.cancel();
}

/**
 * Turns object detection on or off as Frigate's own interface does: a
 * `<camera>/detect/set` message on its websocket. It lasts until Frigate
 * restarts.
 */
export async function setDetection(s: Server, camera: string, on: boolean): Promise<void> {
  const c = await currentCookie(s);
  const url = `${s.base.replace(/^http/, "ws")}/ws`;
  await new Promise<void>((resolve, reject) => {
    const ws = new WebSocket(url, { headers: c ? { Cookie: c } : undefined, client: s.client });
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error("Frigate's websocket didn't answer"));
    }, 5000);
    ws.onopen = () => {
      ws.send(JSON.stringify({ topic: `${camera}/detect/set`, payload: on ? "ON" : "OFF", retain: false }));
      // Give Frigate a moment to take it before closing.
      setTimeout(() => {
        clearTimeout(timer);
        ws.close();
        resolve();
      }, 400);
    };
    ws.onerror = () => {
      clearTimeout(timer);
      reject(new Error(`Can't open Frigate's websocket at ${new URL(url).host}`));
    };
  });
}

// ---------------------------------------------------------------------------
// Pictures: fetched with the session, cached in ~/.cache/backslash/cameras

const env = (k: string) => {
  try {
    return Deno.env.get(k) ?? "";
  } catch {
    return "";
  }
};
export const HOME = env("HOME");
export const CACHE = `${HOME}/.cache/backslash/cameras`;

const dirFor = (s: Server) => `${CACHE}/${encodeURIComponent(new URL(s.base).host)}`;

const exists = (p: string) => {
  try {
    return Deno.statSync(p).size > 0;
  } catch {
    return false;
  }
};

async function download(s: Server, path: string, file: string, signal?: AbortSignal): Promise<boolean> {
  const res = await call(s, path, { signal });
  if (!res.ok || !res.headers.get("content-type")?.startsWith("image/")) {
    await res.body?.cancel();
    return false;
  }
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (!bytes.length) return false;
  // Written aside then renamed: the preview never shows half a picture.
  const tmp = `${file}.part`;
  await Deno.writeFile(tmp, bytes);
  await Deno.rename(tmp, file);
  return true;
}

/** Runs `jobs` four at a time until `deadline`; the late ones are left out. */
async function within<T>(items: T[], deadline: number, job: (t: T) => Promise<void>) {
  const queue = [...items];
  const until = Date.now() + deadline;
  const worker = async () => {
    for (let t = queue.shift(); t !== undefined && Date.now() < until; t = queue.shift()) await job(t);
  };
  await Promise.race([
    Promise.all(Array.from({ length: 4 }, worker)),
    new Promise((r) => setTimeout(r, deadline)),
  ]);
}

/**
 * The latest frame of each camera as a file, fresh if Frigate answers within
 * `deadline` ms, else the last one saved. Older frames are removed.
 */
export async function snapshots(
  s: Server,
  names: string[],
  o: { deadline?: number; height?: number; signal?: AbortSignal } = {},
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!HOME) return out;
  const dir = dirFor(s);
  await Deno.mkdir(dir, { recursive: true }).catch(() => {});
  const previous = new Map<string, string[]>();
  try {
    for await (const f of Deno.readDir(dir)) {
      const p = parseSnapshotName(f.name);
      if (p) previous.set(p.camera, [...(previous.get(p.camera) ?? []), f.name].sort());
    }
  } catch {
    // No cache yet.
  }
  for (const name of names) {
    const last = previous.get(name.replace(/[^\w-]/g, "_"))?.at(-1);
    if (last) out.set(name, `${dir}/${last}`);
  }
  await within(names.filter(safeId), o.deadline ?? 2500, async (name) => {
    const file = `${dir}/${snapshotName(name, Date.now())}`;
    const ok = await download(s, `/${name}/latest.jpg?h=${o.height ?? 480}`, file, o.signal).catch(() => false);
    if (!ok) return;
    out.set(name, file);
    for (const old of previous.get(name.replace(/[^\w-]/g, "_")) ?? []) {
      if (`${dir}/${old}` !== file) await Deno.remove(`${dir}/${old}`).catch(() => {});
    }
  });
  return out;
}

/** An event's snapshot (or thumbnail) as a file; finished events never change, so they are kept. */
export async function eventPictures(
  s: Server,
  list: Event[],
  o: { deadline?: number; signal?: AbortSignal } = {},
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!HOME) return out;
  const dir = `${dirFor(s)}/events`;
  await Deno.mkdir(dir, { recursive: true }).catch(() => {});
  const missing: Event[] = [];
  for (const e of list) {
    if (!safeId(e.id)) continue;
    const file = `${dir}/${e.id}.jpg`;
    if (e.end && exists(file)) out.set(e.id, file);
    else missing.push(e);
  }
  await within(missing, o.deadline ?? 2500, async (e) => {
    const file = `${dir}/${e.id}.jpg`;
    const path = e.hasSnapshot ? `/events/${e.id}/snapshot.jpg?h=360&bbox=1` : `/events/${e.id}/thumbnail.jpg`;
    if (await download(s, path, file, o.signal).catch(() => false)) out.set(e.id, file);
  });
  return out;
}

/** Event pictures older than two weeks go. */
export async function pruneEventPictures(s: Server): Promise<void> {
  const dir = `${dirFor(s)}/events`;
  const limit = Date.now() - 14 * 86_400_000;
  try {
    for await (const f of Deno.readDir(dir)) {
      const st = await Deno.stat(`${dir}/${f.name}`);
      if ((st.mtime?.getTime() ?? 0) < limit) await Deno.remove(`${dir}/${f.name}`).catch(() => {});
    }
  } catch {
    // Nothing cached.
  }
}

// ---------------------------------------------------------------------------
// Links into Frigate's interface (the browser signs in by itself)

export const liveUrl = (s: Server, camera: string) => `${s.base}/#${encodeURIComponent(camera)}`;
export const eventUrl = (s: Server, id: string) => `${s.base}/explore?event_id=${encodeURIComponent(id)}`;
export const clipUrl = (s: Server, id: string) => `${s.base}/api/events/${encodeURIComponent(id)}/clip.mp4`;
export const snapshotUrl = (s: Server, id: string) => `${s.base}/api/events/${encodeURIComponent(id)}/snapshot.jpg`;

export { SetupError };
