import { exec } from "@backslash/api";
import { parseGetAll, type Player, player, rank } from "./lib.ts";

const PATH = "/org/mpris/MediaPlayer2";
const IFACE = "org.mpris.MediaPlayer2.Player";
const CACHE = "/tmp/backslash-media";

const busctl = (...args: string[]) => exec("busctl", ["--user", "--json=short", ...args]);

async function getAll(bus: string, iface: string): Promise<Record<string, any>> {
  return parseGetAll(await busctl("call", bus, PATH, "org.freedesktop.DBus.Properties", "GetAll", "s", iface));
}

export async function players(): Promise<Player[]> {
  const names = JSON.parse(
    await busctl("call", "org.freedesktop.DBus", "/org/freedesktop/DBus", "org.freedesktop.DBus", "ListNames"),
  ).data[0] as string[];
  const found = await Promise.all(
    names.filter((n) => n.startsWith("org.mpris.MediaPlayer2.")).map(async (bus) => {
      try {
        const [props, root] = await Promise.all([getAll(bus, IFACE), getAll(bus, "org.mpris.MediaPlayer2")]);
        return player(bus, props, root);
      } catch {
        return undefined; // gone in the meantime
      }
    }),
  );
  return rank(found.filter((p): p is Player => p !== undefined));
}

/** The player commands act on: the one playing, else the last one paused. */
export async function current(): Promise<Player> {
  const [p] = await players();
  if (!p) throw new Error("No media player is running");
  return p;
}

export const call = (p: Player, method: string) => busctl("call", p.bus, PATH, IFACE, method);
export const raise = (p: Player) => busctl("call", p.bus, PATH, "org.mpris.MediaPlayer2", "Raise");
export const setVolume = (p: Player, volume: number) =>
  busctl("set-property", p.bus, PATH, IFACE, "Volume", "d", String(Math.min(1, Math.max(0, volume))));

/** A local path for the cover: file:// URLs as is, Spotify's downloaded once. */
export async function cover(p: Player): Promise<string | undefined> {
  if (!p.art) return undefined;
  if (p.art.startsWith("file://")) return decodeURIComponent(p.art.slice(7));
  if (!p.art.startsWith("https://i.scdn.co/")) return undefined;
  const path = `${CACHE}/${p.art.split("/").pop()}.jpg`;
  try {
    await Deno.stat(path);
    return path;
  } catch {
    try {
      const res = await fetch(p.art);
      if (!res.ok) return undefined;
      await Deno.mkdir(CACHE, { recursive: true });
      await Deno.writeFile(path, new Uint8Array(await res.arrayBuffer()));
      return path;
    } catch {
      return undefined;
    }
  }
}
