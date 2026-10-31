// Parsing what bootctl, GRUB, the BLS entries and efibootmgr say about the boot menu. Pure, tested in lib_test.ts.

export type Source = "systemd-boot" | "grub" | "efi";
export type Os = "windows" | "linux" | "macos" | "firmware" | "network" | "removable" | "tool" | "other";

export interface BootEntry {
  source: Source;
  /**
   * What the boot loader takes to pick it: the systemd-boot entry id (`arch.conf`), the GRUB menu path
   * (`gnulinux-advanced-…>gnulinux-6.11-…`) or the EFI boot number (`0003`).
   */
  target: string;
  title: string;
  os: Os;
  /** The submenu a GRUB entry is in. */
  submenu?: string;
  /** GRUB: the top-level position (submenus count), what `set default="2"` refers to. */
  index?: number;
  version?: string;
  /** Kernel or EFI binary, device path. */
  path?: string;
  /** Kernel command line (systemd-boot, BLS). */
  options?: string;
  isDefault?: boolean;
  /** The entry this system was started from. */
  isCurrent?: boolean;
  /** Picked for the next boot only. */
  isNext?: boolean;
  /** EFI entries can be inactive (hidden from the firmware's menu). */
  active?: boolean;
}

// ---------------------------------------------------------------------------
// What kind of system an entry starts

const OS_RULES: [Os, RegExp][] = [
  ["firmware", /firmware|uefi settings|bios setup|setup utility|fwsetup|reboot-to-firmware|enter setup/i],
  ["windows", /windows|bootmgfw|microsoft/i],
  ["macos", /mac ?os|os ?x|apple/i],
  ["network", /pxe|ipv4|ipv6|network|http ?boot|\blan\b|ethernet|\bnic\b/i],
  ["tool", /memtest|\bshell\b|diagnos|shutdown|power ?off|efi tools/i],
  ["removable", /usb|removable|cd-?rom|dvd|optical|floppy|sd card/i],
  [
    "linux",
    /linux|arch|ubuntu|fedora|debian|suse|manjaro|mint|pop!?_?os|nixos|gentoo|endeavour|cachyos|garuda|void|alpine|kali|elementary|zorin|rocky|alma|centos|rhel|bazzite|steamos|kernel|vmlinuz|systemd|grub|shim|limine|refind|\.conf$|\.efi$/i,
  ],
];

/** Guesses what an entry starts from its title, id and path. */
export function osOf(...hints: (string | undefined)[]): Os {
  const text = hints.filter(Boolean).join(" ");
  for (const [os, re] of OS_RULES) if (re.test(text)) return os;
  return "other";
}

// ---------------------------------------------------------------------------
// systemd-boot

/** `bootctl list --json=short`: an array of entries (systemd 250+). Undefined when it isn't JSON. */
export function parseBootctl(text: string): BootEntry[] | undefined {
  let data: unknown;
  try {
    data = JSON.parse(text.trim() || "[]");
  } catch {
    return undefined;
  }
  if (!Array.isArray(data)) return undefined;
  const out: BootEntry[] = [];
  for (const e of data as Record<string, unknown>[]) {
    if (!e || typeof e.id !== "string") continue;
    const str = (k: string) => typeof e[k] === "string" && e[k] ? String(e[k]) : undefined;
    const title = str("showTitle") ?? str("title") ?? autoTitle(e.id);
    const linux = str("linux") ?? str("path");
    out.push({
      source: "systemd-boot",
      target: e.id,
      title,
      os: osOf(title, e.id, linux),
      version: str("version"),
      path: linux,
      options: str("options") ?? str("cmdline"),
      isDefault: e.isDefault === true,
      isCurrent: e.isSelected === true,
    });
  }
  return out;
}

const AUTO_TITLES: Record<string, string> = {
  "auto-windows": "Windows Boot Manager",
  "auto-osx": "macOS",
  "auto-efi-shell": "EFI Shell",
  "auto-efi-default": "EFI Default Loader",
  "auto-reboot-to-firmware-setup": "Reboot Into Firmware Interface",
  "auto-poweroff": "Power Off",
  "auto-reboot": "Reboot",
};

/** A readable title for an entry known only by its id: `arch-lts.conf` → "arch-lts". */
export function autoTitle(id: string): string {
  return AUTO_TITLES[id] ?? id.replace(/\.conf$/, "");
}

/** `busctl get-property … BootLoaderEntries`: `as 3 "arch.conf" "auto-windows" …`. */
export function parseBusctlStrings(text: string): string[] {
  const body = text.trim().replace(/^as\s+\d+\s*/, "");
  return [...body.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1].replace(/\\(.)/g, "$1"));
}

/** `busctl get-property … CanRebootToFirmwareSetup`: `s "yes"` → "yes". */
export function parseBusctlString(text: string): string | undefined {
  return text.match(/^s\s+"([^"]*)"/m)?.[1];
}

/** Entries logind knows (the loader reported them) when bootctl can't read the ESP. */
export function entriesFromIds(ids: string[], current?: string, defaultId?: string): BootEntry[] {
  return ids.map((id) => ({
    source: "systemd-boot" as const,
    target: id,
    title: autoTitle(id),
    os: osOf(autoTitle(id), id),
    isCurrent: id === current || undefined,
    isDefault: id === defaultId || undefined,
  }));
}

// ---------------------------------------------------------------------------
// GRUB

export interface GrubMenu {
  entries: BootEntry[];
  /** `set default=` as written: a number, a menu path, or `${saved_entry}`. */
  defaultRef?: string;
  /** grub.cfg includes the BLS entries (Fedora, RHEL): they are in /boot/loader/entries. */
  usesBls: boolean;
  /** grub.cfg reads next_entry: grub-reboot works. */
  supportsNextEntry: boolean;
}

/** Reads the first argument of a menuentry line: `'Arch'\''s kernel'` → "Arch's kernel", and the rest. */
export function readQuoted(text: string): [string, string] {
  let i = 0;
  let out = "";
  while (i < text.length && !/\s/.test(text[i])) {
    const c = text[i];
    if (c === "'") {
      const end = text.indexOf("'", i + 1);
      if (end < 0) return [out + text.slice(i + 1), ""];
      out += text.slice(i + 1, end);
      i = end + 1;
    } else if (c === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') {
        if (text[j] === "\\" && j + 1 < text.length) j++;
        out += text[j];
        j++;
      }
      i = j + 1;
    } else if (c === "\\" && i + 1 < text.length) {
      out += text[i + 1];
      i += 2;
    } else {
      out += c;
      i++;
    }
  }
  return [out, text.slice(i)];
}

/** The id of a menuentry: `$menuentry_id_option 'gnulinux-simple-…'` or `--id …`. */
function entryId(rest: string): string | undefined {
  const m = rest.match(/(?:\$menuentry_id_option|--id)\s+(\S+)/);
  return m ? readQuoted(m[1])[0] : undefined;
}

function classes(rest: string): string[] {
  return [...rest.matchAll(/--class\s+(\S+)/g)].map((m) => m[1]);
}

/** `/boot/grub/grub.cfg` as grub-mkconfig writes it: top-level entries and one level of submenus. */
export function parseGrubCfg(text: string): GrubMenu {
  const entries: BootEntry[] = [];
  const stack: ({ kind: "submenu"; title: string; ref: string } | { kind: "entry" } | { kind: "block" })[] = [];
  let defaultRef: string | undefined;
  let top = -1;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = line.match(/^(menuentry|submenu)\s+(.*)$/);
    if (m) {
      const [title, rest] = readQuoted(m[2]);
      const id = entryId(rest);
      const parent = [...stack].reverse().find((s) => s.kind === "submenu") as
        | { kind: "submenu"; title: string; ref: string }
        | undefined;
      const ref = id ?? title;
      const opens = rest.trimEnd().endsWith("{");
      if (!parent) top++;
      if (m[1] === "submenu") {
        if (opens) stack.push({ kind: "submenu", title, ref: parent ? `${parent.ref}>${ref}` : ref });
        continue;
      }
      const cls = classes(rest);
      entries.push({
        source: "grub",
        target: parent ? `${parent.ref}>${ref}` : ref,
        title,
        submenu: parent?.title,
        index: top,
        os: cls.includes("windows") ? "windows" : osOf(title, ...cls, id),
        version: title.match(/\b(\d+\.\d+[\w.+-]*)/)?.[1],
      });
      if (opens) stack.push({ kind: "entry" });
      continue;
    }
    if (stack.length === 0 && defaultRef === undefined) {
      const d = line.match(/^set\s+default=(.*)$/);
      // The header sets it to `${next_entry}` first when grub-reboot picked one: that is not the default.
      const ref = d ? readQuoted(d[1])[0] : undefined;
      if (ref !== undefined && !/next_entry/.test(ref)) defaultRef = ref;
    }
    if (line.endsWith("{")) stack.push({ kind: "block" });
    else if (line.startsWith("}")) stack.pop();
  }
  return {
    entries,
    defaultRef,
    usesBls: /^\s*blscfg\b/m.test(text),
    supportsNextEntry: /next_entry/.test(text),
  };
}

/** `grubenv`: `saved_entry=…`, `next_entry=…` (the rest of the file is `#` padding). */
export function parseGrubenv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const m = line.match(/^([A-Za-z_][\w]*)=(.*)$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

/** Whether a GRUB reference (`2`, `Advanced options>…`, an id or a title) names this entry. */
export function grubMatches(entry: BootEntry, ref: string | undefined): boolean {
  if (ref === undefined || ref === "") return false;
  if (/^\d+$/.test(ref)) return !entry.submenu && Number(ref) === entry.index;
  if (ref === entry.target || ref === entry.title) return true;
  const want = ref.split(">");
  const have = entry.target.split(">");
  if (want.length !== have.length) return false;
  const titles = entry.submenu ? [entry.submenu, entry.title] : [entry.title];
  return want.every((w, i) => w === have[i] || w === titles[i]);
}

/** Marks the default and the next-boot entry, from `set default` and the grubenv. */
export function markGrub(menu: GrubMenu, env: Record<string, string>): BootEntry[] {
  let ref = menu.defaultRef;
  if (ref && /\$\{?saved_entry\}?/.test(ref)) ref = env.saved_entry || "0";
  if (ref === undefined) ref = "0";
  return menu.entries.map((e) => ({
    ...e,
    isDefault: grubMatches(e, ref) || undefined,
    isNext: grubMatches(e, env.next_entry) || undefined,
  }));
}

/** A Boot Loader Specification entry (`/boot/loader/entries/*.conf`), as GRUB's blscfg shows it. */
export function parseBlsEntry(id: string, text: string): BootEntry {
  const field = (k: string) => text.match(new RegExp(`^${k}\\s+(.+)$`, "m"))?.[1]?.trim();
  const title = field("title") ?? id;
  const version = field("version");
  return {
    source: "grub",
    target: id,
    title,
    os: osOf(title, field("linux"), "linux"),
    version,
    path: field("linux"),
    options: field("options"),
  };
}

/** Newest kernel first, as blscfg sorts them. */
export function sortBls(entries: BootEntry[]): BootEntry[] {
  return [...entries].sort((a, b) => compareVersions(b.version ?? b.target, a.version ?? a.target));
}

/** "6.11.4-301.fc41" vs "6.10.12-200.fc40": numbers compared as numbers. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(/[^\dA-Za-z]+|(?<=\d)(?=\D)|(?<=\D)(?=\d)/).filter(Boolean);
  const pb = b.split(/[^\dA-Za-z]+|(?<=\d)(?=\D)|(?<=\D)(?=\d)/).filter(Boolean);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i];
    const y = pb[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const nx = /^\d+$/.test(x);
    const ny = /^\d+$/.test(y);
    if (nx && ny) {
      const d = Number(x) - Number(y);
      if (d) return Math.sign(d);
    } else if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

// ---------------------------------------------------------------------------
// EFI

export interface EfiMenu {
  entries: BootEntry[];
  current?: string;
  next?: string;
  order: string[];
  timeout?: number;
}

const DEVICE_PATH =
  /\s+((?:HD|PciRoot|Pci|VenHw|VenMsg|VenMedia|BBS|FvVol|FvFile|MAC|Uri|USB|Sata|NVMe|ACPI|MemoryMapped|File|Msg|UsbClass|UsbWwid|Scsi|CDROM|Fv)\(.*)$/;

/** `efibootmgr` (with or without `-v`, old and new versions). */
export function parseEfibootmgr(text: string): EfiMenu {
  const entries: BootEntry[] = [];
  let current: string | undefined;
  let next: string | undefined;
  let order: string[] = [];
  let timeout: number | undefined;
  for (const raw of text.split("\n")) {
    const line = raw.replace(/\r$/, "");
    let m = line.match(/^BootCurrent:\s*([0-9A-Fa-f]{4})/);
    if (m) {
      current = m[1].toUpperCase();
      continue;
    }
    m = line.match(/^BootNext:\s*([0-9A-Fa-f]{4})/);
    if (m) {
      next = m[1].toUpperCase();
      continue;
    }
    m = line.match(/^BootOrder:\s*(.*)$/);
    if (m) {
      order = m[1].split(",").map((s) => s.trim().toUpperCase()).filter((s) => /^[0-9A-F]{4}$/.test(s));
      continue;
    }
    m = line.match(/^Timeout:\s*(\d+)/);
    if (m) {
      timeout = Number(m[1]);
      continue;
    }
    m = line.match(/^Boot([0-9A-Fa-f]{4})(\*?)\s+(.*)$/);
    if (!m) continue;
    let label = m[3];
    let path: string | undefined;
    const tab = label.indexOf("\t");
    if (tab >= 0) {
      path = label.slice(tab + 1).trim();
      label = label.slice(0, tab);
    } else {
      const d = label.match(DEVICE_PATH);
      if (d) {
        path = d[1].trim();
        label = label.slice(0, d.index);
      }
    }
    label = label.trim();
    const num = m[1].toUpperCase();
    entries.push({
      source: "efi",
      target: num,
      title: label || `Boot${num}`,
      os: osOf(label, path),
      path: path || undefined,
      active: m[2] === "*",
    });
  }
  const rank = (n: string) => {
    const i = order.indexOf(n);
    return i < 0 ? order.length + parseInt(n, 16) : i;
  };
  entries.sort((a, b) => rank(a.target) - rank(b.target));
  for (const e of entries) {
    e.isCurrent = e.target === current || undefined;
    e.isNext = e.target === next || undefined;
    e.isDefault = (order.length > 0 && e.target === order[0]) || undefined;
  }
  return { entries, current, next, order, timeout };
}

/** The file an EFI entry starts: `HD(1,GPT,…)/File(\EFI\Microsoft\Boot\bootmgfw.efi)` → `\EFI\Microsoft\Boot\bootmgfw.efi`. */
export function efiFile(path: string | undefined): string | undefined {
  if (!path) return undefined;
  const m = path.match(/File\(([^)]+)\)/) ?? path.match(/(\\EFI\\[^\s)]+)/i);
  return m?.[1];
}

// ---------------------------------------------------------------------------
// Commands

const quote = (arg: string) => /^[\w@%+=:,./-]+$/.test(arg) ? arg : `'${arg.replace(/'/g, `'\\''`)}'`;

/** A command line as a shell would read it back. */
export const shellLine = (argv: string[]) => argv.map(quote).join(" ");

/** pkexec resets PATH: the sbin folders are added back for the tools that live there. */
const ROOT_PATH = "PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin";

/** The root script that picks an entry for the next boot only. */
export function nextBootScript(e: BootEntry, grubTool = "grub-reboot"): string {
  switch (e.source) {
    case "systemd-boot":
      return `${ROOT_PATH}; ${shellLine(["bootctl", "set-oneshot", e.target])}`;
    case "grub":
      return `${ROOT_PATH}; ${shellLine([grubTool, e.target])}`;
    case "efi":
      return `${ROOT_PATH}; ${shellLine(["efibootmgr", "--bootnext", e.target])} >/dev/null`;
  }
}

/** The root script that forgets the next-boot choice. */
export function cancelNextScript(source: Source, grubEditenv = "grub-editenv"): string {
  switch (source) {
    case "systemd-boot":
      return `${ROOT_PATH}; bootctl set-oneshot ''`;
    case "grub":
      return `${ROOT_PATH}; ${grubEditenv} - unset next_entry`;
    case "efi":
      return `${ROOT_PATH}; efibootmgr --delete-bootnext >/dev/null`;
  }
}

/** `systemctl reboot --boot-loader-entry=…` (logind, no password) works for systemd-boot entries. */
export const logindRebootArgs = (e: BootEntry) => ["reboot", `--boot-loader-entry=${e.target}`];

/** pkexec's exit codes and messages, in words; undefined when it ran the program. */
export function pkexecError(code: number, stderr: string): string | undefined {
  if (code === 126) return "Authentication was cancelled";
  if (code === 127 && /not authorized|authentication/i.test(stderr)) return "Not authorized";
  if (/No authentication agent/i.test(stderr)) return "No polkit agent to ask for your password";
  return undefined;
}

/** systemctl and logind errors in words. */
export function rebootError(message: string): string {
  if (/firmware.*not supported|does not support.*firmware|RebootToFirmwareSetup/i.test(message)) {
    return "This computer's firmware doesn't support rebooting into its setup from the system";
  }
  if (/boot loader entry|LoaderFeatures|not supported by the boot loader|boot-loader-entry/i.test(message)) {
    return "The boot loader doesn't support picking the next entry from the system";
  }
  if (/inhibit/i.test(message)) return "An app is blocking the reboot: close it, or reboot from your desktop's menu";
  if (/Interactive authentication required|Access denied|not authorized/i.test(message)) {
    return "Rebooting was not allowed (other users may be logged in)";
  }
  return message.split("\n").filter(Boolean).pop() ?? message;
}

// ---------------------------------------------------------------------------
// Presentation

export const SOURCE_TITLES: Record<Source, string> = {
  "systemd-boot": "systemd-boot",
  grub: "GRUB",
  efi: "Firmware Boot Menu (EFI)",
};

export const OS_TITLES: Record<Os, string> = {
  windows: "Windows",
  linux: "Linux",
  macos: "macOS",
  firmware: "Firmware",
  network: "Network boot",
  removable: "Removable drive",
  tool: "Tool",
  other: "Other",
};

/** Entries the list leaves out: the loader's own "reboot"/"power off" items, and duplicates of the firmware item. */
export function hidden(e: BootEntry): boolean {
  return e.source === "systemd-boot" &&
    ["auto-reboot", "auto-poweroff", "auto-reboot-to-firmware-setup"].includes(e.target);
}

/** Puts Windows first: it is what people reboot into most. Keeps the boot loader's order otherwise. */
export function windowsFirst(entries: BootEntry[]): BootEntry[] {
  return entries.map((e, i) => ({ e, i }))
    .sort((a, b) => Number(b.e.os === "windows") - Number(a.e.os === "windows") || a.i - b.i)
    .map(({ e }) => e);
}
