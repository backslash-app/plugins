// Pure helpers for Printers: lpstat / lpq output (C locale) and what to install.

export type PrinterState = "idle" | "printing" | "disabled" | "unknown";

export interface Printer {
  name: string;
  state: PrinterState;
  /** The job being printed, e.g. `Office-57`. */
  job?: string;
  /** "Paused", "Printing page 2, 45% complete.", "Waiting for printer to become available." */
  message?: string;
  since?: string;
  description?: string;
  location?: string;
  device?: string;
  accepting: boolean;
  isDefault: boolean;
  alerts?: string;
}

export interface Status {
  printers: Printer[];
  defaultName?: string;
}

/**
 * `lpstat -l -p -d`, plus optionally `lpstat -a` (accepting) and `lpstat -v` (devices).
 * Run with LC_ALL=C: lpstat translates its messages.
 */
export function parseLpstat(p: string, a = "", v = ""): Status {
  const printers: Printer[] = [];
  let defaultName: string | undefined;
  let current: Printer | undefined;
  for (const raw of p.split("\n")) {
    const line = raw.replace(/\s+$/, "");
    const def = line.match(/^system default destination: (.+)$/);
    if (def) {
      defaultName = def[1].trim();
      continue;
    }
    const m = line.match(/^printer (\S+) (.*)$/);
    if (m) {
      const rest = m[2];
      let state: PrinterState = "unknown";
      let job: string | undefined;
      if (/^is idle\b/.test(rest)) state = "idle";
      else if (/^now printing\b/.test(rest)) {
        state = "printing";
        job = rest.match(/^now printing (\S+?)\.?\s/)?.[1];
      } else if (/^disabled\b/.test(rest)) state = "disabled";
      current = {
        name: m[1],
        state,
        job,
        since: rest.match(/since (.+?)(?:\s+-)?$/)?.[1],
        accepting: true,
        isDefault: false,
      };
      printers.push(current);
      continue;
    }
    if (!current || !/^\s/.test(line)) continue;
    const t = line.trim();
    const kv = t.match(
      /^(Description|Location|Alerts|Connection|Interface|On fault|After fault|Users allowed|Form mounted|Content types|Printer types):\s*(.*)$/,
    );
    if (kv) {
      if (kv[1] === "Description" && kv[2]) current.description = kv[2];
      if (kv[1] === "Location" && kv[2]) current.location = kv[2];
      if (kv[1] === "Alerts" && kv[2] && kv[2] !== "none") current.alerts = kv[2];
      continue;
    }
    if (/^(Banner required|Charset sets|Default pitch|Default page size|Default port settings|none|\(.*\))/i.test(t)) {
      continue;
    }
    if (!current.message && t) current.message = t;
  }
  for (const line of a.split("\n")) {
    const m = line.match(/^(\S+) (not )?accepting requests/);
    const p = m && printers.find((x) => x.name === m[1]);
    if (p) p.accepting = !m![2];
  }
  for (const line of v.split("\n")) {
    const m = line.match(/^device for (\S+): (.+)$/);
    const p = m && printers.find((x) => x.name === m[1]);
    if (p) p.device = m![2].trim();
  }
  for (const p of printers) p.isDefault = p.name === defaultName;
  return { printers, defaultName };
}

export interface Job {
  /** `Office-57` */
  id: string;
  printer: string;
  number: number;
  user: string;
  size: number;
  date: string;
  title?: string;
  rank?: string;
}

/** `lpstat -o`: `Office-57   ada   1024000   Tue 28 Oct 2026 10:05:12 AM CET`. */
export function parseJobs(out: string): Job[] {
  const jobs: Job[] = [];
  for (const line of out.split("\n")) {
    const m = line.match(/^(\S+)-(\d+)\s+(\S+)\s+(\d+)\s+(.+)$/);
    if (!m) continue;
    // Printer names may contain dashes: the job number is after the last one.
    jobs.push({
      id: `${m[1]}-${m[2]}`,
      printer: m[1],
      number: Number(m[2]),
      user: m[3],
      size: Number(m[4]),
      date: m[5].trim(),
    });
  }
  return jobs;
}

/** `lpq -a`: rank, owner, job number and file name of each job. */
export function parseLpq(out: string): Map<number, { rank: string; title: string }> {
  const map = new Map<number, { rank: string; title: string }>();
  for (const line of out.split("\n")) {
    const m = line.match(/^(\S+)\s+(\S+)\s+(\d+)\s+(.+?)\s+(\d+) bytes\s*$/);
    if (m && m[1] !== "Rank") map.set(Number(m[3]), { rank: m[1], title: m[4].trim() });
  }
  return map;
}

/** Why lpstat failed, in words a person can act on. */
export function lpstatProblem(error: string): "no-scheduler" | "no-printers" | undefined {
  if (/scheduler is not running|Unable to connect to server|connection refused/i.test(error)) return "no-scheduler";
  if (/No destinations added/i.test(error)) return "no-printers";
  return undefined;
}

/** Turns cupsenable / cupsdisable / cancel errors into advice. */
export function explainCupsError(error: string): string {
  const msg = error.replace(/^\S+ exited with \d+: /, "").trim();
  if (/forbidden|not authorized|unauthorized|operation not permitted|permission denied|authentication/i.test(msg)) {
    return "This needs printer admin rights: add yourself to the lpadmin group " +
      "(sudo usermod -aG lpadmin $USER, then log in again) or use the CUPS web page";
  }
  if (/scheduler is not running|Unable to connect/i.test(msg)) return "The printing service (cupsd) isn't running";
  return msg;
}

export function size(bytes: number): string {
  if (!bytes) return "–";
  const units = ["B", "KB", "MB", "GB"];
  let n = bytes;
  let i = 0;
  while (n >= 1000 && i < units.length - 1) {
    n /= 1000;
    i++;
  }
  return `${n >= 10 || i === 0 ? Math.round(n) : n.toFixed(1)} ${units[i]}`;
}

/** "ipp://192.168.1.20/ipp/print" → "Network (IPP) · 192.168.1.20". */
export function connection(device?: string): string | undefined {
  if (!device) return undefined;
  const scheme = device.split(":")[0].toLowerCase();
  const host = device.match(/^[a-z]+:\/\/(?:[^@/]*@)?([^/:?]+)/i)?.[1];
  const kinds: Record<string, string> = {
    ipp: "Network (IPP)",
    ipps: "Network (IPP, secure)",
    http: "Network (IPP)",
    https: "Network (IPP, secure)",
    socket: "Network (JetDirect)",
    lpd: "Network (LPD)",
    smb: "Windows share",
    dnssd: "Network (Bonjour)",
    implicitclass: "Network (shared)",
    usb: "USB",
    parallel: "Parallel port",
    serial: "Serial port",
    "cups-pdf": "PDF file",
    hp: "HP (HPLIP)",
    ippusb: "USB (IPP)",
  };
  const kind = kinds[scheme] ?? scheme.toUpperCase();
  return host && !["usb", "hp", "ippusb"].includes(scheme) ? `${kind} · ${decodeURIComponent(host)}` : kind;
}

/** A printer queue name made readable: `HP_LaserJet_M404` → `HP LaserJet M404`. */
export function prettyName(name: string): string {
  return name.replace(/_/g, " ");
}

/** A path typed in the search bar, with `~` and `file://` understood. */
export function expandPath(input: string, home: string): string {
  let p = input.trim().replace(/^["']|["']$/g, "");
  if (p.startsWith("file://")) p = decodeURIComponent(p.slice(7));
  if (p === "~" || p.startsWith("~/")) p = home + p.slice(1);
  return p;
}

export function looksLikePath(input: string): boolean {
  const t = input.trim();
  return /^(~\/|\/|file:\/\/)/.test(t) && /\.[a-z0-9]{1,5}$/i.test(t);
}

// ---------------------------------------------------------------------------
// What to install

export type Family = "arch" | "debian" | "fedora" | "suse";

/** `/etc/os-release` → the distribution family. */
export function osFamily(osRelease: string): Family | undefined {
  const field = (k: string) => osRelease.match(new RegExp(`^${k}="?([^"\\n]*)"?`, "m"))?.[1]?.toLowerCase() ?? "";
  const ids = `${field("ID")} ${field("ID_LIKE")}`.split(/\s+/);
  if (ids.some((i) => ["arch", "manjaro", "endeavouros", "cachyos"].includes(i))) return "arch";
  if (ids.some((i) => ["debian", "ubuntu", "linuxmint", "pop"].includes(i))) return "debian";
  if (ids.some((i) => ["fedora", "rhel", "centos"].includes(i))) return "fedora";
  if (ids.some((i) => i.startsWith("opensuse") || i === "suse")) return "suse";
  return undefined;
}

const INSTALL: Record<Family, string> = {
  debian: "sudo apt install cups",
  fedora: "sudo dnf install cups",
  arch: "sudo pacman -S cups",
  suse: "sudo zypper install cups",
};

/** The commands that install and start CUPS, for the family or every family when unknown. */
export function installCups(family?: Family): { family: Family; command: string }[] {
  return (family ? [family] : (Object.keys(INSTALL) as Family[])).map((f) => ({
    family: f,
    command: `${INSTALL[f]} && sudo systemctl enable --now cups`,
  }));
}
