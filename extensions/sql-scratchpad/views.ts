// Views shared by the commands: query rows, the query form, results and their exports, connections and tables.

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
  list,
  type ListSpec,
  meta,
  open,
  pop,
  replace,
  submenu,
  toast,
} from "@backslash/api";
import {
  type Connection,
  connectionUrl,
  dangerous,
  describe,
  formatMs,
  KIND_COLORS,
  KIND_NAMES,
  oneLine,
  plural,
  previewQuery,
  type Query,
  tablesQuery,
  toCsv,
  toJson,
  toMarkdown,
  writes,
} from "./lib.ts";
import {
  connectionFor,
  connectionsOf,
  deleteQuery,
  exportFile,
  HOME,
  type Prefs,
  QUERIES_DIR,
  queryPath,
  type Run,
  runQuery,
  saveQuery,
} from "./system.ts";

const fence = (text: string, lang = "") => {
  const longest = Math.max(2, ...(text.match(/`+/g) ?? []).map((t) => t.length));
  const f = "`".repeat(longest + 1);
  return `${f}${lang}\n${text}\n${f}`;
};

const MAX_ROWS_SHOWN = 1000;

// ---------------------------------------------------------------------------
// Live lists: saving, duplicating or deleting a query reloads the list it came from.

const changes = new EventTarget();
const changed = () => changes.dispatchEvent(new Event("change"));

/** Yields `load()` again after every change made from this process. */
export async function* live<T>(load: () => Promise<T>, signal: AbortSignal): AsyncGenerator<T> {
  while (!signal.aborted) {
    yield await load();
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
}

// ---------------------------------------------------------------------------
// Running

/** Runs the SQL and shows the results; read-only unless the user confirmed a change. */
async function execute(
  c: Connection,
  sql: string,
  ctx: Context,
  title: string,
  query?: Query,
): Promise<ListSpec | DetailSpec> {
  const allowWrites = writes(sql, c.kind).length > 0;
  const run = await runQuery(c, sql, {
    allowWrites,
    signal: ctx.signal,
    timeout: Number((ctx.preferences as Prefs).timeout) || undefined,
  });
  if (allowWrites) await toast(`Done on ${c.name}`, { style: "success", message: run.result.message });
  return resultsView(run, title, query);
}

/** The Run action: plain for a read-only query, red with a confirmation when it changes data. */
export function runAction(c: Connection, sql: string, title: string, query?: Query, label?: string): Action {
  const changes = writes(sql, c.kind);
  const warnings = dangerous(sql, c.kind);
  const name = label ?? (changes.length ? `Run on ${c.name} (Changes Data)` : `Run on ${c.name}`);
  return action(name, (ctx) => execute(c, sql, ctx, title, query), {
    icon: changes.length ? Icons.alert : Icons.play,
    ...(changes.length
      ? {
        destructive: true,
        confirm: `${changes.join(", ")} on ${c.name}${warnings.length ? ` (${warnings.join("; ")})` : ""}: run it?`,
      }
      : {}),
  });
}

function runOnMenu(sql: string, title: string, prefs: Prefs, query?: Query): Action[] {
  const { connections } = connectionsOf(prefs);
  if (connections.length < 2) return [];
  return [submenu("Run on…", connections.map((c) => runAction(c, sql, title, query, c.name)), {
    icon: Icons.database,
    shortcut: "<Ctrl><Shift>r",
  })];
}

// ---------------------------------------------------------------------------
// Results

const base = (title: string) =>
  title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "query";

function exportActions(run: Run, title: string): Action[] {
  const r = run.result;
  const save = (ext: string, text: () => string) =>
    action(`Save ${ext.toUpperCase()} to Downloads`, async () => {
      const path = await exportFile(base(title), ext, text());
      await toast(`Saved ${path.split("/").pop()}`, { style: "success", message: "In ~/Downloads" });
    }, { icon: Icons.download, section: "Export" });
  return [
    copy(toCsv(r), "Copy as CSV", { icon: Icons.copy, shortcut: "<Ctrl><Shift>c", section: "Copy" }),
    copy(toJson(r), "Copy as JSON", { icon: Icons.braces, shortcut: "<Ctrl><Shift>j", section: "Copy" }),
    copy(toMarkdown(r), "Copy as Markdown Table", { icon: Icons.text, shortcut: "<Ctrl><Shift>m", section: "Copy" }),
    save("csv", () => toCsv(r)),
    save("json", () => toJson(r)),
    save("md", () => toMarkdown(r) + "\n"),
  ];
}

function commonActions(run: Run, title: string, query?: Query): Action[] {
  return [
    action("Run Again", async (ctx) => replace(await execute(run.connection, run.sql, ctx, title, query)), {
      icon: Icons.refresh,
      shortcut: "<Ctrl>r",
      ...(run.writes ? { destructive: true, confirm: `Run the change on ${run.connection.name} again?` } : {}),
    }),
    copy(run.sql, "Copy SQL", { icon: Icons.code, section: "Copy" }),
    ...(query ? [] : [action("Save Query…", () => queryForm({ sql: run.sql, connection: run.connection.name }), {
      icon: Icons.bookmark,
      shortcut: "<Ctrl>s",
    })]),
  ];
}

export function resultsView(run: Run, title: string, query?: Query): ListSpec | DetailSpec {
  const r = run.result;
  const footer = `${run.connection.name} · ${formatMs(run.ms)}`;
  if (!r.columns.length) {
    return detail({
      title,
      markdown: `## ${r.message ?? "Done"}\n\n${fence(run.sql, "sql")}`,
      status: footer,
      metadata: [
        meta.text("Connection", run.connection.name, { icon: Icons.database, color: KIND_COLORS[run.connection.kind] }),
        meta.text("Time", formatMs(run.ms), { icon: Icons.timer }),
      ],
      actions: commonActions(run, title, query),
    });
  }
  const table = action("Show as Table", () =>
    detail({
      title,
      markdown: [
        toMarkdown(r, 200),
        ...(r.rows.length > 200 ? ["", `_First 200 rows of ${r.rows.length}: copy or save the rest._`] : []),
      ].join("\n"),
      status: `${plural(r.rows.length, "row")} · ${footer}`,
      actions: [...exportActions(run, title)],
    }), { icon: Icons.layers, shortcut: "<Ctrl>t" });
  const shared = [table, ...exportActions(run, title), ...commonActions(run, title, query)];
  const rows = r.rows.slice(0, MAX_ROWS_SHOWN);
  return list({
    title,
    placeholder: `Filter ${plural(r.rows.length, "row")}…`,
    empty: { title: "No rows", description: "The query returned no rows", icon: Icons.database },
    status: `${plural(r.rows.length, "row")}${r.rows.length > rows.length ? ` (first ${rows.length} shown)` : ""} · ${
      plural(r.columns.length, "column")
    } · ${footer}`,
    actions: shared,
    items: rows.map((row, i) => {
      const record = Object.fromEntries(r.columns.map((c, j) => [c, row[j] ?? ""]));
      return {
        id: `row:${i}`,
        title: row[0] || "—",
        subtitle: row.slice(1, 6).map((v) => v || "—").join(" · ").slice(0, 160),
        icon: { source: Icons.square, tint: KIND_COLORS[run.connection.kind] },
        accessories: [{ text: `#${i + 1}` }],
        detail: {
          metadata: r.columns.map((c, j) => meta.text(c, (row[j] ?? "").slice(0, 500) || "—")),
        },
        actions: [
          copy(row[0] ?? "", `Copy ${r.columns[0]}`),
          copy(JSON.stringify(record, null, 2), "Copy Row as JSON", { icon: Icons.braces, shortcut: "<Ctrl>j" }),
          ...shared,
        ],
      };
    }),
  });
}

// ---------------------------------------------------------------------------
// Queries

/** Creates or edits a saved query; running is offered when it doesn't change data. */
export function queryForm(
  options: { query?: Query; sql?: string; connection?: string; after?: "pop" | "close" } = {},
  prefs: Prefs = {},
): FormSpec {
  const q = options.query;
  const { connections } = connectionsOf(prefs);
  const choices = [
    { value: "", title: "Default connection" },
    ...connections.map((c) => ({ value: c.name, title: c.name })),
  ];
  const current = q?.connection ?? options.connection ?? "";
  if (current && !choices.some((c) => c.value === current)) {
    choices.push({ value: current, title: `${current} (unknown)` });
  }
  return form({
    title: q ? `Edit “${q.name}”` : "New SQL Query",
    submitTitle: q ? "Save Changes" : "Save Query",
    fields: [
      field.text("name", "Name", { required: true, value: q?.name ?? "", placeholder: "Active users this week" }),
      field.dropdown("connection", "Connection", choices, { value: current }),
      field.textArea("sql", "SQL", {
        required: true,
        value: q?.sql ?? options.sql ?? "",
        placeholder: "SELECT id, email FROM users WHERE created_at > now() - interval '7 days';",
      }),
      field.checkbox("run", "Run after saving (read-only queries)", { value: !q }),
    ],
    async submit(values, ctx) {
      const name = String(values.name ?? "").trim();
      const sql = String(values.sql ?? "").trim();
      if (!name) throw new Error("Give the query a name");
      if (!sql) throw new Error("Write some SQL");
      const connection = String(values.connection ?? "") || undefined;
      const file = await saveQuery({ name, connection, sql }, q?.file);
      changed();
      const saved: Query = { file, name, connection, sql };
      const conn = connectionFor(saved, ctx.preferences as Prefs);
      if (values.run && conn) {
        if (writes(sql, conn.kind).length) {
          await toast(`Saved “${name}”`, {
            style: "success",
            message: "It changes data: run it from the list to confirm",
          });
          return options.after === "close" ? close(`Saved “${name}”`) : pop();
        }
        return replace(await execute(conn, sql, ctx, name, saved));
      }
      await toast(`Saved “${name}”`, { style: "success" });
      return options.after === "close" ? close(`Saved “${name}”`) : pop();
    },
  });
}

export function queryItem(q: Query, prefs: Prefs): Item {
  const conn = connectionFor(q, prefs);
  const changes = conn ? writes(q.sql, conn.kind) : [];
  const missing = q.connection && conn?.name.toLowerCase() !== q.connection.toLowerCase();
  return {
    id: `query:${q.file}`,
    title: q.name,
    subtitle: oneLine(q.sql),
    icon: {
      source: changes.length ? Icons.alert : Icons.database,
      tint: changes.length ? "orange" : conn ? KIND_COLORS[conn.kind] : "gray",
    },
    section: conn ? conn.name : "No Connection",
    keywords: [q.file, q.connection ?? "", ...changes],
    accessories: [
      ...(changes.length
        ? [{ tag: changes[0], color: "orange" as const, tooltip: "Changes data: asks before running" }]
        : []),
      ...(missing
        ? [{ icon: { source: Icons.alert, tint: "red" as const }, tooltip: `No connection named ${q.connection}` }]
        : []),
    ],
    detail: {
      markdown: fence(q.sql, "sql"),
      metadata: [
        meta.text("Connection", conn ? conn.name : "None configured", {
          icon: Icons.database,
          color: conn ? KIND_COLORS[conn.kind] : "gray",
        }),
        ...(missing ? [meta.text("Wanted", `${q.connection} (not in Settings)`, { color: "red" })] : []),
        ...(conn ? [meta.text("Database", describe(conn, HOME), { icon: Icons.server })] : []),
        meta.text("Mode", changes.length ? `Changes data (${changes.join(", ")})` : "Read-only", {
          icon: changes.length ? Icons.alert : Icons.lock,
          color: changes.length ? "orange" : "green",
        }),
        meta.text("File", `~/.local/share/sql-scratchpad/${q.file}`, { icon: Icons.file }),
      ],
    },
    actions: [
      ...(conn
        ? [runAction(conn, q.sql, q.name, q)]
        : [action("Add a Connection", () => setupDetail(), { icon: Icons.plus })]),
      ...runOnMenu(q.sql, q.name, prefs, q),
      action("Edit Query…", () => queryForm({ query: q }, prefs), { icon: Icons.text, shortcut: "<Ctrl>e" }),
      copy(q.sql, "Copy SQL", { icon: Icons.code, shortcut: "<Ctrl><Shift>c", section: "Copy" }),
      open(queryPath(q.file), "Open in Editor", { icon: Icons.file, shortcut: "<Ctrl>o" }),
      action("Duplicate", async () => {
        await saveQuery({ name: `${q.name} (copy)`, connection: q.connection, sql: q.sql });
        changed();
        await toast("Duplicated", { style: "success" });
      }, { icon: Icons.copy }),
      action("Delete Query", async () => {
        await deleteQuery(q.file);
        changed();
        await toast(`Deleted “${q.name}”`);
      }, {
        icon: Icons.trash,
        destructive: true,
        confirm: `Delete “${q.name}”?`,
        section: "Danger",
        shortcut: "<Ctrl>x",
      }),
    ],
  };
}

export const newQueryAction = (prefs: Prefs) =>
  action("New Query…", () => queryForm({}, prefs), { icon: Icons.plus, shortcut: "<Ctrl>n" });

export const openFolderAction = () =>
  open(QUERIES_DIR, "Open Queries Folder", { icon: Icons.folder, section: "Folder" });

// ---------------------------------------------------------------------------
// Connections

export function setupDetail(): DetailSpec {
  return detail({
    title: "Add a Connection",
    markdown: [
      "## Add your databases",
      "",
      "In **Settings → Extensions → SQL Scratchpad → Connections**, list them as `name=url`, separated by `;`:",
      "",
      fence(
        "prod=postgresql://app:secret@db.example.com:5432/shop?sslmode=require; local=mysql://root@localhost/dev; notes=sqlite:///home/me/notes.db",
      ),
      "",
      "- **PostgreSQL** runs through `psql`, **MySQL / MariaDB** through `mysql`, **SQLite** through `sqlite3`.",
      "- Queries run in **read-only** sessions. Queries that change data (INSERT, UPDATE, DELETE, DROP…) ask first.",
      "- Passwords are passed to the clients in their environment, never on the command line.",
    ].join("\n"),
  });
}

export function setupItem(errors: string[] = []): Item {
  return {
    id: "setup",
    title: errors.length ? "Some connections can't be read" : "Add a database connection",
    subtitle: errors[0] ?? "Settings → Extensions → SQL Scratchpad → Connections",
    icon: { source: errors.length ? Icons.alert : Icons.key, tint: "orange" },
    section: "Connections",
    detail: {
      markdown: setupDetail().markdown as string +
        (errors.length ? `\n\n**Problems:**\n\n${errors.map((e) => `- ${e}`).join("\n")}` : ""),
    },
    actions: [action("How to Add Connections", () => setupDetail(), { icon: Icons.info })],
  };
}

function tablesView(c: Connection, prefs: Prefs): ListSpec {
  return list({
    title: `Tables of ${c.name}`,
    placeholder: `Filter tables of ${c.name}…`,
    empty: { title: "No tables", description: "This database has no table or view you can see", icon: Icons.layers },
    status: (items) => plural(items.length, "table"),
    async items({ signal }) {
      const run = await runQuery(c, tablesQuery(c.kind), { allowWrites: false, signal, timeout: prefs.timeout });
      return run.result.rows.map(([schema, name, type]) => {
        const sql = previewQuery(c.kind, schema, name);
        const isView = /view/i.test(type);
        return {
          id: `${schema}.${name}`,
          title: name,
          subtitle: c.kind === "sqlite" ? undefined : schema,
          icon: { source: isView ? Icons.eye : Icons.layers, tint: KIND_COLORS[c.kind] },
          section: c.kind === "sqlite" ? undefined : schema,
          accessories: [{ tag: isView ? "view" : "table" }],
          actions: [
            runAction(c, sql, name, undefined, "Show First 100 Rows"),
            action("New Query on This Table…", () => queryForm({ sql, connection: c.name }, prefs), {
              icon: Icons.plus,
            }),
            copy(name, "Copy Table Name", { section: "Copy" }),
          ],
        };
      });
    },
  });
}

export function connectionItem(c: Connection, prefs: Prefs, isDefault: boolean): Item {
  return {
    id: `connection:${c.name}`,
    title: c.name,
    subtitle: describe(c, HOME),
    icon: { source: Icons.database, tint: KIND_COLORS[c.kind] },
    section: "Connections",
    keywords: [KIND_NAMES[c.kind], c.host ?? "", c.database ?? ""],
    accessories: [...(isDefault ? [{ tag: "default", color: "purple" as const }] : []), { text: KIND_NAMES[c.kind] }],
    detail: {
      metadata: [
        meta.text("Type", KIND_NAMES[c.kind], { icon: Icons.database, color: KIND_COLORS[c.kind] }),
        ...(c.kind === "sqlite" ? [meta.text("File", describe(c, HOME), { icon: Icons.file })] : [
          meta.text("Host", `${c.host ?? "localhost"}${c.port ? `:${c.port}` : ""}`, { icon: Icons.server }),
          ...(c.database ? [meta.text("Database", c.database)] : []),
          ...(c.user ? [meta.text("User", c.user, { icon: Icons.person })] : []),
          meta.text("Password", c.password ? "Set" : "None (the client's own files may have it)", { icon: Icons.key }),
        ]),
        meta.text("URL", connectionUrl(c), { icon: Icons.link }),
      ],
    },
    actions: [
      action("Browse Tables", () => tablesView(c, prefs), { icon: Icons.layers }),
      action("New Query…", () => queryForm({ connection: c.name }, prefs), { icon: Icons.plus, shortcut: "<Ctrl>n" }),
      copy(connectionUrl(c, true), "Copy URL", {
        concealed: !!c.password,
        icon: Icons.link,
        shortcut: "<Ctrl><Shift>c",
        section: "Copy",
      }),
    ],
  };
}
