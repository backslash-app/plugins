// webhook.site's API (tokens and their requests), the inboxes kept in storage, and replays.

import { storage } from "@backslash/api";
import { addInbox, currentInbox, type Inbox, type Page, removeInbox, type Replay, SITE, type Token } from "./lib.ts";

type Json = Parameters<typeof storage.set>[1];

export interface Prefs {
  apiKey?: string;
}

export class GoneError extends Error {}

async function site<T>(
  prefs: Prefs,
  path: string,
  o: { method?: string; body?: unknown; signal?: AbortSignal } = {},
): Promise<T> {
  const key = String(prefs.apiKey ?? "").trim();
  let res: Response;
  try {
    res = await fetch(`${SITE}${path}`, {
      method: o.method ?? "GET",
      signal: o.signal,
      headers: {
        Accept: "application/json",
        ...(key ? { "Api-Key": key } : {}),
        ...(o.body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: o.body === undefined ? undefined : JSON.stringify(o.body),
    });
  } catch (e) {
    if (o.signal?.aborted) throw e;
    throw new Error("Cannot reach webhook.site: check your connection");
  }
  const text = await res.text();
  if (res.status === 404 || res.status === 410) throw new GoneError("This webhook URL expired or was deleted");
  if (res.status === 401 || res.status === 403) {
    throw new Error(
      key ? "webhook.site refused the API key: check it in Settings" : "webhook.site refused the request",
    );
  }
  if (res.status === 429) throw new Error("webhook.site rate limit reached: wait a minute");
  if (!res.ok) throw new Error(`webhook.site answered ${res.status}${text ? `: ${text.slice(0, 120)}` : ""}`);
  return (text ? JSON.parse(text) : undefined) as T;
}

/** A new URL; it answers 200 with a short text so senders see a success. */
export async function createToken(prefs: Prefs): Promise<Token> {
  const token = await site<Token>(prefs, "/token", {
    method: "POST",
    body: { default_status: 200, default_content: "OK", default_content_type: "text/plain", cors: true },
  });
  if (!token?.uuid) throw new Error("webhook.site didn't create a URL");
  return token;
}

export const requests = (prefs: Prefs, uuid: string, signal?: AbortSignal) =>
  site<Page>(prefs, `/token/${uuid}/requests?sorting=newest&per_page=50`, { signal });

export const deleteRequest = (prefs: Prefs, uuid: string, id: string) =>
  site(prefs, `/token/${uuid}/request/${id}`, { method: "DELETE" });

export const clearRequests = (prefs: Prefs, uuid: string) =>
  site(prefs, `/token/${uuid}/request`, { method: "DELETE" });

export async function deleteToken(prefs: Prefs, uuid: string): Promise<void> {
  try {
    await site(prefs, `/token/${uuid}`, { method: "DELETE" });
  } catch (e) {
    if (!(e instanceof GoneError)) throw e;
  }
}

// ---------------------------------------------------------------------------
// Inboxes in storage

export async function inboxes(): Promise<Inbox[]> {
  return (await storage.get("inboxes").catch(() => undefined) as Inbox[] | undefined) ?? [];
}

export async function current(): Promise<Inbox | undefined> {
  return currentInbox(await inboxes(), await storage.get<string>("current").catch(() => undefined));
}

export async function pick(uuid: string): Promise<void> {
  await storage.set("current", uuid);
}

/** Creates a URL, remembers it and makes it the current one. */
export async function newInbox(prefs: Prefs): Promise<Inbox> {
  const token = await createToken(prefs);
  const inbox: Inbox = { uuid: token.uuid, created: Date.now() };
  await storage.set("inboxes", addInbox(await inboxes(), inbox) as unknown as Json);
  await pick(inbox.uuid);
  return inbox;
}

/** Deletes the URL on webhook.site (if it still exists) and forgets it. */
export async function dropInbox(prefs: Prefs, uuid: string): Promise<void> {
  await deleteToken(prefs, uuid);
  await storage.set("inboxes", removeInbox(await inboxes(), uuid) as unknown as Json);
}

export async function forgetInbox(uuid: string): Promise<void> {
  await storage.set("inboxes", removeInbox(await inboxes(), uuid) as unknown as Json);
}

export interface ReplaySettings {
  target: string;
  keepPath: boolean;
}

export async function replaySettings(): Promise<ReplaySettings | undefined> {
  return await storage.get("replay").catch(() => undefined) as ReplaySettings | undefined;
}

export async function saveReplaySettings(s: ReplaySettings): Promise<void> {
  await storage.set("replay", s as unknown as Json);
}

// ---------------------------------------------------------------------------
// Replays

export interface ReplayResult {
  status: number;
  statusText: string;
  ms: number;
  headers: [string, string][];
  contentType: string;
  text: string;
  size: number;
}

export async function replay(r: Replay, signal?: AbortSignal, fetchFn: typeof fetch = fetch): Promise<ReplayResult> {
  const started = performance.now();
  let res: Response;
  try {
    res = await fetchFn(r.url, {
      method: r.method,
      headers: r.headers,
      body: r.body,
      redirect: "manual",
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000),
    });
  } catch (e) {
    if (signal?.aborted) throw e;
    const msg = e instanceof Error ? e.message : String(e);
    if (/refused|ECONNREFUSED|os error 111/i.test(msg)) {
      throw new Error(`Nothing answers at ${new URL(r.url).host}: is your server running?`);
    }
    if (e instanceof DOMException && e.name === "TimeoutError") throw new Error("No answer after 30 s");
    throw new Error(msg.replace(/^error sending request for url \([^)]*\): /, ""));
  }
  const bytes = new Uint8Array(await res.arrayBuffer());
  return {
    status: res.status,
    statusText: res.statusText,
    ms: Math.round(performance.now() - started),
    headers: [...res.headers.entries()] as [string, string][],
    contentType: res.headers.get("content-type") ?? "",
    text: new TextDecoder().decode(bytes),
    size: bytes.byteLength,
  };
}
