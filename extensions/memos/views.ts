// Rows for notes, the capture row and the new memo form.

import {
  type Action,
  action,
  close,
  copy,
  field,
  form,
  Icons,
  type Item,
  meta,
  open,
  paste,
  refresh,
  toast,
} from "@backslash/api";
import { capture, createMemo, createTriliumNote, remove, type Server, setPinned } from "./api.ts";
import { age, type Note, SERVICE_NAMES, VISIBILITY_LABELS } from "./lib.ts";

/** Called after a change so the next search loads memos again. */
export type Invalidate = () => void;

export function noteItem(s: Server, n: Note, many: boolean, invalidate: Invalidate): Item {
  const pinLabel = s.service === "memos" ? (n.pinned ? "Unpin" : "Pin") : (n.pinned ? "Remove Bookmark" : "Bookmark");
  const mdLink = `[${n.title.replace(/[[\]]/g, "")}](${n.url})`;
  const actions: Action[] = [
    open(n.url, `Open in ${SERVICE_NAMES[n.service]}`),
    copy(n.body || n.title, s.service === "memos" ? "Copy Memo" : "Copy Text", { section: "Copy" }),
    copy(n.url, "Copy Link", { shortcut: "<Ctrl><Shift>c", section: "Copy" }),
    copy(mdLink, "Copy as Markdown Link", { shortcut: "<Ctrl>l", section: "Copy" }),
    paste(n.body || n.title, "Paste Text", { section: "Copy" }),
    action(pinLabel, async () => {
      await setPinned(s, n, !n.pinned);
      invalidate();
      const done = s.service === "memos"
        ? (n.pinned ? "Unpinned" : "Pinned")
        : (n.pinned ? "Bookmark removed" : "Bookmarked");
      await toast(done, { style: "success" });
      return refresh();
    }, {
      icon: Icons.pin,
      shortcut: "<Ctrl>p",
      section: "Note",
    }),
    action(s.service === "memos" ? "Delete Memo" : "Delete Note", async () => {
      await remove(s, n);
      invalidate();
      await toast("Deleted", {
        style: "success",
        message: s.service === "trilium" ? "Trilium can undelete it from Recent Changes" : undefined,
      });
      return refresh();
    }, {
      icon: Icons.trash,
      destructive: true,
      confirm: `Delete “${n.title}”?${s.service === "memos" ? " This can't be undone" : ""}`,
      shortcut: "<Ctrl>Delete",
      section: "Danger",
    }),
  ];
  return {
    id: `${n.service}:${n.id}`,
    title: n.title,
    subtitle: n.service === "memos" ? n.tags.map((t) => `#${t}`).join(" ") : n.body.replace(/\s+/g, " ").slice(0, 100),
    icon: {
      source: n.service === "memos" ? Icons.note : n.type === "code" ? Icons.code : Icons.file,
      tint: n.pinned ? "orange" : n.service === "memos" ? "green" : "blue",
    },
    section: n.pinned ? (s.service === "memos" ? "Pinned" : "Pinned & Bookmarked") : undefined,
    keywords: n.tags.map((t) => `#${t}`),
    accessories: [
      ...(n.pinned
        ? [{
          icon: { source: Icons.pin, tint: "orange" as const },
          tooltip: s.service === "memos" ? "Pinned" : "Bookmarked",
        }]
        : []),
      ...(n.openTasks ? [{ icon: Icons.square, tooltip: "Open tasks" }] : []),
      ...(n.visibility && n.visibility !== "PRIVATE"
        ? [{ icon: Icons.globe, tooltip: VISIBILITY_LABELS[n.visibility] ?? n.visibility }]
        : []),
      ...(n.service === "trilium" ? n.tags.slice(0, 2).map((t) => ({ text: `#${t}`, color: "blue" as const })) : []),
      ...(many ? [{ tag: SERVICE_NAMES[n.service], color: "gray" as const }] : []),
      ...(n.updated ?? n.created ? [{ text: age(n.updated ?? n.created), tooltip: "Last changed" }] : []),
    ],
    detail: {
      markdown: n.body || (n.service === "trilium" ? `## ${n.title}\n\n_Open it to see its content._` : ""),
      metadata: [
        ...(n.tags.length ? [meta.tags("Tags", n.tags.map((t) => `#${t}`))] : []),
        ...(n.created
          ? [meta.text("Created", new Date(n.created).toLocaleString("en-GB"), { icon: Icons.calendar })]
          : []),
        ...(n.updated && n.updated !== n.created
          ? [meta.text("Changed", new Date(n.updated).toLocaleString("en-GB"), { icon: Icons.history })]
          : []),
        ...(n.visibility
          ? [meta.text("Visibility", VISIBILITY_LABELS[n.visibility] ?? n.visibility, { icon: Icons.eye })]
          : []),
        ...(n.type && n.type !== "text" ? [meta.text("Type", n.type)] : []),
        meta.text("Source", SERVICE_NAMES[n.service]),
      ],
    },
    actions,
  };
}

/** The row offering to save what was typed. */
export function captureItem(
  list: Server[],
  target: Server,
  text: string,
  prefs: Record<string, unknown>,
  invalidate: Invalidate,
): Item {
  return {
    id: "capture",
    title: `Capture “${text.length > 60 ? `${text.slice(0, 59)}…` : text}”`,
    subtitle: `as a new ${target.service === "memos" ? "memo" : "Trilium note"}`,
    icon: { source: Icons.plus, tint: "green" },
    section: "New",
    actions: [
      action(`Save to ${SERVICE_NAMES[target.service]}`, async () => {
        await capture(target, text, prefs);
        invalidate();
        return close(`Saved to ${SERVICE_NAMES[target.service]}`);
      }, { icon: Icons.plus }),
      action("Write More…", () => newNoteForm(list, prefs, text), { icon: Icons.text, shortcut: "<Ctrl>e" }),
    ],
  };
}

export function newNoteForm(list: Server[], prefs: Record<string, unknown>, text = "") {
  const hasMemos = list.some((s) => s.service === "memos");
  return form({
    title: hasMemos ? "New Memo" : "New Trilium Note",
    submitTitle: "Save",
    fields: [
      field.textArea("content", hasMemos ? "Memo" : "Note", {
        required: true,
        value: text,
        placeholder: "Markdown and #tags work in Memos",
      }),
      ...(list.length > 1
        ? [field.dropdown("to", "Save to", list.map((s) => ({ value: s.service, title: SERVICE_NAMES[s.service] })), {
          value: String(prefs.captureTo ?? "memos") === "trilium" ? "trilium" : "memos",
        })]
        : []),
      ...(hasMemos
        ? [field.dropdown("visibility", "Visibility (Memos)", [
          { value: "PRIVATE", title: "Private: only you" },
          { value: "PROTECTED", title: "Workspace: signed-in users" },
          { value: "PUBLIC", title: "Public: anyone" },
        ], { value: prefs.memosVisibility === true ? "PUBLIC" : "PRIVATE" })]
        : []),
    ],
    async submit(values) {
      const content = String(values.content ?? "").trim();
      if (!content) throw new Error("Write something first");
      const s = list.find((x) => x.service === values.to) ?? list[0];
      const note = s.service === "memos"
        ? await createMemo(s, content, String(values.visibility ?? "PRIVATE"))
        : await createTriliumNote(s, content, prefs.triliumParent);
      await toast(`Saved to ${SERVICE_NAMES[s.service]}`, { style: "success", message: note.title });
      return close();
    },
  });
}
