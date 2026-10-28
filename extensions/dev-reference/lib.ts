// Reference entries, search ranking and the chmod calculator. Pure, tested in lib_test.ts.

import {
  ASCII_CONTROL,
  COMMON_MODES,
  EXIT_CODES,
  HTML_ENTITIES,
  HTTP_STATUS,
  KEYS,
  MIME_TYPES,
  PORTS,
  SIGNALS,
} from "./data.ts";

export type Tint = "red" | "orange" | "yellow" | "green" | "blue" | "purple" | "teal" | "pink" | "gray";

export interface Entry {
  id: string;
  /** The table it belongs to: a key of {@link SECTIONS}. */
  table: string;
  title: string;
  subtitle: string;
  /** Exact matches rank first ("404", "png", "sigterm"). */
  keys: string[];
  keywords: string[];
  tint: Tint;
  /** Short text on the right. */
  accessory?: string;
  /** [title, text]: the first is Enter. */
  copies: [string, string][];
  /** [label, value] lines of the side panel. */
  facts: [string, string][];
  markdown?: string;
  /** Documentation page. */
  link?: string;
}

export const SECTIONS: Record<string, { title: string; icon: string }> = {
  chmod: { title: "chmod", icon: "bs-lock" },
  http: { title: "HTTP Status Codes", icon: "bs-globe" },
  mime: { title: "MIME Types", icon: "bs-file" },
  ports: { title: "Ports", icon: "bs-plug" },
  ascii: { title: "ASCII", icon: "bs-text" },
  entities: { title: "HTML Entities", icon: "bs-code" },
  keys: { title: "Keyboard Keys", icon: "bs-keyboard" },
  signals: { title: "Unix Signals", icon: "bs-bolt" },
  exit: { title: "Exit Codes", icon: "bs-terminal" },
};

const hex = (n: number, width = 2) => n.toString(16).toUpperCase().padStart(width, "0");

export function httpClass(code: number): { name: string; tint: Tint } {
  if (code < 200) return { name: "Informational", tint: "blue" };
  if (code < 300) return { name: "Success", tint: "green" };
  if (code < 400) return { name: "Redirection", tint: "purple" };
  if (code < 500) return { name: "Client error", tint: "orange" };
  return { name: "Server error", tint: "red" };
}

function httpEntries(): Entry[] {
  return HTTP_STATUS.map(([code, name, description]) => {
    const cls = httpClass(code);
    return {
      id: `http:${code}`,
      table: "http",
      title: `${code} ${name}`,
      subtitle: description,
      keys: [String(code), name.toLowerCase()],
      keywords: [cls.name, "status", "http"],
      tint: cls.tint,
      accessory: cls.name,
      copies: [["Copy Code", String(code)], ["Copy Code and Name", `${code} ${name}`]],
      facts: [["Code", String(code)], ["Name", name], ["Class", `${String(code)[0]}xx · ${cls.name}`]],
      markdown: `## ${code} ${name}\n\n${description}`,
      link: `https://developer.mozilla.org/docs/Web/HTTP/Reference/Status/${code}`,
    };
  });
}

function mimeEntries(): Entry[] {
  return MIME_TYPES.map(([ext, type, kind]) => ({
    id: `mime:${ext}`,
    table: "mime",
    title: type,
    subtitle: `.${ext} · ${kind}`,
    keys: [ext, `.${ext}`, type],
    keywords: [kind, type.split("/")[0]],
    tint: ({ image: "pink", audio: "purple", video: "red", font: "teal", text: "blue" } as Record<string, Tint>)[
      type.split("/")[0]
    ] ?? "gray",
    accessory: `.${ext}`,
    copies: [["Copy MIME Type", type], ["Copy Content-Type Header", `Content-Type: ${type}`]],
    facts: [["Extension", `.${ext}`], ["MIME type", type], ["Kind", kind]],
  }));
}

function portEntries(): Entry[] {
  return PORTS.map(([port, protocol, service, description]) => ({
    id: `port:${port}`,
    table: "ports",
    title: `${port} · ${service}`,
    subtitle: description,
    keys: [String(port), service.toLowerCase()],
    keywords: [protocol, port < 1024 ? "well-known privileged" : "registered"],
    tint: port < 1024 ? "blue" : "teal",
    accessory: protocol,
    copies: [["Copy Port", String(port)], ["Copy ss Command", `ss -tulpn 'sport = :${port}'`]],
    facts: [
      ["Port", String(port)],
      ["Protocol", protocol],
      ["Service", service],
      ["Range", port < 1024 ? "Well-known (needs root to listen)" : "Registered"],
    ],
  }));
}

function asciiEntries(): Entry[] {
  const out: Entry[] = [];
  for (let n = 0; n < 128; n++) {
    const control = ASCII_CONTROL[n];
    const char = String.fromCharCode(n);
    const shown = control && n !== 32 ? control[0] : n === 32 ? "Space" : char;
    out.push({
      id: `ascii:${n}`,
      table: "ascii",
      title: control ? `${shown} · ${control[1]}` : char,
      subtitle: `${n} · 0x${hex(n)} · 0o${n.toString(8).padStart(3, "0")}`,
      keys: [String(n), `0x${hex(n).toLowerCase()}`, ...(control ? [control[0].toLowerCase()] : []), char],
      keywords: control
        ? [control[1], "control"]
        : [/[a-z]/i.test(char) ? "letter" : /\d/.test(char) ? "digit" : "symbol"],
      tint: control ? "gray" : "blue",
      accessory: `0x${hex(n)}`,
      copies: [
        ...(control && n !== 32 ? [] : [["Copy Character", char] as [string, string]]),
        ["Copy Decimal", String(n)],
        ["Copy Hex", `0x${hex(n)}`],
        ...(control?.[2] ? [["Copy Escape", control[2]] as [string, string]] : []),
      ],
      facts: [
        ["Decimal", String(n)],
        ["Hex", `0x${hex(n)}`],
        ["Octal", `0o${n.toString(8)}`],
        ["Binary", n.toString(2).padStart(8, "0")],
        ["HTML", `&#${n};`],
        ...(control?.[2] ? [["Escape", control[2]] as [string, string]] : []),
        ...(n > 0 && n < 27 ? [["Keyboard", `Ctrl+${String.fromCharCode(64 + n)}`] as [string, string]] : []),
      ],
    });
  }
  return out;
}

function entityEntries(): Entry[] {
  return HTML_ENTITIES.map(([name, char, description]) => {
    const cp = char.codePointAt(0)!;
    const visible = /\s|[​-‍­]/.test(char) ? `(${description.toLowerCase()})` : char;
    return {
      id: `entity:${name}`,
      table: "entities",
      title: `${visible}  &${name};`,
      subtitle: description,
      keys: [name.toLowerCase(), `&${name.toLowerCase()};`, char],
      keywords: [`U+${hex(cp, 4)}`],
      tint: "purple",
      accessory: `U+${hex(cp, 4)}`,
      copies: [["Copy Entity", `&${name};`], ["Copy Character", char], ["Copy Numeric Entity", `&#${cp};`]],
      facts: [
        ["Character", visible],
        ["Named", `&${name};`],
        ["Decimal", `&#${cp};`],
        ["Hex", `&#x${hex(cp)};`],
        ["Code point", `U+${hex(cp, 4)}`],
        ["CSS", `\\${hex(cp, 4).toLowerCase()}`],
      ],
    };
  });
}

function keyEntries(): Entry[] {
  return KEYS.map(([label, key, code, keyCode, evdev, evcode]) => ({
    id: `key:${code}`,
    table: "keys",
    title: label,
    subtitle: `code ${code} · key ${key === " " ? '" "' : key}`,
    keys: [
      label.toLowerCase(),
      code.toLowerCase(),
      evdev.toLowerCase(),
      ...(keyCode !== null ? [String(keyCode)] : []),
    ],
    keywords: [key, String(evcode), "keycode"],
    tint: "gray",
    accessory: keyCode !== null ? `keyCode ${keyCode}` : undefined,
    copies: [
      ["Copy event.code", code],
      ["Copy event.key", key],
      ...(keyCode !== null ? [["Copy keyCode", String(keyCode)] as [string, string]] : []),
      ["Copy evdev Name", evdev],
    ],
    facts: [
      ["event.key", key === " " ? '" "' : key],
      ["event.code", code],
      ["keyCode (legacy)", keyCode === null ? "–" : String(keyCode)],
      ["Linux evdev", `${evdev} (${evcode})`],
      ["X11 keycode", String(evcode + 8)],
    ],
  }));
}

function signalEntries(): Entry[] {
  return SIGNALS.map(([n, name, action, description]) => ({
    id: `signal:${n}`,
    table: "signals",
    title: `${n} · ${name}`,
    subtitle: description,
    keys: [String(n), name.toLowerCase(), name.slice(3).toLowerCase()],
    keywords: [action],
    tint: action === "Core dump" ? "red" : action === "Stop" ? "orange" : action === "Ignore" ? "gray" : "yellow",
    accessory: action,
    copies: [
      ["Copy Name", name],
      ["Copy kill Command", `kill -${name.slice(3)} <pid>`],
      ["Copy Number", String(n)],
    ],
    facts: [
      ["Number", String(n)],
      ["Name", name],
      ["Default action", action],
      ["Exit status", `${128 + n} when it kills a shell command`],
    ],
  }));
}

function exitEntries(): Entry[] {
  return EXIT_CODES.map(([code, name, description]) => ({
    id: `exit:${code}`,
    table: "exit",
    title: `${code} · ${name}`,
    subtitle: description,
    keys: [String(code), name.toLowerCase()],
    keywords: ["exit", "status", "$?"],
    tint: code === 0 ? "green" : code > 128 ? "orange" : "red",
    copies: [["Copy Code", String(code)]],
    facts: [
      ["Code", String(code)],
      ["Meaning", name],
      ...(code > 128 && code < 255 ? [["Signal", String(code - 128)] as [string, string]] : []),
    ],
  }));
}

let cache: Entry[] | undefined;

/** Every table but chmod, in display order. */
export function entries(): Entry[] {
  cache ??= [
    ...httpEntries(),
    ...mimeEntries(),
    ...portEntries(),
    ...asciiEntries(),
    ...entityEntries(),
    ...keyEntries(),
    ...signalEntries(),
    ...exitEntries(),
  ];
  return cache;
}

/** Entries matching every word, exact keys first, then title prefixes. */
export function search(all: Entry[], query: string): Entry[] {
  const q = query.trim().toLowerCase();
  if (!q) return all;
  const words = q.split(/\s+/);
  const scored: [number, number, Entry][] = [];
  all.forEach((e, i) => {
    let score = 0;
    if (e.keys.some((k) => k.toLowerCase() === q)) score = 100;
    else if (query.trim().length === 1 && e.keys.includes(query.trim())) score = 100;
    else if (e.title.toLowerCase().startsWith(q)) score = 50;
    else {
      const hay = `${e.title} ${e.subtitle} ${e.keys.join(" ")} ${e.keywords.join(" ")}`.toLowerCase();
      if (!words.every((w) => hay.includes(w))) return;
      score = words.every((w) => e.title.toLowerCase().includes(w)) ? 20 : 10;
    }
    scored.push([score, i, e]);
  });
  return scored.sort((a, b) => b[0] - a[0] || a[1] - b[1]).map((s) => s[2]);
}

// ---------------------------------------------------------------------------
// chmod

/** `755`, `0755`, `4755`, `rwxr-x---`, `-rwxr-xr-x`, `u=rwx,g=rx,o=` → mode bits; undefined otherwise. */
export function parseMode(input: string): number | undefined {
  const t = input.trim();
  if (/^(?:0o?)?[0-7]{3,4}$/i.test(t)) {
    const digits = t.replace(/^0o/i, "");
    return parseInt(digits.length > 4 ? digits.slice(-4) : digits, 8);
  }
  const ls = t.match(/^[-dlcbps]?([r-][w-][xsS-])([r-][w-][xsS-])([r-][w-][xtT-])$/);
  if (ls) {
    let mode = 0;
    ls.slice(1).forEach((triple, i) => {
      const shift = (2 - i) * 3;
      if (triple[0] === "r") mode |= 4 << shift;
      if (triple[1] === "w") mode |= 2 << shift;
      if ("xst".includes(triple[2])) mode |= 1 << shift;
      if ("sStT".includes(triple[2])) mode |= [0o4000, 0o2000, 0o1000][i];
    });
    return mode;
  }
  if (/^[ugoa]*[=+-][rwxst]*(,[ugoa]*[=+-][rwxst]*)*$/.test(t) && /[=+]/.test(t)) {
    let mode = 0;
    for (const clause of t.split(",")) {
      const [, who, op, perms] = clause.match(/^([ugoa]*)([=+-])([rwxst]*)$/)!;
      const classes = !who || who.includes("a") ? "ugo" : who;
      for (const c of classes) {
        const shift = { u: 6, g: 3, o: 0 }[c as "u" | "g" | "o"];
        let bits = 0;
        if (perms.includes("r")) bits |= 4 << shift;
        if (perms.includes("w")) bits |= 2 << shift;
        if (perms.includes("x")) bits |= 1 << shift;
        if (perms.includes("s") && c === "u") bits |= 0o4000;
        if (perms.includes("s") && c === "g") bits |= 0o2000;
        if (perms.includes("t") && c === "o") bits |= 0o1000;
        const mask = (7 << shift) | (c === "u" ? 0o4000 : c === "g" ? 0o2000 : 0o1000);
        if (op === "=") mode = (mode & ~mask) | bits;
        else if (op === "+") mode |= bits;
        else mode &= ~bits;
      }
    }
    return mode;
  }
  return undefined;
}

export const octal = (mode: number) => mode.toString(8).padStart(mode > 0o777 ? 4 : 3, "0");

/** `rwxr-xr-x`, with s/S/t/T for the special bits. */
export function symbolic(mode: number): string {
  let out = "";
  for (let i = 0; i < 3; i++) {
    const shift = (2 - i) * 3;
    const special = mode & [0o4000, 0o2000, 0o1000][i];
    out += mode & (4 << shift) ? "r" : "-";
    out += mode & (2 << shift) ? "w" : "-";
    const x = mode & (1 << shift);
    out += special ? (i === 2 ? (x ? "t" : "T") : x ? "s" : "S") : x ? "x" : "-";
  }
  return out;
}

/** `u=rwx,g=rx,o=rx` for `chmod`. */
export function chmodSymbolic(mode: number): string {
  return ["u", "g", "o"].map((c, i) => {
    const shift = (2 - i) * 3;
    let p = "";
    if (mode & (4 << shift)) p += "r";
    if (mode & (2 << shift)) p += "w";
    if (mode & (1 << shift)) p += "x";
    if (mode & [0o4000, 0o2000, 0o1000][i]) p += i === 2 ? "t" : "s";
    return `${c}=${p}`;
  }).join(",");
}

export function permissionWords(mode: number, who: "u" | "g" | "o"): string {
  const shift = { u: 6, g: 3, o: 0 }[who];
  const words = [
    ...(mode & (4 << shift) ? ["read"] : []),
    ...(mode & (2 << shift) ? ["write"] : []),
    ...(mode & (1 << shift) ? ["execute"] : []),
  ];
  return words.length ? words.join(", ") : "nothing";
}

export function specialBits(mode: number): string[] {
  return [
    ...(mode & 0o4000 ? ["setuid"] : []),
    ...(mode & 0o2000 ? ["setgid"] : []),
    ...(mode & 0o1000 ? ["sticky"] : []),
  ];
}

/** One entry for a mode: octal, symbolic, per class. */
export function modeEntry(mode: number, note?: string): Entry {
  const o = octal(mode), s = symbolic(mode);
  const special = specialBits(mode);
  return {
    id: `chmod:${o}`,
    table: "chmod",
    title: `${o} · ${s}`,
    subtitle: note ??
      `Owner ${permissionWords(mode, "u")} · group ${permissionWords(mode, "g")} · others ${
        permissionWords(mode, "o")
      }`,
    keys: [o, s],
    keywords: [chmodSymbolic(mode), ...special],
    tint: mode & 0o002 ? "red" : mode & 0o7000 ? "orange" : "green",
    accessory: special.length ? special.join(", ") : undefined,
    copies: [
      ["Copy Octal", o],
      ["Copy chmod Command", `chmod ${o} `],
      ["Copy Symbolic", s],
      ["Copy chmod Symbolic Command", `chmod ${chmodSymbolic(mode)} `],
    ],
    facts: [
      ["Octal", o],
      ["Symbolic", s],
      ["ls -l", `-${s}`],
      ["chmod", chmodSymbolic(mode)],
      ["Owner", permissionWords(mode, "u")],
      ["Group", permissionWords(mode, "g")],
      ["Others", permissionWords(mode, "o")],
      ...(special.length ? [["Special", special.join(", ")] as [string, string]] : []),
      ["umask giving it", octal(~mode & 0o777)],
    ],
  };
}

export const commonModes = (): Entry[] => COMMON_MODES.map(([o, note]) => modeEntry(parseInt(o, 8), note));
