import {
  type Action,
  action,
  copy,
  detail,
  Icons,
  type Item,
  list,
  meta,
  paste,
  refresh,
  submenu,
} from "@backslash/api";
import {
  entropy,
  generatorQuery,
  loremParagraph,
  loremParagraphs,
  loremSentence,
  password,
  relative,
  type Result,
  strength,
  transforms,
  uuidV4,
  uuidV7,
} from "../lib.ts";

const preview = (text: string, max = 140) => {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > max ? `${line.slice(0, max)}…` : line;
};

/** A fenced block that can't be closed early by the text itself. */
const fence = (text: string, lang = "") => {
  const ticks = "`".repeat(Math.max(3, ...[...text.matchAll(/`+/g)].map((m) => m[0].length + 1)));
  const shown = text.length > 6000 ? `${text.slice(0, 6000)}\n…` : text;
  return `${ticks}${lang}\n${shown}\n${ticks}`;
};

const valueActions = (value: string): Action[] => [
  copy(value, "Copy to Clipboard"),
  paste(value, "Paste in Active App"),
];

function resultItem(r: Result, depth: number): Item {
  const isJson = r.section === "JSON" || r.id === "jwt";
  const markdown = r.markdown ?? fence(r.value, isJson ? "json" : "");
  const metadata = [
    meta.text("Transformation", r.label.split(" · ")[0], { icon: r.icon }),
    ...(r.metadata ?? []),
    ...(r.id === "counts" ? [] : [meta.separator(), meta.text("Output length", `${[...r.value].length} characters`)]),
  ];
  return {
    id: r.id,
    title: r.title ?? (preview(r.value) || "(empty)"),
    subtitle: r.subtitle ?? r.label,
    icon: { source: r.icon, tint: r.tint },
    section: r.section,
    keywords: [r.label],
    accessories: r.tags,
    detail: { stats: r.stats, markdown: markdown || undefined, metadata },
    actions: [
      ...valueActions(r.value),
      action("Show Full Output", () =>
        detail({
          title: r.label,
          markdown,
          stats: r.stats,
          metadata,
          status: r.label,
          actions: [...valueActions(r.value), ...(r.extra ?? []).map((e) => copy(e.value, e.title))],
        }), { icon: Icons.eye, shortcut: "<Ctrl>d" }),
      ...(depth < 4
        ? [action("Transform This Result", () => chain(r.value, depth + 1), {
          icon: Icons.arrowRight,
          shortcut: "<Ctrl>t",
        })]
        : []),
      ...(r.extra ?? []).map((e) => copy(e.value, e.title, { section: "Copy" })),
    ],
  };
}

/** The transformations of a result, to apply several in a row (decode, then pretty-print…). */
async function chain(value: string, depth: number) {
  const results = await transforms(value);
  return list({
    title: preview(value, 40),
    placeholder: "Filter transformations…",
    status: `${results.length} transformations of the previous result`,
    items: results.map((r) => resultItem(r, depth)),
  });
}

// ---------------------------------------------------------------------------
// Generators

const LENGTHS = [8, 12, 16, 24, 32, 48, 64];

function passwordItem(length: number, symbols: boolean): Item {
  const value = password(length, symbols);
  const bits = entropy(length, symbols);
  const s = strength(bits);
  const kind = symbols ? "letters, digits and symbols" : "letters and digits";
  return {
    id: `password-${symbols ? "symbols" : "alnum"}`,
    title: value,
    subtitle: symbols ? "Password" : "Password · no symbols",
    icon: { source: Icons.lock, tint: symbols ? "orange" : "yellow" },
    section: "Passwords",
    keywords: ["password", "passwd", "secret", "mot de passe", "random"],
    accessories: [{ tag: s.text, color: s.color }, { text: `${length} chars` }],
    detail: {
      stats: [
        { label: "characters", value: length },
        { label: "bits of entropy", value: bits, color: s.color },
      ],
      markdown: fence(value),
      metadata: [
        meta.text("Characters", kind, { icon: Icons.text }),
        meta.progress("Strength", Math.min(1, bits / 128), s.text),
        meta.text("Source", "crypto.getRandomValues", { icon: Icons.shield }),
      ],
    },
    actions: [
      ...valueActions(value),
      action("Generate Another", () => refresh(), { icon: Icons.refresh, shortcut: "<Ctrl>r" }),
      submenu(
        "Other Length",
        LENGTHS.filter((l) => l !== length).map((l) => copy(password(l, symbols), `${l} characters`)),
        { icon: Icons.hash, section: "Generate" },
      ),
      submenu(
        symbols ? "Without Symbols" : "With Symbols",
        LENGTHS.map((l) => copy(password(l, !symbols), `${l} characters`)),
        { icon: Icons.key, section: "Generate" },
      ),
    ],
  };
}

function uuidItem(version: 4 | 7): Item {
  const value = version === 4 ? uuidV4() : uuidV7();
  const variants: [string, string][] = [
    ["Uppercase", value.toUpperCase()],
    ["Without Dashes", value.replace(/-/g, "")],
    ["With Braces", `{${value}}`],
    ["As a URN", `urn:uuid:${value}`],
  ];
  return {
    id: `uuid-v${version}`,
    title: value,
    subtitle: version === 4 ? "UUID v4 · random" : "UUID v7 · time-ordered",
    icon: { source: Icons.tag, tint: version === 4 ? "blue" : "teal" },
    section: "Identifiers",
    keywords: ["uuid", "guid", "id", `v${version}`],
    detail: {
      markdown: fence(value),
      metadata: [
        meta.text("Version", String(version), { icon: Icons.tag }),
        meta.text("Format", version === 4 ? "122 random bits" : "48-bit Unix ms timestamp + 74 random bits"),
        ...(version === 7 ? [meta.text("Sorts by", "Creation time", { icon: Icons.clock })] : []),
        meta.text("Standard", "RFC 9562"),
      ],
    },
    actions: [
      ...valueActions(value),
      action("Generate Another", () => refresh(), { icon: Icons.refresh, shortcut: "<Ctrl>r" }),
      submenu("Copy As", variants.map(([title, v]) => copy(v, title)), { icon: Icons.copy, section: "Copy" }),
      submenu(
        "Copy Several",
        [5, 10, 25].map((n) =>
          copy(
            Array.from({ length: n }, () => version === 4 ? uuidV4() : uuidV7()).join("\n"),
            `${n} UUIDs, one per line`,
          )
        ),
        { icon: Icons.layers, section: "Copy" },
      ),
    ],
  };
}

function loremItems(paragraphs?: number): Item[] {
  const entries: [string, string, string][] = paragraphs
    ? [[`lorem-${paragraphs}`, `${paragraphs} paragraphs`, loremParagraphs(paragraphs)]]
    : [
      ["lorem-sentence", "Sentence", loremSentence()],
      ["lorem-paragraph", "Paragraph", loremParagraph()],
      ["lorem-3", "3 paragraphs", loremParagraphs(3)],
    ];
  return entries.map(([id, what, value]) => ({
    id,
    title: preview(value, 90),
    subtitle: `Lorem ipsum · ${what}`,
    icon: { source: Icons.text, tint: "gray" },
    section: "Placeholder Text",
    keywords: ["lorem", "ipsum", "placeholder", "text", "texte"],
    detail: {
      markdown: value,
      metadata: [meta.text("Words", value.split(/\s+/).length), meta.text("Characters", value.length)],
    },
    actions: [
      ...valueActions(value),
      action("Generate Another", () => refresh(), { icon: Icons.refresh, shortcut: "<Ctrl>r" }),
    ],
  }));
}

function nowItems(): Item[] {
  const now = new Date();
  const entries: [string, string, string][] = [
    ["now-s", "Unix seconds", String(Math.floor(now.getTime() / 1000))],
    ["now-ms", "Unix milliseconds", String(now.getTime())],
    ["now-iso", "ISO 8601 (UTC)", now.toISOString()],
  ];
  return entries.map(([id, what, value]) => ({
    id,
    title: value,
    subtitle: `Now · ${what}`,
    icon: { source: Icons.clock, tint: "blue" },
    section: "Current Time",
    keywords: ["now", "timestamp", "time", "date", "epoch", "maintenant"],
    detail: {
      metadata: [
        meta.text("Format", what, { icon: Icons.calendar }),
        meta.text("Local time", now.toLocaleString("en-GB", { dateStyle: "full", timeStyle: "long" })),
        meta.text("Generated", relative(now, new Date())),
      ],
    },
    actions: [...valueActions(value), action("Refresh", () => refresh(), { icon: Icons.refresh, shortcut: "<Ctrl>r" })],
  }));
}

const TRANSFORMATIONS = [
  "Base64 and Base64URL encode / decode",
  "URL encode / decode, JSON string escape / unescape",
  "MD5, SHA-1, SHA-256, SHA-512",
  "JWT: header, payload and expiry",
  "Unix timestamps (s, ms, µs, ns) ⇄ ISO dates, with relative time",
  "JSON: pretty-print and minify",
  "Numbers: decimal, hexadecimal, binary, octal",
  "camelCase, snake_case, kebab-case, Title Case, UPPERCASE…",
  "Character, word and line counts",
];

const tip: Item = {
  id: "tip",
  title: "Type or paste a value to transform it",
  subtitle: "Encodings, hashes, JWT, timestamps, JSON, number bases, case, counts",
  icon: { source: Icons.info, tint: "gray" },
  section: "Transform",
  detail: {
    markdown: `## What Dev Utils recognizes\n\n${
      TRANSFORMATIONS.map((t) => `- ${t.replace(/\S*_\S*/g, (w) => `\`${w}\``)}`).join("\n")
    }\n\nType **password 32**, **uuid** or **lorem 5** for a generator.`,
  },
};

function generators(kind?: string, n?: number): Item[] {
  const items: Item[] = [];
  if (!kind || kind === "uuid") items.push(uuidItem(4), uuidItem(7));
  if (!kind || kind === "password") {
    const length = n && n >= 4 && n <= 256 ? n : 20;
    items.push(passwordItem(length, true), passwordItem(length, false));
  }
  if (!kind || kind === "lorem") items.push(...loremItems(n && n <= 50 ? n : undefined));
  if (!kind || kind === "now") items.push(...nowItems());
  return items;
}

export default list({
  placeholder: "Paste a value to encode, decode, hash, convert… or pick a generator",
  status: (items) =>
    items.some((i) => i.id === "tip")
      ? "Generators · type to transform"
      : `${items.length} result${items.length === 1 ? "" : "s"}`,
  async search(query) {
    if (!query.trim()) return [...generators(), tip];
    const wanted = generatorQuery(query);
    const results = (await transforms(query)).map((r) => resultItem(r, 0));
    return wanted ? [...generators(wanted.kind, wanted.n), ...results] : results;
  },
});
