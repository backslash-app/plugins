import {
  type Action,
  action,
  copy,
  field,
  form,
  Icons,
  type Item,
  list,
  meta,
  open,
  paste,
  pop,
  refresh,
  toast,
} from "@backslash/api";
import { json, request, type Server, server, SetupError, setupItem } from "../api.ts";
import { ago, type Note, noteBody, noteSnippet, notesWebUrl, plural, sortNotes } from "../lib.ts";

const API = "/index.php/apps/notes/api/v1/notes";
const MISSING = "The Notes app isn't installed on this Nextcloud";

const changes = new EventTarget();

function noteForm(s: Server, categories: string[], note?: Note) {
  return form({
    title: note ? `Edit ${note.title}` : "New Note",
    submitTitle: note ? "Save" : "Create Note",
    fields: [
      field.text("title", "Title", { placeholder: "Shopping list", value: note?.title ?? "", required: !note }),
      field.text("category", "Category", {
        placeholder: categories.length ? categories.slice(0, 3).join(", ") : "Work, Recipes…",
        value: note?.category ?? "",
      }),
      field.textArea("content", "Text", { placeholder: "Markdown is welcome", value: note ? noteBody(note) : "" }),
    ],
    async submit(v) {
      const title = String(v.title ?? "").trim();
      const body = String(v.content ?? "");
      const payload = {
        title: title || note?.title || "New note",
        category: String(v.category ?? "").trim(),
        // Notes takes the first line as the title.
        content: `${title || note?.title || "New note"}\n${body ? `\n${body}` : ""}`,
      };
      if (note) {
        await json(s, `${API}/${note.id}`, {
          method: "PUT",
          body: payload,
          headers: note.etag ? { "If-Match": `"${note.etag}"` } : {},
          missing: MISSING,
        });
        await toast(`Saved ${payload.title}`, { style: "success" });
      } else {
        await json(s, API, { method: "POST", body: payload, missing: MISSING });
        await toast(`Created ${payload.title}`, { style: "success" });
      }
      changes.dispatchEvent(new Event("change"));
      return pop();
    },
  });
}

function noteItem(s: Server, n: Note, categories: string[]): Item {
  const body = noteBody(n);
  const actions: Action[] = [
    open(notesWebUrl(s.base, n.id), "Open in Nextcloud", { icon: Icons.external }),
    paste(n.content ?? "", "Paste Note", { icon: Icons.paste }),
    copy(n.content ?? "", "Copy Note", { section: "Copy", shortcut: "<Ctrl><Shift>c" }),
    copy(n.title, "Copy Title", { section: "Copy" }),
  ];
  if (!n.readonly) {
    actions.push(
      action("Edit Note", () => noteForm(s, categories, n), { icon: Icons.text, shortcut: "<Ctrl>e", section: "Edit" }),
      action(n.favorite ? "Remove from Favorites" : "Add to Favorites", async () => {
        await json(s, `${API}/${n.id}`, { method: "PUT", body: { favorite: !n.favorite }, missing: MISSING });
        return refresh();
      }, { icon: n.favorite ? Icons.star : Icons.starFilled, shortcut: "<Ctrl>f", section: "Edit" }),
      action("Delete Note", async () => {
        const res = await request(s, `${API}/${n.id}`, { method: "DELETE", missing: MISSING });
        await res.body?.cancel();
        await toast(`Deleted ${n.title}`, { style: "success" });
        return refresh();
      }, {
        icon: Icons.trash,
        section: "Edit",
        destructive: true,
        confirm: `Delete “${n.title}”? It goes to the Nextcloud trash bin`,
        shortcut: "<Ctrl>Delete",
      }),
    );
  }
  return {
    id: String(n.id),
    title: n.title || "Untitled",
    subtitle: noteSnippet(n),
    icon: { source: Icons.note, tint: n.favorite ? "yellow" : "gray" },
    section: n.category || "Notes",
    keywords: [n.category, body.slice(0, 500)],
    accessories: [
      ...(n.favorite ? [{ icon: { source: Icons.starFilled, tint: "yellow" as const }, tooltip: "Favorite" }] : []),
      ...(n.readonly ? [{ icon: Icons.lock, tooltip: "Read only" }] : []),
      { text: ago(n.modified * 1000) },
    ],
    detail: {
      markdown: body.length > 4000 ? `${body.slice(0, 4000)}\n\n…` : body || "*Empty note*",
      metadata: [
        ...(n.category ? [meta.text("Category", n.category, { icon: Icons.folder })] : []),
        meta.text("Modified", ago(n.modified * 1000), { icon: Icons.clock }),
        meta.text("Length", plural(body.split(/\s+/).filter(Boolean).length, "word"), { icon: Icons.text }),
      ],
    },
    actions,
  };
}

let footer = "";
let categories: string[] = [];
let current: Server | undefined;

export default list({
  placeholder: "Filter notes by title, text or category…",
  empty: { title: "No notes yet", description: "Create one with Ctrl+N", icon: Icons.note },
  status: () => footer,
  actions: [
    action("New Note", () => {
      if (!current) throw new Error("Connect Nextcloud first, in Settings");
      return noteForm(current, categories);
    }, { icon: Icons.plus, shortcut: "<Ctrl>n" }),
  ],
  async *items({ preferences, signal }) {
    try {
      current = server(preferences);
    } catch (e) {
      if (e instanceof SetupError) {
        yield [setupItem(e)];
        return;
      }
      throw e;
    }
    const s = current;
    while (!signal.aborted) {
      let notes: Note[];
      try {
        notes = sortNotes(await json<Note[]>(s, API, { signal, missing: MISSING }));
      } catch (e) {
        if (e instanceof SetupError) {
          yield [setupItem(e)];
          return;
        }
        throw e;
      }
      categories = [...new Set(notes.map((n) => n.category).filter(Boolean))].sort();
      footer = [
        plural(notes.length, "note"),
        categories.length ? plural(categories.length, "category", "categories") : "",
      ]
        .filter(Boolean).join(" · ");
      yield notes.map((n) => noteItem(s, n, categories));
      // Reload after a note is created or edited.
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
  },
});
