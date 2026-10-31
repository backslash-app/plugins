// Org files on disk, Emacs, and headings as launcher items.

import {
  type Accessory,
  type Action,
  action,
  type Color,
  type Context,
  copy,
  Icons,
  type Item,
  meta,
  type Metadata,
  open,
  refresh,
  submenu,
  toast,
} from "@backslash/api";
import {
  type AgendaEntry,
  appendEntry,
  basename,
  captureEntry,
  ChangedError,
  DEFAULT_KEYWORDS,
  dirname,
  escapeMarkdown,
  fileKeywords,
  type Heading,
  isOrgFile,
  type Keywords,
  markDone,
  mergeKeywords,
  orgToMarkdown,
  parseKeywords,
  parseOrg,
  parsePaths,
  replaceHeading,
  setKeywordLine,
  setPriorityLine,
  tildify,
  type Timestamp,
} from "./lib.ts";

export const HOME = Deno.env.get("HOME") ?? "";

/** The folders an extension may read and write, the same list as `[permissions]`. */
export const ALLOWED = [
  "~/org",
  "~/Org",
  "~/Documents/org",
  "~/Documents/Org",
  "~/Dropbox/org",
  "~/Nextcloud/org",
  "~/Sync/org",
  "~/notes",
  "~/Notes",
];

export interface Config {
  paths: string[];
  inbox: string;
  keywords: Keywords;
  lookahead: number;
  closed: boolean;
}

export function config(ctx: Pick<Context, "preferences">): Config {
  const p = ctx.preferences;
  const lookahead = Number(p.lookahead ?? 7);
  return {
    paths: parsePaths(String(p.files || "~/org"), HOME),
    inbox: parsePaths(String(p.inbox || "~/org/inbox.org"), HOME)[0],
    keywords: parseKeywords(String(p.keywords || DEFAULT_KEYWORDS)),
    lookahead: Number.isFinite(lookahead) && lookahead >= 0 ? Math.min(lookahead, 60) : 7,
    closed: p.closed !== false,
  };
}

function explain(e: unknown, path: string): never {
  if (e instanceof Deno.errors.NotCapable || e instanceof Deno.errors.PermissionDenied) {
    throw new Error(
      `${tildify(path, HOME)} is outside the folders Org Mode may use (${ALLOWED.join(", ")}). ` +
        "Move your Org files there, or change them in Settings → Extensions → Org Mode.",
    );
  }
  throw e;
}

/** The .org files of the configured files and folders (folders searched three levels deep). */
export async function orgFiles(paths: string[]): Promise<{ files: string[]; missing: string[] }> {
  const files: string[] = [];
  const missing: string[] = [];
  const walk = async (dir: string, depth: number) => {
    const entries: Deno.DirEntry[] = [];
    for await (const e of Deno.readDir(dir)) entries.push(e);
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const e of entries) {
      if (e.name.startsWith(".")) continue;
      const path = `${dir}/${e.name}`;
      if (e.isFile && isOrgFile(e.name)) files.push(path);
      else if (e.isDirectory && depth < 3 && !["node_modules", "ltximg"].includes(e.name)) await walk(path, depth + 1);
      if (files.length >= 500) return;
    }
  };
  for (const path of paths) {
    try {
      const stat = await Deno.stat(path);
      if (stat.isDirectory) await walk(path, 0);
      else if (!files.includes(path)) files.push(path);
    } catch (e) {
      if (e instanceof Deno.errors.NotFound) missing.push(path);
      else explain(e, path);
    }
  }
  return { files: [...new Set(files)], missing };
}

export async function readText(path: string): Promise<string> {
  try {
    return await Deno.readTextFile(path);
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) return "";
    explain(e, path);
  }
}

async function writeText(path: string, text: string) {
  try {
    await Deno.mkdir(dirname(path), { recursive: true }).catch(() => {});
    await Deno.writeTextFile(path, text);
  } catch (e) {
    explain(e, path);
  }
}

export interface Loaded {
  headings: Heading[];
  files: string[];
  missing: string[];
  /** Keywords of each file (its #+TODO lines and the preferences). */
  keywords: Map<string, Keywords>;
}

export async function load(cfg: Config): Promise<Loaded> {
  const { files, missing } = await orgFiles(cfg.paths);
  const keywords = new Map<string, Keywords>();
  const parsed = await Promise.all(files.map(async (file) => {
    const text = await readText(file);
    keywords.set(file, mergeKeywords(fileKeywords(text) ?? cfg.keywords, cfg.keywords));
    return parseOrg(text, file, cfg.keywords);
  }));
  return { headings: parsed.flat(), files, missing, keywords };
}

/** Changes a file with `edit`, which throws ChangedError when the heading moved. */
async function edit(file: string, change: (text: string) => string) {
  await writeText(file, change(await readText(file)));
}

export async function capture(cfg: Config, input: string, now = new Date()): Promise<string> {
  const entry = captureEntry(input, cfg.keywords, now);
  await edit(cfg.inbox, (text) => appendEntry(text, entry));
  return `Captured to ${tildify(cfg.inbox, HOME)}`;
}

// --- Emacs -------------------------------------------------------------------

/** Opens the file at the line in a running Emacs (emacsclient), or starts Emacs. */
export async function openInEmacs(file: string, line: number) {
  const at = `+${line + 1}`;
  try {
    const out = await new Deno.Command("emacsclient", {
      args: ["--no-wait", "--reuse-frame", at, file],
      stdin: "null",
      stdout: "null",
      stderr: "piped",
    }).output();
    if (out.success) return;
  } catch (e) {
    if (!(e instanceof Deno.errors.NotFound)) throw e;
  }
  // No Emacs server running (or no emacsclient): start Emacs itself.
  try {
    new Deno.Command("emacs", { args: [at, file], stdin: "null", stdout: "null", stderr: "null" }).spawn().unref();
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) throw new Error("Emacs is not installed: install the emacs package");
    throw e;
  }
}

// --- Items -------------------------------------------------------------------

const KEYWORD_COLORS: Record<string, Color> = {
  TODO: "red",
  NEXT: "orange",
  STARTED: "yellow",
  DOING: "yellow",
  INPROGRESS: "yellow",
  WAITING: "purple",
  WAIT: "purple",
  HOLD: "purple",
  SOMEDAY: "gray",
  MAYBE: "gray",
  PROJ: "blue",
  DONE: "green",
  CANCELLED: "gray",
  CANCELED: "gray",
};
export const keywordColor = (k: string, done: boolean): Color => KEYWORD_COLORS[k] ?? (done ? "green" : "blue");

const PRIORITY_COLOR: Record<string, Color> = { A: "red", B: "orange", C: "blue" };

function headingIcon(h: Heading) {
  if (h.done) return { source: Icons.done, tint: "green" as const };
  if (!h.keyword) return { source: Icons.calendar, tint: "blue" as const };
  if (/^(STARTED|DOING|INPROGRESS|NEXT)$/.test(h.keyword)) return { source: Icons.inProgress, tint: "yellow" as const };
  if (/^(WAITING|WAIT|HOLD)$/.test(h.keyword)) return { source: Icons.hourglass, tint: "purple" as const };
  return { source: Icons.todo, tint: h.priority ? PRIORITY_COLOR[h.priority] ?? "gray" : undefined };
}

const longDate = (ts: Timestamp) =>
  ts.date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" }) +
  (ts.time ? `, ${ts.time}${ts.end ? `–${ts.end}` : ""}` : "") +
  (ts.repeater ? ` (repeats ${ts.repeater.kind}${ts.repeater.n}${ts.repeater.unit})` : "");

function metadata(h: Heading, keywords: Keywords): Metadata[] {
  const lines: Metadata[] = [];
  if (h.keyword) lines.push(meta.tags("State", [{ text: h.keyword, color: keywordColor(h.keyword, h.done) }]));
  if (h.priority) {
    lines.push(meta.text("Priority", `[#${h.priority}]`, { icon: Icons.flag, color: PRIORITY_COLOR[h.priority] }));
  }
  if (h.tags.length) lines.push(meta.tags("Tags", h.tags.map((t) => ({ text: `:${t}:`, color: "teal" as const }))));
  if (h.deadline) lines.push(meta.text("Deadline", longDate(h.deadline), { icon: Icons.flag, color: "red" }));
  if (h.scheduled) lines.push(meta.text("Scheduled", longDate(h.scheduled), { icon: Icons.calendar }));
  for (const ts of h.timestamps.slice(0, 3)) lines.push(meta.text("When", longDate(ts), { icon: Icons.clock }));
  if (h.closed) lines.push(meta.text("Closed", longDate(h.closed), { icon: Icons.done, color: "green" }));
  lines.push(meta.separator());
  lines.push(meta.text("File", tildify(h.file, HOME), { icon: Icons.file }));
  lines.push(meta.text("Line", h.line + 1));
  if (keywords.todo.length) {
    lines.push(meta.text("Keywords", `${keywords.todo.join(" ")} | ${keywords.done.join(" ")}`));
  }
  return lines;
}

function markdown(h: Heading): string {
  const crumbs = [basename(h.file).replace(/\.org$/, ""), ...h.path].map(escapeMarkdown).join(" › ");
  const body = orgToMarkdown(h.body);
  return [`_${crumbs}_`, "", `### ${escapeMarkdown(h.title)}`, ...(body ? ["", body] : [])].join("\n");
}

export interface ItemOptions {
  cfg: Config;
  keywords: Keywords;
  entry?: AgendaEntry;
  now: Date;
}

export function headingItem(h: Heading, o: ItemOptions): Item {
  const { keywords, entry } = o;
  const doneKeyword = keywords.done[0] ?? "DONE";
  const write = (change: (text: string) => string, message: string) => async () => {
    try {
      await edit(h.file, change);
    } catch (e) {
      if (e instanceof ChangedError) {
        await toast(e.message, { style: "failure" });
        return refresh();
      }
      throw e;
    }
    await toast(message, { style: "success" });
    return refresh();
  };
  const emacs = action("Open in Emacs", async () => {
    await openInEmacs(h.file, h.line);
  }, { icon: Icons.code, shortcut: "<Ctrl>o" });
  const done = action(`Mark ${doneKeyword}`, async () => {
    let repeated: string | undefined;
    try {
      await edit(h.file, (text) => {
        const r = markDone(text, h, doneKeyword, new Date(), { closed: o.cfg.closed });
        repeated = r.repeatedTo;
        return r.text;
      });
    } catch (e) {
      if (!(e instanceof ChangedError)) throw e;
      await toast(e.message, { style: "failure" });
      return refresh();
    }
    await toast(repeated ? `Done, next on ${repeated.slice(1, -1)}` : `${doneKeyword}: ${h.title}`, {
      style: "success",
    });
    return refresh();
  }, { icon: Icons.done });
  const actions: Action[] = [];
  if (h.keyword && !h.done) actions.push(done, emacs);
  else actions.push(emacs);
  actions.push(
    submenu("Set State", [
      ...[...keywords.todo, ...keywords.done].filter((k) => k !== h.keyword).map((k) =>
        action(k, write((text) => replaceHeading(text, h, setKeywordLine(h.raw, h.keyword, k)), `Now ${k}`), {
          icon: keywords.done.includes(k) ? Icons.done : Icons.todo,
        })
      ),
      ...(h.keyword
        ? [
          action(
            "No Keyword",
            write((text) => replaceHeading(text, h, setKeywordLine(h.raw, h.keyword, undefined)), "Keyword removed"),
            { icon: Icons.cross },
          ),
        ]
        : []),
    ], { icon: Icons.cycle, shortcut: "<Ctrl>t" }),
    submenu("Set Priority", [
      ...["A", "B", "C"].map((p) =>
        action(
          `[#${p}]`,
          write((text) => replaceHeading(text, h, setPriorityLine(h.raw, h.keyword, p)), `Priority ${p}`),
          {
            icon: p === "A" ? Icons.high : p === "B" ? Icons.medium : Icons.low,
          },
        )
      ),
      action(
        "None",
        write((text) => replaceHeading(text, h, setPriorityLine(h.raw, h.keyword, undefined)), "Priority removed"),
        {
          icon: Icons.noPriority,
        },
      ),
    ], { icon: Icons.flag, shortcut: "<Ctrl><Shift>p" }),
    copy(h.title, "Copy Title", { shortcut: "<Ctrl><Shift>c", section: "Copy" }),
    copy(`[[file:${tildify(h.file, HOME)}::*${h.title}][${h.title}]]`, "Copy Org Link", { section: "Copy" }),
    open(h.file, "Open File", { icon: Icons.file, section: "File" }),
  );

  const accessories: Accessory[] = [];
  if (h.keyword) accessories.push({ tag: h.keyword, color: keywordColor(h.keyword, h.done) });
  if (h.priority) accessories.push({ tag: `#${h.priority}`, color: PRIORITY_COLOR[h.priority] ?? "gray" });
  accessories.push(...h.tags.slice(0, 3).map((t) => ({ tag: t, color: "teal" as const })));
  if (entry) {
    accessories.push({
      icon: entry.kind === "deadline" ? Icons.flag : entry.kind === "scheduled" ? Icons.calendar : Icons.clock,
      text: entry.label,
      color: entry.section === "Overdue" ? "red" : entry.kind === "deadline" && entry.days <= 1 ? "orange" : undefined,
    });
  } else if (h.deadline) {
    accessories.push({ icon: Icons.flag, text: h.deadline.raw.slice(1, 11), tooltip: "Deadline" });
  } else if (h.scheduled) {
    accessories.push({ icon: Icons.calendar, text: h.scheduled.raw.slice(1, 11), tooltip: "Scheduled" });
  }
  return {
    id: `${h.file}:${h.raw}`,
    title: h.title || "(untitled)",
    subtitle: [basename(h.file).replace(/\.org$/, ""), ...h.path.slice(-1)].join(" › "),
    icon: headingIcon(h),
    section: entry?.section,
    keywords: [...(h.keyword ? [h.keyword] : []), ...h.tags, ...h.path],
    accessories,
    detail: { markdown: markdown(h), metadata: metadata(h, keywords) },
    actions,
  };
}
