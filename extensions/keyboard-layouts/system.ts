// Reading and switching layouts with the desktop's own tools.

import { exec } from "@backslash/api";
import {
  type Backend,
  candidates,
  engineName,
  type Env,
  fcitxLayouts,
  gnomeLayouts,
  gnomeSourcesValue,
  hyprLayouts,
  kdeLayouts,
  type Layout,
  layoutName,
  osFamily,
  parseFcitxProfile,
  parseGnomeSources,
  parseIbusEngines,
  parseSetxkbmap,
  parseStringList,
  parseXkbList,
  SESSION_ENV,
  setxkbmapArgs,
  splitLayout,
  swayLayouts,
  x11Layouts,
  type XkbNames,
  xkbSwitchName,
} from "./lib.ts";

const env = (key: string): string | undefined => {
  try {
    return Deno.env.get(key) || undefined;
  } catch {
    return undefined;
  }
};

export const sessionEnv = (): Env => Object.fromEntries(SESSION_ENV.map((k) => [k, env(k)]));
const HOME = env("HOME") ?? "";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const quiet = (p: Promise<string>) => p.catch(() => undefined);

export async function family() {
  return osFamily(await Deno.readTextFile("/etc/os-release").catch(() => ""));
}

let xkbNames: XkbNames | undefined;
async function names(): Promise<XkbNames | undefined> {
  if (xkbNames) return xkbNames;
  for (const f of ["/usr/share/X11/xkb/rules/evdev.lst", "/usr/share/X11/xkb/rules/base.lst"]) {
    const text = await Deno.readTextFile(f).catch(() => "");
    if (text) return (xkbNames = parseXkbList(text));
  }
  return undefined;
}

const KDE = ["--dest", "org.kde.keyboard", "--object-path", "/Layouts"];
const kdeCall = (method: string, ...args: string[]) =>
  exec("gdbus", [
    "call",
    "--session",
    "--timeout",
    "2",
    ...KDE,
    "--method",
    `org.kde.KeyboardLayouts.${method}`,
    ...args,
  ]);

const gsettings = (...args: string[]) => exec("gsettings", args);
const SCHEMA = "org.gnome.desktop.input-sources";

export interface State {
  backend?: Backend;
  wanted: Backend[];
  layouts: Layout[];
  /** fcitx5 or IBus engines, outside the desktop's own list. */
  methods: Layout[];
  /** Which input method framework is running, if any. */
  framework?: "ibus" | "fcitx5";
  /** Hyprland: keyboard names, to switch each when "all" isn't understood. */
  keyboards?: string[];
  /** X11: whether xkb-switch is there to read and set the group. */
  xkbSwitch?: boolean;
  /** Why an installed backend didn't answer. */
  error?: string;
}

let lastError: string | undefined;

async function read(b: Backend, n?: XkbNames): Promise<Partial<State> | undefined> {
  try {
    switch (b) {
      case "gnome": {
        const [sources, mru] = await Promise.all([
          gsettings("get", SCHEMA, "sources"),
          gsettings("get", SCHEMA, "mru-sources").catch(() => "[]"),
        ]);
        const parsed = parseGnomeSources(sources);
        if (!parsed.length) {
          // No source configured: GNOME uses the system layout.
          return { layouts: [] };
        }
        const ibus = parsed.some(([t]) => t === "ibus")
          ? parseIbusEngines(await exec("ibus", ["list-engine"], { signal: AbortSignal.timeout(3000) }).catch(() => ""))
          : undefined;
        return { layouts: gnomeLayouts(sources, mru, n, ibus) };
      }
      case "kde": {
        const [list, current] = await Promise.all([kdeCall("getLayoutsList"), kdeCall("getLayout")]);
        return { layouts: kdeLayouts(list, current) };
      }
      case "hyprland": {
        const { layouts, keyboards } = hyprLayouts(await exec("hyprctl", ["devices", "-j"]), n);
        return { layouts, keyboards };
      }
      case "sway":
        return { layouts: swayLayouts(await exec("swaymsg", ["-t", "get_inputs", "-r"]), n) };
      case "x11": {
        const q = parseSetxkbmap(await exec("setxkbmap", ["-query"]));
        const current = await quiet(exec("xkb-switch", ["-p"]));
        return { layouts: x11Layouts(q, current, n), xkbSwitch: current !== undefined };
      }
    }
  } catch (e) {
    if (!(e instanceof Deno.errors.NotFound)) lastError = e instanceof Error ? e.message : String(e);
    return undefined;
  }
}

/** fcitx5 (its own list) or IBus (outside GNOME, which lists engines with the layouts). */
async function inputMethods(backend: Backend | undefined, n?: XkbNames): Promise<Pick<State, "methods" | "framework">> {
  const state = await quiet(exec("fcitx5-remote", []));
  if (state !== undefined && state !== "0") {
    const current = (await quiet(exec("fcitx5-remote", ["-n"]))) ?? "";
    const profile = await Deno.readTextFile(`${HOME}/.config/fcitx5/profile`).catch(() => "");
    const items = parseFcitxProfile(profile);
    return { framework: "fcitx5", methods: fcitxLayouts(items.length ? items : [{ name: current }], current, n) };
  }
  if (backend === "gnome") return { methods: [] };
  const engine = await quiet(exec("ibus", ["engine"], { signal: AbortSignal.timeout(2000) }));
  if (engine === undefined) return { methods: [] };
  const preload = parseStringList(
    (await quiet(gsettings("get", "org.freedesktop.ibus.general", "preload-engines"))) ?? "",
  );
  const engines = preload.length ? preload : [engine];
  return {
    framework: "ibus",
    methods: engines.map((id) => {
      const xkb = id.match(/^xkb:([^:]+):([^:]*):/);
      return {
        key: id,
        kind: "ibus" as const,
        code: xkb ? xkb[1] : id,
        variant: xkb?.[2] || undefined,
        name: xkb ? layoutName(n, xkb[1], xkb[2] || undefined) : engineName(id),
        active: id === engine,
      };
    }),
  };
}

export async function load(): Promise<State> {
  const wanted = candidates(sessionEnv());
  const n = await names();
  let found: State | undefined;
  for (const b of wanted) {
    const s = await read(b, n);
    if (s) {
      found = { backend: b, wanted, layouts: s.layouts ?? [], methods: [], ...s } as State;
      break;
    }
  }
  const state: State = found ?? { wanted, layouts: [], methods: [], error: lastError };
  Object.assign(state, await inputMethods(state.backend, n));
  return state;
}

// ---------------------------------------------------------------------------
// Switching

/** GNOME has no public API to pick an input source; Eval works only in unsafe mode. */
async function gnomeSwitch(index: number) {
  const ok = await quiet(exec("gdbus", [
    "call",
    "--session",
    "--timeout",
    "2",
    "--dest",
    "org.gnome.Shell",
    "--object-path",
    "/org/gnome/Shell",
    "--method",
    "org.gnome.Shell.Eval",
    `imports.ui.status.keyboard.getInputSourceManager().inputSources[${index}].activate(true)`,
  ]));
  if (ok?.startsWith("(true")) return;
  // GNOME Shell keeps its most-recently-used order when the list changes, and
  // activates the first one: leave only the chosen source for a moment, then
  // put the list back. The chosen one stays first, so it stays active.
  const text = await gsettings("get", SCHEMA, "sources");
  const sources = parseGnomeSources(text);
  const chosen = sources[index];
  if (!chosen) throw new Error("This input source is gone");
  await gsettings("set", SCHEMA, "sources", gnomeSourcesValue([chosen]));
  await sleep(350);
  await gsettings("set", SCHEMA, "sources", text);
  const mru = parseGnomeSources(await gsettings("get", SCHEMA, "mru-sources").catch(() => "[]"));
  const rest = [...sources, ...mru].filter(([t, id]) => !(t === chosen[0] && id === chosen[1]));
  const unique = rest.filter(([t, id], i) => rest.findIndex(([t2, id2]) => t === t2 && id === id2) === i);
  await gsettings("set", SCHEMA, "mru-sources", gnomeSourcesValue([chosen, ...unique])).catch(() => {});
}

export async function switchTo(s: State, l: Layout): Promise<void> {
  if (l.kind === "fcitx5") {
    await exec("fcitx5-remote", ["-s", l.key]);
    return;
  }
  if (l.kind === "ibus" && s.backend !== "gnome") {
    await exec("ibus", ["engine", l.key]);
    return;
  }
  const i = Number(l.key);
  switch (s.backend) {
    case "gnome":
      return await gnomeSwitch(i);
    case "kde": {
      const out = await kdeCall("setLayout", String(i));
      if (out.includes("false")) throw new Error("KDE refused to switch layout");
      return;
    }
    case "hyprland":
      try {
        await exec("hyprctl", ["switchxkblayout", "all", String(i)]);
      } catch {
        // Older Hyprland: one keyboard at a time.
        for (const k of s.keyboards ?? []) await exec("hyprctl", ["switchxkblayout", k, String(i)]).catch(() => {});
      }
      return;
    case "sway":
      await exec("swaymsg", ["input", "type:keyboard", "xkb_switch_layout", String(i)]);
      return;
    case "x11": {
      if (s.xkbSwitch) {
        await exec("xkb-switch", ["-s", xkbSwitchName(l)]);
        return;
      }
      const q = parseSetxkbmap(await exec("setxkbmap", ["-query"]));
      const at = q.layouts.findIndex((c, j) => c === l.code && (q.variants[j] || undefined) === l.variant);
      await exec("setxkbmap", setxkbmapArgs(q, at >= 0 ? at : i));
      return;
    }
    default:
      throw new Error("No keyboard layout backend found");
  }
}

export { splitLayout };
