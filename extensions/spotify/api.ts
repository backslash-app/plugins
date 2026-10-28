// Authenticated calls to the Spotify Web API.

import { type Context, oauth } from "@backslash/api";
import { API, type Device, errorMessage, playBody, provider } from "./lib.ts";

export interface Client {
  get<T>(path: string, signal?: AbortSignal): Promise<T | undefined>;
  send(method: "PUT" | "POST" | "DELETE", path: string, body?: unknown): Promise<void>;
}

/** A client signed in with the user's own Spotify app (the first time opens the browser). */
export async function client(ctx: Pick<Context, "preferences">): Promise<Client> {
  const p = provider(ctx.preferences);
  const token = await oauth.token(p);
  const call = async (method: string, path: string, body?: unknown, signal?: AbortSignal) => {
    const url = path.startsWith("https://") ? path : `${API}${path}`;
    let res: Response;
    try {
      res = await fetch(url, {
        method,
        signal,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (e) {
      if ((e as Error).name === "AbortError") throw e;
      throw new Error(`Spotify is unreachable: ${(e as Error).message}`);
    }
    if (res.status === 204 || res.status === 202) {
      await res.body?.cancel();
      return undefined;
    }
    const text = await res.text();
    let json: unknown = undefined;
    try {
      json = text ? JSON.parse(text) : undefined;
    } catch {
      // Some write endpoints answer a plain snapshot id.
    }
    if (!res.ok) {
      if (res.status === 401) await oauth.signOut(p).catch(() => {});
      throw new Error(errorMessage(res.status, json, res.headers.get("retry-after")));
    }
    return json;
  };
  return {
    get: <T>(path: string, signal?: AbortSignal) => call("GET", path, undefined, signal) as Promise<T | undefined>,
    send: async (method, path, body) => {
      await call(method, path, body);
    },
  };
}

export async function signOut(ctx: Pick<Context, "preferences">): Promise<void> {
  await oauth.signOut(provider(ctx.preferences));
}

export async function devices(api: Client): Promise<Device[]> {
  return (await api.get<{ devices: Device[] }>("/me/player/devices"))?.devices ?? [];
}

export type PlayTarget = { context?: string; uris?: string[]; offset?: string };

/** Plays on the given device, or the active one; with no active device, the first available. */
export async function play(api: Client, target: PlayTarget, deviceId?: string): Promise<void> {
  const body = playBody(target);
  const q = (id?: string) => id ? `?device_id=${encodeURIComponent(id)}` : "";
  try {
    await api.send("PUT", `/me/player/play${q(deviceId)}`, body);
  } catch (e) {
    if (deviceId || !/No active device/.test((e as Error).message)) throw e;
    const first = (await devices(api)).find((d) => d.id && !d.is_restricted);
    if (!first?.id) throw new Error("No Spotify device is online: open Spotify on your computer or phone");
    await api.send("PUT", `/me/player/play${q(first.id)}`, body);
  }
}

/** Track ids → liked, in batches of 50. */
export async function liked(api: Client, ids: string[]): Promise<Set<string>> {
  const out = new Set<string>();
  for (let i = 0; i < ids.length; i += 50) {
    const batch = ids.slice(i, i + 50);
    const flags = await api.get<boolean[]>(`/me/tracks/contains?ids=${batch.join(",")}`).catch(() => undefined);
    flags?.forEach((f, k) => f && out.add(batch[k]));
  }
  return out;
}
