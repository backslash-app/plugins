// Pure helpers for Startup Apps: XDG autostart files, systemd user units and Hyprland's exec-once.

/** The keys of a .desktop file's [Desktop Entry] group (localized keys left out). */
export type DesktopEntry = Record<string, string>;

export function parseDesktop(text: string): DesktopEntry {
  const out: DesktopEntry = {};
  let inEntry = false;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    if (line.startsWith("[")) {
      inEntry = line === "[Desktop Entry]";
      continue;
    }
    if (!inEntry) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    if (key.includes("[")) continue;
    out[key] = line.slice(eq + 1).trim();
  }
  return out;
}

/**
 * Sets (or with `undefined`, removes) a key of the [Desktop Entry] group,
 * keeping the rest of the file as it is.
 */
export function setDesktopKey(text: string, key: string, value: string | undefined): string {
  const lines = text.trim() ? text.replace(/\n+$/, "").split("\n") : [];
  let start = lines.findIndex((l) => l.trim() === "[Desktop Entry]");
  if (start < 0) {
    lines.unshift("[Desktop Entry]");
    start = 0;
  }
  let end = lines.findIndex((l, i) => i > start && l.trim().startsWith("["));
  if (end < 0) end = lines.length;
  const at = lines.findIndex((l, i) => i > start && i < end && l.split("=")[0].trim() === key);
  if (value === undefined) {
    if (at >= 0) lines.splice(at, 1);
  } else if (at >= 0) {
    lines[at] = `${key}=${value}`;
  } else {
    // After the last key of the group, before blank lines that separate the next one.
    let insert = end;
    while (insert > start + 1 && lines[insert - 1].trim() === "") insert--;
    lines.splice(insert, 0, `${key}=${value}`);
  }
  return lines.join("\n") + "\n";
}

const isTrue = (v?: string) => v?.toLowerCase() === "true";
const isFalse = (v?: string) => v?.toLowerCase() === "false";

/** Whether the desktop starts the entry: `Hidden=true` and `X-GNOME-Autostart-enabled=false` turn it off. */
export function isEnabled(e: DesktopEntry): boolean {
  return !isTrue(e.Hidden) && !isFalse(e["X-GNOME-Autostart-enabled"]);
}

/** Whether OnlyShowIn / NotShowIn let the entry start in this desktop (`XDG_CURRENT_DESKTOP`, colon separated). */
export function showsIn(e: DesktopEntry, currentDesktop: string): boolean {
  const current = currentDesktop.split(":").map((d) => d.trim().toLowerCase()).filter(Boolean);
  const list = (v?: string) => (v ?? "").split(";").map((d) => d.trim().toLowerCase()).filter(Boolean);
  const only = list(e.OnlyShowIn);
  const not = list(e.NotShowIn);
  if (current.length === 0) return true;
  if (only.length && !only.some((d) => current.includes(d))) return false;
  if (not.some((d) => current.includes(d))) return false;
  return true;
}

/** Exec without field codes (%u, %F…): what actually runs. */
export function cleanExec(exec: string): string {
  return exec.replace(/\s+%[fFuUdDnNickvm]/g, "").replace(/%%/g, "%").trim();
}

/** The program of a command line: `env FOO=1 /usr/bin/app --x` → `app`. */
export function programName(exec: string): string {
  const words = cleanExec(exec).match(/"[^"]*"|'[^']*'|\S+/g) ?? [];
  let i = 0;
  if (words[i] === "env") {
    i++;
    while (words[i] && (/^\w+=/.test(words[i]) || words[i].startsWith("-"))) i++;
  }
  while (words[i] && /^\w+=/.test(words[i])) i++;
  const prog = (words[i] ?? "").replace(/^["']|["']$/g, "");
  return prog.split("/").pop() ?? prog;
}

export type Origin = "user" | "system" | "override";

/** One XDG autostart entry, after the user's folder has overridden the system's. */
export interface Autostart {
  /** The file name, e.g. `nm-applet.desktop`; the same name in the user folder overrides the system one. */
  id: string;
  name: string;
  comment?: string;
  exec: string;
  enabled: boolean;
  /** `user`: only in ~/.config/autostart; `system`: only in /etc/xdg/autostart; `override`: the user's copy of a system entry. */
  origin: Origin;
  /** The file that decides (the user's when there is one). */
  path: string;
  systemPath?: string;
  /** OnlyShowIn / NotShowIn keep it from starting here. */
  otherDesktop: boolean;
  delay?: number;
  terminal: boolean;
  entry: DesktopEntry;
}

export interface DesktopFile {
  path: string;
  text: string;
}

/**
 * Merges the user's autostart folder over the system's, as session managers do:
 * a user file with the same name replaces the system one.
 */
export function mergeAutostart(user: DesktopFile[], system: DesktopFile[], currentDesktop = ""): Autostart[] {
  const name = (p: string) => p.split("/").pop() ?? p;
  const sys = new Map(system.map((f) => [name(f.path), f]));
  const out = new Map<string, Autostart>();
  const add = (file: DesktopFile, origin: Origin, base?: DesktopFile) => {
    const own = parseDesktop(file.text);
    // An override may hold little more than Hidden=true: show the system entry's name and command then.
    const e = base ? { ...parseDesktop(base.text), ...own } : own;
    const id = name(file.path);
    const delay = Number(e["X-GNOME-Autostart-Delay"]);
    out.set(id, {
      id,
      name: e.Name || id.replace(/\.desktop$/, ""),
      comment: e.Comment || e.GenericName || undefined,
      exec: cleanExec(e.Exec ?? ""),
      enabled: isEnabled(own),
      origin,
      path: file.path,
      systemPath: base?.path,
      otherDesktop: !showsIn(e, currentDesktop),
      delay: Number.isFinite(delay) && delay > 0 ? delay : undefined,
      terminal: isTrue(e.Terminal),
      entry: e,
    });
  };
  for (const f of system) add(f, "system");
  for (const f of user) {
    const base = sys.get(name(f.path));
    add(f, base ? "override" : "user", base);
  }
  return [...out.values()].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
}

/**
 * The user's file after turning an entry on or off, as GNOME Tweaks does: the
 * user's own file is edited, a system entry gets a copy in the user's folder.
 */
export function toggledText(userText: string | undefined, systemText: string | undefined, on: boolean): string {
  let text = userText ?? systemText ?? "[Desktop Entry]\n";
  text = setDesktopKey(text, "Hidden", on ? "false" : "true");
  if (!on) return setDesktopKey(text, "X-GNOME-Autostart-enabled", "false");
  return parseDesktop(text)["X-GNOME-Autostart-enabled"] === undefined
    ? text
    : setDesktopKey(text, "X-GNOME-Autostart-enabled", "true");
}

/** A new autostart entry. */
export function newDesktopFile(name: string, command: string, comment = ""): string {
  const lines = [
    "[Desktop Entry]",
    "Type=Application",
    `Name=${name.replace(/\n/g, " ").trim()}`,
    ...(comment.trim() ? [`Comment=${comment.replace(/\n/g, " ").trim()}`] : []),
    `Exec=${command.replace(/\n/g, " ").trim()}`,
    "Terminal=false",
    "X-GNOME-Autostart-enabled=true",
    "Hidden=false",
  ];
  return lines.join("\n") + "\n";
}

/** A file name for a new entry that doesn't collide with `taken`. */
export function desktopFileName(name: string, taken: string[]): string {
  const slug = name.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "startup-app";
  let id = `${slug}.desktop`;
  for (let i = 2; taken.includes(id); i++) id = `${slug}-${i}.desktop`;
  return id;
}

// ---------------------------------------------------------------------------
// systemd

export interface UnitFile {
  unit: string;
  state: string;
  preset?: string;
}

/** `systemctl --user list-unit-files --no-legend --plain` lines. */
export function parseUnitFiles(out: string): UnitFile[] {
  return out.split("\n").map((l) => l.trim().split(/\s+/)).filter((w) => w.length >= 2 && w[0].includes("."))
    .map(([unit, state, preset]) => ({ unit, state, preset: preset && preset !== "-" ? preset : undefined }));
}

export interface UnitInfo {
  id: string;
  description?: string;
  activeState?: string;
  subState?: string;
  fragmentPath?: string;
  wantedBy: string[];
  execStart?: string;
}

/** `systemctl show -p …` for several units: blocks of Key=Value separated by blank lines. */
export function parseShow(out: string): UnitInfo[] {
  return out.split(/\n\s*\n/).map((block) => {
    const kv: Record<string, string> = {};
    for (const line of block.split("\n")) {
      const eq = line.indexOf("=");
      if (eq > 0) kv[line.slice(0, eq)] = line.slice(eq + 1);
    }
    return kv;
  }).filter((kv) => kv.Id).map((kv) => ({
    id: kv.Id,
    description: kv.Description || undefined,
    activeState: kv.ActiveState || undefined,
    subState: kv.SubState || undefined,
    fragmentPath: kv.FragmentPath || undefined,
    wantedBy: (kv.WantedBy ?? "").split(/\s+/).filter(Boolean),
    execStart: kv.ExecStart ? execFromShow(kv.ExecStart) : undefined,
  }));
}

/** `{ path=/usr/bin/foo ; argv[]=/usr/bin/foo --bar ; … }` → `/usr/bin/foo --bar`. */
export function execFromShow(v: string): string | undefined {
  return v.match(/argv\[\]=([^;]*)/)?.[1]?.trim() || undefined;
}

// ---------------------------------------------------------------------------
// Hyprland

export interface ExecOnce {
  command: string;
  file: string;
  line: number;
  /** `exec-once` or `exec` (run again at each reload). */
  keyword: "exec-once" | "exec";
}

/** `exec-once` lines of a Hyprland config, and the files it `source`s. */
export function parseHyprland(text: string, file: string): { execs: ExecOnce[]; sources: string[] } {
  const execs: ExecOnce[] = [];
  const sources: string[] = [];
  text.split("\n").forEach((raw, i) => {
    // `##` is a literal #; a single # starts a comment.
    const line = stripComment(raw).trim();
    const m = line.match(/^(exec-once|exec|source)\s*=\s*(.+)$/);
    if (!m) return;
    if (m[1] === "source") sources.push(m[2].trim());
    else execs.push({ command: m[2].trim(), file, line: i + 1, keyword: m[1] as "exec-once" | "exec" });
  });
  return { execs, sources };
}

/** Removes a `# comment`; `##` stands for a literal `#`. */
function stripComment(line: string): string {
  let out = "";
  for (let i = 0; i < line.length; i++) {
    if (line[i] !== "#") out += line[i];
    else if (line[i + 1] === "#") out += line[i++];
    else break;
  }
  return out;
}

/** A `source =` path relative to the config, with `~` expanded. */
export function resolveSource(path: string, fromFile: string, home: string): string {
  if (path === "~" || path.startsWith("~/")) return home + path.slice(1);
  if (path.startsWith("$HOME/")) return home + path.slice(5);
  if (path.startsWith("/")) return path;
  return `${fromFile.slice(0, fromFile.lastIndexOf("/"))}/${path}`;
}

export function tilde(p: string, home: string): string {
  return home && (p === home || p.startsWith(home + "/")) ? "~" + p.slice(home.length) : p;
}

export function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}
