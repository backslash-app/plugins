import {
  action,
  close,
  type Color,
  copy,
  detail,
  exec,
  Icons,
  type Item,
  list,
  meta,
  open,
  storage,
} from "@backslash/api";
import { type ManEntry, manToMarkdown, parseApropos, rank, sectionName, stripOverstrike } from "../lib.ts";
import { runInTerminal } from "../terminal.ts";

interface Prefs {
  terminal?: string;
}

const COLORS: Record<string, Color> = {
  "1": "green",
  "2": "red",
  "3": "purple",
  "5": "orange",
  "7": "teal",
  "8": "blue",
};
const color = (section: string) => COLORS[section[0]] ?? "gray";
const webUrl = (e: ManEntry) => `https://man.archlinux.org/man/${encodeURIComponent(e.name)}.${e.section}`;

async function remember(e: ManEntry) {
  const recent = (await storage.get<[string, string, string][]>("man-recent")) ?? [];
  const kept = recent.filter(([n, s]) => !(n === e.name && s === e.section));
  await storage.set("man-recent", [[e.name, e.section, e.description], ...kept].slice(0, 12));
}

async function page(e: ManEntry, prefs: Prefs) {
  const raw = await exec("man", ["-P", "cat", e.section, e.name]);
  if (/This system has been minimized/.test(raw)) {
    throw new Error("Man pages were removed from this system: run `unminimize` to restore them");
  }
  await remember(e);
  const markdown = manToMarkdown(raw);
  const sections = [...markdown.matchAll(/^## (.+)$/gm)].map((m) => m[1]);
  return detail({
    title: `${e.name}(${e.section})`,
    markdown,
    metadata: [
      meta.text("Page", `${e.name}(${e.section})`, { icon: Icons.book }),
      meta.text("Section", `${e.section} · ${sectionName(e.section)}`, { icon: Icons.hash, color: color(e.section) }),
      ...(e.description ? [meta.text("Summary", e.description)] : []),
      ...(sections.length ? [meta.tags("Contents", sections.slice(0, 10))] : []),
      meta.separator(),
      meta.link("Online", `man.archlinux.org/man/${e.name}.${e.section}`, webUrl(e)),
    ],
    status: `man ${e.section} ${e.name}`,
    actions: [
      action("Open in Terminal", () => {
        runInTerminal(["man", e.section, e.name], prefs.terminal || undefined);
        return close();
      }, { icon: Icons.terminal, shortcut: "<Ctrl>t" }),
      open(webUrl(e), "Open Online", { shortcut: "<Ctrl>o" }),
      copy(stripOverstrike(raw), "Copy Page Text", { shortcut: "<Ctrl><Shift>c" }),
    ],
  });
}

function item(e: ManEntry, prefs: Prefs, section?: string): Item {
  return {
    id: `${e.name}(${e.section})`,
    title: e.name,
    subtitle: e.description,
    icon: { source: Icons.book, tint: color(e.section) },
    section,
    keywords: [e.description],
    accessories: [{ tag: e.section, color: color(e.section) }],
    detail: {
      metadata: [
        meta.text("Page", `${e.name}(${e.section})`, { icon: Icons.book }),
        meta.text("Section", `${e.section} · ${sectionName(e.section)}`, { icon: Icons.hash, color: color(e.section) }),
        ...(e.description ? [meta.text("Summary", e.description)] : []),
      ],
    },
    actions: [
      action("Read Page", () => page(e, prefs), { icon: Icons.book }),
      action("Open in Terminal", async () => {
        runInTerminal(["man", e.section, e.name], prefs.terminal || undefined);
        await remember(e);
        return close();
      }, { icon: Icons.terminal, shortcut: "<Ctrl>t" }),
      open(webUrl(e), "Open Online", { shortcut: "<Ctrl>o" }),
      copy(`man ${e.section} ${e.name}`, "Copy man Command", { icon: Icons.terminal, section: "Copy" }),
      copy(e.name, "Copy Name", { shortcut: "<Ctrl>period", section: "Copy" }),
    ],
  };
}

/** apropos takes regular expressions: each word is matched literally, all of them required. */
const literal = (w: string) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

let summary = "";

export default list({
  placeholder: "Search man pages by name or description…",
  empty: {
    title: "No man page found",
    description: "Try another word, or check that man-db is installed",
    icon: Icons.book,
  },
  status: () => summary,
  async search(query, { preferences, signal }) {
    const prefs = preferences as Prefs;
    summary = "";
    if (!query.trim()) {
      const recent = (await storage.get<[string, string, string][]>("man-recent")) ?? [];
      return recent.map(([name, section, description]) => item({ name, section, description }, prefs, "Recently Read"));
    }
    let out = "";
    try {
      out = await exec("apropos", ["-a", ...query.trim().split(/\s+/).map(literal)], { signal });
    } catch (err) {
      if (err instanceof Deno.errors.NotFound) throw new Error("apropos is not installed: install man-db");
      // Exit 16: nothing appropriate.
      return [];
    }
    const entries = parseApropos(out);
    const byName = rank(entries, query.trim(), (e) => e.name, 80);
    const rest = entries.filter((e) => !byName.includes(e));
    const shown = [...byName, ...rest].slice(0, 80);
    summary = `${entries.length} page${entries.length === 1 ? "" : "s"}`;
    return shown.map((e) => item(e, prefs));
  },
});
