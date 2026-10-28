// What a QR code holds, Wi-Fi payloads, history, and the background scan
// script. Pure, tested in lib_test.ts.

// ---------------------------------------------------------------------------
// Payloads

export type PayloadKind = "url" | "wifi" | "email" | "phone" | "sms" | "geo" | "contact" | "otp" | "event" | "text";

export interface Payload {
  kind: PayloadKind;
  /** What to show as the title. */
  title: string;
  /** Lines for the detail panel. */
  fields: { label: string; value: string; secret?: boolean }[];
  /** Something to open: a URL, mailto:, tel:, geo… */
  open?: string;
  /** Contains a secret (password, OTP seed): copy concealed, don't keep the text in history. */
  secret?: boolean;
}

/** Splits "a;b\;c;" on unescaped `sep`, unescaping \\, \;, \,, \: and \". */
function splitEscaped(text: string, sep: string): string[] {
  const out: string[] = [];
  let cur = "";
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "\\" && i + 1 < text.length) cur += text[++i];
    else if (c === sep) {
      out.push(cur);
      cur = "";
    } else cur += c;
  }
  out.push(cur);
  return out;
}

export interface Wifi {
  ssid: string;
  password?: string;
  security: "WPA" | "WEP" | "nopass" | string;
  hidden?: boolean;
}

/** "WIFI:T:WPA;S:My Net;P:p\;ss;H:true;;" */
export function parseWifi(text: string): Wifi | undefined {
  if (!/^WIFI:/i.test(text)) return undefined;
  const fields: Record<string, string> = {};
  for (const part of splitEscaped(text.slice(5), ";")) {
    const m = part.match(/^([A-Za-z]+):([\s\S]*)$/);
    if (m) fields[m[1].toUpperCase()] = m[2];
  }
  if (fields.S === undefined) return undefined;
  return {
    ssid: fields.S,
    password: fields.P || undefined,
    security: fields.T || (fields.P ? "WPA" : "nopass"),
    ...(/^true$/i.test(fields.H ?? "") ? { hidden: true } : {}),
  };
}

const escapeWifi = (s: string) => s.replace(/([\\;,:"])/g, "\\$1");

export function wifiPayload(w: Wifi): string {
  const security = w.password ? (w.security === "nopass" ? "WPA" : w.security) : "nopass";
  return `WIFI:T:${security};S:${escapeWifi(w.ssid)};${w.password ? `P:${escapeWifi(w.password)};` : ""}${
    w.hidden ? "H:true;" : ""
  };`;
}

/** Reads a scanned or typed text as what it is. */
export function parsePayload(raw: string): Payload {
  const text = raw.trim();
  const wifi = parseWifi(text);
  if (wifi) {
    return {
      kind: "wifi",
      title: wifi.ssid,
      fields: [
        { label: "Network", value: wifi.ssid },
        { label: "Security", value: wifi.security === "nopass" ? "None (open)" : wifi.security },
        ...(wifi.password ? [{ label: "Password", value: wifi.password, secret: true }] : []),
        ...(wifi.hidden ? [{ label: "Hidden", value: "Yes" }] : []),
      ],
      secret: !!wifi.password,
    };
  }
  if (/^otpauth(-migration)?:\/\//i.test(text)) {
    let label = "One-time password";
    const fields: Payload["fields"] = [];
    try {
      const u = new URL(text);
      label = decodeURIComponent(u.pathname.replace(/^\/+/, "")) || label;
      const issuer = u.searchParams.get("issuer");
      if (issuer) fields.push({ label: "Issuer", value: issuer });
      fields.push({ label: "Type", value: u.host.toUpperCase() || "TOTP" });
      const secret = u.searchParams.get("secret");
      if (secret) fields.push({ label: "Secret", value: secret, secret: true });
    } catch {
      // Keep the defaults.
    }
    return { kind: "otp", title: label, fields, secret: true };
  }
  if (/^https?:\/\/\S+$/i.test(text)) {
    let host = text;
    try {
      host = new URL(text).hostname;
    } catch {
      // Not a valid URL after all; shown as is.
    }
    return { kind: "url", title: text, fields: [{ label: "Site", value: host }], open: text };
  }
  if (/^(?:www\.)[^\s/]+\.[a-z]{2,}\S*$/i.test(text)) {
    return {
      kind: "url",
      title: text,
      fields: [{ label: "Site", value: text.split("/")[0] }],
      open: `https://${text}`,
    };
  }
  const mail = text.match(/^(?:mailto:|MATMSG:TO:)([^?;\s]+)/i);
  if (mail) {
    const fields = [{ label: "To", value: mail[1] }];
    const sub = text.match(/[?&]subject=([^&]*)/i)?.[1] ?? text.match(/;SUB:([^;]*)/i)?.[1];
    if (sub) fields.push({ label: "Subject", value: safeDecode(sub) });
    return { kind: "email", title: mail[1], fields, open: /^mailto:/i.test(text) ? text : `mailto:${mail[1]}` };
  }
  if (/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(text)) {
    return { kind: "email", title: text, fields: [{ label: "To", value: text }], open: `mailto:${text}` };
  }
  const tel = text.match(/^tel:(\+?[\d\s().-]+)$/i);
  if (tel) return { kind: "phone", title: tel[1], fields: [{ label: "Number", value: tel[1] }], open: text };
  const sms = text.match(/^(?:sms|smsto):(\+?[\d\s().-]+)(?::|\?body=)?([\s\S]*)$/i);
  if (sms) {
    return {
      kind: "sms",
      title: sms[1],
      fields: [
        { label: "Number", value: sms[1] },
        ...(sms[2] ? [{ label: "Message", value: safeDecode(sms[2]) }] : []),
      ],
      open: `sms:${sms[1]}`,
    };
  }
  const geo = text.match(/^geo:(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/i);
  if (geo) {
    return {
      kind: "geo",
      title: `${geo[1]}, ${geo[2]}`,
      fields: [{ label: "Latitude", value: geo[1] }, { label: "Longitude", value: geo[2] }],
      open: `https://www.openstreetmap.org/?mlat=${geo[1]}&mlon=${geo[2]}#map=15/${geo[1]}/${geo[2]}`,
    };
  }
  if (/^BEGIN:VCARD/i.test(text) || /^MECARD:/i.test(text)) {
    const v = (key: string) =>
      text.match(new RegExp(`^${key}(?:;[^:\\n]*)?:(.*)$`, "im"))?.[1]?.trim() ??
        text.match(new RegExp(`[:;]${key}:([^;]*)`, "i"))?.[1]?.trim();
    const name = v("FN") ?? v("N")?.split(/[;,]/).filter(Boolean).reverse().join(" ") ?? "Contact";
    const fields = [
      ["Name", name],
      ["Phone", v("TEL")],
      ["Email", v("EMAIL")],
      ["Organization", v("ORG")],
      ["Website", v("URL")],
    ].filter((f): f is [string, string] => !!f[1]).map(([label, value]) => ({ label, value }));
    return { kind: "contact", title: name, fields };
  }
  if (/^BEGIN:VEVENT/im.test(text) || /^BEGIN:VCALENDAR/i.test(text)) {
    const summary = text.match(/^SUMMARY:(.*)$/im)?.[1]?.trim() ?? "Event";
    const start = text.match(/^DTSTART[^:]*:(.*)$/im)?.[1]?.trim();
    return {
      kind: "event",
      title: summary,
      fields: [{ label: "Event", value: summary }, ...(start ? [{ label: "Starts", value: start }] : [])],
    };
  }
  const firstLine = text.split("\n")[0];
  return {
    kind: "text",
    title: firstLine.length > 80 ? `${firstLine.slice(0, 80)}…` : firstLine || "(empty)",
    fields: [{ label: "Length", value: `${[...text].length} characters` }],
  };
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s.replace(/\+/g, " "));
  } catch {
    return s;
  }
}

// ---------------------------------------------------------------------------
// History

export interface Entry {
  kind: "generated" | "scanned";
  text: string;
  /** Unix ms. */
  at: number;
  /** The picture a scan was read from. */
  image?: string;
}

/** Newest first, one entry per kind and text, at most `max`. */
export function mergeHistory(history: Entry[], added: Entry[], max = 50): Entry[] {
  const all = [...added, ...history].sort((a, b) => b.at - a.at);
  const seen = new Set<string>();
  return all.filter((e) => {
    const key = `${e.kind}\n${e.text}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, max);
}

/** Files "1730000000123456789.txt" written by the scan script → entries. */
export function scanEntry(name: string, text: string): Entry | undefined {
  const m = name.match(/^(\d{10,19})\.txt$/);
  if (!m || !text.trim()) return undefined;
  const at = m[1].length > 13 ? Number(m[1].slice(0, 13)) : Number(m[1]) * (m[1].length <= 10 ? 1000 : 1);
  return { kind: "scanned", text: text.replace(/\n$/, ""), at };
}

// ---------------------------------------------------------------------------
// Files

/** A short stable name for the picture of a text: FNV-1a, 64 bits as two 32-bit halves. */
export function fileKey(text: string, ecc: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (const b of new TextEncoder().encode(`${ecc}\n${text}`)) {
    h1 = Math.imul(h1 ^ b, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ b, 0x5bd1e995) >>> 0;
  }
  return h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0");
}

/** "QR https example.com 2026-10-28 14.05.12.png", safe for every file system. */
export function saveName(text: string, date: Date, ext = "png"): string {
  const words = text.replace(/^[a-z]+:\/*/i, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim().slice(0, 40).trim();
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}.${
    pad(date.getMinutes())
  }.${pad(date.getSeconds())}`;
  return `QR ${words ? `${words} ` : ""}${stamp}.${ext}`;
}

/** The pixels per module so that the picture is about `target` pixels wide. */
export const scaleFor = (size: number, target = 600) => Math.max(4, Math.round(target / (size + 8)));

/** `~/.config/user-dirs.dirs` → the pictures folder. */
export function picturesDir(userDirs: string, home: string): string {
  const m = userDirs.match(/^XDG_PICTURES_DIR="([^"]*)"/m);
  return m ? m[1].replace(/^\$HOME/, home) : `${home}/Pictures`;
}

// ---------------------------------------------------------------------------
// Sessions and the scan script

export type Desktop = "gnome" | "kde" | "hyprland" | "sway" | "other";

export interface Session {
  wayland: boolean;
  desktop: Desktop;
}

export const SESSION_ENV = [
  "XDG_SESSION_TYPE",
  "XDG_CURRENT_DESKTOP",
  "WAYLAND_DISPLAY",
  "DISPLAY",
  "XAUTHORITY",
  "HYPRLAND_INSTANCE_SIGNATURE",
  "SWAYSOCK",
] as const;

export type Env = Partial<Record<string, string>>;

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

export type ShotTool = "grim" | "gnome-screenshot" | "spectacle" | "maim" | "scrot" | "import";

/** Tools that can capture an area in this session, best first. */
export function areaTools(s: Session): ShotTool[] {
  if (s.wayland) {
    if (s.desktop === "gnome") return ["gnome-screenshot"];
    if (s.desktop === "kde") return ["spectacle"];
    return ["grim", "gnome-screenshot", "spectacle"];
  }
  return ["maim", "scrot", "import", "gnome-screenshot", "spectacle"];
}

/** Single-quotes for sh. */
export const q = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

export function areaCommand(tool: ShotTool, file: string): string {
  const f = q(file);
  switch (tool) {
    case "grim":
      return `geometry=$(slurp -d) || exit 0; grim -g "$geometry" ${f}`;
    case "gnome-screenshot":
      return `gnome-screenshot -a -f ${f}`;
    case "spectacle":
      return `spectacle -b -n -r -o ${f}`;
    case "maim":
      return `maim -s ${f}`;
    case "scrot":
      return `scrot -s -o ${f}`;
    case "import":
      return `import ${f}`;
  }
}

export interface ScanOptions {
  tool: ShotTool;
  /** Where the capture and results go: ~/.cache/backslash/qr. */
  cache: string;
  wayland: boolean;
  /** Open http(s) links right away. */
  openLinks?: boolean;
  copy?: boolean;
}

/**
 * Captures an area, decodes it with zbarimg, leaves the result in
 * `<cache>/scans/<ns>.txt` (read back by the extension), copies it (unless it
 * holds a password or OTP seed) and notifies.
 */
export function scanScript(o: ScanOptions): string {
  const shot = `${o.cache}/scan.png`;
  const copyCmd = o.wayland
    ? `{ printf %s "$out" | wl-copy || printf %s "$out" | xclip -selection clipboard; } 2>/dev/null`
    : `{ printf %s "$out" | xclip -selection clipboard || printf %s "$out" | wl-copy; } 2>/dev/null`;
  return [
    "sleep 0.4",
    `mkdir -p ${q(`${o.cache}/scans`)}`,
    `rm -f ${q(shot)}`,
    `${areaCommand(o.tool, shot)} || exit 0`,
    `[ -s ${q(shot)} ] || exit 0`,
    `if out=$(zbarimg --raw -q ${q(shot)} 2>/dev/null) && [ -n "$out" ]; then`,
    `  id=$(date +%s%N)`,
    `  printf '%s\\n' "$out" > ${q(`${o.cache}/scans/`)}"$id.txt"`,
    `  mv -f ${q(shot)} ${q(`${o.cache}/scans/`)}"$id.png"`,
    `  case "$out" in WIFI:*P:*|otpauth*) note='Open QR Codes to see it' ;; *)`,
    o.copy === false
      ? "    note='Open QR Codes to see it'"
      : `    if ${copyCmd}; then note='Copied to the clipboard'; else note=''; fi`,
    "  ;; esac",
    `  notify-send -a Backslash -i ${
      q(`${o.cache}/scans/`)
    }"$id.png" 'QR code scanned' "$(printf %s "$out" | head -c 160 | tr -d '<>&')\${note:+ · $note}" 2>/dev/null`,
    ...(o.openLinks ? [`  case "$out" in http://*|https://*) xdg-open "$out" >/dev/null 2>&1 & ;; esac`] : []),
    "else",
    `  notify-send -a Backslash 'No QR code found' 'Select the whole code with a little margin around it' 2>/dev/null`,
    "fi",
    "true",
  ].join("\n");
}

/** `systemd-run` arguments to run a script in the background, outside the launcher. */
export function systemdRunArgs(unit: string, script: string, env: Env = {}): string[] {
  return [
    "--user",
    "--quiet",
    `--unit=${unit}`,
    "--description=Backslash: scan a QR code",
    "--collect",
    // wl-copy and xclip stay in the background to serve the clipboard.
    "--property=KillMode=process",
    ...Object.entries(env).filter(([, v]) => v).map(([k, v]) => `--setenv=${k}=${v}`),
    "/bin/sh",
    "-c",
    script,
  ];
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

const PACKAGES: Record<string, Partial<Record<Family, string>>> = {
  zbarimg: { arch: "zbar", debian: "zbar-tools", fedora: "zbar", suse: "zbar" },
  spectacle: { debian: "kde-spectacle" },
  import: { arch: "imagemagick", debian: "imagemagick", fedora: "ImageMagick", suse: "ImageMagick" },
  "wl-copy": { arch: "wl-clipboard", debian: "wl-clipboard", fedora: "wl-clipboard", suse: "wl-clipboard" },
};

const MANAGERS: Record<Family, string> = {
  arch: "sudo pacman -S",
  debian: "sudo apt install",
  fedora: "sudo dnf install",
  suse: "sudo zypper install",
};

const FAMILY_NAMES: Record<Family, string> = {
  arch: "Arch",
  debian: "Debian, Ubuntu",
  fedora: "Fedora",
  suse: "openSUSE",
};

export function installCommand(programs: string[], family: Family): string {
  return `${MANAGERS[family]} ${[...new Set(programs.map((p) => PACKAGES[p]?.[family] ?? p))].join(" ")}`;
}

export function installMarkdown(what: string, programs: string[], family?: Family): string {
  const families = family ? [family] : (Object.keys(MANAGERS) as Family[]);
  return `${what}\n\n${
    families.map((f) => `**${FAMILY_NAMES[f]}**\n\n\`${installCommand(programs, f)}\``).join("\n\n")
  }`;
}

/** What to install to capture an area in this session. */
export function capturePackages(s: Session): string[] {
  if (s.wayland) {
    if (s.desktop === "gnome") return ["gnome-screenshot"];
    if (s.desktop === "kde") return ["spectacle"];
    return ["grim", "slurp"];
  }
  return ["maim"];
}
