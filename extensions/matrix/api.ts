// Calls to the homeserver with the user's access token.

import { storage } from "@backslash/api";
import {
  errorText,
  normalizeHomeserver,
  type Room,
  roomsOf,
  sortRooms,
  SYNC_FILTER,
  type SyncResponse,
  textMessage,
  txnId,
  wellKnownBase,
} from "./lib.ts";

export class SetupError extends Error {}

export type Session = { base: string; token: string; web: string };

/** The homeserver's client API, found through `/.well-known/matrix/client` (cached). */
async function baseUrl(server: string, signal?: AbortSignal): Promise<string> {
  const known = await storage.get<Record<string, string>>("wellKnown").catch(() => undefined) ?? {};
  if (known[server]) return known[server];
  let base = server;
  try {
    const res = await fetch(`${server}/.well-known/matrix/client`, { signal });
    if (res.ok) base = wellKnownBase(await res.json().catch(() => undefined)) ?? server;
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
  }
  await storage.set("wellKnown", { ...known, [server]: base }).catch(() => {});
  return base;
}

export async function session(prefs: Record<string, unknown>, signal?: AbortSignal): Promise<Session> {
  const server = normalizeHomeserver(prefs.homeserver || "matrix.org");
  const token = String(prefs.token ?? "").trim().replace(/^Bearer\s+/i, "");
  if (!token) throw new SetupError("Add your Matrix access token");
  const web = String(prefs.webClient ?? "").trim() || "https://app.element.io";
  return { base: await baseUrl(server, signal), token, web: /^https?:\/\//.test(web) ? web : `https://${web}` };
}

export async function mx<T>(
  s: Session,
  path: string,
  options: { method?: string; body?: unknown; signal?: AbortSignal } = {},
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${s.base}/_matrix/client/v3${path}`, {
      method: options.method ?? "GET",
      signal: options.signal,
      headers: {
        Authorization: `Bearer ${s.token}`,
        Accept: "application/json",
        ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw new Error(`The homeserver ${new URL(s.base).host} is unreachable: ${(e as Error).message}`);
  }
  const json = await res.json().catch(() => undefined);
  if (!res.ok) {
    const message = errorText(res.status, json);
    if (res.status === 401) throw new SetupError(message);
    throw new Error(message);
  }
  return json as T;
}

/** Our user id, asked once per token. */
export async function whoami(s: Session, signal?: AbortSignal): Promise<string> {
  // A digest of the token tells whether the saved id is still ours, without keeping the token.
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${s.base} ${s.token}`));
  const key = [...new Uint8Array(digest)].slice(0, 8).map((b) => b.toString(16).padStart(2, "0")).join("");
  const saved = await storage.get<{ key: string; user: string }>("whoami").catch(() => undefined);
  if (saved?.key === key) return saved.user;
  const { user_id } = await mx<{ user_id: string }>(s, "/account/whoami", { signal });
  await storage.set("whoami", { key, user: user_id }).catch(() => {});
  return user_id;
}

/** A full (filtered) sync: every joined room and invite, sorted; saved for the next opening. */
export async function loadRooms(s: Session, signal?: AbortSignal): Promise<Room[]> {
  const [me, sync] = await Promise.all([
    whoami(s, signal),
    mx<SyncResponse>(
      s,
      `/sync?timeout=0&set_presence=offline&filter=${encodeURIComponent(JSON.stringify(SYNC_FILTER))}`,
      { signal },
    ),
  ]);
  const rooms = sortRooms(roomsOf(sync, me));
  await storage.set("rooms", { base: s.base, rooms }).catch(() => {});
  return rooms;
}

export async function cachedRooms(s: Session): Promise<Room[] | undefined> {
  const saved = await storage.get<{ base: string; rooms: Room[] }>("rooms").catch(() => undefined);
  return saved?.base === s.base ? saved.rooms : undefined;
}

export async function markRead(s: Session, room: Room): Promise<void> {
  if (!room.last) return;
  await mx(s, `/rooms/${encodeURIComponent(room.id)}/read_markers`, {
    method: "POST",
    body: { "m.fully_read": room.last.eventId, "m.read": room.last.eventId },
  });
}

export async function send(s: Session, room: Room, body: string, replyTo?: string): Promise<string> {
  if (room.encrypted) {
    throw new Error("This room is end-to-end encrypted: Backslash can't encrypt, send from your Matrix client");
  }
  const { event_id } = await mx<{ event_id: string }>(
    s,
    `/rooms/${encodeURIComponent(room.id)}/send/m.room.message/${txnId()}`,
    { method: "PUT", body: textMessage(body, replyTo) },
  );
  return event_id;
}

export async function join(s: Session, room: Room): Promise<void> {
  await mx(s, `/join/${encodeURIComponent(room.id)}`, { method: "POST", body: {} });
}

export async function leave(s: Session, room: Room): Promise<void> {
  await mx(s, `/rooms/${encodeURIComponent(room.id)}/leave`, { method: "POST", body: {} });
}
