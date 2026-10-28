// Items, actions and views shared by the commands.

import {
  type Action,
  action,
  close,
  type Context,
  copy,
  detail,
  type DetailSpec,
  Icons,
  type Item,
  meta,
  type Metadata,
  open,
  openExternal,
  paste,
  refresh,
  storage,
  submenu,
} from "@backslash/api";
import { article, langLinks, NotFound } from "./api.ts";
import {
  extractToMarkdown,
  firstParagraph,
  formatDate,
  languageName,
  markdownLink,
  type Page,
  pageUrl,
  preferredLanguage,
  readingTime,
  sortLangLinks,
  truncate,
  wordCount,
} from "./lib.ts";

const env = (k: string) => {
  try {
    return Deno.env.get(k);
  } catch {
    return undefined;
  }
};

/** The language from the preferences, else the locale. */
export const defaultLanguage = (ctx: Context) =>
  preferredLanguage(
    (ctx.preferences as { language?: string }).language,
    env("LC_ALL") || env("LC_MESSAGES") || env("LANG"),
  );

// ---------------------------------------------------------------------------
// Recently viewed

export interface Recent {
  lang: string;
  title: string;
  description?: string;
  image?: string;
  url: string;
  at: number;
}

export const recents = async (): Promise<Recent[]> => ((await storage.get("recent")) ?? []) as unknown as Recent[];

export async function remember(p: Page): Promise<void> {
  const entry: Recent = {
    lang: p.lang,
    title: p.title,
    description: p.description,
    image: p.image?.url,
    url: p.url,
    at: Date.now(),
  };
  const kept = (await recents()).filter((r) => !(r.lang === p.lang && r.title === p.title));
  await storage.set("recent", [entry, ...kept].slice(0, 30) as any);
}

export async function forget(r: Recent | undefined): Promise<void> {
  if (!r) return storage.delete("recent");
  await storage.set("recent", (await recents()).filter((x) => !(x.lang === r.lang && x.title === r.title)) as any);
}

// ---------------------------------------------------------------------------
// Pages

const coords = (p: Page) =>
  p.coordinates
    ? `${Math.abs(p.coordinates.lat).toFixed(4)}° ${p.coordinates.lat >= 0 ? "N" : "S"}, ${
      Math.abs(p.coordinates.lon).toFixed(4)
    }° ${p.coordinates.lon >= 0 ? "E" : "W"}`
    : undefined;

export function pageMetadata(p: Page, extra: Metadata[] = []): Metadata[] {
  const c = coords(p);
  const edited = formatDate(p.edited);
  return [
    ...(p.description ? [meta.text("Description", p.description, { icon: Icons.info })] : []),
    meta.text("Language", `${languageName(p.lang)} (${p.lang})`, { icon: Icons.globe }),
    ...(p.disambiguation ? [meta.tags("Type", [{ text: "Disambiguation", color: "orange" }])] : []),
    ...(c
      ? [
        meta.link(
          "Coordinates",
          c,
          `https://www.openstreetmap.org/?mlat=${p.coordinates!.lat}&mlon=${p.coordinates!.lon}#map=12/${
            p.coordinates!.lat
          }/${p.coordinates!.lon}`,
        ),
      ]
      : []),
    ...(p.length ? [meta.text("Size", `${Math.round(p.length / 1024)} kB of wikitext`, { icon: Icons.file })] : []),
    ...(edited ? [meta.text("Last edited", edited, { icon: Icons.clock })] : []),
    ...extra,
    meta.separator(),
    meta.link("Link", p.url.replace(/^https:\/\//, ""), p.url),
  ];
}

/** Opens the page in the browser and keeps it in Recently Viewed. */
const openPage = (p: Page) =>
  action("Open in Browser", async () => {
    await remember(p).catch(() => {});
    await openExternal(p.url);
    return close();
  }, { icon: Icons.globe, shortcut: "<Ctrl>o" });

const readHere = (p: Page) =>
  action("Read Here", () => articleView(p.lang, p.title), { icon: Icons.book, shortcut: "<Ctrl>r" });

/**
 * Open (Enter: the browser, or the launcher with the "read here" preference),
 * copy the link, the summary, a markdown link; open in another language.
 */
export function pageActions(p: Page, o: { readFirst?: boolean; readHere?: boolean } = {}): Action[] {
  const summary = firstParagraph(p.extract);
  const opening = o.readHere === false
    ? [openPage(p)]
    : o.readFirst
    ? [readHere(p), openPage(p)]
    : [openPage(p), readHere(p)];
  return [
    ...opening,
    copy(p.url, "Copy Link", { shortcut: "<Ctrl><Shift>c", section: "Copy" }),
    ...(summary ? [copy(`${summary}\n\n${p.url}`, "Copy Summary", { section: "Copy", icon: Icons.text })] : []),
    copy(markdownLink(p), "Copy Markdown Link", { section: "Copy", icon: Icons.link }),
    paste(p.url, "Paste Link", { section: "Copy" }),
    otherLanguages(p),
  ];
}

const otherLanguages = (p: Page) =>
  submenu("Open in Another Language", async () => {
    const links = sortLangLinks(await langLinks(p.lang, p.title));
    if (!links.length) return [action("Only in this language", () => undefined, { icon: Icons.info })];
    return links.map((l) =>
      action(`${l.autonym ?? languageName(l.lang)} · ${l.title}`, () => articleView(l.lang, l.title), {
        icon: Icons.globe,
      })
    );
  }, { icon: Icons.globe, shortcut: "<Ctrl>l", section: "Language" });

/** A search result, a random page or a recent one. */
export function pageItem(p: Page, section?: string, readFirst = false): Item {
  const intro = extractToMarkdown(truncate(p.extract, 1400));
  return {
    id: `${p.lang}:${p.title}`,
    title: p.title,
    subtitle: p.description ?? truncate(firstParagraph(p.extract), 90),
    icon: p.image?.url ?? { source: Icons.book, tint: p.disambiguation ? "orange" : "gray" },
    section,
    accessories: p.disambiguation ? [{ tag: "Disambiguation", color: "orange" }] : [],
    detail: {
      image: p.image?.url,
      markdown: [p.description ? `*${p.description}*` : "", intro || "No summary."].filter(Boolean).join("\n\n"),
      metadata: pageMetadata(p),
    },
    actions: pageActions(p, { readFirst }),
  };
}

export function recentItem(r: Recent, readFirst = false): Item {
  const page: Page = {
    lang: r.lang,
    title: r.title,
    description: r.description,
    extract: "",
    url: r.url,
    image: r.image ? { url: r.image } : undefined,
  };
  return {
    id: `recent:${r.lang}:${r.title}`,
    title: r.title,
    subtitle: r.description,
    icon: r.image ?? { source: Icons.history, tint: "gray" },
    section: "Recently Viewed",
    accessories: [{ tag: r.lang }],
    detail: {
      image: r.image,
      metadata: [
        ...pageMetadata(page),
        meta.text("Viewed", new Date(r.at).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }), {
          icon: Icons.history,
        }),
      ],
    },
    actions: [
      ...pageActions(page, { readFirst }),
      action("Remove from Recent", async () => {
        await forget(r);
        return refresh();
      }, { icon: Icons.trash, section: "Danger", destructive: true }),
    ],
  };
}

// ---------------------------------------------------------------------------
// The article, read in the launcher

export async function articleView(lang: string, title: string): Promise<DetailSpec> {
  let page: Page | undefined;
  try {
    page = await article(lang, title);
  } catch (e) {
    if (!(e instanceof NotFound)) throw e;
  }
  if (!page) {
    return detail({
      title,
      markdown: `# ${title}\n\nThis page doesn't exist on ${languageName(lang)} Wikipedia.`,
      actions: [open(pageUrl(lang, title), "Open in Browser", { icon: Icons.globe })],
    });
  }
  const p = page;
  await remember(p).catch(() => {});
  const body = extractToMarkdown(p.extract);
  const words = wordCount(body);
  return detail({
    title: p.title,
    markdown: `# ${p.title}\n\n${p.description ? `*${p.description}*\n\n` : ""}${body || "No text."}`,
    stats: [
      { label: "Words", value: words.toLocaleString("en-US") },
      { label: "Reading time", value: readingTime(words) },
    ],
    metadata: pageMetadata(p),
    status: `${languageName(p.lang)} Wikipedia`,
    actions: [
      openPage(p),
      copy(p.url, "Copy Link", { shortcut: "<Ctrl><Shift>c", section: "Copy" }),
      copy(`# ${p.title}\n\n${body}\n\nSource: ${p.url}`, "Copy Article as Markdown", {
        icon: Icons.text,
        section: "Copy",
      }),
      copy(markdownLink(p), "Copy Markdown Link", { section: "Copy", icon: Icons.link }),
      otherLanguages(p),
    ],
  });
}
