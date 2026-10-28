// Notion pages, databases and blocks as launcher items, Markdown and forms.

import {
  type Accessory,
  type Action,
  action,
  close,
  type Context,
  copy,
  detail,
  type DetailSpec,
  type Field,
  field,
  form,
  type FormSpec,
  type FormValues,
  type Icon,
  Icons,
  type Item,
  meta,
  type Metadata,
  open,
  storage,
  toast,
} from "@backslash/api";
import { needToken, notion } from "./api.ts";

// ---------------------------------------------------------------------------
// Shapes (API version 2022-06-28)

export interface RichText {
  type?: string;
  plain_text: string;
  href?: string | null;
  annotations?: { bold?: boolean; italic?: boolean; strikethrough?: boolean; code?: boolean };
}

export type NotionIcon =
  | { type: "emoji"; emoji: string }
  | { type: "external"; external: { url: string } }
  | { type: "file"; file: { url: string } }
  | { type: "custom_emoji"; custom_emoji: { name: string; url: string } }
  | null;

export type Parent =
  | { type: "workspace"; workspace: true }
  | { type: "page_id"; page_id: string }
  | { type: "database_id"; database_id: string }
  | { type: "block_id"; block_id: string };

export interface PropertyValue {
  id: string;
  type: string;
  [key: string]: any;
}

export interface Page {
  object: "page";
  id: string;
  url: string;
  created_time: string;
  last_edited_time: string;
  icon?: NotionIcon;
  parent: Parent;
  archived?: boolean;
  in_trash?: boolean;
  properties: Record<string, PropertyValue>;
}

export interface PropertySchema {
  id: string;
  name: string;
  type: string;
  select?: { options: { name: string; color?: string }[] };
  multi_select?: { options: { name: string; color?: string }[] };
  status?: { options: { name: string; color?: string }[] };
}

export interface Database {
  object: "database";
  id: string;
  url: string;
  created_time: string;
  last_edited_time: string;
  icon?: NotionIcon;
  parent: Parent;
  title: RichText[];
  description?: RichText[];
  is_inline?: boolean;
  archived?: boolean;
  properties: Record<string, PropertySchema>;
}

export type Result = Page | Database;

export interface Block {
  id: string;
  type: string;
  has_children?: boolean;
  [key: string]: any;
}

// ---------------------------------------------------------------------------
// Formatting

export const plain = (rich: RichText[] | undefined) => (rich ?? []).map((t) => t.plain_text).join("");

export function richToMarkdown(rich: RichText[] | undefined): string {
  return (rich ?? []).map((t) => {
    let s = t.plain_text;
    if (!s) return "";
    const a = t.annotations ?? {};
    if (a.code) s = `\`${s}\``;
    if (a.bold) s = `**${s}**`;
    if (a.italic) s = `_${s}_`;
    if (a.strikethrough) s = `~~${s}~~`;
    if (t.href) s = `[${s}](${t.href})`;
    return s;
  }).join("");
}

export function titleOf(r: Result): string {
  if (r.object === "database") return plain(r.title) || "Untitled database";
  const prop = Object.values(r.properties).find((p) => p.type === "title");
  return plain(prop?.title) || "Untitled";
}

/** The emoji of a page, else Backslash's glyph for pages or databases (pictures come from hosts we can't list). */
export function iconOf(r: Result): Icon {
  if (r.icon?.type === "emoji") return r.icon.emoji;
  return r.object === "database" ? { source: Icons.layers, tint: "blue" } : { source: Icons.file, tint: "gray" };
}

/** "5m", "3h", "2d", "25 Oct". */
export function since(iso: string, now = new Date()): string {
  const s = Math.max(0, (now.getTime() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h`;
  if (s < 7 * 86_400) return `${Math.floor(s / 86_400)}d`;
  return new Date(iso).toLocaleDateString("en", { day: "numeric", month: "short", year: "numeric" });
}

/** `https://www.notion.so/…` → `notion://www.notion.so/…`, opened by the desktop app. */
export const appUrl = (url: string) => url.replace(/^https:\/\//, "notion://");

/** Where a result lives: the title of its parent when it is in the same results. */
export function parentName(r: Result, titles: Map<string, string>): string {
  switch (r.parent.type) {
    case "workspace":
      return "Workspace";
    case "page_id":
      return titles.get(r.parent.page_id) ?? "Page";
    case "database_id":
      return titles.get(r.parent.database_id) ?? "Database";
    default:
      return "Block";
  }
}

/** A property of a page as one line of text, or nothing when it is empty. */
export function propertyText(p: PropertyValue): string | undefined {
  const v = p[p.type];
  switch (p.type) {
    case "title":
    case "rich_text":
      return plain(v) || undefined;
    case "select":
    case "status":
      return v?.name;
    case "multi_select":
      return (v as { name: string }[]).map((o) => o.name).join(", ") || undefined;
    case "number":
      return v == null ? undefined : String(v);
    case "checkbox":
      return v ? "Yes" : "No";
    case "date":
      return v ? (v.end ? `${v.start} → ${v.end}` : v.start) : undefined;
    case "people":
      return (v as { name?: string }[]).map((u) => u.name ?? "Someone").join(", ") || undefined;
    case "url":
    case "email":
    case "phone_number":
      return v || undefined;
    case "formula":
      return v?.[v.type] == null ? undefined : String(v[v.type]);
    case "unique_id":
      return v?.number == null ? undefined : `${v.prefix ? `${v.prefix}-` : ""}${v.number}`;
    default:
      return undefined;
  }
}

// ---------------------------------------------------------------------------
// Blocks → Markdown

export function blocksToMarkdown(blocks: Block[]): string {
  const out: string[] = [];
  let number = 0;
  for (const b of blocks) {
    const v = b[b.type] ?? {};
    const text = richToMarkdown(v.rich_text);
    number = b.type === "numbered_list_item" ? number + 1 : 0;
    switch (b.type) {
      case "paragraph":
        out.push(text);
        break;
      case "heading_1":
        out.push(`# ${text}`);
        break;
      case "heading_2":
        out.push(`## ${text}`);
        break;
      case "heading_3":
        out.push(`### ${text}`);
        break;
      case "bulleted_list_item":
        out.push(`- ${text}`);
        break;
      case "numbered_list_item":
        out.push(`${number}. ${text}`);
        break;
      case "to_do":
        out.push(`- [${v.checked ? "x" : " "}] ${text}`);
        break;
      case "toggle":
        out.push(`▸ ${text}`);
        break;
      case "quote":
        out.push(`> ${text}`);
        break;
      case "callout":
        out.push(`> ${v.icon?.type === "emoji" ? `${v.icon.emoji} ` : ""}${text}`);
        break;
      case "code":
        out.push(`\`\`\`${v.language && v.language !== "plain text" ? v.language : ""}\n${plain(v.rich_text)}\n\`\`\``);
        break;
      case "divider":
        out.push("---");
        break;
      case "child_page":
        out.push(`📄 **${v.title}**`);
        break;
      case "child_database":
        out.push(`🗂 **${v.title}**`);
        break;
      case "bookmark":
      case "embed":
      case "link_preview":
        if (v.url) out.push(`[${plain(v.caption) || v.url}](${v.url})`);
        break;
      case "image":
      case "file":
      case "pdf":
      case "video": {
        const url = v.external?.url ?? v.file?.url;
        out.push(url ? `[${plain(v.caption) || b.type}](${url})` : `_[${b.type}]_`);
        break;
      }
      case "equation":
        out.push(`\`${v.expression}\``);
        break;
      default:
        if (text) out.push(text);
    }
  }
  // List items stay together; other blocks are separated by a blank line.
  return out.reduce((md, line, i) => {
    if (!i) return line;
    const list = /^(- |\d+\. )/;
    return md + (list.test(line) && list.test(out[i - 1]) ? "\n" : "\n\n") + line;
  }, "");
}

// ---------------------------------------------------------------------------
// Writing

export const BLOCK_TYPES = [
  { value: "paragraph", title: "Text" },
  { value: "to_do", title: "To-do" },
  { value: "bulleted_list_item", title: "Bulleted list" },
  { value: "numbered_list_item", title: "Numbered list" },
  { value: "heading_3", title: "Heading" },
  { value: "quote", title: "Quote" },
  { value: "callout", title: "Callout" },
  { value: "code", title: "Code" },
];

const richText = (content: string) =>
  // Notion caps a text object at 2000 characters.
  (content.match(/[\s\S]{1,2000}/g) ?? []).map((part) => ({ type: "text", text: { content: part } }));

/** One block per line for lists and to-dos, one block for the rest. */
export function textToBlocks(text: string, type = "paragraph"): Block[] {
  const lines = ["to_do", "bulleted_list_item", "numbered_list_item"].includes(type)
    ? text.split("\n").map((l) => l.trim()).filter(Boolean)
    : type === "paragraph"
    ? text.split(/\n\s*\n/).map((l) => l.trim()).filter(Boolean)
    : [text.trim()];
  return lines.map((line) =>
    ({
      object: "block",
      type,
      [type]: {
        rich_text: richText(line),
        ...(type === "to_do" ? { checked: false } : {}),
        ...(type === "code" ? { language: "plain text" } : {}),
      },
    }) as unknown as Block
  );
}

export async function appendToPage(token: string, pageId: string, text: string, type = "paragraph") {
  const children = textToBlocks(text, type);
  if (!children.length) throw new Error("Nothing to add");
  await notion(token, `/blocks/${pageId}/children`, { method: "PATCH", body: { children } });
}

/** "today", "tomorrow", "2026-11-02" or "2026-11-02 14:30" → a Notion date. */
export function parseDate(input: string, now = new Date()): { start: string } | undefined {
  const t = input.trim().toLowerCase();
  if (!t) return undefined;
  const day = (offset: number) => {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };
  if (t === "today") return { start: day(0) };
  if (t === "tomorrow") return { start: day(1) };
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return { start: t };
  const m = /^(\d{4}-\d{2}-\d{2})[ t](\d{1,2}):(\d{2})$/.exec(t);
  if (m) return { start: new Date(`${m[1]}T${m[2].padStart(2, "0")}:${m[3]}:00`).toISOString() };
  throw new Error(`“${input}” is not a date: use YYYY-MM-DD, “today” or “tomorrow”`);
}

/** Properties a form can fill, in the database's order (title first). */
export const EDITABLE = [
  "title",
  "rich_text",
  "number",
  "select",
  "status",
  "multi_select",
  "checkbox",
  "date",
  "url",
  "email",
  "phone_number",
];

export function editableProperties(db: Database): PropertySchema[] {
  return Object.values(db.properties)
    .filter((p) => EDITABLE.includes(p.type))
    .sort((a, b) => Number(b.type === "title") - Number(a.type === "title"));
}

export function databaseFields(db: Database): Field[] {
  return editableProperties(db).map((p, i): Field => {
    const id = `p${i}`;
    switch (p.type) {
      case "title":
        return field.text(id, p.name, { required: true, placeholder: "Title" });
      case "select":
      case "status": {
        const options = (p[p.type as "select" | "status"]?.options ?? []).map((o) => o.name);
        return field.dropdown(
          id,
          p.name,
          [{ value: "", title: "—" }, ...options.map((o) => ({ value: o, title: o }))],
          {
            value: "",
          },
        );
      }
      case "checkbox":
        return field.checkbox(id, p.name);
      case "multi_select":
        return field.text(id, p.name, {
          placeholder: (p.multi_select?.options ?? []).slice(0, 6).map((o) => o.name).join(", ") || "Comma separated",
        });
      case "date":
        return field.text(id, p.name, { placeholder: "YYYY-MM-DD, today, tomorrow" });
      case "number":
        return field.text(id, p.name, { placeholder: "0" });
      default:
        return field.text(id, p.name);
    }
  });
}

/** The `properties` of a new page from the form's values. */
export function propertiesFrom(db: Database, values: FormValues, now = new Date()): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  editableProperties(db).forEach((p, i) => {
    const raw = values[`p${i}`];
    if (p.type === "checkbox") {
      out[p.name] = { checkbox: raw === true };
      return;
    }
    const text = String(raw ?? "").trim();
    if (!text) return;
    switch (p.type) {
      case "title":
      case "rich_text":
        out[p.name] = { [p.type]: richText(text) };
        break;
      case "number": {
        const n = Number(text.replace(",", "."));
        if (!Number.isFinite(n)) throw new Error(`${p.name}: “${text}” is not a number`);
        out[p.name] = { number: n };
        break;
      }
      case "select":
      case "status":
        out[p.name] = { [p.type]: { name: text } };
        break;
      case "multi_select":
        out[p.name] = { multi_select: text.split(",").map((s) => s.trim()).filter(Boolean).map((name) => ({ name })) };
        break;
      case "date":
        out[p.name] = { date: parseDate(text, now) };
        break;
      default:
        out[p.name] = { [p.type]: text };
    }
  });
  return out;
}

export function createPageForm(db: Database, ctx: Context): FormSpec {
  const name = titleOf(db);
  return form({
    title: `New page in ${name}`,
    submitTitle: "Create Page",
    fields: [...databaseFields(db), field.textArea("content", "Content", { placeholder: "Paragraphs of the page" })],
    async submit(values) {
      const token = needToken(ctx.preferences);
      const content = String(values.content ?? "").trim();
      const page = await notion<Page>(token, "/pages", {
        method: "POST",
        body: {
          parent: { database_id: db.id },
          properties: propertiesFrom(db, values),
          ...(content ? { children: textToBlocks(content) } : {}),
        },
      });
      await storage.set("lastDatabase", db.id).catch(() => {});
      await toast(`Created in ${name}`, { style: "success" });
      return detail({
        title: titleOf(page),
        markdown: `# ${titleOf(page)}\n\nCreated in **${name}**.`,
        metadata: [meta.text("Database", name, { icon: Icons.layers }), meta.link("Link", "Open in Notion", page.url)],
        status: "Page created",
        actions: [
          open(page.url, "Open in Notion"),
          open(appUrl(page.url), "Open in Notion App", { icon: Icons.apps }),
          copy(page.url, "Copy URL", { shortcut: "<Ctrl><Shift>c" }),
          action("Done", () => close()),
        ],
      });
    },
  });
}

export function addToPageForm(page: Page, ctx: Context): FormSpec {
  const title = titleOf(page);
  return form({
    title: `Add to ${title}`,
    submitTitle: "Add",
    fields: [
      field.textArea("text", "Text", { required: true, placeholder: "Appended at the end of the page" }),
      field.dropdown("type", "As", BLOCK_TYPES, { value: "paragraph" }),
    ],
    async submit(values) {
      await appendToPage(needToken(ctx.preferences), page.id, String(values.text), String(values.type));
      await storage.set("lastPage", page.id).catch(() => {});
      return close(`Added to ${title}`);
    },
  });
}

// ---------------------------------------------------------------------------
// Items

export function resultMetadata(r: Result, titles: Map<string, string>): Metadata[] {
  const lines: Metadata[] = [
    meta.text("Type", r.object === "database" ? (r.is_inline ? "Inline database" : "Database") : "Page", {
      icon: r.object === "database" ? Icons.layers : Icons.file,
    }),
    meta.text("In", parentName(r, titles), { icon: r.parent.type === "workspace" ? Icons.home : Icons.folder }),
  ];
  if (r.object === "page") {
    const props = Object.entries(r.properties)
      .filter(([, p]) => p.type !== "title")
      .map(([name, p]) => [name, propertyText(p)] as const)
      .filter(([, v]) => v)
      .slice(0, 8);
    if (props.length) lines.push(meta.separator(), ...props.map(([name, v]) => meta.text(name, v!)));
  } else {
    const names = Object.values(r.properties).map((p) => p.name);
    if (names.length) lines.push(meta.tags("Properties", names.slice(0, 10)));
  }
  lines.push(
    meta.separator(),
    meta.text("Edited", since(r.last_edited_time), { icon: Icons.clock }),
    meta.text("Created", since(r.created_time)),
  );
  return lines;
}

export async function pageContent(page: Page, ctx: Context): Promise<DetailSpec> {
  const token = needToken(ctx.preferences);
  const data = await notion<{ results: Block[]; has_more: boolean }>(
    token,
    `/blocks/${page.id}/children?page_size=100`,
  );
  const title = titleOf(page);
  const body = blocksToMarkdown(data.results) || "_Empty page._";
  return detail({
    title,
    markdown: `# ${page.icon?.type === "emoji" ? `${page.icon.emoji} ` : ""}${title}\n\n${body}${
      data.has_more ? "\n\n_…continued in Notion._" : ""
    }`,
    metadata: resultMetadata(page, new Map()),
    status: `Edited ${since(page.last_edited_time)}`,
    actions: resultActions(page, ctx, true),
  });
}

export function resultActions(r: Result, ctx: Context, page = false): Action[] {
  const title = titleOf(r);
  const actions: Action[] = [
    open(r.url, "Open in Browser"),
    open(appUrl(r.url), "Open in Notion App", { icon: Icons.apps, shortcut: "<Ctrl>o" }),
  ];
  if (r.object === "page") {
    if (!page) {
      actions.push(action("Show Content", () => pageContent(r, ctx), { icon: Icons.text, shortcut: "<Ctrl>d" }));
    }
    actions.push(action("Add to Page", () => addToPageForm(r, ctx), {
      icon: Icons.plus,
      shortcut: "<Ctrl>n",
      section: "Page",
    }));
  } else {
    actions.push(action("Create Page in Database", () => createPageForm(r, ctx), {
      icon: Icons.plus,
      shortcut: "<Ctrl>n",
      section: "Database",
    }));
  }
  actions.push(
    copy(r.url, "Copy URL", { shortcut: "<Ctrl><Shift>c", section: "Copy" }),
    copy(`[${title}](${r.url})`, "Copy as Markdown Link", { section: "Copy" }),
    copy(r.id, "Copy ID", { icon: Icons.hash, section: "Copy" }),
  );
  return actions;
}

export function resultItem(r: Result, ctx: Context, titles: Map<string, string>): Item {
  const accessories: Accessory[] = [];
  if (r.object === "database") accessories.push({ tag: "Database", color: "blue" });
  accessories.push({ text: since(r.last_edited_time), tooltip: "Last edited" });
  return {
    id: r.id,
    title: titleOf(r),
    subtitle: parentName(r, titles),
    icon: iconOf(r),
    keywords: [r.object, parentName(r, titles)],
    accessories,
    detail: { metadata: resultMetadata(r, titles) },
    actions: resultActions(r, ctx),
  };
}

/** Titles of the results, to name the parents of the others. */
export const titlesOf = (results: Result[]) => new Map(results.map((r) => [r.id, titleOf(r)]));

export async function search(
  token: string,
  query: string,
  kind: "page" | "database" | undefined,
  signal?: AbortSignal,
  size = 30,
): Promise<Result[]> {
  const data = await notion<{ results: Result[] }>(token, "/search", {
    method: "POST",
    signal,
    body: {
      ...(query.trim() ? { query: query.trim() } : {}),
      ...(kind ? { filter: { property: "object", value: kind } } : {}),
      sort: { direction: "descending", timestamp: "last_edited_time" },
      page_size: size,
    },
  });
  return data.results.filter((r) => !r.archived && !(r as Page).in_trash);
}
