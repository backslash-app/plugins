// Twitch Helix with the user's own app: a pasted user access token, or a
// sign-in through the browser (authorization code, the launcher keeps the token).

import { exec, oauth } from "@backslash/api";
import {
  API,
  type Auth,
  AuthError,
  type Category,
  type Channel,
  type Family,
  osFamily,
  type Page,
  playArgs,
  type Stream,
  type Tool,
  twitchError,
  unitArgs,
  type User,
} from "./lib.ts";

async function token(auth: Auth): Promise<string> {
  if (auth.token) return auth.token;
  try {
    return await oauth.token(auth.provider!);
  } catch (e) {
    throw new AuthError(`Sign-in failed: ${e instanceof Error ? e.message : e}`);
  }
}

export async function helix<T>(auth: Auth, path: string, signal?: AbortSignal): Promise<T> {
  const bearer = await token(auth);
  let res: Response;
  try {
    res = await fetch(`${API}${path}`, {
      signal,
      headers: { "Client-Id": auth.clientId, Authorization: `Bearer ${bearer}` },
    });
  } catch (e) {
    if (signal?.aborted) throw e;
    throw new Error(`Can't reach Twitch: ${e instanceof Error ? e.message : e}`);
  }
  if (!res.ok) {
    const error = twitchError(res.status, await res.text());
    // A refused sign-in token is forgotten, so the next run signs in again.
    if (error instanceof AuthError && auth.provider) await oauth.signOut(auth.provider).catch(() => {});
    throw error;
  }
  return await res.json() as T;
}

let me: Promise<User> | undefined;

export function currentUser(auth: Auth, signal?: AbortSignal): Promise<User> {
  me ??= helix<Page<User>>(auth, "/users", signal).then((p) => {
    if (!p.data[0]) throw new AuthError("Twitch didn't say who you are: use a user access token, not an app token");
    return p.data[0];
  });
  me.catch(() => (me = undefined));
  return me;
}

/** Live channels the user follows (up to 100). */
export async function followedLive(auth: Auth, signal?: AbortSignal): Promise<Stream[]> {
  const user = await currentUser(auth, signal);
  return (await helix<Page<Stream>>(auth, `/streams/followed?user_id=${user.id}&first=100`, signal)).data;
}

/** Profile pictures by user id (stream answers don't carry them). */
export async function avatars(auth: Auth, ids: string[], signal?: AbortSignal): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (let i = 0; i < ids.length; i += 100) {
    const q = ids.slice(i, i + 100).map((id) => `id=${id}`).join("&");
    if (!q) continue;
    const page = await helix<Page<User>>(auth, `/users?${q}`, signal);
    for (const u of page.data) if (u.profile_image_url) out.set(u.id, u.profile_image_url);
  }
  return out;
}

export async function searchChannels(auth: Auth, query: string, signal?: AbortSignal): Promise<Channel[]> {
  return (await helix<Page<Channel>>(auth, `/search/channels?first=25&query=${encodeURIComponent(query)}`, signal))
    .data;
}

export async function searchCategories(auth: Auth, query: string, signal?: AbortSignal): Promise<Category[]> {
  return (await helix<Page<Category>>(auth, `/search/categories?first=25&query=${encodeURIComponent(query)}`, signal))
    .data;
}

export async function topCategories(auth: Auth, signal?: AbortSignal): Promise<Category[]> {
  return (await helix<Page<Category>>(auth, "/games/top?first=40", signal)).data;
}

export async function streamsIn(auth: Auth, gameId: string, signal?: AbortSignal): Promise<Stream[]> {
  return (await helix<Page<Stream>>(auth, `/streams?first=50&game_id=${gameId}`, signal)).data;
}

// ---------------------------------------------------------------------------
// Playback: a transient systemd user unit, so the player outlives the launcher.

async function installed(name: string): Promise<boolean> {
  try {
    await new Deno.Command(name, {
      args: ["--version"],
      stdin: "null",
      stdout: "null",
      stderr: "null",
      signal: AbortSignal.timeout(3000),
    }).output();
    return true;
  } catch (e) {
    return !(e instanceof Deno.errors.NotFound || e instanceof Deno.errors.PermissionDenied ||
      e instanceof Deno.errors.NotCapable);
  }
}

export interface Tools {
  streamlink: boolean;
  mpv: boolean;
  ytdlp: boolean;
}

let tools: Promise<Tools> | undefined;

export function findTools(): Promise<Tools> {
  return tools ??= Promise.all([installed("streamlink"), installed("mpv"), installed("yt-dlp")]).then((
    [streamlink, mpv, ytdlp],
  ) => ({ streamlink, mpv, ytdlp }));
}

/** streamlink first (ads and qualities handled), else mpv with yt-dlp. */
export function toolFor(t: Tools): Tool | undefined {
  if (t.streamlink) return "streamlink";
  if (t.mpv && t.ytdlp) return "mpv";
  return undefined;
}

export async function distro(): Promise<Family | undefined> {
  return osFamily(await Deno.readTextFile("/etc/os-release").catch(() => ""));
}

const env = (k: string) => {
  try {
    return Deno.env.get(k);
  } catch {
    return undefined;
  }
};

export class NoPlayer extends Error {}

export async function play(login: string, o: { audioOnly?: boolean; quality?: string } = {}): Promise<Tool> {
  const t = await findTools();
  const tool = toolFor(t);
  if (!tool) throw new NoPlayer("Install streamlink (or mpv and yt-dlp) to watch here");
  const unit = `backslash-twitch-${login.replace(/[^a-z0-9_]/gi, "")}`;
  await exec("systemctl", ["--user", "stop", `${unit}.service`]).catch(() => {});
  const display = Object.fromEntries(
    ["WAYLAND_DISPLAY", "DISPLAY", "XAUTHORITY", "XDG_RUNTIME_DIR"].map((k) => [k, env(k)]),
  );
  const argv = playArgs(tool, login, { ...o, player: tool === "streamlink" && t.mpv ? "mpv" : undefined });
  try {
    await exec("systemd-run", unitArgs(unit, `Backslash Twitch: ${login}`, display, argv));
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) throw new Error("systemd-run is needed to start the player");
    if (String(e).includes("Failed to connect to bus")) {
      throw new Error("No systemd user session: streams play with systemd-run --user");
    }
    throw e;
  }
  return tool;
}
