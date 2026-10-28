// The views: a navigable tree, query results, conversions and errors.

import {
  type Action,
  action,
  clipboard,
  close,
  type Color,
  copy,
  detail,
  type DetailSpec,
  field,
  form,
  type FormSpec,
  type Icon,
  Icons,
  type Item,
  list,
  type ListSpec,
  meta,
  type Metadata,
  replace,
} from "@backslash/api";
import {
  breadcrumb,
  children,
  copyText,
  csvFriendly,
  excerpt,
  formatBytes,
  formatPath,
  inlinePreview,
  insight,
  isContainer,
  isQuery,
  type Json,
  jsonPath,
  type JsonType,
  jsPath,
  keyLabel,
  type ParseError,
  parseJson,
  type Path,
  previewJson,
  query,
  QueryError,
  sizeLabel,
  stats,
  toCsv,
  toToml,
  toYaml,
  typeOf,
  utf8Bytes,
} from "./lib.ts";

export interface Doc {
  root: Json;
  text: string;
  /** Where it came from: "Clipboard", "Search text", "Pasted". */
  source: string;
}

const TYPE_STYLE: Record<JsonType, { icon: string; tint: Color }> = {
  object: { icon: Icons.braces, tint: "blue" },
  array: { icon: Icons.layers, tint: "purple" },
  string: { icon: Icons.text, tint: "green" },
  number: { icon: Icons.hash, tint: "orange" },
  boolean: { icon: Icons.check, tint: "teal" },
  null: { icon: Icons.dot, tint: "gray" },
};

const typeIcon = (v: Json): Icon => {
  const t = typeOf(v);
  if (t === "boolean") return { source: v ? Icons.check : Icons.cross, tint: "teal" };
  return { source: TYPE_STYLE[t].icon, tint: TYPE_STYLE[t].tint };
};

/** Copies text computed only when the action runs (big documents stay cheap to list). */
function copyLazy(title: string, text: () => string, options: Parameters<typeof action>[2] = {}): Action {
  return action(title, async () => {
    await clipboard.write(text());
    return close(`Copied ${title.replace(/^Copy /, "").toLowerCase()}`);
  }, { icon: Icons.copy, ...options });
}

const MAX_ITEMS = 1000;

// ---------------------------------------------------------------------------
// Items

function itemDetail(value: Json, path: Path | null) {
  const t = typeOf(value);
  const { text, truncated } = previewJson(value, 60);
  const hint = insight(value);
  const metadata: Metadata[] = [
    meta.tags("Type", [{ text: t, color: TYPE_STYLE[t].tint }]),
    ...(isContainer(value) || typeof value === "string" ? [meta.text("Size", sizeLabel(value))] : []),
    ...(typeof value === "string" ? [meta.text("UTF-8", formatBytes(utf8Bytes(value)))] : []),
    ...(hint ? [meta.text("Looks like", hint, { icon: Icons.sparkle })] : []),
    ...(path
      ? [
        meta.separator(),
        meta.text("Path", formatPath(path), { icon: Icons.chevronRight }),
        meta.text("JSONPath", jsonPath(path)),
      ]
      : [meta.text("Path", "Computed by the query", { icon: Icons.sparkle })]),
  ];
  return {
    markdown: [
      "```json",
      text,
      "```",
      ...(truncated ? ["", "_Preview cut: open it or copy it to see everything._"] : []),
    ]
      .join("\n"),
    metadata,
  };
}

function valueActions(doc: Doc, value: Json, path: Path | null): Action[] {
  // A computed container (`| sort`) opens as a document of its own.
  const open = isContainer(value)
    ? [
      action(
        "Open",
        () => path ? nodeList(doc, path) : nodeList({ root: value, text: JSON.stringify(value), source: "Result" }, []),
        { icon: Icons.chevronRight },
      ),
    ]
    : [];
  const copyValue = isContainer(value)
    ? copyLazy("Copy Value", () => copyText(value), { shortcut: "<Ctrl><Shift>v" })
    : copy(copyText(value), "Copy Value", { shortcut: "<Ctrl><Shift>v" });
  return [
    ...open,
    copyValue,
    ...(path
      ? [
        copy(formatPath(path), "Copy Path", { icon: Icons.chevronRight, shortcut: "<Ctrl><Shift>c", section: "Path" }),
        copy(jsonPath(path), "Copy JSONPath", {
          icon: Icons.chevronRight,
          shortcut: "<Ctrl><Shift>j",
          section: "Path",
        }),
        copy(jsPath(path), "Copy JavaScript Accessor", { icon: Icons.code, section: "Path" }),
      ]
      : []),
    ...(isContainer(value)
      ? [
        copyLazy("Copy Formatted JSON", () => JSON.stringify(value, null, 2), { section: "Copy" }),
        copyLazy("Copy Minified JSON", () => JSON.stringify(value), { section: "Copy", shortcut: "<Ctrl><Shift>m" }),
        action("Convert…", () => convertList(value, path), {
          icon: Icons.shuffle,
          shortcut: "<Ctrl>e",
          section: "Copy",
        }),
      ]
      : [copy(JSON.stringify(value), "Copy as JSON Literal", { section: "Copy" })]),
  ];
}

function valueItem(doc: Doc, key: string, value: Json, path: Path | null, section?: string): Item {
  const t = typeOf(value);
  return {
    id: path ? formatPath(path) : `${section}:${key}`,
    title: key,
    subtitle: inlinePreview(value, 70),
    icon: typeIcon(value),
    section,
    accessories: [
      ...(isContainer(value) || typeof value === "string" ? [{ text: sizeLabel(value) }] : []),
      { tag: t, color: TYPE_STYLE[t].tint },
    ],
    detail: itemDetail(value, path),
    actions: valueActions(doc, value, path),
  };
}

// ---------------------------------------------------------------------------
// The tree

const QUERY_HELP = [
  "## Queries",
  "",
  '- `.a.b`, `."a b"`, `["a b"]`: a key',
  "- `[0]`, `[-1]`, `[1:3]`, `[0,2]`: items",
  "- `[]`, `[*]`, `.*`: everything inside",
  "- `..name`: every `name`, at any depth",
  "- `[?(@.price < 10)]`, `[?(@.tags)]`, `[?(@.name =~ /ada/i)]`: filters",
  "- `| keys`, `| length`, `| type`, `| first`, `| last`, `| sort`, `| unique`, `| flatten`, `| reverse`",
  "- `| select(.age >= 18)`, `| .name`: jq pipes on each result",
  "",
  "A leading `$` (JSONPath) works too.",
].join("\n");

/** The keys (or items) at `path`, filtered as you type, or a query's results. */
export function nodeList(doc: Doc, path: Path, initialQuery = ""): ListSpec {
  let node = doc.root;
  for (const k of path) node = (node as Record<string, Json>)[k as string];
  const entries = children(node);
  const { values, depth } = path.length ? { values: 0, depth: 0 } : stats(doc.root);
  const summary = path.length
    ? `${formatPath(path)} · ${typeOf(node)} · ${sizeLabel(node)}`
    : `${doc.source} · ${typeOf(node)} · ${sizeLabel(node)} · ${
      values.toLocaleString("en")
    } values · depth ${depth} · ${formatBytes(utf8Bytes(doc.text))}`;
  let status = summary;
  return list({
    title: breadcrumb(path),
    placeholder: "Filter keys, or query: .a.b[0], ..name, [?(@.price < 10)], | keys",
    empty: { title: "Empty", description: `This ${typeOf(node)} has nothing inside.`, icon: Icons.braces },
    status: () => status,
    actions: [
      copyLazy("Copy Formatted JSON", () => JSON.stringify(node, null, 2), { section: "This Node" }),
      copyLazy("Copy Minified JSON", () => JSON.stringify(node), { section: "This Node" }),
      action("Convert…", () => convertList(node, path), { icon: Icons.shuffle, section: "This Node" }),
      ...(path.length ? [copy(formatPath(path), "Copy Path", { icon: Icons.chevronRight, section: "This Node" })] : []),
      action("Reload from Clipboard", async () => replace(await fromClipboard()), {
        icon: Icons.refresh,
        shortcut: "<Ctrl>r",
        section: "Source",
      }),
      action("Paste JSON…", () => pasteForm(), { icon: Icons.paste, section: "Source" }),
    ],
    search(input) {
      const q = input.trim() === initialQuery.trim() ? "" : input.trim();
      if (q && isQuery(q)) {
        let results;
        try {
          results = query(node, q, path);
        } catch (e) {
          status = "Query error";
          const message = e instanceof QueryError ? e.message : e instanceof Error ? e.message : String(e);
          return [{
            id: "query-error",
            title: message,
            subtitle: q,
            icon: { source: Icons.alert, tint: "orange" },
            detail: { markdown: QUERY_HELP },
          }];
        }
        status = `${results.length.toLocaleString("en")} result${results.length === 1 ? "" : "s"} · ${q}`;
        if (!results.length) {
          return [{
            id: "no-result",
            title: "No match",
            subtitle: q,
            icon: { source: Icons.search, tint: "gray" },
            detail: { markdown: QUERY_HELP },
          }];
        }
        return results.slice(0, MAX_ITEMS).map((r, i) =>
          valueItem(doc, r.path ? formatPath(r.path) : `Result ${i + 1}`, r.value, r.path, "Results")
        );
      }
      const words = q.toLowerCase().split(/\s+/).filter(Boolean);
      const shown = words.length
        ? entries.filter(({ key, value }) => {
          const hay = `${key} ${isContainer(value) ? "" : String(value)}`.toLowerCase();
          return words.every((w) => hay.includes(w));
        })
        : entries;
      status = words.length ? `${shown.length} of ${entries.length} · ${summary}` : summary;
      const items = shown.slice(0, MAX_ITEMS).map(({ key, value }) =>
        valueItem(doc, keyLabel(key), value, [...path, key])
      );
      if (shown.length > MAX_ITEMS) {
        items.push({
          id: "more",
          title: `${(shown.length - MAX_ITEMS).toLocaleString("en")} more`,
          subtitle: "Type to filter, or query a range: [1000:2000]",
          icon: { source: Icons.info, tint: "gray" },
        });
      }
      return items;
    },
  });
}

// ---------------------------------------------------------------------------
// Conversions

export function convertList(value: Json, path: Path | null): ListSpec {
  const where = path ? formatPath(path) : "the result";
  const formats: { id: string; title: string; lang: string; make: () => string; note?: () => string }[] = [
    { id: "pretty", title: "Formatted JSON", lang: "json", make: () => JSON.stringify(value, null, 2) },
    { id: "min", title: "Minified JSON", lang: "json", make: () => JSON.stringify(value) },
    { id: "yaml", title: "YAML", lang: "yaml", make: () => toYaml(value) },
    {
      id: "toml",
      title: "TOML",
      lang: "toml",
      make: () => toToml(value).text,
      note: () => {
        const n = toToml(value).droppedNulls;
        return n ? `TOML has no null: ${n} null value${n === 1 ? " was" : "s were"} left out.` : "";
      },
    },
    {
      id: "csv",
      title: "CSV",
      lang: "csv",
      make: () => toCsv(value),
      note: () =>
        csvFriendly(value)
          ? "Columns are every key of the objects; nested values are written as JSON."
          : "Works best with an array of objects.",
    },
  ];
  return list({
    title: `Convert ${where}`,
    placeholder: "Pick a format…",
    items: () =>
      formats.map((f) => {
        let text: string;
        try {
          text = f.make();
        } catch (e) {
          return {
            id: f.id,
            title: f.title,
            subtitle: e instanceof Error ? e.message : String(e),
            icon: { source: Icons.cross, tint: "gray" },
            accessories: [{ tag: "Not possible", color: "gray" as const }],
          };
        }
        const lines = text.replace(/\n$/, "").split("\n");
        const shown = lines.length > 80 ? [...lines.slice(0, 80), "…"] : lines;
        const note = f.note?.();
        return {
          id: f.id,
          title: f.title,
          subtitle: `${lines.length.toLocaleString("en")} line${lines.length === 1 ? "" : "s"} · ${
            formatBytes(utf8Bytes(text))
          }`,
          icon: { source: f.lang === "json" ? Icons.braces : Icons.file, tint: "blue" },
          detail: {
            markdown: [...(note ? [note, ""] : []), "```" + f.lang, ...shown, "```"].join("\n"),
          },
          actions: [
            copy(text, `Copy ${f.title}`),
            action(`Show ${f.title}`, () =>
              detail({
                title: `${f.title} · ${where}`,
                markdown: ["```" + f.lang, text, "```"].join("\n"),
                actions: [copy(text, `Copy ${f.title}`)],
              }), { icon: Icons.eye }),
          ],
        };
      }),
  });
}

// ---------------------------------------------------------------------------
// Sources and errors

export function errorView(text: string, error: ParseError, source: string): DetailSpec {
  if (error.message === "The text is empty") {
    return detail({
      title: "No JSON",
      markdown: [
        `## The ${source.toLowerCase()} is empty`,
        "",
        "Copy some JSON and open JSON Explorer again, paste it with **Paste JSON…**, or type it after the command name.",
      ].join("\n"),
      actions: sourceActions(),
    });
  }
  return detail({
    title: "Invalid JSON",
    markdown: [
      `## ${error.message}`,
      "",
      `Line ${error.line}, column ${error.column}${error.hint ? `. ${error.hint}.` : "."}`,
      "",
      "```",
      excerpt(text, error.line, error.column),
      "```",
    ].join("\n"),
    metadata: [
      meta.text("Line", error.line, { icon: Icons.alert, color: "red" }),
      meta.text("Column", error.column),
      meta.text("Offset", error.offset),
      meta.separator(),
      meta.text("Source", source),
      meta.text(
        "Length",
        `${text.length.toLocaleString("en")} chars, ${text.split("\n").length} line${text.includes("\n") ? "s" : ""}`,
      ),
    ],
    actions: [
      ...sourceActions(),
      copy(`${error.line}:${error.column}`, "Copy Line:Column", { section: "Copy" }),
      copy(`${error.message} (line ${error.line}, column ${error.column})`, "Copy Error", { section: "Copy" }),
    ],
  });
}

function sourceActions(): Action[] {
  return [
    action("Reload from Clipboard", async () => replace(await fromClipboard()), {
      icon: Icons.refresh,
      shortcut: "<Ctrl>r",
    }),
    action("Paste JSON…", () => pasteForm(), { icon: Icons.paste, shortcut: "<Ctrl>n" }),
  ];
}

export function explore(text: string, source: string, initialQuery = ""): ListSpec | DetailSpec {
  const parsed = parseJson(text);
  if (!parsed.ok) return errorView(text, parsed.error, source);
  return nodeList({ root: parsed.value, text, source }, [], initialQuery);
}

export async function fromClipboard(): Promise<ListSpec | DetailSpec> {
  return explore(await clipboard.read().catch(() => ""), "Clipboard");
}

export function pasteForm(): FormSpec {
  return form({
    title: "Paste JSON",
    submitTitle: "Explore",
    fields: [field.textArea("json", "JSON", { required: true, placeholder: '{ "paste": "here" }' })],
    submit: (values) => replace(explore(String(values.json ?? ""), "Pasted text")),
  });
}
