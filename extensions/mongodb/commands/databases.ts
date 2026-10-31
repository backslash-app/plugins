import { action, close, copy, Icons, type Item, list, type ListSpec, meta, open, refresh } from "@backslash/api";
import {
  bytes,
  type CollectionRow,
  type Connection,
  count,
  type DatabaseRow,
  docTitle,
  hasPassword,
  idLiteral,
  idText,
  isSystemDb,
  objectIdTime,
  parseConnections,
  plural,
  redact,
  type ServerInfo,
  shellJson,
  sortCollections,
  sortDatabases,
  withDatabase,
} from "../lib.ts";
import { collections, documents, MissingError, serverInfo } from "../mongosh.ts";
import { runInTerminal } from "../terminal.ts";

interface Prefs {
  connections?: string;
  showSystem?: boolean;
  terminal?: string;
}

const errorText = (e: unknown) => e instanceof Error ? e.message : String(e);
const fence = (text: string) => `\`\`\`js\n${text.replace(/```/g, "ʼʼʼ")}\n\`\`\``;

function shellAction(uri: string, prefs: Prefs, title = "Open in mongosh") {
  return action(title, () => {
    runInTerminal(["mongosh", uri], prefs.terminal || undefined);
    return close();
  }, { icon: Icons.terminal, shortcut: "<Ctrl>t" });
}

function copyUri(uri: string, title = "Copy Connection String", o: { section?: string; shortcut?: string } = {}) {
  return copy(uri, title, { icon: Icons.link, concealed: hasPassword(uri), ...o });
}

// ---------------------------------------------------------------------------
// Documents

function documentItem(db: string, coll: string, doc: Record<string, unknown>): Item {
  const id = idText(doc._id);
  const created = objectIdTime(doc._id);
  const text = shellJson(doc);
  const ns = `db.getSiblingDB(${JSON.stringify(db)}).getCollection(${JSON.stringify(coll)})`;
  const fields = Object.keys(doc).filter((k) => k !== "_id");
  return {
    id,
    title: docTitle(doc),
    subtitle: docTitle(doc) === id ? undefined : id,
    icon: { source: Icons.braces, tint: "green" },
    keywords: [id, ...fields],
    accessories: [
      { text: `${fields.length} field${fields.length === 1 ? "" : "s"}` },
      ...(created
        ? [{ text: new Date(created).toLocaleDateString("en-GB"), tooltip: "Created (from its ObjectId)" }]
        : []),
    ],
    detail: { markdown: fence(text.length > 20_000 ? `${text.slice(0, 20_000)}\n…` : text) },
    actions: [
      copy(text, "Copy Document"),
      copy(id, "Copy _id", { shortcut: "<Ctrl>period" }),
      copy(`${ns}.findOne({ _id: ${idLiteral(doc._id)} })`, "Copy findOne Query", { icon: Icons.terminal }),
      copy(JSON.stringify(doc), "Copy as Extended JSON", { section: "Copy" }),
    ],
  };
}

function documentsView(conn: Connection, db: string, coll: CollectionRow, prefs: Prefs): ListSpec {
  let status = "";
  return list({
    title: `${db}.${coll.name}`,
    placeholder: `Filter, in shell syntax: { status: "paid", total: { $gt: 100 } }`,
    empty: { title: "No documents", description: "Nothing matches this filter", icon: Icons.braces },
    status: () => status,
    actions: [shellAction(withDatabase(conn.uri, db), prefs)],
    async search(query, { signal }) {
      try {
        const res = await documents(conn.uri, db, coll.name, query, signal);
        status = `${res.total !== undefined ? `${res.total.toLocaleString("en-US")} documents` : ""}${
          res.docs.length ? ` · latest ${res.docs.length}` : ""
        }${query.trim() ? " matching" : ""}`;
        return res.docs.map((d) => documentItem(db, coll.name, d));
      } catch (e) {
        if (signal.aborted) return [];
        status = "";
        return [{
          id: "error",
          title: query.trim() ? "This filter doesn't work" : "Can't read the documents",
          subtitle: errorText(e).slice(0, 120),
          icon: { source: Icons.alert, tint: "red" },
          detail: {
            markdown: `${
              fence(errorText(e))
            }\n\nA filter is a shell object: \`{ email: /@example\\.com$/ }\`, \`{ _id: ObjectId("…") }\`, \`{ createdAt: { $gte: ISODate("2026-10-01") } }\`.`,
          },
        }];
      }
    },
  });
}

// ---------------------------------------------------------------------------
// Collections

function collectionItem(conn: Connection, db: string, c: CollectionRow, prefs: Prefs): Item {
  const ns = `db.getSiblingDB(${JSON.stringify(db)}).getCollection(${JSON.stringify(c.name)})`;
  const view = c.type === "view";
  return {
    id: c.name,
    title: c.name,
    subtitle: view
      ? `view on ${c.viewOn ?? "?"}`
      : c.type === "timeseries"
      ? "time series"
      : c.capped
      ? "capped"
      : undefined,
    icon: { source: view ? Icons.eye : Icons.layers, tint: c.name.startsWith("system.") ? "gray" : "green" },
    section: c.name.startsWith("system.") ? "System" : view ? "Views" : "Collections",
    accessories: [
      ...(c.count !== undefined
        ? [{
          text: `${count(c.count)} doc${c.count === 1 ? "" : "s"}`,
          tooltip: `${c.count.toLocaleString("en-US")} document${c.count === 1 ? "" : "s"} (estimated)`,
        }]
        : []),
      ...(c.storageSize !== undefined ? [{ text: bytes(c.storageSize), tooltip: "Storage size" }] : []),
      ...(c.indexes ? [{ text: `${c.indexes} ${c.indexes === 1 ? "index" : "indexes"}`, icon: Icons.hash }] : []),
    ],
    detail: {
      stats: [
        ...(c.count !== undefined ? [{ label: "documents", value: count(c.count) }] : []),
        ...(c.size !== undefined ? [{ label: "data", value: bytes(c.size) }] : []),
        ...(c.indexes ? [{ label: "indexes", value: c.indexes }] : []),
      ],
      metadata: [
        meta.text("Type", c.type ?? "collection"),
        ...(c.viewOn ? [meta.text("View on", c.viewOn)] : []),
        ...(c.count !== undefined
          ? [meta.text("Documents", c.count.toLocaleString("en-US"), { icon: Icons.braces })]
          : []),
        ...(c.avgObjSize ? [meta.text("Average document", bytes(c.avgObjSize))] : []),
        ...(c.size !== undefined ? [meta.text("Data size", bytes(c.size))] : []),
        ...(c.storageSize !== undefined ? [meta.text("On disk", bytes(c.storageSize), { icon: Icons.drive })] : []),
        ...(c.indexSize !== undefined ? [meta.text("Indexes", `${c.indexes ?? "?"} · ${bytes(c.indexSize)}`)] : []),
        meta.text("Namespace", `${db}.${c.name}`, { icon: Icons.database }),
      ],
    },
    actions: [
      action("Browse Documents", () => documentsView(conn, db, c, prefs), { icon: Icons.braces }),
      copy(`${db}.${c.name}`, "Copy Namespace", { shortcut: "<Ctrl>period" }),
      shellAction(withDatabase(conn.uri, db), prefs),
      copy(`${ns}.find({})`, "Copy find Query", { icon: Icons.terminal, section: "Copy" }),
      copy(c.name, "Copy Name", { section: "Copy" }),
    ],
  };
}

function collectionsView(conn: Connection, db: string, prefs: Prefs): ListSpec {
  let status = "";
  return list({
    title: db,
    placeholder: `Filter collections of ${db}…`,
    empty: { title: "No collections", description: "This database is empty", icon: Icons.layers },
    status: () => status,
    actions: [
      shellAction(withDatabase(conn.uri, db), prefs),
      action("Reload", () => refresh(), { icon: Icons.refresh }),
    ],
    async items({ signal }) {
      const rows = sortCollections(await collections(conn.uri, db, signal));
      const docs = rows.reduce((n, c) => n + (c.count ?? 0), 0);
      status = `${conn.label} · ${db} · ${plural(rows.length, "collection")} · ${count(docs)} documents`;
      return rows.map((c) => collectionItem(conn, db, c, prefs));
    },
  });
}

// ---------------------------------------------------------------------------
// Databases

function databaseItem(conn: Connection, info: ServerInfo, d: DatabaseRow, prefs: Prefs): Item {
  const uri = withDatabase(conn.uri, d.name);
  return {
    id: `${conn.uri}#${d.name}`,
    title: d.name,
    subtitle: conn.label,
    icon: { source: Icons.database, tint: isSystemDb(d.name) ? "gray" : "green" },
    section: conn.label,
    keywords: [conn.label, info.setName ?? ""],
    accessories: [
      ...(d.collections !== undefined ? [{ text: plural(d.collections, "collection") }] : []),
      ...(d.objects !== undefined ? [{ text: `${count(d.objects)} doc${d.objects === 1 ? "" : "s"}` }] : []),
      { text: bytes(d.sizeOnDisk), tooltip: "On disk" },
    ],
    detail: {
      stats: [
        ...(d.collections !== undefined ? [{ label: "collections", value: d.collections }] : []),
        ...(d.objects !== undefined ? [{ label: "documents", value: count(d.objects) }] : []),
        { label: "on disk", value: bytes(d.sizeOnDisk) },
      ],
      metadata: [
        meta.text("Server", conn.label, { icon: Icons.server }),
        ...(info.version ? [meta.text("MongoDB", info.version, { icon: Icons.tag })] : []),
        ...(info.setName
          ? [meta.text("Replica set", info.setName)]
          : info.shard
          ? [meta.text("Topology", "sharded (mongos)")]
          : []),
        ...(d.views ? [meta.text("Views", String(d.views))] : []),
        ...(d.dataSize !== undefined ? [meta.text("Data size", bytes(d.dataSize))] : []),
        ...(d.indexes !== undefined ? [meta.text("Indexes", String(d.indexes), { icon: Icons.hash })] : []),
        meta.text("Connection", redact(uri), { icon: Icons.link }),
      ],
    },
    actions: [
      action("Show Collections", () => collectionsView(conn, d.name, prefs), { icon: Icons.layers }),
      copyUri(uri, "Copy Connection String", { shortcut: "<Ctrl><Shift>c" }),
      shellAction(uri, prefs),
      copy(d.name, "Copy Name", { shortcut: "<Ctrl>period", section: "Copy" }),
      copyUri(conn.uri, "Copy Server Connection String", { section: "Copy" }),
    ],
  };
}

function errorItem(conn: Connection, e: unknown, prefs: Prefs): Item {
  const missing = e instanceof MissingError;
  return {
    id: `error:${conn.uri}`,
    title: missing ? "mongosh is not installed" : `${conn.label}: ${errorText(e).slice(0, 100)}`,
    subtitle: missing ? "It runs the queries; install it to browse your databases" : redact(conn.uri),
    icon: { source: Icons.alert, tint: missing ? "orange" : "red" },
    section: missing ? undefined : conn.label,
    detail: {
      markdown: missing
        ? [
          "This command uses **mongosh**, MongoDB's shell.",
          "",
          "```sh",
          "sudo dnf install mongodb-mongosh   # Fedora, from MongoDB's repository",
          "sudo apt install mongodb-mongosh   # Debian, Ubuntu, from MongoDB's repository",
          "npm install -g mongosh             # anywhere with Node.js",
          "```",
        ].join("\n")
        : `\`\`\`\n${errorText(e)}\n\`\`\`\n\nConnection strings are set in **Settings → Extensions → MongoDB**.`,
    },
    actions: missing
      ? [
        open("https://www.mongodb.com/docs/mongodb-shell/install/", "Install mongosh"),
        copy("npm install -g mongosh", "Copy npm Command"),
      ]
      : [action("Retry", () => refresh(), { icon: Icons.refresh }), copyUri(conn.uri), shellAction(conn.uri, prefs)],
  };
}

let summary = "";

export default list({
  placeholder: "Filter databases…",
  empty: { title: "No databases", description: "The server has no database you may see", icon: Icons.database },
  status: () => summary,
  actions: [action("Reload", () => refresh(), { icon: Icons.refresh, shortcut: "<Ctrl>r" })],
  async *items({ preferences, signal }) {
    const prefs = preferences as Prefs;
    const showSystem = prefs.showSystem === true || String(prefs.showSystem) === "true";
    const conns = parseConnections(prefs.connections);
    const results = new Map<string, Item[]>();
    const render = () => conns.flatMap((c) => results.get(c.uri) ?? []);
    summary = `Connecting to ${plural(conns.length, "server")}…`;
    let missing = false;
    const load = async (conn: Connection) => {
      try {
        const info = await serverInfo(conn.uri, signal);
        const dbs = sortDatabases(info.databases).filter((d) => showSystem || !isSystemDb(d.name));
        results.set(conn.uri, dbs.map((d) => databaseItem(conn, info, d, prefs)));
      } catch (e) {
        if (e instanceof MissingError) missing = true;
        results.set(conn.uri, [errorItem(conn, e, prefs)]);
      }
    };
    // Each server shows up as soon as it answers.
    const pending = new Map(conns.map((conn, i) => [i, load(conn).then(() => i)]));
    while (pending.size) {
      pending.delete(await Promise.race(pending.values()));
      if (signal.aborted) return;
      if (missing) {
        summary = "mongosh is missing";
        yield [errorItem(conns[0], new MissingError(), prefs)];
        return;
      }
      const shown = render();
      const dbs = shown.filter((i) => !i.id?.startsWith("error:")).length;
      summary = `${plural(dbs, "database")} · ${
        pending.size ? `waiting for ${plural(pending.size, "server")}` : plural(conns.length, "server")
      }`;
      yield shown;
    }
  },
});
