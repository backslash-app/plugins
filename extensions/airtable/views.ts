// Rows for tables and records, the record search and the new record form.

import {
  type Action,
  action,
  close,
  copy,
  detail,
  field,
  form,
  type FormSpec,
  Icons,
  type Item,
  list,
  meta,
  open,
  refresh,
  replace,
  submenu,
  toast,
} from "@backslash/api";
import { type Backend, create, type each, fields, rowUrl, search, tableUrl } from "./api.ts";
import {
  type Field,
  fieldHint,
  fieldIcon,
  KIND_NAMES,
  primaryField,
  recordFields,
  recordMarkdown,
  recordText,
  recordView,
  type Row,
  SetupError,
  setupItem,
  type Table,
  tableKey,
} from "./lib.ts";

/** Setup rows when nothing loaded because of the settings; a toast when only some services failed. */
export async function report<T>(r: Awaited<ReturnType<typeof each<T>>>): Promise<Item[] | undefined> {
  if (!r.errors.length) return undefined;
  if (!r.ok.length) {
    const setup = r.errors.find((e) => e.error instanceof SetupError);
    if (setup) return [setupItem(setup.error as SetupError)];
    throw r.errors[0].error;
  }
  await toast(`${r.errors.map((e) => KIND_NAMES[e.backend.kind]).join(", ")} didn't answer`, {
    style: "failure",
    message: r.errors.map((e) => e.error.message).join(" · "),
  });
  return undefined;
}

const TINT = { airtable: "yellow", nocodb: "purple", baserow: "blue" } as const;

// ---------------------------------------------------------------------------
// Tables

export function tableItem(b: Backend, t: Table, many: boolean, o: { formFirst?: boolean } = {}): Item {
  const searchAction = action("Search Records", () => recordsView(b, t), { icon: Icons.search });
  const addAction = action("Add Record…", () => recordForm(b, t), { icon: Icons.plus, shortcut: "<Ctrl>n" });
  const writable = t.fields?.filter((f) => f.writable).length;
  return {
    id: tableKey(t),
    title: t.name,
    subtitle: t.baseName,
    icon: { source: Icons.database, tint: TINT[t.kind] },
    section: many ? `${KIND_NAMES[t.kind]} · ${t.baseName}` : t.baseName,
    keywords: [t.baseName, KIND_NAMES[t.kind], ...(t.fields ?? []).map((f) => f.name)],
    accessories: t.fields ? [{ text: `${t.fields.length} fields`, icon: Icons.layers }] : [],
    detail: t.fields
      ? {
        markdown: [
          `## ${t.name}`,
          "",
          ...t.fields.map((f) =>
            `- **${f.name}**${f.primary ? " (primary)" : ""} · ${f.type}${f.writable ? "" : " · read-only"}`
          ),
        ].join("\n"),
        metadata: [
          meta.text("Base", t.baseName, { icon: Icons.database }),
          meta.text("Fields", `${t.fields.length}${writable !== undefined ? `, ${writable} in the form` : ""}`),
          meta.text("Source", KIND_NAMES[t.kind]),
        ],
      }
      : {
        metadata: [meta.text("Base", t.baseName, { icon: Icons.database }), meta.text("Source", KIND_NAMES[t.kind])],
      },
    actions: [
      ...(o.formFirst ? [addAction, searchAction] : [searchAction, addAction]),
      open(tableUrl(b, t), `Open in ${KIND_NAMES[t.kind]}`, { shortcut: "<Ctrl>o" }),
      copy(tableUrl(b, t), "Copy Table Link", { section: "Copy" }),
      copy(t.id, "Copy Table ID", { section: "Copy" }),
      action("Reload", () => refresh(), { icon: Icons.refresh, shortcut: "<Ctrl>r" }),
    ],
  };
}

// ---------------------------------------------------------------------------
// Records

export function recordItem(b: Backend, t: Table, fs: Field[], row: Row): Item {
  const v = recordView(row, fs);
  const url = rowUrl(b, t, row);
  const primary = primaryField(fs);
  const copyable = [
    ...(primary && v.title !== "Untitled" ? [{ name: primary.name, value: v.title }] : []),
    ...v.lines,
    ...v.long,
  ];
  return {
    id: `${tableKey(t)}:${row.id}`,
    title: v.title,
    subtitle: v.subtitle,
    icon: { source: Icons.file, tint: TINT[t.kind] },
    keywords: v.lines.map((l) => l.value),
    accessories: v.tag ? [{ tag: v.tag }] : [],
    detail: {
      markdown: recordMarkdown(v),
      metadata: [
        ...v.lines.slice(0, 24).map((l) => meta.text(l.name, l.value, { icon: fieldIcon(l.field?.kind ?? "other") })),
        meta.separator(),
        ...(row.created
          ? [meta.text("Created", new Date(row.created).toLocaleString("en-GB"), { icon: Icons.calendar })]
          : []),
        meta.text("Table", `${t.baseName} › ${t.name}`, { icon: Icons.database }),
      ],
    },
    actions: [
      open(url, `Open in ${KIND_NAMES[t.kind]}`),
      copy(v.title, `Copy ${primary?.name ?? "Title"}`, { shortcut: "<Ctrl><Shift>c", section: "Copy" }),
      copy(recordText(v), "Copy Record as Text", { section: "Copy" }),
      copy(JSON.stringify(row.fields, null, 2), "Copy Record as JSON", { section: "Copy" }),
      copy(url, "Copy Record Link", { shortcut: "<Ctrl>l", section: "Copy" }),
      ...(copyable.length > 1
        ? [submenu("Copy Field", copyable.map((c) => copy(c.value, c.name)), { icon: Icons.copy, section: "Copy" })]
        : []),
      action("Add Record…", () => recordForm(b, t), { icon: Icons.plus, shortcut: "<Ctrl>n", section: "Table" }),
      open(tableUrl(b, t), "Open Table", { icon: Icons.database, section: "Table" }),
    ],
  };
}

export function recordsView(b: Backend, t: Table) {
  let shown = 0;
  return list({
    title: t.name,
    placeholder: `Search ${t.name}…`,
    status: () => `${shown === 50 ? "First 50" : shown} record${shown === 1 ? "" : "s"} · ${t.baseName}`,
    empty: {
      title: "No record found",
      description: `Nothing in ${t.name} matches. Ctrl+N adds a record.`,
      icon: Icons.file,
    },
    actions: [
      action("Add Record…", () => recordForm(b, t), { icon: Icons.plus, shortcut: "<Ctrl>n" }),
      open(tableUrl(b, t), `Open in ${KIND_NAMES[t.kind]}`, { shortcut: "<Ctrl>o" }),
    ],
    async search(query, { signal }) {
      const fs = await fields(b, t, signal);
      const rows = await search(b, t, query, signal);
      shown = rows.length;
      return rows.map((r) => recordItem(b, t, fs, r));
    },
  });
}

// ---------------------------------------------------------------------------
// The form

/** A form field for each writable field, the primary one first and required. */
export function formFields(fs: Field[]) {
  const writable = fs.filter((f) => f.writable);
  const ordered = [...writable.filter((f) => f.primary), ...writable.filter((f) => !f.primary)].slice(0, 30);
  return ordered.map((f) => {
    const id = `f_${f.id}`;
    const o = { placeholder: fieldHint(f) ?? f.description, required: f.primary };
    switch (f.kind) {
      case "longText":
        return field.textArea(id, f.name, o);
      case "checkbox":
        return field.checkbox(id, f.name);
      case "select":
        return field.dropdown(id, f.name, [
          ...(f.primary ? [] : [{ value: "", title: "—" }]),
          ...(f.choices ?? []).map((c) => ({ value: c.name, title: c.name })),
        ], { value: f.primary ? f.choices?.[0]?.name ?? "" : "" });
      default:
        return field.text(id, f.name, o);
    }
  });
}

export async function recordForm(b: Backend, t: Table): Promise<FormSpec> {
  const fs = await fields(b, t);
  const inputs = formFields(fs);
  if (!inputs.length) {
    throw new Error(`${t.name} has no field a form can fill in (formulas, links and files are read-only here)`);
  }
  return form({
    title: `New Record in ${t.name}`,
    submitTitle: "Add Record",
    fields: inputs,
    async submit(values) {
      const body = recordFields(t.kind, fs, values);
      if (typeof body === "string") throw new Error(body);
      const row = await create(b, t, body);
      const v = recordView(row, fs);
      await toast(`Added to ${t.name}`, { style: "success" });
      return replace(detail({
        title: "Record Added",
        markdown: `## ${v.title}\n\nAdded to **${t.baseName} › ${t.name}**.`,
        metadata: [
          ...v.lines.map((l) => meta.text(l.name, l.value)),
          ...v.long.map((l) => meta.text(l.name, l.value.slice(0, 120))),
        ],
        status: "Record added",
        actions: [
          open(rowUrl(b, t, row), `Open in ${KIND_NAMES[t.kind]}`),
          action("Add Another…", () => recordForm(b, t), { icon: Icons.plus, shortcut: "<Ctrl>n" }),
          copy(rowUrl(b, t, row), "Copy Record Link", { shortcut: "<Ctrl><Shift>c" }),
          action("Done", () => close(), { icon: Icons.check }),
        ],
      }));
    },
  });
}

export const reloadAction = (): Action =>
  action("Reload", () => refresh(), { icon: Icons.refresh, shortcut: "<Ctrl>r" });
