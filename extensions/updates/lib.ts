// Parsing the output of package managers, and building the commands that apply updates.
// Pure, tested in lib_test.ts.

export type Manager = "apt" | "dnf" | "pacman" | "zypper" | "flatpak" | "snap" | "fwupd";

export interface Update {
  manager: Manager;
  name: string;
  /** Installed version, when the manager tells. */
  from?: string;
  to: string;
  /** Repository, remote, channel or vendor. */
  source?: string;
  arch?: string;
  security: boolean;
  /** Flatpak application id, fwupd device id. */
  id?: string;
  /** Display name when it differs from the package name (Flatpak apps, firmware). */
  label?: string;
  summary?: string;
  /** Download size in bytes, when known. */
  size?: number;
}

export interface ManagerInfo {
  title: string;
  /** Programs probed to know whether the manager is installed. */
  program: string;
  /** Asks for administrator rights. */
  sudo: boolean;
  kind: "system" | "apps" | "firmware";
}

export const MANAGERS: Record<Manager, ManagerInfo> = {
  apt: { title: "APT", program: "apt", sudo: true, kind: "system" },
  dnf: { title: "DNF", program: "dnf", sudo: true, kind: "system" },
  pacman: { title: "Pacman", program: "pacman", sudo: true, kind: "system" },
  zypper: { title: "Zypper", program: "zypper", sudo: true, kind: "system" },
  flatpak: { title: "Flatpak", program: "flatpak", sudo: false, kind: "apps" },
  snap: { title: "Snap", program: "snap", sudo: true, kind: "apps" },
  fwupd: { title: "Firmware", program: "fwupdmgr", sudo: false, kind: "firmware" },
};

export const ORDER: Manager[] = ["apt", "dnf", "pacman", "zypper", "flatpak", "snap", "fwupd"];

const lines = (out: string) => out.split("\n").map((l) => l.trimEnd()).filter((l) => l.trim());

/**
 * `apt list --upgradable`:
 * `openssl/jammy-updates,jammy-security 3.0.2-0ubuntu1.15 amd64 [upgradable from: 3.0.2-0ubuntu1.14]`.
 */
export function parseApt(out: string): Update[] {
  return lines(out).flatMap((line) => {
    const m = line.match(/^([^/\s]+)\/(\S+)\s+(\S+)\s+(\S+)(?:\s+\[upgradable from:\s*([^\]]+)\])?/);
    if (!m) return [];
    const suites = m[2].split(",");
    return [{
      manager: "apt" as const,
      name: m[1],
      to: m[3],
      arch: m[4],
      from: m[5]?.trim(),
      source: suites[0],
      security: suites.some((s) => /-security$|^security$/.test(s)),
    }];
  });
}

/**
 * `dnf check-update` (dnf 4 and 5): `name.arch  version  repo`, sometimes wrapped after a long name.
 * Stops at "Obsoleting Packages".
 */
export function parseDnf(out: string): Update[] {
  const updates: Update[] = [];
  let carry = "";
  for (const raw of out.split("\n")) {
    if (/^Obsoleting/i.test(raw.trim())) break;
    const line = (carry ? `${carry} ${raw.trim()}` : raw.trim()).trim();
    carry = "";
    if (!line || /^(Last metadata|Available Upgrades|Upgrades|Updating|Security:|Repositories loaded)/i.test(line)) {
      continue;
    }
    const parts = line.split(/\s+/);
    if (parts.length === 1 && /\.\w+$/.test(parts[0])) {
      carry = parts[0]; // the version and repo are on the next line
      continue;
    }
    if (parts.length < 3) continue;
    const m = parts[0].match(/^(.+)\.([^.]+)$/);
    if (!m || !/\d/.test(parts[1])) continue;
    updates.push({ manager: "dnf", name: m[1], arch: m[2], to: parts[1], source: parts[2], security: false });
  }
  return updates;
}

/** Name of an RPM from its NEVRA, `kernel-core-6.8.5-301.fc40.x86_64` → `kernel-core`. */
export function rpmName(nevra: string): string | undefined {
  return nevra.match(/^(.+)-[^-]+-[^-]+\.[^.]+$/)?.[1];
}

/**
 * `dnf updateinfo list --security`: the packages fixed by a security advisory.
 * dnf 4: `FEDORA-2024-1a2b3c Important/Sec. openssl-1:3.2.1-2.fc40.x86_64`;
 * dnf 5: `FEDORA-2024-1a2b3c security  Important openssl-1:3.2.1-2.fc40.x86_64 2024-04-09 01:23:45`.
 */
export function parseDnfSecurity(out: string): Set<string> {
  const names = new Set<string>();
  for (const line of lines(out)) {
    const nevra = line.trim().split(/\s+/).find((t, i) =>
      i > 0 && /-\d.*\.\w+$/.test(t) && !/^\d{4}-\d\d-\d\d$/.test(t)
    );
    const name = nevra && rpmName(nevra);
    if (name) names.add(name);
  }
  return names;
}

/** `rpm -q --qf '%{NAME}.%{ARCH} %{VERSION}-%{RELEASE}\n' …`: the newest installed version wins. */
export function parseRpmVersions(out: string): Map<string, string> {
  const versions = new Map<string, string>();
  for (const line of lines(out)) {
    const [key, version] = line.trim().split(/\s+/);
    if (key && version && !/is not installed/.test(line)) versions.set(key, version);
  }
  return versions;
}

/** `checkupdates` (pacman-contrib): `linux 6.8.4.arch1-1 -> 6.8.5.arch1-1`. */
export function parseCheckupdates(out: string): Update[] {
  return lines(out).flatMap((line) => {
    const m = line.trim().match(/^(\S+)\s+(\S+)\s+->\s+(\S+)/);
    return m ? [{ manager: "pacman" as const, name: m[1], from: m[2], to: m[3], security: false }] : [];
  });
}

/** `zypper -q list-updates`: a table whose header names the columns. */
export function parseZypper(out: string): Update[] {
  const rows = lines(out).filter((l) => l.includes("|"));
  const header = rows.findIndex((r) => /\bName\b/.test(r) && /Version/.test(r));
  if (header < 0) return [];
  const cols = rows[header].split("|").map((c) => c.trim());
  const at = (name: RegExp) => cols.findIndex((c) => name.test(c));
  const [repo, name, current, available, arch] = [
    at(/^Repository$/),
    at(/^Name$/),
    at(/^Current Version$/),
    at(/^Available Version$/),
    at(/^Arch$/),
  ];
  return rows.slice(header + 1).flatMap((row) => {
    if (/^[-+|\s]+$/.test(row)) return [];
    const cells = row.split("|").map((c) => c.trim());
    if (!cells[name]) return [];
    return [{
      manager: "zypper" as const,
      name: cells[name],
      from: current >= 0 ? cells[current] || undefined : undefined,
      to: cells[available] ?? "",
      source: repo >= 0 ? cells[repo] : undefined,
      arch: arch >= 0 ? cells[arch] : undefined,
      security: false,
    }];
  });
}

export const FLATPAK_COLUMNS = "application,name,version,branch,origin";

/**
 * `flatpak remote-ls --updates --columns=application,name,version,branch,origin` (tab separated),
 * with the installed versions from `flatpak list --columns=application,version,branch`.
 */
export function parseFlatpak(out: string, installed = ""): Update[] {
  const current = new Map<string, string>();
  for (const line of lines(installed)) {
    const [app, version, branch] = line.split("\t");
    if (app) current.set(`${app}/${branch ?? ""}`, version || branch || "");
  }
  return lines(out).flatMap((line) => {
    const [app, name, version, branch, origin] = line.split("\t").map((c) => c?.trim());
    if (!app || app === "Application ID") return [];
    const runtime = /\.(Platform|Sdk|GL|Locale|Debug|Codecs|ffmpeg|openh264)\b/.test(app) ||
      /^org\.freedesktop\./.test(app);
    return [{
      manager: "flatpak" as const,
      name: app,
      label: name && name !== app ? name : undefined,
      id: app,
      from: current.get(`${app}/${branch ?? ""}`) || undefined,
      to: version || branch || "latest",
      source: origin,
      arch: branch,
      summary: runtime ? "Runtime shared by Flatpak apps" : undefined,
      security: false,
    }];
  });
}

const SIZE_UNITS: Record<string, number> = { B: 1, kB: 1e3, KB: 1e3, MB: 1e6, GB: 1e9 };

/** `snap refresh --list`: `Name Version Rev Size Publisher Notes`; `snap list` gives the installed versions. */
export function parseSnap(out: string, installed = ""): Update[] {
  const current = new Map<string, string>();
  for (const line of lines(installed).slice(1)) {
    const [name, version] = line.trim().split(/\s+/);
    if (name) current.set(name, version);
  }
  const rows = lines(out);
  if (!rows.length || !/^Name\s+Version/.test(rows[0])) return [];
  return rows.slice(1).flatMap((line) => {
    const [name, version, _rev, size, publisher] = line.trim().split(/\s+/);
    if (!name || !version) return [];
    const m = size?.match(/^([\d.]+)(B|kB|KB|MB|GB)$/);
    return [{
      manager: "snap" as const,
      name,
      from: current.get(name),
      to: version,
      source: publisher?.replace(/[✓✪*]$/, ""),
      size: m ? Number(m[1]) * SIZE_UNITS[m[2]] : undefined,
      security: false,
    }];
  });
}

const stripHtml = (s: string) =>
  s.replace(/<li>/g, "\n- ").replace(/<\/p>\s*<p>/g, "\n\n").replace(/<[^>]+>/g, "").replace(/\n{3,}/g, "\n\n").trim();

/** `fwupdmgr get-updates --json`. */
export function parseFwupd(json: string): Update[] {
  if (!json.trim().startsWith("{")) return [];
  const data = JSON.parse(json) as {
    Devices?: {
      Name?: string;
      DeviceId?: string;
      Version?: string;
      Vendor?: string;
      Releases?: { Version?: string; Summary?: string; Description?: string; Urgency?: string; Size?: number }[];
    }[];
  };
  return (data.Devices ?? []).flatMap((d) => {
    const r = d.Releases?.[0];
    if (!r?.Version) return [];
    return [{
      manager: "fwupd" as const,
      name: d.Name ?? d.DeviceId ?? "Device",
      id: d.DeviceId,
      from: d.Version,
      to: r.Version,
      source: d.Vendor,
      summary: [r.Summary, r.Description && stripHtml(r.Description)].filter(Boolean).join("\n\n") || undefined,
      size: r.Size,
      security: r.Urgency === "high" || r.Urgency === "critical",
    }];
  });
}

/** Single-quotes a word for sh. */
export const shellQuote = (s: string) => (/^[\w@%+=:,./-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`);

/** The command applying every update of one manager. `rolling` is openSUSE Tumbleweed. */
export function updateAllCommand(m: Manager, rolling = false): string {
  switch (m) {
    case "apt":
      return "sudo apt update && sudo apt upgrade";
    case "dnf":
      return "sudo dnf upgrade --refresh";
    case "pacman":
      return "sudo pacman -Syu";
    case "zypper":
      return rolling ? "sudo zypper dist-upgrade" : "sudo zypper update";
    case "flatpak":
      return "flatpak update";
    case "snap":
      return "sudo snap refresh";
    case "fwupd":
      return "fwupdmgr update";
  }
}

/** The command updating one package, or undefined where partial upgrades are unsupported (Arch). */
export function updateOneCommand(u: Update): string | undefined {
  const name = shellQuote(u.name);
  switch (u.manager) {
    case "apt":
      return `sudo apt install --only-upgrade ${name}`;
    case "dnf":
      return `sudo dnf upgrade ${name}`;
    case "pacman":
      return undefined;
    case "zypper":
      return `sudo zypper update ${name}`;
    case "flatpak":
      return `flatpak update ${shellQuote(u.id ?? u.name)}`;
    case "snap":
      return `sudo snap refresh ${name}`;
    case "fwupd":
      return u.id ? `fwupdmgr update ${shellQuote(u.id)}` : "fwupdmgr update";
  }
}

/** A shell script running the commands one after the other, then waiting for Enter. */
export function terminalScript(commands: { title: string; command: string }[]): string {
  const steps = commands.map(({ title, command }) =>
    `printf '\\n\\033[1m==> %s\\033[0m\\n' ${shellQuote(title)}; ${command} || failed=1`
  );
  return [
    "failed=0",
    ...steps,
    `if [ "$failed" = 0 ]; then printf '\\n\\033[32mAll done.\\033[0m '; else printf '\\n\\033[31mSome updates failed.\\033[0m '; fi`,
    "printf 'Press Enter to close…'; read -r _",
  ].join("\n");
}

/** How each terminal runs a command. */
export const TERMINAL_ARGS: Record<string, (argv: string[]) => string[]> = {
  "x-terminal-emulator": (argv) => ["-e", ...argv],
  ptyxis: (argv) => ["--", ...argv],
  kgx: (argv) => ["--", ...argv],
  "gnome-terminal": (argv) => ["--", ...argv],
  konsole: (argv) => ["-e", ...argv],
  "xfce4-terminal": (argv) => ["-x", ...argv],
  foot: (argv) => argv,
  kitty: (argv) => argv,
  alacritty: (argv) => ["-e", ...argv],
  wezterm: (argv) => ["start", "--", ...argv],
  ghostty: (argv) => ["-e", ...argv],
  xterm: (argv) => ["-e", ...argv],
};

/** Terminals to try, the desktop's own first. */
export function terminalOrder(desktop = ""): string[] {
  const d = desktop.toLowerCase();
  const first = d.includes("kde")
    ? ["konsole"]
    : d.includes("gnome") || d.includes("unity") || d.includes("budgie")
    ? ["ptyxis", "kgx", "gnome-terminal"]
    : d.includes("xfce")
    ? ["xfce4-terminal"]
    : [];
  const rest = [
    "x-terminal-emulator",
    "kgx",
    "gnome-terminal",
    "ptyxis",
    "konsole",
    "foot",
    "kitty",
    "alacritty",
    "wezterm",
    "ghostty",
    "xfce4-terminal",
    "xterm",
  ];
  return [...new Set([...first, ...rest])];
}

/** "3 updates", "1 update". */
export const plural = (n: number, word = "update") => `${n} ${word}${n === 1 ? "" : "s"}`;

/** 12_345_678 → "12.3 MB". */
export function size(n: number): string {
  const units = ["B", "kB", "MB", "GB"];
  let i = 0;
  while (n >= 1000 && i < units.length - 1) {
    n /= 1000;
    i++;
  }
  return `${i === 0 ? Math.round(n) : n.toFixed(1)} ${units[i]}`;
}
