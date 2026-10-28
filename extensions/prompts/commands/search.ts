import { type Action, action, clipboard, copy, Icons, type Item, list, meta, refresh, toast } from "@backslash/api";
import {
  askedVariables,
  copyTitle,
  excerpt,
  exportJson,
  makePrompt,
  mergeImport,
  parseImport,
  type Prompt,
  sortPrompts,
  starterPrompts,
  variables,
} from "../lib.ts";
import { loadPrompts, savePrompts, updatePrompt } from "../store.ts";
import { fenced, promptForm, use } from "../views.ts";

const date = (ms: number) => new Date(ms).toLocaleDateString("en", { dateStyle: "medium" });

function libraryActions(): Action[] {
  return [
    action("Add Prompt", () => promptForm(undefined, { back: true }), {
      icon: Icons.plus,
      shortcut: "<Ctrl>n",
      section: "Library",
    }),
    action("Export Library to Clipboard", async () => {
      const prompts = await loadPrompts();
      await clipboard.write(exportJson(prompts));
      await toast(`Copied ${prompts.length} prompts as JSON`, { style: "success" });
    }, { icon: Icons.upload, section: "Library" }),
    action("Import from Clipboard", async () => {
      const drafts = parseImport(await clipboard.read());
      const r = mergeImport(await loadPrompts(), drafts, Date.now());
      await savePrompts(r.prompts);
      const parts = [
        `${r.added} added`,
        r.updated ? `${r.updated} updated` : "",
        r.skipped ? `${r.skipped} already there` : "",
      ];
      await toast("Prompts imported", { style: "success", message: parts.filter(Boolean).join(", ") });
      return refresh();
    }, { icon: Icons.download, section: "Library" }),
    action("Restore Starter Prompts", async () => {
      const r = mergeImport(await loadPrompts(), starterPrompts(Date.now()), Date.now());
      await savePrompts(r.prompts);
      await toast(r.added + r.updated ? "Starter prompts restored" : "The starter prompts are all there", {
        style: "success",
        message: r.added + r.updated ? `${r.added} added, ${r.updated} reset` : undefined,
      });
      return refresh();
    }, { icon: Icons.refresh, section: "Library", confirm: "Add the missing starter prompts and reset edited ones?" }),
  ];
}

function promptItem(p: Prompt, all: Prompt[]): Item {
  const vars = variables(p.body);
  const asked = askedVariables(p.body);
  const builtins = vars.filter((v) => v.builtin).map((v) => v.name.toLowerCase());
  return {
    id: p.id,
    title: p.title,
    subtitle: excerpt(p.body),
    icon: p.pinned ? { source: Icons.pin, tint: "yellow" } : { source: Icons.sparkle, tint: "purple" },
    keywords: [...p.tags, ...vars.map((v) => v.name)],
    accessories: [
      ...p.tags.slice(0, 2).map((t) => ({ tag: t })),
      ...(asked.length
        ? [{
          text: `${asked.length} var${asked.length === 1 ? "" : "s"}`,
          tooltip: asked.map((v) => v.label).join(", "),
        }]
        : []),
      ...(builtins.includes("clipboard") ? [{ icon: Icons.paste, tooltip: "Inserts the clipboard" }] : []),
    ],
    detail: {
      markdown: fenced(p.body),
      metadata: [
        ...(asked.length
          ? [meta.tags("Variables", asked.map((v) => ({ text: v.default ? `${v.label} = ${v.default}` : v.label })))]
          : []),
        ...(builtins.length
          ? [meta.tags("Filled in", builtins.map((b) => ({ text: b, color: "teal" as const })))]
          : []),
        ...(p.tags.length ? [meta.tags("Tags", p.tags)] : []),
        meta.separator(),
        meta.text("Used", p.uses ? `${p.uses} time${p.uses === 1 ? "" : "s"}` : "Never", { icon: Icons.history }),
        ...(p.lastUsed ? [meta.text("Last used", date(p.lastUsed), { icon: Icons.clock })] : []),
        meta.text("Updated", date(p.updated), { icon: Icons.calendar }),
      ],
    },
    actions: [
      action(asked.length ? "Fill and Paste" : "Paste", () => use(p, "paste"), { icon: Icons.paste }),
      action(asked.length ? "Fill and Copy" : "Copy", () => use(p, "copy"), { icon: Icons.copy }),
      action(asked.length ? "Fill and Preview" : "Preview", () => use(p, "preview"), {
        icon: Icons.eye,
        shortcut: "<Ctrl>p",
      }),
      copy(p.body, "Copy Template", { icon: Icons.braces, shortcut: "<Ctrl><Shift>c", section: "Copy" }),
      copy(p.title, "Copy Title", { section: "Copy" }),
      action("Edit Prompt", () => promptForm(p), { icon: Icons.note, shortcut: "<Ctrl>e", section: "Prompt" }),
      action("Duplicate", async () => {
        const dup = makePrompt(
          { title: copyTitle(p.title, all.map((x) => x.title)), body: p.body, tags: p.tags },
          Date.now(),
        );
        await savePrompts([...await loadPrompts(), dup]);
        return promptForm(dup);
      }, { icon: Icons.copy, shortcut: "<Ctrl>d", section: "Prompt" }),
      action(p.pinned ? "Unpin" : "Pin to Top", async () => {
        await updatePrompt(p.id, (x) => ({ ...x, pinned: !x.pinned }));
        return refresh();
      }, { icon: Icons.pin, shortcut: "<Ctrl><Shift>p", section: "Prompt" }),
      action("Delete Prompt", async () => {
        await updatePrompt(p.id, () => null);
        await toast(`Deleted “${p.title}”`, { style: "success" });
        return refresh();
      }, {
        icon: Icons.trash,
        shortcut: "<Ctrl>x",
        section: "Prompt",
        destructive: true,
        confirm: `Delete “${p.title}”?`,
      }),
      ...libraryActions(),
    ],
  };
}

export default list({
  placeholder: "Search prompts by title, tag or variable…",
  empty: {
    title: "No prompts",
    description: "Press Ctrl+N to add one, or Ctrl+K → Restore Starter Prompts",
    icon: Icons.sparkle,
  },
  actions: libraryActions(),
  status: (items) => `${items.length} prompt${items.length === 1 ? "" : "s"}`,
  async items() {
    const prompts = await loadPrompts();
    return sortPrompts(prompts).map((p) => ({ ...promptItem(p, prompts), section: p.pinned ? "Pinned" : "Prompts" }));
  },
});
