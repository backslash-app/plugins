// The rules form, the old → new preview, quick presets and the undo row.

import {
  type Action,
  action,
  copy,
  field,
  form,
  type FormSpec,
  type FormValues,
  Icons,
  type Item,
  list,
  type ListSpec,
  meta,
  open,
  pop,
  submenu,
  toast,
} from "@backslash/api";
import {
  ago,
  basename,
  changesSomething,
  checkRules,
  DATE_FORMATS,
  DEFAULT_RULES,
  describeRules,
  dirname,
  type FileInfo,
  type Plan,
  planRenames,
  plural,
  readRules,
  type Row,
  type Rules,
  undoPlan,
} from "./lib.ts";
import { type Batch, exists, forgetBatch, hasExiftool, loadDates, rename, saveRules, tilde } from "./system.ts";

// The main list stays live: renaming or undoing wakes it up.
const changes = new EventTarget();
export const changed = () => changes.dispatchEvent(new Event("change"));

/** Resolves on the next change, or when `signal` aborts. */
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

// ---------------------------------------------------------------------------
// Rules form

export async function rulesForm(files: FileInfo[], saved: Rules): Promise<FormSpec> {
  const exif = await hasExiftool();
  const r = saved;
  return form({
    title: `Rename ${plural(files.length, "File")}`,
    submitTitle: "Preview",
    fields: [
      field.text("find", "Find", { value: r.find, placeholder: "Text to replace, e.g. IMG_" }),
      field.text("replace", "Replace with", { value: r.replace, placeholder: "Empty removes it; $1 for regex groups" }),
      field.checkbox("regex", "Find is a regular expression", { value: r.regex }),
      field.checkbox("ignoreCase", "Ignore case when finding", { value: r.ignoreCase }),
      field.dropdown("case", "Case", [
        { value: "keep", title: "Keep as is" },
        { value: "lower", title: "lowercase" },
        { value: "upper", title: "UPPERCASE" },
        { value: "title", title: "Title Case" },
        { value: "sentence", title: "Sentence case" },
      ], { value: r.case }),
      field.checkbox("slugify", "Slugify (été 2026! → ete-2026)", { value: r.slugify }),
      field.dropdown("numbering", "Numbering", [
        { value: "none", title: "None" },
        { value: "prefix", title: "Before the name: 001_name" },
        { value: "suffix", title: "After the name: name_001" },
        { value: "replace", title: "Instead of the name: 001" },
      ], { value: r.numbering }),
      field.text("start", "Start at", { value: String(r.start), placeholder: "1" }),
      field.text("padding", "Digits", { value: String(r.padding), placeholder: "3 → 001" }),
      field.dropdown("order", "Number in the order of", [
        { value: "copied", title: "Copying" },
        { value: "name", title: "Name" },
        { value: "date", title: "Date" },
      ], { value: r.order }),
      field.dropdown("date", "Date", [
        { value: "none", title: "None" },
        { value: "prefix", title: "Before the name" },
        { value: "suffix", title: "After the name" },
      ], { value: r.date }),
      field.dropdown("dateSource", "Date from", [
        {
          value: "exif",
          title: exif ? "Date taken (EXIF), else modified" : "Date taken (needs exiftool), else modified",
        },
        { value: "mtime", title: "Date modified" },
      ], { value: r.dateSource }),
      field.dropdown("dateFormat", "Date format", DATE_FORMATS, { value: r.dateFormat }),
      field.text("separator", "Separator", { value: r.separator, placeholder: "_ between date, number and name" }),
      field.text("prefix", "Prefix", { value: r.prefix }),
      field.text("suffix", "Suffix", { value: r.suffix, placeholder: "Before the extension" }),
      field.text("extension", "New extension", { value: r.extension, placeholder: "Empty keeps it, e.g. jpg" }),
      field.checkbox("lowerExtension", "Lowercase the extension (.JPG → .jpg)", { value: r.lowerExtension }),
    ],
    async submit(values: FormValues) {
      const rules = readRules(values);
      try {
        checkRules(rules);
      } catch (e) {
        await toast((e as Error).message, { style: "failure" });
        return;
      }
      if (!changesSomething(rules)) {
        await toast("Pick at least one change", { style: "failure" });
        return;
      }
      await saveRules(rules);
      return await previewView(files, rules);
    },
  });
}

// ---------------------------------------------------------------------------
// Preview

function statusTag(r: Row) {
  switch (r.status) {
    case "rename":
      return { tag: "rename", color: "blue" as const };
    case "same":
      return { tag: "unchanged", color: "gray" as const };
    default:
      return { tag: r.status === "invalid" ? "invalid" : "conflict", color: "red" as const };
  }
}

async function doRename(plan: Plan, rules: string): Promise<boolean> {
  if (!plan.renames) {
    await toast(plan.conflicts ? "Every rename has a conflict" : "Nothing changes", { style: "failure" });
    return false;
  }
  try {
    const n = await rename(plan, rules);
    changed();
    await toast(`Renamed ${plural(n, "file")}`, {
      style: "success",
      message: [plan.conflicts ? `${plan.conflicts} skipped` : "", "Undo from Batch Rename"].filter(Boolean).join(
        " · ",
      ),
    });
    return true;
  } catch (e) {
    await toast("Nothing was renamed", { style: "failure", message: (e as Error).message });
    return false;
  }
}

function rowItem(r: Row, actions: Action[]): Item {
  const tag = statusTag(r);
  const newName = basename(r.to);
  const oldName = basename(r.from);
  return {
    id: r.from,
    title: r.status === "same" ? oldName : newName,
    subtitle: r.status === "same" ? "unchanged" : `← ${oldName}`,
    icon: {
      source: r.status === "rename" ? Icons.arrowRight : r.status === "same" ? Icons.dot : Icons.alert,
      tint: tag.color,
    },
    section: r.status === "rename" ? "Renamed" : r.status === "same" ? "Unchanged" : "Conflicts",
    keywords: [oldName],
    accessories: [
      ...(r.dateFromMtime ? [{ icon: Icons.clock, tooltip: "No date taken: the date modified is used" }] : []),
      tag,
    ],
    detail: {
      metadata: [
        meta.text("Now", oldName, { icon: Icons.file }),
        meta.text("Becomes", r.status === "rename" ? newName : "No change", { icon: Icons.arrowRight }),
        ...(r.reason ? [meta.tags("Problem", [{ text: r.reason, color: "red" }])] : []),
        ...(r.dateFromMtime ? [meta.text("Date", "No date taken: modified date used", { icon: Icons.calendar })] : []),
        meta.text("Folder", tilde(dirname(r.from)), { icon: Icons.folder }),
      ],
    },
    actions,
  };
}

/** Every file, old → new, conflicts first; Enter renames. */
export async function previewView(files: FileInfo[], rules: Rules): Promise<ListSpec> {
  if (rules.date !== "none" && rules.dateSource === "exif") await loadDates(files);
  const summary = describeRules(rules);
  return list({
    title: "Preview",
    placeholder: "Old → new names…",
    status: () => summary,
    items: () => {
      const plan = planRenames(files, rules, exists);
      const go = action(
        plan.conflicts
          ? `Rename ${plural(plan.renames, "File")}, Skip ${plan.conflicts}`
          : `Rename ${plural(plan.renames, "File")}`,
        async () => {
          if (await doRename(plan, summary)) return pop();
        },
        { icon: Icons.check },
      );
      const edit = action("Change Rules", () => pop(), { icon: Icons.settings, shortcut: "<Ctrl>e" });
      const actions = [
        go,
        edit,
        copy(plan.rows.map((r) => `${basename(r.from)} → ${basename(r.to)}`).join("\n"), "Copy the List", {
          section: "Copy",
        }),
      ];
      const order = { conflict: 0, invalid: 0, rename: 1, same: 2 };
      return [...plan.rows].sort((a, b) => order[a.status] - order[b.status]).map((r) => rowItem(r, actions));
    },
  });
}

/** One-key renames that skip the form. */
export function quickRenames(files: FileInfo[]): Action {
  const preset = (title: string, rules: Partial<Rules>) =>
    action(title, () => previewView(files, { ...DEFAULT_RULES, ...rules }));
  return submenu("Quick Rename", [
    preset("lowercase", { case: "lower", lowerExtension: true }),
    preset("Slugify (été 2026! → ete-2026)", { slugify: true, lowerExtension: true }),
    preset("Number 001, 002… Before the Name", { numbering: "prefix", order: "name" }),
    preset("Only Numbers 001, 002…, by Date", { numbering: "replace", order: "date", dateSource: "mtime" }),
    preset("Date Taken Before the Name", { date: "prefix", dateFormat: "YYYY-MM-DD_HH-mm-ss" }),
    preset("Spaces to Underscores", { find: " ", replace: "_" }),
    preset("Lowercase Extensions (.JPG → .jpg)", { lowerExtension: true }),
  ], { icon: Icons.bolt, shortcut: "<Ctrl>q" });
}

// ---------------------------------------------------------------------------
// Undo

export async function undo(batch: Batch): Promise<string> {
  const plan = undoPlan(batch.renames, exists);
  if (!plan.renames) throw new Error("The renamed files aren't there anymore");
  const n = await rename(plan, "Undo");
  changed();
  return plan.conflicts ? `Restored ${plural(n, "name")}, ${plan.conflicts} skipped` : `Restored ${plural(n, "name")}`;
}

export function undoItem(batch: Batch): Item {
  const plan = undoPlan(batch.renames, exists);
  const lines = batch.renames.slice(0, 60).map((r) => `- ${basename(r.to)} → **${basename(r.from)}**`);
  if (batch.renames.length > 60) lines.push(`- … and ${batch.renames.length - 60} more`);
  return {
    id: "undo",
    title: "Undo Last Rename",
    subtitle: `${plural(batch.renames.length, "file")} · ${ago(batch.at)}`,
    icon: { source: Icons.history, tint: "orange" },
    section: "Last Rename",
    accessories: plan.conflicts ? [{ tag: `${plan.conflicts} can't be undone`, color: "red" }] : [],
    detail: {
      markdown: lines.join("\n"),
      metadata: [
        ...(batch.rules ? [meta.text("Rules", batch.rules, { icon: Icons.settings })] : []),
        meta.text("Folder", tilde(dirname(batch.renames[0]?.to ?? "")), { icon: Icons.folder }),
      ],
    },
    actions: [
      action("Undo Rename", async () => {
        try {
          await toast(await undo(batch), { style: "success" });
        } catch (e) {
          await toast("Couldn't undo", { style: "failure", message: (e as Error).message });
        }
      }, { icon: Icons.history, confirm: `Give ${plural(plan.renames, "file")} their old names back?` }),
      open(dirname(batch.renames[0]?.to ?? "/"), "Open Folder", { icon: Icons.folder, shortcut: "<Ctrl>o" }),
      action("Forget It", async () => {
        await forgetBatch();
        changed();
      }, { icon: Icons.cross, destructive: true, confirm: "Forget the last rename? It can't be undone afterwards." }),
    ],
  };
}

export function clipboardHint(): Item {
  return {
    id: "clipboard-hint",
    title: "Copy files in your file manager",
    subtitle: "Then rename them all at once",
    icon: { source: Icons.paste, tint: "gray" },
    section: "Clipboard",
    detail: {
      markdown: [
        "Select files or folders in **Files**, **Dolphin**, **Thunar** or **Nemo** and press **Ctrl+C**, then open Batch Rename again.",
        "",
        "You'll pick the rules (find and replace, case, numbering, date taken, prefix and suffix, extension), see every old and new name before anything changes, and can undo the last rename.",
      ].join("\n"),
    },
    actions: [],
  };
}
