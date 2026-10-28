// Keyboard layouts and input methods from every desktop's own tools. Pure,
// tested in lib_test.ts.

// ---------------------------------------------------------------------------
// Session

export type Backend = "gnome" | "kde" | "hyprland" | "sway" | "x11";
export type Env = Partial<Record<string, string>>;

export const SESSION_ENV = [
  "XDG_SESSION_TYPE",
  "XDG_CURRENT_DESKTOP",
  "WAYLAND_DISPLAY",
  "DISPLAY",
  "HYPRLAND_INSTANCE_SIGNATURE",
  "SWAYSOCK",
  "HOME",
] as const;

/** Backends worth trying here, best first; each is confirmed by asking it. */
export function candidates(env: Env): Backend[] {
  const desktop = (env.XDG_CURRENT_DESKTOP ?? "").toLowerCase().split(":");
  const type = (env.XDG_SESSION_TYPE ?? "").toLowerCase();
  const wayland = type === "wayland" || (!!env.WAYLAND_DISPLAY && type !== "x11");
  const out: Backend[] = [];
  if (env.HYPRLAND_INSTANCE_SIGNATURE || desktop.includes("hyprland")) out.push("hyprland");
  if (env.SWAYSOCK || desktop.includes("sway")) out.push("sway");
  if (desktop.includes("kde")) out.push("kde");
  if (desktop.some((d) => ["gnome", "ubuntu", "unity", "pop", "budgie", "cinnamon"].includes(d))) out.push("gnome");
  if (env.DISPLAY && !wayland) out.push("x11");
  return out;
}

export const BACKEND_NAMES: Record<Backend, string> = {
  gnome: "GNOME",
  kde: "KDE Plasma",
  hyprland: "Hyprland",
  sway: "Sway",
  x11: "X11",
};

// ---------------------------------------------------------------------------
// Layouts

export type Kind = "xkb" | "ibus" | "fcitx5";

export interface Layout {
  /** What the backend switches to: an index, a GNOME source, an engine name. */
  key: string;
  kind: Kind;
  /** XKB layout code (`fr`), or the engine name for input methods. */
  code: string;
  variant?: string;
  name: string;
  active: boolean;
}

/** `fr`, `fr+azerty`, `fr(azerty)` → code and variant. */
export function splitLayout(spec: string): { code: string; variant?: string } {
  const m = spec.match(/^([^+(]+)(?:\+([^)]+)|\(([^)]+)\))?$/);
  if (!m) return { code: spec };
  const variant = m[2] ?? m[3];
  return variant ? { code: m[1], variant } : { code: m[1] };
}

/** "FR", "US", "DE·NEO": the short tag shown next to the layout. */
export function tag(l: Pick<Layout, "code" | "variant" | "kind">): string {
  if (l.kind !== "xkb") return l.kind === "ibus" ? "IBus" : "Fcitx";
  const base = l.code.toUpperCase();
  if (!l.variant) return base;
  const v = l.variant.replace(/[-_].*/, "");
  return `${base}·${v.length > 6 ? v.slice(0, 5).toUpperCase() : v.toUpperCase()}`;
}

export interface XkbNames {
  layouts: Map<string, string>;
  /** Keyed by `code+variant`. */
  variants: Map<string, string>;
}

/** `/usr/share/X11/xkb/rules/evdev.lst` → layout and variant descriptions. */
export function parseXkbList(text: string): XkbNames {
  const layouts = new Map<string, string>();
  const variants = new Map<string, string>();
  let section = "";
  for (const line of text.split("\n")) {
    const head = line.match(/^!\s*(\w+)/);
    if (head) {
      section = head[1];
      continue;
    }
    const m = line.match(/^\s+(\S+)\s+(.+)$/);
    if (!m) continue;
    if (section === "layout") layouts.set(m[1], m[2].trim());
    else if (section === "variant") {
      const v = m[2].match(/^(\S+):\s*(.+)$/);
      if (v) variants.set(`${v[1]}+${m[1]}`, v[2].trim());
    }
  }
  return { layouts, variants };
}

export function layoutName(names: XkbNames | undefined, code: string, variant?: string): string {
  return (variant ? names?.variants.get(`${code}+${variant}`) : undefined) ?? names?.layouts.get(code) ??
    (variant ? `${code.toUpperCase()} (${variant})` : code.toUpperCase());
}

/** The layout and variant code of a description ("French (AZERTY)"), for backends that only give names. */
export function codeOfName(names: XkbNames | undefined, name: string): { code: string; variant?: string } | undefined {
  if (!names) return undefined;
  for (const [key, desc] of names.variants) {
    if (desc === name) {
      const [code, variant] = key.split("+");
      return { code, variant };
    }
  }
  for (const [code, desc] of names.layouts) if (desc === name) return { code };
  return undefined;
}

// --- GNOME -----------------------------------------------------------------

/** `gsettings get org.gnome.desktop.input-sources sources`: `[('xkb', 'us'), ('ibus', 'anthy')]`. */
export function parseGnomeSources(text: string): [string, string][] {
  return [...text.matchAll(/\(\s*'([^']*)'\s*,\s*'([^']*)'\s*\)/g)].map((m) => [m[1], m[2]]);
}

export const gnomeSourcesValue = (sources: [string, string][]) =>
  sources.length ? `[${sources.map(([t, id]) => `('${t}', '${id}')`).join(", ")}]` : "@a(ss) []";

/** GNOME's input sources, the current one being the first of `mru-sources` still configured. */
export function gnomeLayouts(sourcesText: string, mruText: string, names?: XkbNames, ibusNames?: Map<string, string>) {
  const sources = parseGnomeSources(sourcesText);
  const mru = parseGnomeSources(mruText);
  const current = mru.find(([t, id]) => sources.some(([t2, id2]) => t === t2 && id === id2)) ?? sources[0];
  return sources.map(([type, id], i): Layout => {
    const active = !!current && current[0] === type && current[1] === id;
    if (type === "xkb") {
      const { code, variant } = splitLayout(id);
      return { key: String(i), kind: "xkb", code, variant, name: layoutName(names, code, variant), active };
    }
    return { key: String(i), kind: "ibus", code: id, name: ibusNames?.get(id) ?? engineName(id), active };
  });
}

// --- KDE -------------------------------------------------------------------

/** `gdbus … org.kde.KeyboardLayouts.getLayoutsList`: `([('us', '', 'English (US)'), ('fr', 'azerty', 'French')],)`. */
export function kdeLayouts(listOut: string, currentOut: string): Layout[] {
  const current = Number(currentOut.replace(/u?int\d+/g, "").match(/(\d+)/)?.[1] ?? 0);
  return [...listOut.matchAll(/\(\s*'([^']*)'\s*,\s*'([^']*)'\s*,\s*'((?:[^'\\]|\\.)*)'\s*\)/g)].map((m, i) => ({
    key: String(i),
    kind: "xkb",
    code: m[1],
    variant: m[2] || undefined,
    name: m[3].replace(/\\(.)/g, "$1") || m[1].toUpperCase(),
    active: i === current,
  }));
}

// --- Hyprland --------------------------------------------------------------

interface HyprKeyboard {
  name: string;
  layout: string;
  variant: string;
  active_keymap: string;
  main?: boolean;
  active_layout_index?: number;
}

/** `hyprctl devices -j`: the main keyboard's layouts; the active one from its keymap name. */
export function hyprLayouts(json: string, names?: XkbNames): { layouts: Layout[]; keyboards: string[] } {
  const keyboards = ((JSON.parse(json) as { keyboards?: HyprKeyboard[] }).keyboards ?? [])
    .filter((k) => !/virtual|power-button|video-bus|sleep-button/i.test(k.name));
  const main = keyboards.find((k) => k.main) ?? keyboards[0];
  if (!main) return { layouts: [], keyboards: [] };
  const codes = main.layout.split(",").map((s) => s.trim());
  const variants = (main.variant ?? "").split(",").map((s) => s.trim());
  const layouts = codes.filter(Boolean).map((code, i): Layout => {
    const variant = variants[i] || undefined;
    return { key: String(i), kind: "xkb", code, variant, name: layoutName(names, code, variant), active: false };
  });
  const index = typeof main.active_layout_index === "number"
    ? main.active_layout_index
    : layouts.findIndex((l) => l.name === main.active_keymap);
  const fallback = layouts.findIndex((l) => names?.layouts.get(l.code) === main.active_keymap);
  const active = index >= 0 ? index : fallback >= 0 ? fallback : 0;
  if (layouts[active]) layouts[active].active = true;
  return { layouts, keyboards: keyboards.map((k) => k.name) };
}

// --- Sway ------------------------------------------------------------------

/** `swaymsg -t get_inputs -r`: the first keyboard's layout names and active index. */
export function swayLayouts(json: string, names?: XkbNames): Layout[] {
  const inputs = JSON.parse(json) as {
    type: string;
    xkb_layout_names?: string[];
    xkb_active_layout_index?: number;
  }[];
  const kb = inputs.find((i) => i.type === "keyboard" && (i.xkb_layout_names?.length ?? 0) > 1) ??
    inputs.find((i) => i.type === "keyboard");
  if (!kb?.xkb_layout_names) return [];
  return kb.xkb_layout_names.map((name, i) => {
    const c = codeOfName(names, name);
    return {
      key: String(i),
      kind: "xkb",
      code: c?.code ?? name.slice(0, 2).toLowerCase(),
      variant: c?.variant,
      name,
      active: i === (kb.xkb_active_layout_index ?? 0),
    };
  });
}

// --- X11 -------------------------------------------------------------------

export interface XkbQuery {
  layouts: string[];
  variants: string[];
  options?: string;
}

/** `setxkbmap -query`. */
export function parseSetxkbmap(text: string): XkbQuery {
  const get = (k: string) => text.match(new RegExp(`^${k}:\\s*(.*)$`, "m"))?.[1]?.trim() ?? "";
  const layouts = get("layout").split(",").map((s) => s.trim());
  const variants = get("variant").split(",").map((s) => s.trim());
  return { layouts: layouts.filter(Boolean), variants, options: get("options") || undefined };
}

/** X11 layouts; `current` is `xkb-switch -p` (`fr(azerty)`), else the first group is active. */
export function x11Layouts(q: XkbQuery, current?: string, names?: XkbNames): Layout[] {
  const cur = current ? splitLayout(current.trim()) : undefined;
  let found = false;
  const out = q.layouts.map((code, i): Layout => {
    const variant = q.variants[i] || undefined;
    const active = !found && !!cur && cur.code === code && (cur.variant ?? "") === (variant ?? "");
    if (active) found = true;
    return { key: String(i), kind: "xkb", code, variant, name: layoutName(names, code, variant), active };
  });
  if (!found && out[0]) out[0].active = true;
  return out;
}

/** `setxkbmap` arguments putting layout `i` first, so it becomes the active group. */
export function setxkbmapArgs(q: XkbQuery, i: number): string[] {
  const order = [i, ...q.layouts.map((_, j) => j).filter((j) => j !== i)];
  const args = ["-layout", order.map((j) => q.layouts[j]).join(",")];
  if (q.variants.some(Boolean)) args.push("-variant", order.map((j) => q.variants[j] ?? "").join(","));
  return args;
}

/** The `xkb-switch -s` argument for a layout. */
export const xkbSwitchName = (l: Layout) => l.variant ? `${l.code}(${l.variant})` : l.code;

// ---------------------------------------------------------------------------
// Input methods

/** "mozc-jp" → "Mozc", "libpinyin" → "Pinyin": a readable name when the engine gives none. */
export function engineName(id: string): string {
  const known: Record<string, string> = {
    "mozc-jp": "Mozc (Japanese)",
    anthy: "Anthy (Japanese)",
    libpinyin: "Intelligent Pinyin",
    pinyin: "Pinyin",
    rime: "Rime",
    hangul: "Hangul (Korean)",
    chewing: "Chewing (Chinese)",
    "m17n:hi:inscript": "Hindi (InScript)",
    "unikey": "Unikey (Vietnamese)",
  };
  if (known[id]) return known[id];
  const base = id.replace(/^keyboard-/, "").replace(/^xkb:/, "").replace(/::.*$/, "");
  return base.charAt(0).toUpperCase() + base.slice(1);
}

/** `ibus list-engine`: `  anthy - Anthy` lines → names. */
export function parseIbusEngines(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of text.matchAll(/^\s+(\S+)\s+-\s+(.+)$/gm)) out.set(m[1], m[2].trim());
  return out;
}

/** `gsettings get org.freedesktop.ibus.general preload-engines`: `['xkb:us::eng', 'anthy']`. */
export function parseStringList(text: string): string[] {
  return [...text.matchAll(/'((?:[^'\\]|\\.)*)'/g)].map((m) => m[1]);
}

/** `~/.config/fcitx5/profile`: the input methods of the first group, in order. */
export function parseFcitxProfile(text: string): { name: string; layout?: string }[] {
  const out: { name: string; layout?: string }[] = [];
  let group = "";
  let item: { name?: string; layout?: string } | undefined;
  const flush = () => {
    if (item?.name) out.push({ name: item.name, layout: item.layout || undefined });
    item = undefined;
  };
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    const sec = line.match(/^\[(.+)\]$/);
    if (sec) {
      flush();
      group = sec[1];
      if (/^Groups\/0\/Items\/\d+$/.test(group)) item = {};
      continue;
    }
    if (!item) continue;
    const kv = line.match(/^(\w+)=(.*)$/);
    if (kv?.[1] === "Name") item.name = kv[2];
    if (kv?.[1] === "Layout") item.layout = kv[2];
  }
  flush();
  return out;
}

/** Input methods as layouts: `keyboard-fr-azerty` is an XKB layout under fcitx5. */
export function fcitxLayouts(items: { name: string }[], current: string, names?: XkbNames): Layout[] {
  return items.map((it) => {
    const kb = it.name.match(/^keyboard-([a-z]+)(?:-(.+))?$/);
    if (kb) {
      return {
        key: it.name,
        kind: "fcitx5",
        code: kb[1],
        variant: kb[2],
        name: layoutName(names, kb[1], kb[2]),
        active: it.name === current,
      };
    }
    return { key: it.name, kind: "fcitx5", code: it.name, name: engineName(it.name), active: it.name === current };
  });
}

/** Tag for an fcitx5 keyboard layout: it is still an XKB layout to the user. */
export const displayTag = (l: Layout) =>
  l.kind === "fcitx5" && /^keyboard-/.test(l.key) ? tag({ ...l, kind: "xkb" }) : tag(l);

/** The layout after the active one, cycling. */
export function nextLayout<T extends { active: boolean }>(layouts: T[]): T | undefined {
  if (layouts.length < 2) return undefined;
  const i = layouts.findIndex((l) => l.active);
  return layouts[(i + 1) % layouts.length];
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

const MANAGERS: Record<Family, [string, string]> = {
  arch: ["Arch", "sudo pacman -S"],
  debian: ["Debian, Ubuntu", "sudo apt install"],
  fedora: ["Fedora", "sudo dnf install"],
  suse: ["openSUSE", "sudo zypper install"],
};

const PACKAGES: Record<string, Partial<Record<Family, string>>> = {
  setxkbmap: { debian: "x11-xkb-utils", fedora: "setxkbmap", arch: "xorg-setxkbmap", suse: "setxkbmap" },
  "xkb-switch": { debian: "xkb-switch", arch: "xkb-switch", fedora: "xkb-switch", suse: "xkb-switch" },
  gdbus: { debian: "libglib2.0-bin", arch: "glib2", fedora: "glib2", suse: "glib2-tools" },
};

export function installMarkdown(what: string, programs: string[], family?: Family): string {
  const families = family ? [family] : (Object.keys(MANAGERS) as Family[]);
  const lines = families.map((f) =>
    `**${MANAGERS[f][0]}**\n\n\`${MANAGERS[f][1]} ${programs.map((p) => PACKAGES[p]?.[f] ?? p).join(" ")}\``
  );
  return `${what}\n\n${lines.join("\n\n")}`;
}
