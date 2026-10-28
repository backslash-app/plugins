import {
  type Action,
  action,
  copy,
  detail,
  type DetailSpec,
  Icons,
  type Item,
  list,
  meta,
  open,
  paste,
  storage,
  submenu,
} from "@backslash/api";
import { reach } from "../devdocs.ts";
import {
  bestPlatform,
  parseTldrIndex,
  parseTldrPage,
  plainCommand,
  platformOrder,
  rank,
  type TldrCommand,
  tldrMarkdown,
  tldrName,
  type TldrPage,
  tldrUrl,
  tldrWebUrl,
} from "../lib.ts";

interface Prefs {
  language?: string;
}

const DAY = 86400_000;
const ORDER = platformOrder(Deno.build.os);

let indexPromise: Promise<TldrCommand[] | undefined> | undefined;

/** The list of pages, cached a day; undefined when tldr.sh can't be reached (exact names still work). */
function tldrIndex(): Promise<TldrCommand[] | undefined> {
  indexPromise ??= (async () => {
    const cached = (await storage.get("index")) as { at: number; commands: [string, string][] } | undefined;
    const fromCache = cached?.commands.map(([name, p]) => ({ name, platforms: p.split(",") }));
    if (fromCache && Date.now() - cached!.at < DAY) return fromCache;
    try {
      const res = await fetch("https://tldr.sh/assets/index.json");
      if (!res.ok) throw new Error(`tldr.sh answered ${res.status}`);
      const commands = parseTldrIndex(await res.text());
      await storage.set("index", { at: Date.now(), commands: commands.map((c) => [c.name, c.platforms.join(",")]) });
      return commands;
    } catch {
      return fromCache;
    }
  })();
  return indexPromise;
}

interface Loaded {
  name: string;
  platform: string;
  language: string;
  page: TldrPage;
}

const pages = new Map<string, Promise<Loaded | undefined>>();

/** A page in the user's language, else in English; undefined when it does not exist. */
function loadPage(name: string, platform: string, language: string): Promise<Loaded | undefined> {
  const key = `${language}/${platform}/${name}`;
  let p = pages.get(key);
  if (!p) {
    p = (async () => {
      for (const lang of language !== "en" ? [language, "en"] : ["en"]) {
        const res = await reach(tldrUrl(name, platform, lang));
        if (res.ok) return { name, platform, language: lang, page: parseTldrPage(await res.text()) };
        await res.body?.cancel();
        if (res.status !== 404) throw new Error(`GitHub answered ${res.status}`);
      }
      return undefined;
    })();
    p.catch(() => pages.delete(key));
    pages.set(key, p);
  }
  return p;
}

async function remember(name: string) {
  const recent = (await storage.get<string[]>("recent")) ?? [];
  await storage.set("recent", [name, ...recent.filter((n) => n !== name)].slice(0, 12));
}

function exampleActions(page: TldrPage): Action[] {
  if (!page.examples.length) return [];
  return [
    submenu(
      "Copy Example",
      page.examples.map((e) => copy(plainCommand(e.command), e.description)),
      { icon: Icons.copy, shortcut: "<Ctrl><Shift>c", section: "Examples" },
    ),
    submenu(
      "Paste Example",
      page.examples.map((e) => paste(plainCommand(e.command), e.description)),
      { icon: Icons.paste, shortcut: "<Ctrl><Shift>v", section: "Examples" },
    ),
  ];
}

function metadata(l: Loaded, platforms: string[]) {
  return [
    meta.text("Command", l.page.title || l.name, { icon: Icons.terminal }),
    meta.tags("Platforms", platforms.map((p) => ({ text: p, color: p === l.platform ? "green" as const : undefined }))),
    meta.text("Examples", l.page.examples.length, { icon: Icons.code }),
    ...(l.language !== "en" ? [meta.text("Language", l.language, { icon: Icons.globe })] : []),
    meta.separator(),
    ...(l.page.more
      ? [meta.link("More information", l.page.more.replace(/^https?:\/\//, "").slice(0, 50), l.page.more)]
      : []),
    meta.link("Page", `tldr-pages/${l.platform}/${l.name}.md`, tldrWebUrl(l.name, l.platform)),
  ];
}

function pageView(l: Loaded, platforms: string[]): DetailSpec {
  return detail({
    title: `tldr ${l.name}`,
    markdown: tldrMarkdown(l.page),
    metadata: metadata(l, platforms),
    status: `${l.page.examples.length} examples · ${l.platform}`,
    actions: [
      ...exampleActions(l.page),
      ...(l.page.more ? [open(l.page.more, "Open Documentation", { icon: Icons.book })] : []),
      open(tldrWebUrl(l.name, l.platform), "Open on GitHub", { shortcut: "<Ctrl>o" }),
    ],
  });
}

function commandItem(c: TldrCommand, language: string, loaded?: Loaded, section?: string): Item {
  const platform = loaded?.platform ?? bestPlatform(c, ORDER);
  const show = action("Show Page", async () => {
    const l = loaded ?? await loadPage(c.name, platform, language);
    if (!l) throw new Error(`No tldr page for ${c.name}`);
    await remember(c.name);
    return pageView(l, c.platforms);
  }, { icon: Icons.book });
  return {
    id: c.name,
    title: loaded?.page.title || c.name,
    subtitle: loaded?.page.description[0],
    icon: { source: Icons.terminal, tint: "teal" },
    section,
    accessories: c.platforms.slice(0, 3).map((p) => ({ tag: p, color: p === platform ? "teal" as const : undefined })),
    detail: loaded ? { markdown: tldrMarkdown(loaded.page), metadata: metadata(loaded, c.platforms) } : {
      metadata: [
        meta.tags("Platforms", c.platforms),
        meta.text("Page", "Press Enter to load it", { icon: Icons.info }),
      ],
    },
    actions: [
      show,
      ...(loaded ? exampleActions(loaded.page) : []),
      open(tldrWebUrl(c.name, platform), "Open on GitHub", { shortcut: "<Ctrl>o" }),
      copy(c.name, "Copy Command Name", { shortcut: "<Ctrl>period", section: "Copy" }),
    ],
  };
}

export default list({
  placeholder: "Search tldr pages: tar, git commit, ffmpeg…",
  empty: { title: "No tldr page", description: "Try the base command (git, docker, systemctl…)", icon: Icons.search },
  status: (items) => (items.length ? `${items.length} page${items.length === 1 ? "" : "s"}` : ""),
  async search(query, { preferences, signal }) {
    const language = ((preferences as Prefs).language || "en").trim().toLowerCase();
    const index = await tldrIndex();
    if (!query.trim()) {
      const recent = (await storage.get<string[]>("recent")) ?? [];
      const known = new Map(index?.map((c) => [c.name, c]));
      return recent.map((name) =>
        commandItem(known.get(name) ?? { name, platforms: ["common"] }, language, undefined, "Recently Viewed")
      );
    }
    const name = tldrName(query);
    if (!index) {
      // Offline index: look the exact page up on each platform.
      for (const platform of ORDER.slice(0, 4)) {
        const l = await loadPage(name, platform, language);
        if (signal.aborted) return [];
        if (l) return [commandItem({ name, platforms: [platform] }, language, l)];
      }
      return [];
    }
    const hits = rank(index, name, (c) => c.name, 40);
    if (!hits.length) return [];
    // The best match comes with its page in the side panel.
    const top = await loadPage(hits[0].name, bestPlatform(hits[0], ORDER), language).catch(() => undefined);
    return hits.map((c, i) => commandItem(c, language, i === 0 ? top : undefined));
  },
});
