// Loading gists, the creation form and the actions, shared by the commands.

import {
  type Action,
  action,
  clipboard,
  close,
  copy,
  field,
  form,
  type FormSpec,
  Icons,
  open,
  pop,
  submenu,
  toast,
} from "@backslash/api";
import { github } from "./api.ts";
import { files, type Gist, type GistFile, gistTitle, guessFilename, newGist } from "./lib.ts";

// --- Live reload: the views of a command share one process ------------------------

const changes = new EventTarget();

export const notifyChanged = () => changes.dispatchEvent(new Event("change"));

/** Waits for the next change made from this command, or for `signal` to abort. */
export function nextChange(signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      changes.removeEventListener("change", done);
      signal.removeEventListener("abort", done);
      resolve();
    };
    changes.addEventListener("change", done);
    signal.addEventListener("abort", done);
  });
}

// --- Contents -----------------------------------------------------------------------

/** Full gists by id, kept while their `updated_at` doesn't change. */
const full = new Map<string, Gist>();

export async function withContent(t: string, g: Gist, signal?: AbortSignal): Promise<Gist> {
  const known = full.get(g.id);
  if (known && known.updated_at === g.updated_at) return known;
  const loaded = await github<Gist>(t, `/gists/${g.id}`, { signal });
  full.set(g.id, loaded);
  return loaded;
}

/** A file's whole text, even when the gist API truncated it (over 1 MB). */
async function contentOf(t: string, g: Gist, file: GistFile): Promise<string> {
  const loaded = (await withContent(t, g)).files[file.filename] ?? file;
  if (!loaded.truncated && loaded.content !== undefined) return loaded.content;
  const res = await fetch(loaded.raw_url);
  if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
  return await res.text();
}

// --- Actions ------------------------------------------------------------------------

export function gistActions(t: string, g: Gist, options: { own: boolean; starred: boolean }): Action[] {
  const all = files(g);
  const single = all.length === 1 ? all[0] : undefined;
  const copyFile = (file: GistFile, title: string, o: { shortcut?: string } = {}) =>
    action(title, async () => {
      await clipboard.write(await contentOf(t, g, file));
      return close(`Copied ${file.filename}`);
    }, { icon: Icons.copy, ...o });
  const pasteFile = (file: GistFile, title: string) =>
    action(title, async () => {
      await clipboard.paste(await contentOf(t, g, file));
    }, { icon: Icons.paste, shortcut: "<Ctrl><Shift>v" });
  return [
    ...(single ? [copyFile(single, "Copy Content")] : [submenu(
      "Copy File Content",
      all.map((f) => copyFile(f, f.filename)),
      { icon: Icons.copy },
    )]),
    open(g.html_url, "Open in Browser"),
    ...(single ? [pasteFile(single, "Paste Content")] : [submenu(
      "Paste File Content",
      () => all.map((f) => pasteFile(f, f.filename)),
      { icon: Icons.paste, shortcut: "<Ctrl><Shift>v" },
    )]),
    copy(g.html_url, "Copy Gist URL", { shortcut: "<Ctrl><Shift>c", section: "Copy" }),
    ...(single ? [copy(single.raw_url, "Copy Raw URL", { icon: Icons.link, section: "Copy" })] : []),
    copy(`git clone ${g.git_pull_url ?? `https://gist.github.com/${g.id}.git`}`, "Copy git clone", {
      icon: Icons.terminal,
      section: "Copy",
    }),
    copy(g.id, "Copy Gist ID", { icon: Icons.hash, section: "Copy" }),
    action("Create Gist from Clipboard", () => createForm(t, { standalone: false }), {
      icon: Icons.plus,
      shortcut: "<Ctrl>n",
      section: "Gist",
    }),
    ...(options.starred
      ? [action("Unstar", async () => {
        await github(t, `/gists/${g.id}/star`, { method: "DELETE" });
        await toast("Unstarred", { style: "success" });
        notifyChanged();
      }, { icon: Icons.star, section: "Gist" })]
      : []),
    ...(options.own
      ? [action("Delete Gist", async () => {
        await github(t, `/gists/${g.id}`, { method: "DELETE" });
        full.delete(g.id);
        await toast(`Deleted “${gistTitle(g)}”`, { style: "success" });
        notifyChanged();
      }, {
        icon: Icons.trash,
        destructive: true,
        confirm: `Delete “${gistTitle(g)}” for good?`,
        shortcut: "<Ctrl><Shift>x",
        section: "Danger",
      })]
      : []),
  ];
}

// --- Creating -----------------------------------------------------------------------

/** `standalone`: the form is the command itself, so creating closes the launcher instead of going back. */
export async function createForm(t: string, { standalone }: { standalone: boolean }): Promise<FormSpec> {
  const text = await clipboard.read().catch(() => "");
  return form({
    title: "New Gist",
    submitTitle: "Create Gist",
    fields: [
      field.text("description", "Description", { placeholder: "What it is, for search later" }),
      field.text("filename", "File name", { value: text.trim() ? guessFilename(text) : "", required: true }),
      field.textArea("content", "Content", { value: text, required: true, placeholder: "Copied text appears here" }),
      field.dropdown("visibility", "Visibility", [
        { value: "secret", title: "Secret (anyone with the link)" },
        { value: "public", title: "Public (listed on your profile)" },
      ], { value: "secret" }),
    ],
    async submit(values) {
      const body = newGist({
        description: String(values.description ?? ""),
        filename: String(values.filename ?? ""),
        content: String(values.content ?? ""),
        visibility: String(values.visibility ?? "secret"),
      });
      const created = await github<Gist>(t, "/gists", { method: "POST", body });
      await clipboard.write(created.html_url);
      await toast("Gist created", { style: "success", message: "Its URL is in the clipboard" });
      if (standalone) return close("Gist created, URL copied");
      notifyChanged();
      return pop();
    },
  });
}
