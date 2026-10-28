// Logseq graphs on disk, and their pages and blocks as launcher items.

import {
  type Action,
  action,
  clipboard,
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
} from "@backslash/api";
import {
  ago,
  appendBlock,
  backlinkCounts,
  type Block,
  blockUri,
  type Config,
  formatDate,
  type Graph,
  graphFromCacheFile,
  listProperty,
  type Page,
  pageKey,
  pageNameFromFile,
  pageUri,
  parseConfig,
  parseJournalFile,
  parsePage,
  plain,
  previewMarkdown,
  taskMarker,
  wordCount,
} from "./lib.ts";

export const HOME = Deno.env.get("HOME") ?? "";
export const tildify = (p: string) => (HOME && p.startsWith(`${HOME}/`) ? `~${p.slice(HOME.length)}` : p);
const expand = (p: string) => (p === "~" ? HOME : p.startsWith("~/") ? `${HOME}${p.slice(1)}` : p);

const isDir = (p: string) => Deno.stat(p).then((s) => s.isDirectory, () => false);

/** Graphs Logseq knows (its cache in ~/.logseq/graphs), plus a folder set in the preferences; most recently used first. */
export async function loadGraphs(ctx: Pick<Context, "preferences">): Promise<Graph[]> {
  const found: Graph[] = [];
  try {
    for await (const e of Deno.readDir(`${HOME}/.logseq/graphs`)) {
      const g = e.isFile ? graphFromCacheFile(e.name) : undefined;
      if (!g) continue;
      const stat = await Deno.stat(`${HOME}/.logseq/graphs/${e.name}`).catch(() => undefined);
      found.push({ ...g, used: stat?.mtime?.getTime() });
    }
  } catch { /* Logseq never ran */ }
  const pref = String(ctx.preferences.graph ?? "").trim();
  if (pref.includes("/")) {
    const path = expand(pref).replace(/\/+$/, "");
    if (!found.some((g) => g.path === path)) found.push({ name: path.split("/").pop()!, path, used: Infinity });
  }
  const present = await Promise.all(found.map((g) => isDir(g.path)));
  return found.filter((_, i) => present[i]).sort((a, b) => (b.used ?? 0) - (a.used ?? 0));
}

/** The graph for the journal and captures: the preference (a name or a folder), else the one used last. */
export function pickGraph(graphs: Graph[], ctx: Pick<Context, "preferences">): Graph | undefined {
  const pref = String(ctx.preferences.graph ?? "").trim();
  if (pref) {
    const path = expand(pref).replace(/\/+$/, "");
    const hit = graphs.find((g) => g.path === path || g.name.toLowerCase() === pref.toLowerCase());
    if (hit) return hit;
  }
  return graphs[0];
}

export async function graphConfig(g: Graph): Promise<Config> {
  return parseConfig(await Deno.readTextFile(`${g.path}/logseq/config.edn`).catch(() => undefined));
}

export interface PageFile {
  graph: Graph;
  name: string;
  /** Relative to the graph. */
  file: string;
  journal?: Date;
  page: Page;
  modified: number;
  tags: string[];
  aliases: string[];
  backlinks: number;
}

const MAX_FILE = 2 * 1024 * 1024;

async function mdFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  try {
    for await (const e of Deno.readDir(dir)) if (e.isFile && /\.md$/i.test(e.name)) out.push(e.name);
  } catch { /* missing folder */ }
  return out;
}

const cache = new Map<string, { at: number; pages: Promise<PageFile[]> }>();

export const clearIndex = () => cache.clear();

/** Every page and journal of a graph, read once per minute at most. */
export function indexGraph(g: Graph, maxAge = 60_000): Promise<PageFile[]> {
  const hit = cache.get(g.path);
  if (hit && Date.now() - hit.at < maxAge) return hit.pages;
  const pages = (async () => {
    const config = await graphConfig(g);
    const files = [
      ...(await mdFiles(`${g.path}/${config.pagesDir}`)).map((f) => ({ dir: config.pagesDir, f, journal: false })),
      ...(await mdFiles(`${g.path}/${config.journalsDir}`)).map((f) => ({ dir: config.journalsDir, f, journal: true })),
    ];
    const out: PageFile[] = [];
    for (let i = 0; i < files.length; i += 64) {
      const batch = await Promise.all(
        files.slice(i, i + 64).map(async ({ dir, f, journal }) => {
          const full = `${g.path}/${dir}/${f}`;
          try {
            const stat = await Deno.stat(full);
            const page = parsePage(stat.size > MAX_FILE ? "" : await Deno.readTextFile(full));
            const base = f.replace(/\.md$/i, "");
            const date = journal ? parseJournalFile(base, config.journalFile) : undefined;
            const name = page.properties.title ??
              (date ? formatDate(config.journalTitle, date) : pageNameFromFile(base, config.tripleLowbar));
            return {
              graph: g,
              name,
              file: `${dir}/${f}`,
              journal: date,
              page,
              modified: stat.mtime?.getTime() ?? 0,
              tags: listProperty(page.properties.tags),
              aliases: listProperty(page.properties.alias),
              backlinks: 0,
            } satisfies PageFile;
          } catch {
            return undefined;
          }
        }),
      );
      for (const p of batch) if (p) out.push(p);
    }
    const counts = backlinkCounts(out.map((p) => ({ name: p.name, page: p.page, aliases: p.aliases })));
    for (const p of out) p.backlinks = counts.get(pageKey(p.name)) ?? 0;
    return out;
  })();
  cache.set(g.path, { at: Date.now(), pages });
  pages.catch(() => cache.delete(g.path));
  return pages;
}

// --- Today's journal ------------------------------------------------------------

export async function todayJournal(g: Graph, now = new Date()) {
  const config = await graphConfig(g);
  const ext = config.org ? "org" : "md";
  const file = `${g.path}/${config.journalsDir}/${formatDate(config.journalFile, now)}.${ext}`;
  const title = formatDate(config.journalTitle, now);
  const exists = await Deno.stat(file).then(() => true, () => false);
  return { file, title, exists, config, uri: pageUri(g.name, title) };
}

export async function openToday(ctx: Pick<Context, "preferences">): Promise<string> {
  const g = pickGraph(await loadGraphs(ctx), ctx);
  if (!g) throw new Error("No Logseq graph found: open a folder in Logseq once, or set one in the preferences");
  const j = await todayJournal(g);
  await openExternal(j.uri);
  return `${j.title} · ${g.name}`;
}

/** Folders dedicated to Logseq, where `[permissions] write` lets captures go (graphs in them or below). */
export const WRITABLE = ["~/Logseq", "~/logseq", "~/Documents/Logseq", "~/Documents/logseq"];

export async function capture(ctx: Pick<Context, "preferences">, text: string, now = new Date()): Promise<string> {
  const g = pickGraph(await loadGraphs(ctx), ctx);
  if (!g) throw new Error("No Logseq graph found: open a folder in Logseq once, or set one in the preferences");
  const j = await todayJournal(g, now);
  const p2 = (n: number) => String(n).padStart(2, "0");
  const time = ctx.preferences.timestamp === true ? `${p2(now.getHours())}:${p2(now.getMinutes())}` : undefined;
  try {
    const content = j.exists ? await Deno.readTextFile(j.file) : "";
    await Deno.mkdir(j.file.replace(/\/[^/]+$/, ""), { recursive: true });
    await Deno.writeTextFile(j.file, appendBlock(content, text, { org: j.config.org, time }));
    cache.delete(g.path);
    return `Added to ${j.title} · ${g.name}`;
  } catch (e) {
    if (!(e instanceof Deno.errors.NotCapable || e instanceof Deno.errors.PermissionDenied)) throw e;
    // The graph is elsewhere: hand the block over through Logseq itself.
    await clipboard.write(time ? `${time} ${text}` : text);
    await openExternal(j.uri);
    return `Copied: paste it in today's journal (Backslash may only write in ${WRITABLE.join(", ")})`;
  }
}

// --- Items --------------------------------------------------------------------

const when = (ms: number) => new Date(ms).toLocaleString("en", { dateStyle: "medium", timeStyle: "short" });

function propertyLines(props: Record<string, string>): Metadata[] {
  return Object.entries(props)
    .filter(([k]) => !["tags", "alias", "title", "id", "collapsed", "filters", "public", "icon"].includes(k))
    .slice(0, 8)
    .map(([k, v]) => {
      const list = listProperty(v);
      return v.includes("[[") || (v.includes(",") && list.length > 1)
        ? meta.tags(k, list.slice(0, 6).map((t) => ({ text: t, color: "teal" as const })))
        : meta.text(k, v.length > 60 ? `${v.slice(0, 59)}…` : v);
    });
}

export function pageMetadata(p: PageFile, several: boolean): Metadata[] {
  const lines: Metadata[] = [];
  if (several) lines.push(meta.text("Graph", p.graph.name, { icon: Icons.layers, color: "teal" }));
  lines.push(meta.text("Type", p.journal ? "Journal" : "Page", { icon: p.journal ? Icons.calendar : Icons.note }));
  if (p.tags.length) {
    lines.push(meta.tags("Tags", p.tags.slice(0, 8).map((t) => ({ text: `#${t}`, color: "teal" as const }))));
  }
  if (p.aliases.length) lines.push(meta.tags("Aliases", p.aliases.slice(0, 6)));
  lines.push(...propertyLines(p.page.properties));
  lines.push(meta.separator());
  lines.push(meta.text("Backlinks", p.backlinks, { icon: Icons.link, color: p.backlinks ? "teal" : undefined }));
  lines.push(meta.text("Blocks", p.page.blocks.length, { icon: Icons.layers }));
  lines.push(meta.text("Words", wordCount(p.page)));
  lines.push(meta.text("Modified", when(p.modified), { icon: Icons.clock }));
  lines.push(meta.text("File", p.file, { icon: Icons.file }));
  return lines;
}

function pageActions(p: PageFile, several: boolean, o: { page?: boolean } = {}): Action[] {
  const uri = pageUri(p.graph.name, p.name);
  const full = `${p.graph.path}/${p.file}`;
  return [
    open(uri, "Open in Logseq", { icon: Icons.external }),
    ...(o.page ? [] : [action("View Page", () => pagePage(p, several), { icon: Icons.eye, shortcut: "<Ctrl>o" })]),
    copy(`[[${p.name}]]`, "Copy Page Reference", { shortcut: "<Ctrl><Shift>c", section: "Copy" }),
    paste(`[[${p.name}]]`, "Paste Page Reference", { shortcut: "<Ctrl><Shift>v", section: "Copy" }),
    copy(uri, "Copy Logseq URL", { icon: Icons.link, section: "Copy" }),
    copy(full, "Copy File Path", { section: "Copy" }),
    open(full, "Open File in Default App", { icon: Icons.file, section: "Open" }),
    open(full.replace(/\/[^/]+$/, ""), "Show in Folder", { icon: Icons.folder, section: "Open" }),
  ];
}

export function pagePage(p: PageFile, several: boolean): DetailSpec {
  return detail({
    title: p.name,
    markdown: `# ${p.name}\n\n${previewMarkdown(p.page, 30_000) || "*Empty page*"}`,
    metadata: pageMetadata(p, several),
    status: `${p.graph.name} · ${p.page.blocks.length} blocks · ${p.backlinks} backlink${p.backlinks === 1 ? "" : "s"}`,
    actions: pageActions(p, several, { page: true }),
  });
}

export function pageItem(p: PageFile, o: { several: boolean; section?: string }): Item {
  const first = p.page.blocks.find((b) => b.content)?.content;
  return {
    id: `${p.graph.path}/${p.file}`,
    title: p.name,
    subtitle: first ? plain(first.split("\n")[0]).slice(0, 100) : undefined,
    icon: { source: p.journal ? Icons.calendar : Icons.note, tint: "teal" },
    section: o.section,
    accessories: [
      ...p.tags.slice(0, 2).map((t) => ({ tag: `#${t}`, color: "teal" as const })),
      ...(p.backlinks ? [{ icon: Icons.link, text: String(p.backlinks), tooltip: `${p.backlinks} backlinks` }] : []),
      ...(o.several ? [{ text: p.graph.name }] : []),
      { text: ago(p.modified), tooltip: `Modified ${when(p.modified)}` },
    ],
    detail: { markdown: previewMarkdown(p.page, 3000) || "*Empty page*", metadata: pageMetadata(p, o.several) },
    actions: pageActions(p, o.several),
  };
}

export function blockItem(p: PageFile, b: Block, o: { several: boolean }): Item {
  const marker = taskMarker(b.content);
  const text = plain(b.content.split("\n")[0]) || plain(b.content);
  const uri = b.id ? blockUri(p.graph.name, b.id) : pageUri(p.graph.name, p.name);
  return {
    id: `${p.graph.path}/${p.file}#${b.id ?? text.slice(0, 40)}`,
    title: text.slice(0, 120),
    subtitle: p.name,
    icon: marker
      ? { source: marker === "DONE" ? Icons.squareCheck : Icons.square, tint: marker === "DONE" ? "green" : "orange" }
      : { source: Icons.dot, tint: "teal" },
    section: "Blocks",
    accessories: [...(marker ? [{ tag: marker }] : []), ...(o.several ? [{ text: p.graph.name }] : [])],
    detail: {
      markdown: previewMarkdown({ properties: {}, blocks: [{ ...b, depth: 0 }] }, 3000),
      metadata: [
        meta.text("Page", p.name, { icon: p.journal ? Icons.calendar : Icons.note, color: "teal" }),
        ...(o.several ? [meta.text("Graph", p.graph.name, { icon: Icons.layers })] : []),
        ...propertyLines(b.properties),
        meta.text("Modified", when(p.modified), { icon: Icons.clock }),
      ],
    },
    actions: [
      open(uri, b.id ? "Open Block in Logseq" : "Open Page in Logseq", { icon: Icons.external }),
      ...(b.id ? [open(pageUri(p.graph.name, p.name), "Open Page in Logseq", { icon: Icons.note })] : []),
      action("View Page", () => pagePage(p, o.several), { icon: Icons.eye, shortcut: "<Ctrl>o" }),
      copy(b.content, "Copy Block", { shortcut: "<Ctrl><Shift>c", section: "Copy" }),
      ...(b.id
        ? [
          copy(`((${b.id}))`, "Copy Block Reference", { section: "Copy" }),
          paste(`((${b.id}))`, "Paste Block Reference", { shortcut: "<Ctrl><Shift>v", section: "Copy" }),
        ]
        : []),
      copy(`[[${p.name}]]`, "Copy Page Reference", { section: "Copy" }),
    ],
  };
}

export const NO_GRAPH = {
  title: "No Logseq graph found",
  description:
    "Open a folder in Logseq once (it is listed in ~/.logseq/graphs), or set a graph folder in Settings → Extensions → Logseq.",
  icon: Icons.layers,
};
