import { action, type Context, Icons, list, open } from "@backslash/api";
import { ageSection, checklist, sortNotes, tildify, titleFromText } from "../lib.ts";
import { HOME, live, loadNotes, noteForm, noteItem, notesDir, pinnedFiles } from "../notes.ts";

let total = 0;
let pins = 0;

export default (ctx: Context) => {
  const dir = notesDir(ctx);
  const newNote = action("New Note", () => noteForm(dir, { title: ctx.query ? titleFromText(ctx.query) : "" }), {
    icon: Icons.plus,
    shortcut: "<Ctrl>n",
  });
  return list({
    placeholder: "Search notes by title, text or #tag…",
    filter: {
      options: [
        { value: "all", title: "All Notes" },
        { value: "pinned", title: "Pinned" },
        { value: "tasks", title: "Checklists" },
      ],
    },
    empty: {
      title: "No notes yet",
      description: `Press Ctrl+N to write one. Notes are markdown files in ${tildify(dir, HOME)}.`,
      icon: Icons.note,
    },
    actions: [newNote, open(dir, "Show Notes Folder", { icon: Icons.folder })],
    status: (items) =>
      `${items.length === total ? total : `${items.length} of ${total}`} note${total === 1 ? "" : "s"}${
        pins ? ` · ${pins} pinned` : ""
      } · ${tildify(dir, HOME)}`,
    // Reloads after an edit, a pin or a deletion made from this list.
    items: ({ signal, filter }) =>
      live(async () => {
        const [notes, pinned] = await Promise.all([loadNotes(dir), pinnedFiles()]);
        total = notes.length;
        pins = notes.filter((n) => pinned.includes(n.file)).length;
        let shown = sortNotes(notes, pinned);
        if (filter === "pinned") shown = shown.filter((n) => pinned.includes(n.file));
        if (filter === "tasks") shown = shown.filter((n) => checklist(n.body).total > 0);
        return shown.map((n) => {
          const isPinned = pinned.includes(n.file);
          return noteItem(n, dir, isPinned, isPinned ? "Pinned" : ageSection(n.modified));
        });
      }, signal),
  });
};
