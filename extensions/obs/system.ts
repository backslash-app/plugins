// The connection kept for the life of a view, starting OBS, scene screenshots
// and the last recording.

import { type Context, exec, storage } from "@backslash/api";
import { ObsClient } from "./api.ts";
import { checkedUrl, decodeDataUrl, screenshotName } from "./lib.ts";

const env = (key: string): string | undefined => {
  try {
    return Deno.env.get(key);
  } catch {
    return undefined;
  }
};

export const HOME = env("HOME") ?? "";
export const CACHE = `${HOME}/.cache/backslash/obs`;

let current: Promise<ObsClient> | undefined;

/** The open connection, or a new one. */
export function obs(ctx: Pick<Context, "preferences">): Promise<ObsClient> {
  if (!current) {
    const url = checkedUrl(ctx.preferences.url);
    const password = String(ctx.preferences.password ?? "");
    const p = ObsClient.connect(url, password).then((client) => {
      client.onclose = () => {
        if (current === p) current = undefined;
      };
      return client;
    });
    p.catch(() => {
      if (current === p) current = undefined;
    });
    current = p;
  }
  return current;
}

export async function disconnect(): Promise<void> {
  const p = current;
  current = undefined;
  (await p?.catch(() => undefined))?.close();
}

/** Runs `fn` with a connection, then closes it (no-view commands). */
export async function once<T>(ctx: Pick<Context, "preferences">, fn: (obs: ObsClient) => Promise<T>): Promise<T> {
  const client = await obs(ctx);
  try {
    return await fn(client);
  } finally {
    await disconnect();
  }
}

// ---------------------------------------------------------------------------
// Starting OBS

/** OBS's desktop file: the distribution's package or Flatpak (same id). */
export const DESKTOP_FILES = () => [
  "/usr/share/applications/com.obsproject.Studio.desktop",
  "/usr/local/share/applications/com.obsproject.Studio.desktop",
  "/var/lib/flatpak/exports/share/applications/com.obsproject.Studio.desktop",
  `${HOME}/.local/share/flatpak/exports/share/applications/com.obsproject.Studio.desktop`,
  "/var/lib/snapd/desktop/applications/obs-studio_obs-studio.desktop",
];

export async function obsDesktopFile(): Promise<string | undefined> {
  for (const f of DESKTOP_FILES()) {
    if (await Deno.stat(f).then((s) => s.isFile).catch(() => false)) return f;
  }
  return undefined;
}

/** Opens OBS like the app menu does. */
export async function startObs(): Promise<void> {
  const file = await obsDesktopFile();
  if (!file) throw new Error("OBS Studio isn't installed (or not where Backslash looks for it)");
  await exec("gio", ["launch", file]);
}

// ---------------------------------------------------------------------------
// Screenshots

/** A small JPEG of each scene in the cache folder, for the preview panel. */
export async function screenshots(client: ObsClient, scenes: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!HOME || !scenes.length) return out;
  await Deno.mkdir(CACHE, { recursive: true }).catch(() => {});
  try {
    for await (const e of Deno.readDir(CACHE)) {
      if (e.name.startsWith("scene-")) await Deno.remove(`${CACHE}/${e.name}`).catch(() => {});
    }
  } catch {
    return out;
  }
  const list = scenes.slice(0, 24);
  const results = await client.batch(list.map((sourceName) => ({
    requestType: "GetSourceScreenshot",
    requestData: { sourceName, imageFormat: "jpg", imageWidth: 480, imageCompressionQuality: 70 },
  }))).catch(() => []);
  const stamp = Date.now();
  await Promise.all(results.map(async (r, i) => {
    const bytes = r.ok ? decodeDataUrl(String(r.data.imageData ?? "")) : undefined;
    if (!bytes) return;
    const path = `${CACHE}/${screenshotName(list[i], stamp)}`;
    try {
      await Deno.writeFile(path, bytes);
      out.set(list[i], path);
    } catch {
      // No preview for this one.
    }
  }));
  return out;
}

// ---------------------------------------------------------------------------
// Recordings

export async function lastRecording(): Promise<string | undefined> {
  return (await storage.get<string>("lastRecording")) ?? undefined;
}

export async function setLastRecording(path: string | undefined): Promise<void> {
  if (path) await storage.set("lastRecording", path);
}

/** Starts or stops recording; returns what to flash. */
export async function toggleRecording(client: ObsClient): Promise<{ active: boolean; path?: string }> {
  const st = await client.request("GetRecordStatus");
  if (st.outputActive) {
    const res = await client.request("StopRecord");
    const path = typeof res.outputPath === "string" ? res.outputPath : undefined;
    await setLastRecording(path);
    return { active: false, path };
  }
  await client.request("StartRecord");
  return { active: true };
}

export async function toggleStreaming(client: ObsClient): Promise<boolean> {
  const res = await client.request("ToggleStream");
  return !!res.outputActive;
}
