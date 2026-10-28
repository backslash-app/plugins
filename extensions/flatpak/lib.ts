// Parsing flatpak's output and summing up what apps may do. Pure, tested in lib_test.ts.

export const COLUMNS = "application,name,description,version,branch,arch,origin,installation,ref,runtime,size";

export interface Ref {
  id: string;
  name: string;
  description: string;
  version: string;
  branch: string;
  arch: string;
  origin: string;
  /** "user", "system" or a custom installation's name. */
  installation: string;
  ref: string;
  /** For apps: `org.gnome.Platform/x86_64/47`. */
  runtime: string;
  size: number;
  kind: "app" | "runtime";
}

/** "258.8 MB", "1.2 GB", "980 bytes", "12,5 kB" (GLib's decimal units) → bytes. */
export function parseSize(text: string): number {
  const m = text.trim().replace(",", ".").match(/^([\d.]+)\s*(bytes?|[kKMGTP]i?B)?/);
  if (!m) return 0;
  const n = parseFloat(m[1]);
  const unit = (m[2] ?? "B").toLowerCase();
  const pow = unit.startsWith("byte") || unit === "b" ? 0 : "kmgtp".indexOf(unit[0]) + 1;
  const base = unit.includes("i") ? 1024 : 1000;
  return Math.round(n * base ** pow);
}

/** `flatpak list --app|--runtime --columns=…` (tab separated). */
export function parseList(text: string, kind: Ref["kind"]): Ref[] {
  return text.split("\n").filter((l) => l.trim()).map((line) => {
    const [id, name, description, version, branch, arch, origin, installation, ref, runtime, size] = line.split("\t");
    return {
      id: id ?? "",
      name: name || id || "",
      description: description ?? "",
      version: version ?? "",
      branch: branch ?? "",
      arch: arch ?? "",
      origin: origin ?? "",
      installation: installation ?? "",
      ref: ref ?? "",
      runtime: runtime ?? "",
      size: parseSize(size ?? ""),
      kind,
    };
  }).filter((r) => r.id);
}

/** `org.gnome.Platform/x86_64/47` → id and branch. */
export function splitRuntime(runtime: string): { id: string; arch?: string; branch?: string } {
  const [id, arch, branch] = runtime.split("/");
  return { id, arch, branch };
}

/**
 * Runtimes no installed app uses, directly or as an extension of a used
 * runtime (`org.freedesktop.Platform.GL.default` goes with
 * `org.freedesktop.Platform`, `org.mozilla.firefox.Locale` with Firefox).
 * A good guess; `flatpak uninstall --unused` has the final say.
 */
export function unusedRuntimes(apps: Ref[], runtimes: Ref[]): Set<string> {
  const used = new Set(apps.map((a) => {
    const r = splitRuntime(a.runtime);
    return `${r.id}/${r.branch ?? ""}`;
  }));
  const bases = [...apps.map((a) => a.id), ...runtimes.filter((r) => used.has(`${r.id}/${r.branch}`)).map((r) => r.id)];
  const direct = (r: Ref) => used.has(`${r.id}/${r.branch}`);
  const extension = (r: Ref) => bases.some((b) => r.id.startsWith(`${b}.`));
  // An extension of a runtime branch nothing uses goes with it (org.gnome.Platform.Locale of an old branch).
  const orphan = (r: Ref) =>
    runtimes.some((base) => r.id.startsWith(`${base.id}.`) && base.branch === r.branch && !direct(base));
  const out = new Set<string>();
  for (const r of runtimes) {
    if (direct(r)) continue;
    if (extension(r) && !orphan(r)) continue;
    out.add(r.ref);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Permissions

export interface Permissions {
  shared: string[];
  sockets: string[];
  devices: string[];
  features: string[];
  filesystems: string[];
  talk: string[];
  own: string[];
  system: string[];
}

/** `flatpak info --show-permissions <app>` (a keyfile). */
export function parsePermissions(text: string): Permissions {
  const p: Permissions = {
    shared: [],
    sockets: [],
    devices: [],
    features: [],
    filesystems: [],
    talk: [],
    own: [],
    system: [],
  };
  let group = "";
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    const g = line.match(/^\[(.+)\]$/);
    if (g) {
      group = g[1];
      continue;
    }
    const kv = line.match(/^([^=]+)=(.*)$/);
    if (!kv) continue;
    const [key, value] = [kv[1].trim(), kv[2].trim()];
    const values = value.split(";").filter(Boolean);
    if (group === "Context" && key in p) (p as unknown as Record<string, string[]>)[key].push(...values);
    if (group === "Session Bus Policy") (value === "own" ? p.own : p.talk).push(key);
    if (group === "System Bus Policy") p.system.push(key);
  }
  return p;
}

export type Level = "high" | "medium" | "low";
export interface Grant {
  text: string;
  level: Level;
}

const FS_NAMES: Record<string, string> = {
  host: "All files",
  "host-os": "System files",
  "host-etc": "System settings (/etc)",
  home: "Home folder",
  "xdg-download": "Downloads",
  "xdg-documents": "Documents",
  "xdg-pictures": "Pictures",
  "xdg-music": "Music",
  "xdg-videos": "Videos",
  "xdg-desktop": "Desktop",
  "xdg-config": "App settings",
  "xdg-run/pipewire-0": "PipeWire",
};

/** The permissions worth knowing about, worst first. Negated ones (`!home`) are left out. */
export function summarize(p: Permissions): Grant[] {
  const out: Grant[] = [];
  const add = (text: string, level: Level) => out.push({ text, level });
  for (const f of p.filesystems) {
    if (f.startsWith("!")) continue;
    const [path, mode] = f.split(":");
    const name = FS_NAMES[path] ?? path.replace(/^~\//, "~/");
    const level: Level = ["host", "host-os", "home", "host-etc"].includes(path) ? "high" : "medium";
    add(`${name}${mode === "ro" ? " (read-only)" : mode === "create" ? " (create)" : ""}`, level);
  }
  if (p.devices.includes("all")) add("All devices", "high");
  else if (p.devices.length) add(`Devices: ${p.devices.join(", ")}`, p.devices.includes("dri") ? "low" : "medium");
  if (p.sockets.includes("x11") && !p.sockets.includes("fallback-x11")) add("X11 (can see other windows)", "medium");
  if (p.sockets.includes("system-bus")) add("Whole system bus", "high");
  if (p.sockets.includes("session-bus")) add("Whole session bus", "high");
  if (p.sockets.includes("ssh-auth")) add("SSH agent", "medium");
  if (p.sockets.includes("pulseaudio")) add("Sound", "low");
  if (p.sockets.includes("cups")) add("Printing", "low");
  if (p.sockets.includes("pcsc")) add("Smart cards", "medium");
  if (p.shared.includes("network")) add("Network", "low");
  if (p.features.includes("devel")) add("Debugging (ptrace)", "medium");
  if (p.talk.includes("org.freedesktop.Flatpak")) add("Run commands outside the sandbox", "high");
  if (p.talk.some((n) => n === "org.freedesktop.secrets")) add("Passwords (Secret Service)", "medium");
  if (p.talk.includes("org.freedesktop.Notifications")) add("Notifications", "low");
  const rank: Record<Level, number> = { high: 0, medium: 1, low: 2 };
  return out.sort((a, b) => rank[a.level] - rank[b.level]);
}

export const sandboxScore = (grants: Grant[]): Level =>
  grants.some((g) => g.level === "high") ? "high" : grants.some((g) => g.level === "medium") ? "medium" : "low";

// ---------------------------------------------------------------------------
// Formatting

export function formatBytes(n: number): string {
  if (n < 1000) return `${n} B`;
  const units = ["kB", "MB", "GB", "TB"];
  let v = n / 1000;
  let i = 0;
  while (v >= 1000 && i < units.length - 1) {
    v /= 1000;
    i++;
  }
  return `${v >= 100 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

/** The Flathub page for apps that came from Flathub. */
export const flathubUrl = (r: Ref) => /flathub/i.test(r.origin) ? `https://flathub.org/apps/${r.id}` : undefined;

/** `flatpak uninstall` arguments for one ref in its own installation. */
export function uninstallArgs(r: Ref, deleteData = false): string[] {
  const where = r.installation === "user" ? ["--user"] : r.installation === "system" ? ["--system"] : [
    `--installation=${r.installation}`,
  ];
  return ["uninstall", ...where, "--noninteractive", "-y", ...(deleteData ? ["--delete-data"] : []), r.ref];
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
  arch: ["Arch", "sudo pacman -S flatpak"],
  debian: ["Debian, Ubuntu", "sudo apt install flatpak"],
  fedora: ["Fedora", "sudo dnf install flatpak"],
  suse: ["openSUSE", "sudo zypper install flatpak"],
};

export function installMarkdown(family?: Family): string {
  const families = family ? [family] : (Object.keys(MANAGERS) as Family[]);
  return [
    "Flatpak isn't installed. Install it, then add Flathub:",
    ...families.map((f) => `**${MANAGERS[f][0]}**\n\n\`${MANAGERS[f][1]}\``),
    "`flatpak remote-add --if-not-exists flathub https://dl.flathub.org/repo/flathub.flatpakrepo`",
  ].join("\n\n");
}
