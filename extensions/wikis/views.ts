// Rows, the reading view and the setup help.

import { action, clipboard, close, copy, detail, Icons, type Item, meta, type Metadata, open } from "@backslash/api";
import type { Wiki } from "./api.ts";
import { age, type Content, type Page, SetupError, type WikiId, WIKIS } from "./lib.ts";

export const WIKI_ICONS: Record<WikiId, { source: string; tint: "blue" | "green" | "teal" | "purple" }> = {
  outline: { source: Icons.note, tint: "purple" },
  bookstack: { source: Icons.book, tint: "teal" },
  wikijs: { source: Icons.globe, tint: "green" },
  confluence: { source: Icons.layers, tint: "blue" },
};

const HELP = [
  "## Connect your wikis",
  "",
  "Set up any of them in **Settings → Extensions → Wikis → Configure**; results are merged.",
  "",
  "- **Outline**: an **API key** from **Settings → API & Apps → New API key** (Outline's cloud",
  "  needs nothing else; a self-hosted Outline needs its **address** too).",
  "- **BookStack**: its **address**, and a **token ID** and **token secret** from **your profile →",
  "  Access & Security → API Tokens → Create Token** (your role needs the *Access system API* permission).",
  "- **Wiki.js**: its **address**, and an **API key** from **Administration → API Access** (enable",
  "  the API, then **New API Key** with read access).",
  "- **Confluence Cloud**: your **site** (`your-team.atlassian.net`), your **email** and an",
  "  **API token** from **id.atlassian.com → Security → API tokens**.",
  "",
  "Self-hosted wikis can be on this computer, your local network (`*.lan`, `*.local`, `192.168.x.x`…)",
  "or Tailscale (`*.ts.net`): an extension declares in advance the hosts it may reach.",
].join("\n");

export function setupItems(messages: string[]): Item[] {
  return [{
    id: "setup",
    title: messages[0] ?? "Connect Outline, BookStack, Wiki.js or Confluence",
    subtitle: "Settings → Extensions → Wikis",
    icon: { source: Icons.key, tint: "orange" },
    detail: {
      markdown: [HELP, ...(messages.length > 1 ? ["", ...messages.slice(1).map((m) => `- ${m}`)] : [])].join("\n"),
    },
    actions: [
      open("https://id.atlassian.com/manage-profile/security/api-tokens", "Open Atlassian API Tokens", {
        icon: Icons.key,
      }),
    ],
  }];
}

/** A wiki that failed, shown among the results of the others. */
export function problemItem(wiki: WikiId | undefined, e: Error): Item {
  const setup = e instanceof SetupError;
  return {
    id: `problem-${wiki ?? e.message}`,
    title: e.message,
    subtitle: setup ? "Settings → Extensions → Wikis" : undefined,
    icon: { source: setup ? Icons.key : Icons.alert, tint: setup ? "orange" : "red" },
    section: "Problems",
    detail: { markdown: setup ? HELP : `### ${wiki ? WIKIS[wiki] : "A wiki"} failed\n\n${e.message}` },
    actions: [copy(e.message, "Copy Error")],
  };
}

function pageMetadata(p: Page, c?: Content): Metadata[] {
  const updated = c?.updated ?? p.updated;
  const author = c?.author ?? p.author;
  const tags = c?.tags?.length ? c.tags : p.tags;
  return [
    meta.text("Wiki", WIKIS[p.wiki], { icon: WIKI_ICONS[p.wiki].source }),
    ...(p.container ? [meta.text("In", p.container, { icon: Icons.folder })] : []),
    ...(updated
      ? [meta.text("Updated", `${new Date(updated).toLocaleDateString("en-GB")} (${age(updated)})`, {
        icon: Icons.calendar,
      })]
      : []),
    ...(author ? [meta.person("By", author)] : []),
    ...(tags.length ? [meta.tags("Tags", tags)] : []),
    meta.separator(),
    meta.link("Link", hostOf(p.url), p.url),
  ];
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

const mdLink = (p: Page) => `[${p.title.replace(/[[\]]/g, "")}](${p.url})`;

function readView(w: Wiki, p: Page) {
  let loaded: Content | undefined;
  const load = async (signal?: AbortSignal) => loaded ??= await w.content(p, signal);
  return detail({
    title: p.title,
    async markdown({ signal }) {
      const c = await load(signal);
      const line = [p.container, WIKIS[p.wiki], c.author, c.updated ? `updated ${age(c.updated)} ago` : ""]
        .filter(Boolean).join(" · ");
      return [`# ${p.title}`, "", `_${line}_`, "", c.markdown || "_This page is empty._"].join("\n");
    },
    metadata: pageMetadata(p),
    actions: [
      open(p.url, `Open in ${WIKIS[p.wiki]}`),
      copy(p.url, "Copy Link", { shortcut: "<Ctrl><Shift>c" }),
      action("Copy Page as Markdown", async () => {
        const c = await load();
        await clipboard.write(`# ${p.title}\n\n${c.markdown}\n`);
        return close("Page copied as Markdown");
      }, { icon: Icons.copy, shortcut: "<Ctrl><Shift>m" }),
      copy(mdLink(p), "Copy as Markdown Link", { shortcut: "<Ctrl><Shift>l" }),
    ],
  });
}

export function pageItem(w: Wiki, p: Page, section?: string): Item {
  return {
    id: `${p.wiki}:${p.id}`,
    title: p.title,
    subtitle: p.container,
    icon: WIKI_ICONS[p.wiki],
    section,
    keywords: [WIKIS[p.wiki], p.container ?? "", ...p.tags].filter(Boolean),
    accessories: [
      ...p.tags.slice(0, 2).map((t) => ({ tag: t })),
      ...(p.updated
        ? [{ text: age(p.updated), tooltip: `Updated ${new Date(p.updated).toLocaleString("en-GB")}` }]
        : []),
      { text: WIKIS[p.wiki], icon: WIKI_ICONS[p.wiki] },
    ],
    detail: {
      markdown: `### ${p.title}\n\n${p.excerpt ?? "_No preview: press Enter to read the page._"}`,
      metadata: pageMetadata(p),
    },
    actions: [
      action("Read Page", () => readView(w, p), { icon: Icons.book }),
      open(p.url, `Open in ${WIKIS[p.wiki]}`),
      copy(p.url, "Copy Link", { shortcut: "<Ctrl><Shift>c", section: "Copy" }),
      copy(mdLink(p), "Copy as Markdown Link", { shortcut: "<Ctrl><Shift>l", section: "Copy" }),
      copy(p.title, "Copy Title", { shortcut: "<Ctrl>period", section: "Copy" }),
    ],
  };
}
