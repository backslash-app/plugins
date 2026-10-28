// Reads vaults from disk and turns notes into launcher items.

import {
  type Action,
  action,
  copy,
  detail,
  type DetailSpec,
  Icons,
  type Item,
  meta,
  type Metadata,
  open,
  paste,
} from "@backslash/api";
import {
  ago,
  backlinkCounts,
  basename,
  CONFIG_PATHS,
  type DailyConfig,
  dailyNotePath,
  dirname,
  firstLine,
  type Frontmatter,
  linkTargets,
  mergeVaults,
  noteAliases,
  noteTags,
  obsidianUri,
  openUri,
  parseDailyConfig,
  parseVaults,
  previewMarkdown,
  skipDir,
  splitFrontmatter,
  stripMd,
  type Vault,
  wordCount,
} from "./lib.ts";

export const HOME = Deno.env.get("HOME") ?? "";

export const tildify = (p: string) => (HOME && p.startsWith(`${HOME}/`) ? `~${p.slice(HOME.length)}` : p);

export async function loadVaults(): Promise<Vault[]> {
  const lists = await Promise.all(CONFIG_PATHS.map(async (rel) => {
    try {
      return parseVaults(await Deno.readTextFile(`${HOME}/${rel}`));
    } catch {
      return [];
    }
  }));
  // Vaults that were deleted or moved stay in obsidian.json: keep the ones on disk.
  const all = mergeVaults(lists);
  const present = await Promise.all(all.map((v) => Deno.stat(v.path).then((s) => s.isDirectory, () => false)));
  return all.filter((_, i) => present[i]);
}

export interface NoteFile {
  vault: Vault;
  /** Relative to the vault, with `.md`. */
  path: string;
  title: string;
  modified: number;
  created: number;
  size: number;
  body: string;
  frontmatter: Frontmatter;
  tags: string[];
  aliases: string[];
  links: string[];
  backlinks: number;
}

const MAX_FILE = 2 * 1024 * 1024;
const MAX_NOTES = 20_000;

async function walk(root: string, rel = "", out: string[] = [], depth = 0): Promise<string[]> {
  if (depth > 24 || out.length >= MAX_NOTES) return out;
  let entries: Deno.DirEntry[];
  try {
    entries = await Array.fromAsync(Deno.readDir(rel ? `${root}/${rel}` : root));
  } catch {
    return out;
  }
  for (const e of entries) {
    const path = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory && !skipDir(e.name)) await walk(root, path, out, depth + 1);
    else if (e.isFile && /\.md$/i.test(e.name)) out.push(path);
  }
  return out;
}

// One index per vault for the life of the command: searching as you type
// must not read thousands of files on each keystroke.
const cache = new Map<string, { at: number; notes: Promise<NoteFile[]> }>();

export function indexVault(vault: Vault, maxAge = 60_000): Promise<NoteFile[]> {
  const hit = cache.get(vault.path);
  if (hit && Date.now() - hit.at < maxAge) return hit.notes;
  const notes = (async () => {
    const paths = await walk(vault.path);
    const out: NoteFile[] = [];
    for (let i = 0; i < paths.length; i += 64) {
      const batch = await Promise.all(
        paths.slice(i, i + 64).map(async (path) => {
          const full = `${vault.path}/${path}`;
          try {
            const stat = await Deno.stat(full);
            const text = stat.size > MAX_FILE ? "" : await Deno.readTextFile(full);
            const { frontmatter, body } = splitFrontmatter(text);
            return {
              vault,
              path,
              title: basename(stripMd(path)),
              modified: stat.mtime?.getTime() ?? 0,
              created: stat.birthtime?.getTime() ?? 0,
              size: stat.size,
              body,
              frontmatter,
              tags: noteTags(frontmatter, body),
              aliases: noteAliases(frontmatter),
              links: linkTargets(body),
              backlinks: 0,
            } satisfies NoteFile;
          } catch {
            return undefined;
          }
        }),
      );
      for (const n of batch) if (n) out.push(n);
    }
    const counts = backlinkCounts(out);
    for (const n of out) n.backlinks = counts.get(n.path) ?? 0;
    return out;
  })();
  cache.set(vault.path, { at: Date.now(), notes });
  notes.catch(() => cache.delete(vault.path));
  return notes;
}

export async function dailyConfig(vault: Vault): Promise<DailyConfig> {
  const text = await Deno.readTextFile(`${vault.path}/.obsidian/daily-notes.json`).catch(() => undefined);
  return parseDailyConfig(text);
}

export async function todayNote(vault: Vault, now = new Date()): Promise<{ path: string; exists: boolean }> {
  const path = dailyNotePath(await dailyConfig(vault), now);
  const exists = await Deno.stat(`${vault.path}/${path}`).then(() => true, () => false);
  return { path, exists };
}

// --- Items -------------------------------------------------------------------

const when = (ms: number) => new Date(ms).toLocaleString("en", { dateStyle: "medium", timeStyle: "short" });

/** Frontmatter lines worth showing, besides tags and aliases. */
function frontmatterLines(fm: Frontmatter): Metadata[] {
  return Object.entries(fm.fields)
    .filter(([k]) => !/^(tags?|aliases?|cssclass(es)?|position)$/i.test(k))
    .slice(0, 6)
    .map(([k, v]) =>
      Array.isArray(v) ? meta.tags(k, v.slice(0, 6)) : meta.text(k, v.length > 60 ? `${v.slice(0, 60)}…` : v)
    );
}

export function noteMetadata(n: NoteFile, several: boolean): Metadata[] {
  const lines: Metadata[] = [];
  if (several) lines.push(meta.text("Vault", n.vault.name, { icon: Icons.archive, color: "purple" }));
  const folder = dirname(n.path);
  lines.push(meta.text("Folder", folder || "/", { icon: Icons.folder }));
  if (n.tags.length) {
    lines.push(meta.tags("Tags", n.tags.slice(0, 8).map((t) => ({ text: `#${t}`, color: "purple" as const }))));
  }
  if (n.aliases.length) lines.push(meta.tags("Aliases", n.aliases.slice(0, 6)));
  lines.push(...frontmatterLines(n.frontmatter));
  lines.push(meta.separator());
  lines.push(meta.text("Backlinks", n.backlinks, { icon: Icons.link, color: n.backlinks ? "purple" : undefined }));
  lines.push(meta.text("Links", n.links.length, { icon: Icons.arrowRight }));
  lines.push(meta.text("Words", wordCount(n.body)));
  lines.push(meta.text("Modified", when(n.modified), { icon: Icons.clock }));
  if (n.created && Math.abs(n.created - n.modified) > 60_000) {
    lines.push(meta.text("Created", when(n.created), { icon: Icons.calendar }));
  }
  return lines;
}

export function noteActions(n: NoteFile, several: boolean, o: { page?: boolean } = {}): Action[] {
  const full = `${n.vault.path}/${n.path}`;
  const uri = openUri(n.vault.name, n.path);
  const text = n.body.trim();
  return [
    open(uri, "Open in Obsidian", { icon: Icons.external }),
    ...(o.page ? [] : [action("View Note", () => notePage(n, several), { icon: Icons.eye, shortcut: "<Ctrl>o" })]),
    open(obsidianUri("open", { vault: n.vault.name, file: stripMd(n.path), paneType: "tab" }), "Open in New Tab", {
      icon: Icons.window,
      shortcut: "<Ctrl>t",
      section: "Open",
    }),
    open(full, "Open in Default App", { icon: Icons.file, section: "Open" }),
    open(`${n.vault.path}/${dirname(n.path)}`.replace(/\/$/, ""), "Show in Folder", {
      icon: Icons.folder,
      section: "Open",
    }),
    copy(`[[${n.title}]]`, "Copy Wikilink", { shortcut: "<Ctrl><Shift>c", section: "Copy" }),
    copy(uri, "Copy Obsidian URL", { icon: Icons.link, section: "Copy" }),
    copy(text, "Copy Content", { section: "Copy" }),
    paste(text, "Paste Content", { shortcut: "<Ctrl><Shift>v", section: "Copy" }),
    copy(full, "Copy File Path", { section: "Copy" }),
  ];
}

export function notePage(n: NoteFile, several: boolean): DetailSpec {
  return detail({
    title: n.title,
    markdown: `# ${n.title}\n\n${previewMarkdown(n.body, 20_000)}`,
    metadata: noteMetadata(n, several),
    status: `${n.vault.name} · ${wordCount(n.body)} words · ${n.backlinks} backlink${n.backlinks === 1 ? "" : "s"}`,
    actions: noteActions(n, several, { page: true }),
  });
}

export function noteItem(n: NoteFile, o: { several: boolean; section?: string; subtitle?: string }): Item {
  const folder = dirname(n.path);
  return {
    id: `${n.vault.path}/${n.path}`,
    title: n.title,
    subtitle: o.subtitle ?? (firstLine(n.body) || folder || undefined),
    icon: { source: Icons.note, tint: "purple" },
    section: o.section,
    accessories: [
      ...n.tags.slice(0, 2).map((t) => ({ tag: `#${t}`, color: "purple" as const })),
      ...(n.backlinks ? [{ icon: Icons.link, text: String(n.backlinks), tooltip: `${n.backlinks} backlinks` }] : []),
      ...(o.several ? [{ text: n.vault.name }] : folder ? [{ text: folder, tooltip: "Folder" }] : []),
      { text: ago(n.modified), tooltip: `Modified ${when(n.modified)}` },
    ],
    detail: {
      markdown: previewMarkdown(n.body, 3000),
      metadata: noteMetadata(n, o.several),
    },
    actions: noteActions(n, o.several),
  };
}

export const NO_VAULT = {
  title: "No Obsidian vault found",
  description: `Open a vault in Obsidian once: it is listed in ${
    tildify(`${HOME}/${CONFIG_PATHS[0]}`)
  } (or the Flatpak config).`,
  icon: Icons.archive,
};
