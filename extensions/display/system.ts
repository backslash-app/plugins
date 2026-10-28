// Talking to brightnessctl / logind / ddcutil, the desktop's night light, and
// the compositor's outputs.

import { exec } from "@backslash/api";
import {
  type Backlight,
  type DdcDisplay,
  detectSession,
  type Env,
  type Family,
  type Monitor,
  osFamily,
  parseBrightnessctl,
  parseBusctl,
  parseDdcDetect,
  parseDdcVcp,
  parseGsettings,
  parseHyprctl,
  parseKscreen,
  parseMutter,
  parseSway,
  parseUdevAttrs,
  parseUdevDb,
  parseWlrRandrJson,
  parseWlrRandrText,
  parseXrandr,
  rawFor,
  type Session,
  SESSION_ENV,
  systemdRunArgs,
  type Warmer,
  warmerCandidates,
  warmerCommand,
} from "./lib.ts";

const env = (key: string): string | undefined => {
  try {
    return Deno.env.get(key);
  } catch {
    return undefined;
  }
};
const sessionEnv = (): Env => Object.fromEntries(SESSION_ENV.map((k) => [k, env(k)]));
export const session = (): Session => detectSession(sessionEnv());

export const missing = (e: unknown) =>
  e instanceof Deno.errors.NotFound || e instanceof Deno.errors.NotCapable || e instanceof Deno.errors.PermissionDenied;

export async function family(): Promise<Family | undefined> {
  return osFamily(await Deno.readTextFile("/etc/os-release").catch(() => ""));
}

// ---------------------------------------------------------------------------
// Brightness

export interface Backlights {
  list: Backlight[];
  /** How we read and write them. */
  via?: "brightnessctl" | "logind";
}

/** Built-in panels: brightnessctl, else the kernel's values through udevadm (written via logind). */
export async function backlights(): Promise<Backlights> {
  try {
    const list = parseBrightnessctl(await exec("brightnessctl", ["-l", "-m", "-c", "backlight"]));
    if (list.length) return { list, via: "brightnessctl" };
  } catch {
    // Not installed: read sysfs through udev.
  }
  try {
    const devices = parseUdevDb(await exec("udevadm", ["info", "--export-db"]), "backlight");
    const list = await Promise.all(devices.map(async ({ path }) => {
      const id = path.split("/").pop()!;
      const attrs = parseUdevAttrs(await exec("udevadm", ["info", "-a", "-p", path]));
      return {
        id,
        name: id,
        current: Number(attrs.brightness),
        max: Number(attrs.max_brightness),
        kind: "backlight" as const,
      };
    }));
    const ok = list.filter((b) => b.max > 0 && Number.isFinite(b.current));
    return { list: ok, via: ok.length ? "logind" : undefined };
  } catch {
    return { list: [] };
  }
}

export async function setBacklight(b: Backlight, pct: number, via: Backlights["via"]): Promise<void> {
  if (b.kind === "ddc") {
    await exec("ddcutil", ["--display", b.id.slice(4), "setvcp", "10", String(rawFor(b, pct))]);
    return;
  }
  if (via === "brightnessctl") {
    await exec("brightnessctl", ["-q", "-d", b.id, "set", String(rawFor(b, pct))]);
    return;
  }
  // logind lets the session's user set the backlight without root.
  await exec("busctl", [
    "call",
    "org.freedesktop.login1",
    "/org/freedesktop/login1/session/auto",
    "org.freedesktop.login1.Session",
    "SetBrightness",
    "ssu",
    "backlight",
    b.id,
    String(rawFor(b, pct)),
  ]);
}

/** External monitors over DDC/CI (slow: about a second each). */
export async function ddcDisplays(): Promise<Backlight[]> {
  let found: DdcDisplay[];
  try {
    found = parseDdcDetect(await exec("ddcutil", ["detect", "--brief"]));
  } catch {
    return [];
  }
  const out = await Promise.all(found.map(async (d) => {
    const v = parseDdcVcp(
      await exec("ddcutil", ["--display", String(d.display), "--brief", "getvcp", "10"]).catch(() => ""),
    );
    return v ? [{ id: `ddc:${d.display}`, name: d.model, current: v.current, max: v.max, kind: "ddc" as const }] : [];
  }));
  return out.flat();
}

// ---------------------------------------------------------------------------
// Night light

export interface NightLight {
  backend: "gnome" | "kde" | Warmer;
  enabled: boolean;
  /** Warming the screen right now (GNOME and KDE follow a schedule). */
  active?: boolean;
  temperature?: number;
  schedule?: string;
}

const GNOME = "org.gnome.settings-daemon.plugins.color";
const gsettings = async (key: string) => parseGsettings(await exec("gsettings", ["get", GNOME, key]));
const kwin = async (iface: string, path: string, prop: string) =>
  parseBusctl(await exec("busctl", ["--user", "get-property", "org.kde.KWin", path, iface, prop]));

export const NIGHT_UNIT = "backslash-night-light";

async function warmer(s: Session): Promise<Warmer | undefined> {
  for (const tool of warmerCandidates(s)) {
    try {
      await new Deno.Command(tool, {
        args: ["-h"],
        stdin: "null",
        stdout: "null",
        stderr: "null",
        signal: AbortSignal.timeout(3000),
      })
        .output();
      return tool;
    } catch (e) {
      if (!missing(e)) return tool;
    }
  }
  return undefined;
}

/** The desktop's night light, or the daemon we run on wlroots and X11. */
export async function nightLight(): Promise<NightLight | undefined> {
  const s = session();
  if (s.desktop === "gnome") {
    try {
      const enabled = (await gsettings("night-light-enabled")) === true;
      const [temperature, automatic, from, to] = await Promise.all([
        gsettings("night-light-temperature"),
        gsettings("night-light-schedule-automatic"),
        gsettings("night-light-schedule-from"),
        gsettings("night-light-schedule-to"),
      ]);
      const clock = (h: unknown) => {
        const n = Number(h);
        return `${String(Math.floor(n)).padStart(2, "0")}:${String(Math.round((n % 1) * 60)).padStart(2, "0")}`;
      };
      return {
        backend: "gnome",
        enabled,
        temperature: Number(temperature) || undefined,
        schedule: automatic ? "Sunset to sunrise" : `${clock(from)} to ${clock(to)}`,
      };
    } catch {
      // gsettings or the schema is missing.
    }
  }
  if (s.desktop === "kde") {
    for (
      const [iface, path] of [["org.kde.KWin.NightLight", "/org/kde/KWin/NightLight"], [
        "org.kde.kwin.ColorCorrect",
        "/ColorCorrect",
      ]]
    ) {
      try {
        const enabled = (await kwin(iface, path, "enabled")) === true;
        const active = await kwin(iface, path, "running").catch(() => undefined);
        const temperature = await kwin(iface, path, "currentTemperature").catch(() => undefined);
        return { backend: "kde", enabled, active: active === true, temperature: Number(temperature) || undefined };
      } catch {
        // Older or newer Plasma: try the other interface.
      }
    }
  }
  const tool = await warmer(s);
  if (!tool) return undefined;
  const state = await exec("systemctl", ["--user", "is-active", NIGHT_UNIT]).catch(() => "inactive");
  return { backend: tool, enabled: state === "active" || state === "activating", active: state === "active" };
}

export async function setNightLight(on: boolean, kelvin: number): Promise<void> {
  const n = await nightLight();
  if (!n) throw new Error("No night light found");
  if (n.backend === "gnome") {
    await exec("gsettings", ["set", GNOME, "night-light-enabled", String(on)]);
    return;
  }
  if (n.backend === "kde") {
    let written = false;
    for (const tool of ["kwriteconfig6", "kwriteconfig5"]) {
      try {
        await exec(tool, ["--file", "kwinrc", "--group", "NightColor", "--key", "Active", String(on)]);
        written = true;
        break;
      } catch (e) {
        if (!missing(e)) throw e;
      }
    }
    if (!written) throw new Error("kwriteconfig6 is needed to change KDE's night light");
    await exec("busctl", ["--user", "call", "org.kde.KWin", "/KWin", "org.kde.KWin", "reconfigure"]);
    return;
  }
  if (!on) {
    await exec("systemctl", ["--user", "stop", NIGHT_UNIT]).catch(() => {});
    return;
  }
  await exec("systemctl", ["--user", "reset-failed", NIGHT_UNIT]).catch(() => {});
  await exec("systemd-run", systemdRunArgs(NIGHT_UNIT, warmerCommand(n.backend, kelvin), sessionEnv()));
}

// ---------------------------------------------------------------------------
// Monitors

type Source = [string, string[], (out: string) => Monitor[]];

const MUTTER: Source = [
  "gdbus",
  [
    "call",
    "--session",
    "--dest",
    "org.gnome.Mutter.DisplayConfig",
    "--object-path",
    "/org/gnome/Mutter/DisplayConfig",
    "--method",
    "org.gnome.Mutter.DisplayConfig.GetCurrentState",
  ],
  parseMutter,
];
const SOURCES: Record<string, Source> = {
  hyprland: ["hyprctl", ["-j", "monitors", "all"], parseHyprctl],
  sway: ["swaymsg", ["-t", "get_outputs", "-r"], parseSway],
  kde: ["kscreen-doctor", ["-j"], parseKscreen],
  gnome: MUTTER,
  wlr: ["wlr-randr", ["--json"], parseWlrRandrJson],
  wlrText: ["wlr-randr", [], parseWlrRandrText],
  xrandr: ["xrandr", ["--query"], parseXrandr],
};

/** The connected monitors, from the first source that answers. */
export async function monitors(): Promise<{ list: Monitor[]; source?: string }> {
  const s = session();
  const order = s.wayland
    ? [s.desktop, "wlr", "wlrText", "hyprland", "sway", "kde", "gnome"]
    : [s.desktop === "gnome" ? "gnome" : "", "xrandr"];
  for (const key of [...new Set(order)].filter((k) => SOURCES[k])) {
    const [program, args, parse] = SOURCES[key];
    try {
      const list = parse(await exec(program, args));
      if (list.length) return { list, source: program };
    } catch {
      // Next source.
    }
  }
  return { list: [] };
}
