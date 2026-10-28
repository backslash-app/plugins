// Parsing brightness, night light and monitor information from the tools of
// each desktop. Pure, tested in lib_test.ts.

// ---------------------------------------------------------------------------
// Session

export type Desktop = "gnome" | "kde" | "hyprland" | "sway" | "other";
export interface Session {
  wayland: boolean;
  desktop: Desktop;
}
export type Env = Partial<Record<string, string>>;

export const SESSION_ENV = [
  "XDG_SESSION_TYPE",
  "XDG_CURRENT_DESKTOP",
  "WAYLAND_DISPLAY",
  "DISPLAY",
  "XAUTHORITY",
  "HYPRLAND_INSTANCE_SIGNATURE",
  "SWAYSOCK",
] as const;

export function detectSession(env: Env): Session {
  const type = (env.XDG_SESSION_TYPE ?? "").toLowerCase();
  const wayland = type === "wayland" || (!!env.WAYLAND_DISPLAY && type !== "x11");
  const current = (env.XDG_CURRENT_DESKTOP ?? "").toLowerCase().split(":");
  const desktop: Desktop = env.HYPRLAND_INSTANCE_SIGNATURE || current.includes("hyprland")
    ? "hyprland"
    : env.SWAYSOCK || current.includes("sway")
    ? "sway"
    : current.some((d) => ["gnome", "ubuntu", "unity", "pop"].includes(d))
    ? "gnome"
    : current.includes("kde")
    ? "kde"
    : "other";
  return { wayland, desktop };
}

// ---------------------------------------------------------------------------
// Brightness

export interface Backlight {
  /** Kernel device name, e.g. intel_backlight; or "ddc:1" for an external monitor. */
  id: string;
  name: string;
  current: number;
  max: number;
  kind: "backlight" | "ddc";
}

export const percent = (b: Backlight) => (b.max > 0 ? Math.round((b.current / b.max) * 100) : 0);

/** `brightnessctl -l -m -c backlight`: "intel_backlight,backlight,19200,40%,48000". */
export function parseBrightnessctl(out: string): Backlight[] {
  return out.split("\n").flatMap((line) => {
    const [name, cls, current, , max] = line.trim().split(",");
    if (!name || cls !== "backlight" || !Number(max)) return [];
    return [{ id: name, name, current: Number(current), max: Number(max), kind: "backlight" as const }];
  });
}

/** `udevadm info --export-db` → the devices of a subsystem, with their properties. */
export function parseUdevDb(out: string, subsystem: string): { path: string; props: Record<string, string> }[] {
  return out.split(/\n\s*\n/).flatMap((block) => {
    const props: Record<string, string> = {};
    let path = "";
    for (const line of block.split("\n")) {
      if (line.startsWith("P: ")) path = line.slice(3).trim();
      else if (line.startsWith("E: ")) {
        const eq = line.indexOf("=");
        if (eq > 3) props[line.slice(3, eq)] = line.slice(eq + 1);
      }
    }
    return props.SUBSYSTEM === subsystem && path ? [{ path, props }] : [];
  });
}

/** `udevadm info -a -p …`: the first device's `ATTR{…}` values. */
export function parseUdevAttrs(out: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const first = out.split(/looking at parent device/)[0];
  for (const m of first.matchAll(/ATTR\{([^}]+)\}=="([^"]*)"/g)) attrs[m[1]] = m[2];
  return attrs;
}

/** The raw value for a percentage, never fully off for a backlight. */
export function rawFor(b: Backlight, pct: number): number {
  const v = Math.round((Math.max(0, Math.min(100, pct)) / 100) * b.max);
  return b.kind === "backlight" ? Math.max(1, v) : v;
}

/** One step brighter or dimmer, landing on multiples of the step. */
export function stepped(pct: number, step: number): number {
  const next = step > 0 ? Math.floor(pct / step) * step + step : Math.ceil(pct / -step) * -step + step;
  return Math.max(step > 0 ? 0 : 1, Math.min(100, next));
}

export const PRESETS = [100, 75, 50, 25, 10];

export interface DdcDisplay {
  display: number;
  model: string;
  bus?: string;
  connector?: string;
}

/** `ddcutil detect --brief`. */
export function parseDdcDetect(out: string): DdcDisplay[] {
  return out.split(/\n\s*\n/).flatMap((block) => {
    const n = block.match(/^Display\s+(\d+)/m);
    if (!n) return [];
    const monitor = block.match(/Monitor:\s+(.*)$/m)?.[1]?.trim() ?? "";
    const [, model] = monitor.split(":");
    return [{
      display: Number(n[1]),
      model: (model || monitor || `Display ${n[1]}`).trim(),
      bus: block.match(/I2C bus:\s+(\S+)/)?.[1],
      connector: block.match(/DRM connector:\s+(\S+)/)?.[1]?.replace(/^card\d+-/, ""),
    }];
  });
}

/** `ddcutil --brief getvcp 10`: "VCP 10 C 50 100" → current and max. */
export function parseDdcVcp(out: string): { current: number; max: number } | undefined {
  const m = out.match(/VCP\s+10\s+C\s+(\d+)\s+(\d+)/i);
  return m ? { current: Number(m[1]), max: Number(m[2]) } : undefined;
}

// ---------------------------------------------------------------------------
// Night light

/** `gsettings get …`: "true", "uint32 2700", "'manual'". */
export function parseGsettings(out: string): string | number | boolean {
  const v = out.trim();
  if (v === "true" || v === "false") return v === "true";
  const n = v.match(/^(?:u?int\d*\s+)?(-?[\d.]+)$/);
  if (n) return Number(n[1]);
  return v.replace(/^'(.*)'$/, "$1");
}

/** `busctl get-property …`: "b true", "u 4500". */
export function parseBusctl(out: string): string | number | boolean | undefined {
  const m = out.trim().match(/^([a-z])\s+(.*)$/);
  if (!m) return undefined;
  if (m[1] === "b") return m[2] === "true";
  if ("uiynqxtd".includes(m[1])) return Number(m[2]);
  return m[2].replace(/^"(.*)"$/, "$1");
}

/** Daemons that keep the screen warm on wlroots compositors and X11, best first. */
export type Warmer = "hyprsunset" | "wlsunset" | "gammastep" | "redshift";

export function warmerCandidates(s: Session): Warmer[] {
  if (s.wayland) return s.desktop === "hyprland" ? ["hyprsunset", "wlsunset", "gammastep"] : ["wlsunset", "gammastep"];
  return ["gammastep", "redshift"];
}

/** The daemon's command line, at a fixed temperature all day. */
export function warmerCommand(tool: Warmer, kelvin: number): string[] {
  const k = Math.round(Math.max(1000, Math.min(6500, kelvin)));
  switch (tool) {
    case "hyprsunset":
      return ["hyprsunset", "-t", String(k)];
    case "wlsunset":
      // wlsunset needs a day temperature above the night one.
      return ["wlsunset", "-t", String(k), "-T", String(k + 1)];
    case "gammastep":
    case "redshift":
      return [tool, "-l", "0:0", "-t", `${k}:${k}`, "-r"];
  }
}

export function systemdRunArgs(unit: string, command: string[], env: Env = {}): string[] {
  return [
    "--user",
    "--quiet",
    `--unit=${unit}`,
    "--description=Backslash: night light",
    "--collect",
    ...Object.entries(env).filter(([, v]) => v).map(([k, v]) => `--setenv=${k}=${v}`),
    ...command,
  ];
}

// ---------------------------------------------------------------------------
// Monitors

export interface Monitor {
  name: string;
  description: string;
  make?: string;
  model?: string;
  serial?: string;
  width: number;
  height: number;
  /** Hz. */
  refresh: number;
  scale: number;
  x: number;
  y: number;
  transform?: string;
  enabled: boolean;
  primary?: boolean;
  builtin?: boolean;
  vrr?: boolean;
  modes: string[];
}

const nonEmpty = (s: unknown) => (typeof s === "string" && s.trim() && s !== "Unknown" ? s.trim() : undefined);
const isBuiltin = (name: string) => /^(eDP|LVDS|DSI)/i.test(name);
const TRANSFORMS = ["normal", "90", "180", "270", "flipped", "flipped-90", "flipped-180", "flipped-270"];
const modeName = (w: number, h: number, r: number) => `${w}×${h} @ ${round(r)} Hz`;
const round = (r: number) => (Math.abs(r - Math.round(r)) < 0.01 ? String(Math.round(r)) : r.toFixed(2));

/** `hyprctl -j monitors`. */
export function parseHyprctl(json: string): Monitor[] {
  return (JSON.parse(json) as any[]).map((m) => ({
    name: m.name,
    // hyprctl appends the serial to the description.
    description: (nonEmpty(m.description) ?? m.name).replace(m.serial ? ` ${m.serial}` : /$^/, ""),
    make: nonEmpty(m.make),
    model: nonEmpty(m.model),
    serial: nonEmpty(m.serial),
    width: m.width,
    height: m.height,
    refresh: m.refreshRate,
    scale: m.scale,
    x: m.x,
    y: m.y,
    transform: TRANSFORMS[m.transform] ?? String(m.transform),
    enabled: !m.disabled && m.dpmsStatus !== false,
    primary: !!m.focused,
    builtin: isBuiltin(m.name),
    vrr: !!m.vrr,
    modes: [
      ...new Set(((m.availableModes ?? []) as string[]).map((s) => {
        const x = s.match(/(\d+)x(\d+)@([\d.]+)/);
        return x ? modeName(Number(x[1]), Number(x[2]), Number(x[3])) : s;
      })),
    ],
  }));
}

/** `swaymsg -t get_outputs -r`. */
export function parseSway(json: string): Monitor[] {
  return (JSON.parse(json) as any[]).map((o) => {
    const mode = o.current_mode ?? {};
    return {
      name: o.name,
      description: [nonEmpty(o.make), nonEmpty(o.model)].filter(Boolean).join(" ") || o.name,
      make: nonEmpty(o.make),
      model: nonEmpty(o.model),
      serial: nonEmpty(o.serial),
      width: mode.width ?? 0,
      height: mode.height ?? 0,
      refresh: (mode.refresh ?? 0) / 1000,
      scale: o.scale ?? 1,
      x: o.rect?.x ?? 0,
      y: o.rect?.y ?? 0,
      transform: o.transform,
      enabled: o.active !== false,
      primary: !!o.focused,
      builtin: isBuiltin(o.name),
      vrr: o.adaptive_sync_status === "enabled",
      modes: [...new Set(((o.modes ?? []) as any[]).map((m) => modeName(m.width, m.height, m.refresh / 1000)))],
    };
  });
}

/** `wlr-randr --json`. */
export function parseWlrRandrJson(json: string): Monitor[] {
  return (JSON.parse(json) as any[]).map((o) => {
    const modes = (o.modes ?? []) as any[];
    const cur = modes.find((m) => m.current) ?? modes.find((m) => m.preferred) ?? {};
    return {
      name: o.name,
      description: [nonEmpty(o.make), nonEmpty(o.model)].filter(Boolean).join(" ") || nonEmpty(o.description) ||
        o.name,
      make: nonEmpty(o.make),
      model: nonEmpty(o.model),
      serial: nonEmpty(o.serial),
      width: cur.width ?? 0,
      height: cur.height ?? 0,
      refresh: cur.refresh ?? 0,
      scale: o.scale ?? 1,
      x: o.position?.x ?? 0,
      y: o.position?.y ?? 0,
      transform: o.transform,
      enabled: o.enabled !== false,
      builtin: isBuiltin(o.name),
      vrr: !!o.adaptive_sync,
      modes: [...new Set(modes.map((m) => modeName(m.width, m.height, m.refresh)))],
    };
  });
}

/** `wlr-randr` (text, for versions without --json). */
export function parseWlrRandrText(out: string): Monitor[] {
  const monitors: Monitor[] = [];
  let cur: Monitor | undefined;
  let inModes = false;
  for (const line of out.split("\n")) {
    const head = line.match(/^(\S+)\s*(?:"(.*)")?\s*$/);
    if (head) {
      cur = {
        name: head[1],
        description: head[2]?.replace(/\s*\([^)]*\)$/, "") || head[1],
        width: 0,
        height: 0,
        refresh: 0,
        scale: 1,
        x: 0,
        y: 0,
        enabled: true,
        builtin: isBuiltin(head[1]),
        modes: [],
      };
      monitors.push(cur);
      inModes = false;
      continue;
    }
    if (!cur) continue;
    const kv = line.match(/^\s+([A-Za-z ]+):\s*(.*)$/);
    if (kv) {
      inModes = kv[1] === "Modes";
      const v = kv[2].trim();
      if (kv[1] === "Make") cur.make = nonEmpty(v);
      else if (kv[1] === "Model") cur.model = nonEmpty(v);
      else if (kv[1] === "Serial") cur.serial = v === "(null)" ? undefined : nonEmpty(v);
      else if (kv[1] === "Enabled") cur.enabled = v === "yes";
      else if (kv[1] === "Scale") cur.scale = Number(v);
      else if (kv[1] === "Transform") cur.transform = v;
      else if (kv[1] === "Adaptive Sync") cur.vrr = v === "enabled";
      else if (kv[1] === "Position") {
        const [x, y] = v.split(",").map(Number);
        cur.x = x;
        cur.y = y;
      }
      continue;
    }
    const mode = line.match(/^\s+(\d+)x(\d+) px, ([\d.]+) Hz(.*)$/);
    if (mode && inModes) {
      const [w, h, r] = [Number(mode[1]), Number(mode[2]), Number(mode[3])];
      cur.modes.push(modeName(w, h, r));
      if (mode[4].includes("current")) Object.assign(cur, { width: w, height: h, refresh: r });
    }
  }
  for (const m of monitors) {
    if (m.make || m.model) m.description = [m.make, m.model].filter(Boolean).join(" ");
    m.modes = [...new Set(m.modes)];
  }
  return monitors;
}

/** `xrandr --query`: connected outputs. */
export function parseXrandr(out: string): Monitor[] {
  const monitors: Monitor[] = [];
  let cur: Monitor | undefined;
  for (const line of out.split("\n")) {
    const head = line.match(
      /^(\S+) (connected|disconnected)( primary)?(?: (\d+)x(\d+)\+(-?\d+)\+(-?\d+))?(?: (left|right|inverted))?/,
    );
    if (head) {
      cur = undefined;
      if (head[2] !== "connected") continue;
      cur = {
        name: head[1],
        description: head[1],
        width: Number(head[4] ?? 0),
        height: Number(head[5] ?? 0),
        refresh: 0,
        scale: 1,
        x: Number(head[6] ?? 0),
        y: Number(head[7] ?? 0),
        transform: head[8] ?? "normal",
        enabled: head[4] !== undefined,
        primary: !!head[3],
        builtin: isBuiltin(head[1]),
        modes: [],
      };
      monitors.push(cur);
      continue;
    }
    const mode = cur && line.match(/^\s+(\d+)x(\d+)i?\s+(.*)$/);
    if (cur && mode) {
      const [w, h] = [Number(mode[1]), Number(mode[2])];
      for (const r of mode[3].matchAll(/([\d.]+)(\*?)(\+?)/g)) {
        cur.modes.push(modeName(w, h, Number(r[1])));
        if (r[2] === "*") cur.refresh = Number(r[1]);
      }
    }
  }
  for (const m of monitors) m.modes = [...new Set(m.modes)];
  return monitors;
}

/** `kscreen-doctor -j` (KDE Plasma). */
export function parseKscreen(json: string): Monitor[] {
  const rotations: Record<number, string> = { 1: "normal", 2: "90", 4: "180", 8: "270" };
  return ((JSON.parse(json).outputs ?? []) as any[]).filter((o) => o.connected).map((o) => {
    const modes = (o.modes ?? []) as any[];
    const cur = modes.find((m) => String(m.id) === String(o.currentModeId)) ?? {};
    return {
      name: o.name,
      description: o.name,
      width: cur.size?.width ?? o.size?.width ?? 0,
      height: cur.size?.height ?? o.size?.height ?? 0,
      refresh: cur.refreshRate ?? 0,
      scale: o.scale ?? 1,
      x: o.pos?.x ?? 0,
      y: o.pos?.y ?? 0,
      transform: rotations[o.rotation] ?? "normal",
      enabled: !!o.enabled,
      primary: o.priority === 1,
      builtin: isBuiltin(o.name),
      vrr: o.vrrPolicy === 1 || o.vrrPolicy === 2,
      modes: [...new Set(modes.map((m) => modeName(m.size.width, m.size.height, m.refreshRate)))],
    };
  });
}

/** `gdbus call … org.gnome.Mutter.DisplayConfig.GetCurrentState` (GNOME). */
export function parseMutter(out: string): Monitor[] {
  const heads = [...out.matchAll(/\(\('([^']*)', '([^']*)', '([^']*)', '([^']*)'\), \[\('/g)];
  const logical = [
    ...out.matchAll(/\((-?\d+), (-?\d+), ([\d.]+), (?:uint32 )?(\d+), (true|false), \[\('([^']*)'/g),
  ];
  return heads.map((h, i) => {
    const segment = out.slice(h.index!, heads[i + 1]?.index ?? out.length);
    const modeRe = /\('([^']+)', (\d+), (\d+), ([\d.]+), ([\d.]+), \[[^\]]*\], (\{[^}]*\}|@a\{sv\} \{\})\)/g;
    const modes = [...segment.matchAll(modeRe)];
    const cur = modes.find((m) => m[6].includes("'is-current': <true>"));
    const log = logical.find((l) => l[6] === h[1]);
    const display = segment.match(/'display-name': <'([^']*)'>/)?.[1];
    return {
      name: h[1],
      description: display ?? ([nonEmpty(h[2]), nonEmpty(h[3])].filter(Boolean).join(" ") || h[1]),
      make: nonEmpty(h[2]),
      model: nonEmpty(h[3]),
      serial: h[4] && !/^0x0+$/.test(h[4]) ? h[4] : undefined,
      width: cur ? Number(cur[2]) : 0,
      height: cur ? Number(cur[3]) : 0,
      refresh: cur ? Number(cur[4]) : 0,
      scale: log ? Number(log[3]) : 1,
      x: log ? Number(log[1]) : 0,
      y: log ? Number(log[2]) : 0,
      transform: log ? TRANSFORMS[Number(log[4])] : undefined,
      enabled: !!cur && !!log,
      primary: log?.[5] === "true",
      builtin: /'is-builtin': <true>/.test(segment) || isBuiltin(h[1]),
      modes: [...new Set(modes.map((m) => modeName(Number(m[2]), Number(m[3]), Number(m[4]))))],
    };
  });
}

export const resolution = (m: Monitor) => `${m.width} × ${m.height}`;
export const refreshText = (m: Monitor) => `${round(m.refresh)} Hz`;
export const scaleText = (s: number) => `${Number(s.toFixed(2))}×`;
/** The size the desktop lays out, e.g. 2256×1504 at 1.5 → 1504 × 1003. */
export const logicalSize = (m: Monitor) =>
  `${Math.round(m.width / (m.scale || 1))} × ${Math.round(m.height / (m.scale || 1))}`;

/** "16:9", "3:2", "21:9" (approximately). */
export function aspect(w: number, h: number): string {
  if (!w || !h) return "";
  const known: [number, number][] = [[16, 9], [16, 10], [3, 2], [4, 3], [21, 9], [32, 9], [5, 4], [1, 1]];
  const r = Math.max(w, h) / Math.min(w, h);
  const best = known.reduce((a, b) => (Math.abs(b[0] / b[1] - r) < Math.abs(a[0] / a[1] - r) ? b : a));
  if (Math.abs(best[0] / best[1] - r) > 0.07) return r.toFixed(2) + ":1";
  return w >= h ? `${best[0]}:${best[1]}` : `${best[1]}:${best[0]}`;
}

// ---------------------------------------------------------------------------
// What to install

export type Family = "arch" | "debian" | "fedora" | "suse";

export function osFamily(osRelease: string): Family | undefined {
  const field = (k: string) => osRelease.match(new RegExp(`^${k}="?([^"\\n]*)"?`, "m"))?.[1]?.toLowerCase() ?? "";
  const ids = `${field("ID")} ${field("ID_LIKE")}`.split(/\s+/);
  if (ids.some((i) => ["arch", "manjaro", "endeavouros", "cachyos"].includes(i))) return "arch";
  if (ids.some((i) => ["debian", "ubuntu", "linuxmint", "pop"].includes(i))) return "debian";
  if (ids.some((i) => ["fedora", "rhel", "centos"].includes(i))) return "fedora";
  if (ids.some((i) => i.startsWith("opensuse") || i === "suse")) return "suse";
  return undefined;
}

const MANAGERS: Record<Family, string> = {
  arch: "sudo pacman -S",
  debian: "sudo apt install",
  fedora: "sudo dnf install",
  suse: "sudo zypper install",
};

export const install = (family: Family | undefined, ...packages: string[]) =>
  `${MANAGERS[family ?? "debian"]} ${packages.join(" ")}`;
