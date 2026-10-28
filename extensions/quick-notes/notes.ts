// Reading and writing the notes folder, and the notes as launcher items.

import {
  type Action,
  action,
  close,
  type Context,
  copy,
  detail,
  type DetailSpec,
  field,
  form,
  type FormSpec,
  Icons,
  type Item,
  meta,
  type Metadata,
  open,
  paste,
  pop,
  storage,
  toast,
} from "@backslash/api";
import {
  ago,
  checklist,
  expandHome,
  fileNameFor,
  firstLine,
  type Note,
  parseNote,
  preview,
  serialize,
  tildify,
  uniqueFileName,
  wordCount,
} from "./lib.ts";

export const HOME = Deno.env.get("HOME") ?? "";
export const DEFAULT_FOLDER = "~/Documents/Notes";

export function notesDir(ctx: Pick<Context, "preferences">): string {
  const raw = String(ctx.preferences.folder ?? "").trim() || DEFAULT_FOLDER;
  return expandHome(raw, HOME).replace(/\/+$/, "");
}

function denied(dir: string): Error {
  return new Error(
    `Quick Notes may only use folders inside ~/Documents; ${tildify(dir, HOME)} is outside. ` +
      "Change the folder in Settings → Extensions → Quick Notes.",
  );
}

export async function loadNotes(dir: string): Promise<Note[]> {
  const notes: Note[] = [];
  try {
    for await (const e of Deno.readDir(dir)) {
      if (!e.isFile || !/\.md$/i.test(e.name) || e.name.startsWith(".")) continue;
      const path = `${dir}/${e.name}`;
      try {
        const [text, stat] = await Promise.all([Deno.readTextFile(path), Deno.stat(path)]);
        notes.push(parseNote(e.name, text, stat.mtime?.getTime() ?? 0, stat.birthtime?.getTime() ?? 0));
      } catch { /* unreadable file: skipped */ }
    }
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) return [];
    if (e instanceof Deno.errors.NotCapable || e instanceof Deno.errors.PermissionDenied) throw denied(dir);
    throw e;
  }
  return notes;
}

/** Writes a note, renaming its file when the title changed. Returns the file name. */
export async function saveNote(
  dir: string,
  values: { title: string; body: string },
  previous?: Note,
): Promise<string> {
  try {
    await Deno.mkdir(dir, { recursive: true });
    const taken: string[] = [];
    for await (const e of Deno.readDir(dir)) taken.push(e.name);
    const wanted = fileNameFor(values.title.trim() || firstLine(values.body) || "Untitled");
    const file = previous && previous.file.toLowerCase() === wanted.toLowerCase()
      ? previous.file
      : uniqueFileName(wanted, taken, previous?.file);
    await Deno.writeTextFile(`${dir}/${file}`, serialize({ frontmatter: previous?.frontmatter, body: values.body }));
    if (previous && previous.file !== file) {
      await Deno.remove(`${dir}/${previous.file}`).catch(() => {});
      await renamePinned(previous.file, file);
    }
    notifyChanged();
    return file;
  } catch (e) {
    if (e instanceof Deno.errors.NotCapable || e instanceof Deno.errors.PermissionDenied) throw denied(dir);
    throw e;
  }
}

export async function deleteNote(dir: string, note: Note): Promise<void> {
  await Deno.remove(`${dir}/${note.file}`);
  await setPinned(note.file, false);
  notifyChanged();
}

// --- Pins (kept in storage: the files stay untouched) ------------------------

export async function pinnedFiles(): Promise<string[]> {
  const p = await storage.get<string[]>("pinned").catch(() => undefined);
  return Array.isArray(p) ? p : [];
}

export async function setPinned(file: string, on: boolean): Promise<void> {
  const all = (await pinnedFiles()).filter((f) => f !== file);
  await storage.set("pinned", on ? [...all, file] : all);
  notifyChanged();
}

async function renamePinned(from: string, to: string) {
  const all = await pinnedFiles();
  if (all.includes(from)) await storage.set("pinned", all.map((f) => (f === from ? to : f)));
}

// --- Live reload: views of this command share one process -------------------

const changes = new EventTarget();

export function notifyChanged() {
  changes.dispatchEvent(new Event("change"));
}

/** Yields `load()`, then again after each change, until `signal` aborts. */
export async function* live<T>(load: () => Promise<T>, signal: AbortSignal): AsyncGenerator<T> {
  while (!signal.aborted) {
    yield await load();
    await new Promise<void>((resolve) => {
      const done = () => {
        changes.removeEventListener("change", done);
        signal.removeEventListener("abort", done);
        resolve();
      };
      changes.addEventListener("change", done);
      signal.addEventListener("abort", done);
    });
  }
}

// --- Views -------------------------------------------------------------------

/** `standalone`: the form is the command itself, so saving closes the launcher instead of going back. */
export function noteForm(
  dir: string,
  options: { note?: Note; title?: string; body?: string; standalone?: boolean } = {},
): FormSpec {
  const note = options.note;
  return form({
    title: note ? `Edit “${note.title}”` : "New Note",
    submitTitle: note ? "Save Note" : "Create Note",
    fields: [
      field.text("title", "Title", {
        required: true,
        placeholder: "Groceries, meeting notes, ideas…",
        value: note?.title ?? options.title ?? "",
      }),
      field.textArea("body", "Note", {
        placeholder: "Markdown: **bold**, - [ ] tasks, #tags",
        value: note?.body ?? options.body ?? "",
      }),
    ],
    async submit(values) {
      const title = String(values.title ?? "").trim();
      const body = String(values.body ?? "");
      const file = await saveNote(dir, { title, body }, note);
      await toast(note ? "Note saved" : "Note created", { style: "success", message: file });
      return options.standalone ? close(`Saved “${file.replace(/\.md$/, "")}”`) : pop();
    },
  });
}

function noteMetadata(note: Note, dir: string, pinned: boolean): Metadata[] {
  const tasks = checklist(note.body);
  const lines: Metadata[] = [];
  if (pinned) lines.push(meta.text("Pinned", "Yes", { icon: Icons.pin, color: "yellow" }));
  if (note.tags.length) {
    lines.push(meta.tags("Tags", note.tags.map((t) => ({ text: `#${t}`, color: "blue" as const }))));
  }
  if (tasks.total) {
    lines.push(meta.progress("Checklist", tasks.done / tasks.total, `${tasks.done} of ${tasks.total} done`));
  }
  lines.push(
    meta.text("Modified", new Date(note.modified).toLocaleString("en", { dateStyle: "medium", timeStyle: "short" }), {
      icon: Icons.clock,
    }),
  );
  if (note.created && Math.abs(note.created - note.modified) > 60_000) {
    lines.push(meta.text("Created", new Date(note.created).toLocaleDateString("en", { dateStyle: "medium" }), {
      icon: Icons.calendar,
    }));
  }
  lines.push(meta.separator());
  lines.push(meta.text("Words", wordCount(note.body)));
  lines.push(meta.text("Characters", note.body.trim().length));
  lines.push(meta.link("File", tildify(`${dir}/${note.file}`, HOME), `file://${dir}/${encodeURIComponent(note.file)}`));
  return lines;
}

export function notePage(note: Note, dir: string, pinned: boolean): DetailSpec {
  return detail({
    title: note.title,
    markdown: `# ${note.title}\n\n${note.body.trim() || "_Empty note._"}`,
    metadata: noteMetadata(note, dir, pinned),
    status: `${wordCount(note.body)} words · modified ${ago(note.modified)}`,
    actions: noteActions(note, dir, pinned, { page: true }),
  });
}

export function noteActions(note: Note, dir: string, pinned: boolean, o: { page?: boolean } = {}): Action[] {
  const path = `${dir}/${note.file}`;
  const text = note.body.trim();
  return [
    action("Edit Note", () => noteForm(dir, { note }), { icon: Icons.text, shortcut: "<Ctrl>e" }),
    copy(text, "Copy Note", { shortcut: "<Ctrl><Shift>c" }),
    paste(text, "Paste Note", { shortcut: "<Ctrl><Shift>v" }),
    ...(o.page
      ? []
      : [action("View Note", () => notePage(note, dir, pinned), { icon: Icons.eye, shortcut: "<Ctrl>o" })]),
    action(pinned ? "Unpin Note" : "Pin Note", async () => {
      await setPinned(note.file, !pinned);
      await toast(pinned ? "Unpinned" : "Pinned to the top", { style: "success" });
      return o.page ? pop() : undefined;
    }, { icon: Icons.pin, shortcut: "<Ctrl><Shift>p", section: "Note" }),
    action("New Note", () => noteForm(dir), { icon: Icons.plus, shortcut: "<Ctrl>n", section: "Note" }),
    open(path, "Open in Default App", { icon: Icons.external, section: "Open" }),
    open(dir, "Show Notes Folder", { icon: Icons.folder, section: "Open" }),
    copy(note.title, "Copy Title", { section: "Copy" }),
    copy(`# ${note.title}\n\n${text}`, "Copy as Markdown with Title", { section: "Copy" }),
    copy(path, "Copy File Path", { section: "Copy" }),
    action("Delete Note", async () => {
      await deleteNote(dir, note);
      await toast(`Deleted “${note.title}”`, { style: "success" });
      return o.page ? pop() : undefined;
    }, {
      icon: Icons.trash,
      destructive: true,
      confirm: `Delete “${note.title}”? The file is removed.`,
      section: "Danger",
      shortcut: "<Ctrl>Delete",
    }),
  ];
}

/** Words of the body as search keywords, so filtering finds notes by content. */
function contentKeywords(note: Note, max = 200): string[] {
  const words = new Set<string>();
  for (const w of note.body.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}_-]{2,}/gu) ?? []) {
    words.add(w);
    if (words.size >= max) break;
  }
  return [...words];
}

export function noteItem(note: Note, dir: string, pinned: boolean, section?: string): Item {
  const tasks = checklist(note.body);
  return {
    id: note.file,
    title: note.title,
    subtitle: firstLine(note.body) || undefined,
    icon: pinned ? { source: Icons.pin, tint: "yellow" } : { source: Icons.note, tint: tasks.total ? "green" : "blue" },
    section,
    keywords: [...note.tags.map((t) => `#${t}`), ...contentKeywords(note)],
    accessories: [
      ...note.tags.slice(0, 2).map((t) => ({ tag: `#${t}`, color: "blue" as const })),
      ...(tasks.total
        ? [{
          icon: { source: tasks.done === tasks.total ? Icons.squareCheck : Icons.square, tint: "green" as const },
          text: `${tasks.done}/${tasks.total}`,
          tooltip: "Checklist",
        }]
        : []),
      { text: ago(note.modified), tooltip: new Date(note.modified).toLocaleString() },
    ],
    detail: {
      markdown: preview(note.body),
      metadata: noteMetadata(note, dir, pinned),
    },
    actions: noteActions(note, dir, pinned),
  };
}
