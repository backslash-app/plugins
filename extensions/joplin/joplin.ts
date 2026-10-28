// The Joplin Data API, served by the desktop app's Web Clipper service, and
// notes as launcher items.

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
  refresh,
  storage,
  toast,
} from "@backslash/api";
import {
  ago,
  apiUrl,
  BASE,
  type Folder,
  folderPaths,
  markdownLink,
  type Note,
  openFolderUrl,
  openNoteUrl,
  type Page,
  parseTags,
  previewBody,
  snippet,
  type Tag,
  todoState,
  when,
  wordCount,
} from "./lib.ts";

/** The Web Clipper service is off (or Joplin is closed). */
export class OfflineError extends Error {}
/** No token, or a wrong one. */
export class TokenError extends Error {}

export interface Client {
  token: string;
  get<T>(path: string, params?: Record<string, string | number | undefined>, signal?: AbortSignal): Promise<T>;
  send<T>(method: string, path: string, body: unknown): Promise<T>;
}

async function call(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: init.signal ?? AbortSignal.timeout(10_000) });
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") throw e;
    throw new OfflineError("Joplin's Web Clipper service is off");
  }
}

async function parse<T>(res: Response): Promise<T> {
  if (res.status === 403) throw new TokenError("Joplin refused the token");
  const text = await res.text();
  if (!res.ok) {
    let message = text;
    try {
      message = JSON.parse(text).error ?? text;
    } catch { /* plain text */ }
    throw new Error(`Joplin: ${String(message).split("\n")[0] || res.status}`);
  }
  return (text ? JSON.parse(text) : undefined) as T;
}

/** Checks the service is on (no token needed), then that a token is set. */
export async function connect(ctx: Pick<Context, "preferences">, signal?: AbortSignal): Promise<Client> {
  const ping = await call(`${BASE}/ping`, { signal });
  if (!(await ping.text()).includes("JoplinClipperServer")) {
    throw new OfflineError("Something else answers on port 41184");
  }
  const token = String(ctx.preferences.token ?? "").trim();
  if (!token) throw new TokenError("Add your Joplin API token");
  return {
    token,
    get: async (path, params = {}, s) => parse(await call(apiUrl(path, params, token), { signal: s ?? signal })),
    send: async (method, path, body) =>
      parse(
        await call(apiUrl(path, {}, token), {
          method,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
      ),
  };
}

/** Every page of a paginated list. */
export async function all<T>(
  c: Client,
  path: string,
  params: Record<string, string | number>,
  signal?: AbortSignal,
  max = 2000,
): Promise<T[]> {
  const out: T[] = [];
  for (let page = 1; out.length < max; page++) {
    const r = await c.get<Page<T>>(path, { ...params, limit: 100, page }, signal);
    out.push(...r.items);
    if (!r.has_more) break;
  }
  return out;
}

export const loadFolders = (c: Client, signal?: AbortSignal) =>
  all<Folder>(c, "/folders", { fields: "id,title,parent_id" }, signal);

export async function noteTags(c: Client, id: string, signal?: AbortSignal): Promise<string[]> {
  const r = await c.get<Page<Tag>>(`/notes/${id}/tags`, { fields: "id,title" }, signal).catch(() => undefined);
  return (r?.items ?? []).map((t) => t.title).sort();
}

// --- Setup -------------------------------------------------------------------

export function setupItems(e: OfflineError | TokenError): Item[] {
  if (e instanceof OfflineError) {
    return [{
      id: "offline",
      title: "Joplin's Web Clipper service is off",
      subtitle: "Open Joplin, then Tools → Options → Web Clipper → Enable",
      icon: { source: Icons.plug, tint: "orange" },
      detail: {
        markdown: [
          "## Turn on the Web Clipper service",
          "",
          "Backslash reads your notes through the Data API of **Joplin desktop**, served by its Web Clipper service.",
          "",
          "1. Open Joplin",
          "2. **Tools → Options → Web Clipper** (on macOS: Joplin → Settings)",
          "3. **Enable Web Clipper Service**: it shows *Status: Enabled, port 41184*",
          "",
          "Joplin must stay open (it can be minimized). Another port than 41184 isn't supported.",
        ].join("\n"),
      },
      actions: [
        open("joplin://x-callback-url/openFolder?id=", "Open Joplin", { icon: Icons.external }),
        open("https://joplinapp.org/help/apps/clipper", "Web Clipper Help", { icon: Icons.globe }),
        open("https://joplinapp.org/download/", "Download Joplin", { icon: Icons.download }),
      ],
    }];
  }
  return [{
    id: "token",
    title: e.message,
    subtitle: "Tools → Options → Web Clipper → Advanced options → Authorization token",
    icon: { source: Icons.key, tint: "orange" },
    detail: {
      markdown: [
        "## Connect Joplin",
        "",
        "1. In Joplin: **Tools → Options → Web Clipper**",
        "2. Under **Advanced options**, copy the **Authorization token**",
        "3. Paste it in **Settings → Extensions → Joplin → Configure** (stored in your keyring)",
      ].join("\n"),
    },
    actions: [
      open("https://joplinapp.org/help/api/references/rest_api/#authorisation", "Token Help", { icon: Icons.globe }),
    ],
  }];
}

export async function guarded(load: () => Promise<Item[]>): Promise<Item[]> {
  try {
    return await load();
  } catch (e) {
    if (e instanceof OfflineError || e instanceof TokenError) return setupItems(e);
    throw e;
  }
}

// --- Notes -------------------------------------------------------------------

export interface Shown {
  note: Note;
  notebook?: string;
  tags: string[];
}

function noteMetadata(s: Shown): Metadata[] {
  const n = s.note;
  const state = todoState(n);
  const lines: Metadata[] = [];
  if (s.notebook) lines.push(meta.text("Notebook", s.notebook, { icon: Icons.book }));
  if (s.tags.length) lines.push(meta.tags("Tags", s.tags.map((t) => ({ text: t, color: "blue" as const }))));
  if (state !== "note") {
    lines.push(meta.text("To-do", state === "done" ? `Done ${ago(n.todo_completed)}` : "Open", {
      icon: state === "done" ? Icons.done : Icons.todo,
      color: state === "done" ? "green" : state === "overdue" ? "red" : undefined,
    }));
    if (n.todo_due) {
      lines.push(
        meta.text("Due", when(n.todo_due), { icon: Icons.bell, color: state === "overdue" ? "red" : undefined }),
      );
    }
  }
  lines.push(meta.separator());
  lines.push(meta.text("Updated", `${when(n.updated_time)} · ${ago(n.updated_time)}`, { icon: Icons.clock }));
  if (n.created_time) lines.push(meta.text("Created", when(n.created_time), { icon: Icons.calendar }));
  lines.push(meta.text("Words", wordCount(n.body)));
  if (n.author) lines.push(meta.person("Author", n.author));
  if (n.source_url) {
    const host = (() => {
      try {
        return new URL(n.source_url).host;
      } catch {
        return n.source_url;
      }
    })();
    lines.push(meta.link("Source", host, n.source_url));
  }
  return lines;
}

export function notePage(c: Client, s: Shown): DetailSpec {
  return detail({
    title: s.note.title || "Untitled",
    markdown: `# ${s.note.title || "Untitled"}\n\n${previewBody(s.note.body ?? "", 50_000) || "*Empty note*"}`,
    metadata: noteMetadata(s),
    status: [s.notebook, `${wordCount(s.note.body)} words`, `updated ${ago(s.note.updated_time)}`].filter(Boolean)
      .join(" · "),
    actions: noteActions(c, s, { page: true }),
  });
}

export function noteActions(c: Client, s: Shown, o: { page?: boolean } = {}): Action[] {
  const n = s.note;
  const state = todoState(n);
  const body = (n.body ?? "").trim();
  return [
    open(openNoteUrl(n.id), "Open in Joplin", { icon: Icons.external }),
    ...(o.page ? [] : [action("View Note", () => notePage(c, s), { icon: Icons.eye, shortcut: "<Ctrl>o" })]),
    ...(state === "note" ? [] : [
      action(state === "done" ? "Mark as Not Done" : "Mark as Done", async () => {
        await c.send("PUT", `/notes/${n.id}`, { todo_completed: state === "done" ? 0 : Date.now() });
        await toast(state === "done" ? "Reopened" : "Done", { style: "success" });
        return o.page ? pop() : refresh();
      }, { icon: state === "done" ? Icons.todo : Icons.done, shortcut: "<Ctrl><Shift>d" }),
    ]),
    copy(markdownLink(n), "Copy Markdown Link", { shortcut: "<Ctrl><Shift>c", section: "Copy" }),
    paste(markdownLink(n), "Paste Markdown Link", { shortcut: "<Ctrl><Shift>v", section: "Copy" }),
    copy(body, "Copy Markdown", { section: "Copy" }),
    copy(openNoteUrl(n.id), "Copy Joplin URL", { icon: Icons.link, section: "Copy" }),
    copy(n.title, "Copy Title", { section: "Copy" }),
    ...(n.source_url ? [open(n.source_url, "Open Source Page", { icon: Icons.globe, section: "Open" })] : []),
    open(openFolderUrl(n.parent_id), "Open Notebook in Joplin", { icon: Icons.book, section: "Open" }),
    action("New Note", () => noteForm(c, { folder: n.parent_id }), {
      icon: Icons.plus,
      shortcut: "<Ctrl>n",
      section: "Open",
    }),
  ];
}

export function noteItem(c: Client, s: Shown, section?: string): Item {
  const n = s.note;
  const state = todoState(n);
  const icon = state === "note"
    ? { source: Icons.note, tint: "blue" as const }
    : state === "done"
    ? { source: Icons.squareCheck, tint: "green" as const }
    : { source: Icons.square, tint: state === "overdue" ? "red" as const : "orange" as const };
  return {
    id: n.id,
    title: n.title || "Untitled",
    subtitle: snippet(n.body) || undefined,
    icon,
    section,
    accessories: [
      ...s.tags.slice(0, 2).map((t) => ({ tag: t, color: "blue" as const })),
      ...(s.notebook ? [{ icon: Icons.book, text: s.notebook.split(" / ").pop(), tooltip: s.notebook }] : []),
      { text: ago(n.updated_time), tooltip: `Updated ${when(n.updated_time)}` },
    ],
    detail: { markdown: previewBody(n.body ?? "") || "*Empty note*", metadata: noteMetadata(s) },
    actions: noteActions(c, s),
  };
}

// --- New note ----------------------------------------------------------------

export async function lastFolder(): Promise<string | undefined> {
  const f = await storage.get("lastFolder").catch(() => undefined);
  return typeof f === "string" ? f : undefined;
}

async function tagId(c: Client, title: string): Promise<string> {
  const found = await c.get<Page<Tag>>("/search", { type: "tag", query: title, fields: "id,title" });
  const hit = found.items.find((t) => t.title.toLowerCase() === title);
  if (hit) return hit.id;
  return (await c.send<Tag>("POST", "/tags", { title })).id;
}

export async function noteForm(
  c: Client,
  o: { folder?: string; title?: string; standalone?: boolean } = {},
): Promise<FormSpec> {
  const [folders, remembered] = await Promise.all([loadFolders(c), lastFolder()]);
  const paths = folderPaths(folders);
  if (!paths.length) throw new Error("Create a notebook in Joplin first");
  const initial = [o.folder, remembered].find((id) => id && paths.some((p) => p.id === id)) ?? paths[0].id;
  return form({
    title: "New Joplin Note",
    submitTitle: "Create Note",
    fields: [
      field.text("title", "Title", { required: true, placeholder: "Meeting notes", value: o.title ?? "" }),
      field.textArea("body", "Note", { placeholder: "Markdown" }),
      field.dropdown("folder", "Notebook", paths.map((p) => ({ value: p.id, title: p.path })), { value: initial }),
      field.text("tags", "Tags", { placeholder: "work, ideas" }),
      field.checkbox("todo", "To-do"),
    ],
    async submit(values) {
      const title = String(values.title ?? "").trim();
      if (!title) throw new Error("Give the note a title");
      const parent_id = String(values.folder || initial);
      const note = await c.send<Note>("POST", "/notes", {
        title,
        body: String(values.body ?? ""),
        parent_id,
        is_todo: values.todo === true ? 1 : 0,
      });
      for (const t of parseTags(String(values.tags ?? ""))) {
        await c.send("POST", `/tags/${await tagId(c, t)}/notes`, { id: note.id });
      }
      await storage.set("lastFolder", parent_id);
      const where = paths.find((p) => p.id === parent_id)?.path ?? "Joplin";
      await toast(`Note created in ${where}`, { style: "success" });
      return o.standalone ? close(`Created in ${where}`) : pop();
    },
  });
}
