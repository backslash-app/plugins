import {
  type Action,
  action,
  close,
  type Context,
  copy,
  Icons,
  type Item,
  list,
  meta,
  type Metadata,
  open,
  refresh,
  toast,
  updateCommandMetadata,
} from "@backslash/api";
import {
  type Client,
  clientCommand,
  CLIENTS,
  type Connection,
  connectionUrl,
  type DbType,
  describe,
  type Family,
  HEALTH_COLORS,
  installCommand,
  SOURCE_NAMES,
  type Status,
  TYPE_COLORS,
  TYPE_NAMES,
} from "../lib.ts";
import {
  checkStatus,
  connectionForm,
  copySecret,
  deleteConnection,
  distro,
  HOME,
  installedClients,
  loadSources,
  missingClientItem,
  nextChange,
  openIn,
  passwordOf,
  type Prefs,
  savedList,
  type Sources,
} from "../db.ts";
import { shellLine } from "../terminal.ts";

const CLIENT_NAMES: Record<Client, string> = {
  psql: "psql",
  pgcli: "pgcli",
  mysql: "mysql",
  mariadb: "mariadb",
  mycli: "mycli",
  sqlite3: "sqlite3",
  litecli: "litecli",
  "redis-cli": "redis-cli",
};

const TYPE_ICON: Record<DbType, string> = {
  postgres: Icons.database,
  mysql: Icons.database,
  sqlite: Icons.file,
  redis: Icons.bolt,
};

function metadata(c: Connection, status: Status | undefined, origin: string | undefined): Metadata[] {
  const lines: Metadata[] = [
    meta.tags("Type", [{ text: TYPE_NAMES[c.type], color: TYPE_COLORS[c.type] }]),
    meta.text("Status", status?.text ?? "Checking…", {
      icon: Icons.dot,
      color: status ? HEALTH_COLORS[status.health] : "gray",
    }),
  ];
  if (c.type === "sqlite") {
    lines.push(meta.text("File", describe(c, HOME), { icon: Icons.file }));
  } else {
    if (c.service) lines.push(meta.text("Service", c.service, { icon: Icons.settings }));
    if (c.host || !c.socket) lines.push(meta.text("Host", c.host ?? "localhost", { icon: Icons.server }));
    if (c.socket) lines.push(meta.text("Socket", c.socket, { icon: Icons.plug }));
    if (c.port) lines.push(meta.text("Port", c.port, { icon: Icons.hash }));
    if (c.database) lines.push(meta.text(c.type === "redis" ? "Database #" : "Database", c.database));
    if (c.user) lines.push(meta.person("User", c.user));
    lines.push(meta.text("Password", origin ?? "None known", {
      icon: origin ? Icons.lock : Icons.key,
      color: origin ? "green" : "gray",
    }));
  }
  lines.push(meta.separator(), meta.text("Source", SOURCE_NAMES[c.source], { icon: Icons.folder }));
  return lines;
}

function item(
  c: Connection,
  src: Sources,
  prefs: Prefs,
  clients: Set<Client>,
  family: Family | undefined,
  status?: Status,
): Item {
  const { password, origin } = passwordOf(c, src, prefs);
  const available = CLIENTS[c.type].filter((cl) => clients.has(cl));
  const [primary, ...others] = available;
  const actions: Action[] = [];
  const openAction = (client: Client, o: { shortcut?: string } = {}) =>
    action(`Open in ${CLIENT_NAMES[client]}`, () => {
      const term = openIn(c, client, src, prefs);
      return close(`${CLIENT_NAMES[client]} in ${term}`);
    }, { icon: Icons.terminal, ...o });
  if (primary) {
    actions.push(openAction(primary));
    others.forEach((cl, i) => actions.push(openAction(cl, i === 0 ? { shortcut: "<Ctrl>o" } : {})));
  } else {
    actions.push(copy(installCommand(c.type, family), `Copy ${TYPE_NAMES[c.type]} Client Install Command`, {
      icon: Icons.download,
    }));
  }
  actions.push(action("Check Status", () => refresh(), { icon: Icons.activity, shortcut: "<Ctrl>r" }));

  const url = connectionUrl(c, password);
  actions.push(copy(url, password ? "Copy URL (Password Masked)" : "Copy URL", {
    icon: Icons.link,
    shortcut: "<Ctrl><Shift>c",
    section: "Copy",
  }));
  if (password) {
    actions.push(copySecret(connectionUrl(c, password, true), "Copy URL with Password", { section: "Copy" }));
    actions.push(copySecret(password, "Copy Password", { section: "Copy" }));
  }
  const shown = primary ?? CLIENTS[c.type][0];
  const cmd = clientCommand(c, shown, undefined).argv;
  actions.push(copy(shellLine(cmd), `Copy ${CLIENT_NAMES[shown]} Command`, { icon: Icons.terminal, section: "Copy" }));
  if (c.host) actions.push(copy(c.host, "Copy Host", { icon: Icons.server, section: "Copy" }));
  if (c.path) actions.push(copy(c.path, "Copy File Path", { icon: Icons.file, section: "Copy" }));

  if (c.source === "saved") {
    actions.push(
      action("Edit Connection", async () => {
        const saved = (await savedList()).find((s) => s.name === c.name);
        if (!saved) throw new Error(`${c.name} is no longer saved`);
        return connectionForm({ connection: saved });
      }, { icon: Icons.settings, shortcut: "<Ctrl>e", section: "Connection" }),
      action("Delete Connection", async () => {
        await deleteConnection(c.name);
        await toast(`Deleted ${c.name}`, { style: "success" });
      }, {
        icon: Icons.trash,
        destructive: true,
        confirm: `Delete the saved connection “${c.name}”? The database itself is not touched.`,
        shortcut: "<Ctrl>Delete",
        section: "Danger",
      }),
    );
  } else {
    actions.push(open(`${HOME}/${SOURCE_NAMES[c.source].slice(2)}`, `Open ${SOURCE_NAMES[c.source]}`, {
      icon: Icons.file,
      section: "Connection",
    }));
  }

  const color = status ? HEALTH_COLORS[status.health] : "gray";
  return {
    id: c.id,
    title: c.name,
    subtitle: describe(c, HOME),
    icon: { source: TYPE_ICON[c.type], tint: TYPE_COLORS[c.type] },
    section: SOURCE_NAMES[c.source],
    keywords: [c.type, TYPE_NAMES[c.type], c.host ?? "", c.database ?? "", c.user ?? "", c.service ?? ""],
    accessories: [
      ...(origin ? [{ icon: Icons.lock, tooltip: `Password in ${origin}` }] : []),
      { tag: TYPE_NAMES[c.type].split(" ")[0], color: TYPE_COLORS[c.type] },
      {
        icon: { source: Icons.dot, tint: color },
        text: status?.text ?? "…",
        tooltip: status ? "Status" : "Checking…",
      },
    ],
    detail: { metadata: metadata(c, status, origin) },
    actions,
  };
}

let summary = "";

export default (ctx: Context) => {
  const prefs = ctx.preferences as Prefs;
  const addAction = action("Add Connection", () => connectionForm(), { icon: Icons.plus, shortcut: "<Ctrl>n" });
  return list({
    placeholder: "Filter connections by name, host, database…",
    filter: {
      options: [
        { value: "all", title: "All" },
        { value: "postgres", title: "PostgreSQL" },
        { value: "mysql", title: "MySQL" },
        { value: "sqlite", title: "SQLite" },
        { value: "redis", title: "Redis" },
      ],
      default: "all",
    },
    empty: {
      title: "No database connections",
      description: "Press Ctrl+N to add one, or describe them in ~/.pgpass, ~/.pg_service.conf or ~/.my.cnf",
      icon: Icons.database,
    },
    status: () => summary,
    actions: [addAction],
    async *items({ signal, filter }) {
      while (!signal.aborted) {
        const [src, clients, family] = await Promise.all([loadSources(), installedClients(), distro()]);
        const shown = src.connections.filter((c) => !filter || filter === "all" || c.type === filter);
        const missing = await Promise.all(
          [...new Set(shown.map((c) => c.type))]
            .filter((t) => !CLIENTS[t].some((cl) => clients.has(cl)))
            .map(missingClientItem),
        );
        const withAdd = (items: Item[]) => [...items, ...missing];
        summary = shown.length ? `${shown.length} connection${shown.length === 1 ? "" : "s"} · checking…` : "";
        yield withAdd(shown.map((c) => item(c, src, prefs, clients, family)));

        const statuses = await Promise.all(shown.map((c) => checkStatus(c, signal)));
        if (signal.aborted) return;
        const up = statuses.filter((s) => s.health === "up" || s.health === "auth").length;
        summary = !shown.length
          ? ""
          : `${shown.length} connection${shown.length === 1 ? "" : "s"} · ${up} up${
            src.files.length ? ` · ${src.files.join(", ")}` : ""
          }`;
        if (!filter || filter === "all") {
          await updateCommandMetadata({
            subtitle: src.connections.length ? `${src.connections.length} connections · ${up} up` : null,
          }).catch(() => {});
        }
        yield withAdd(shown.map((c, i) => item(c, src, prefs, clients, family, statuses[i])));
        await nextChange(signal);
      }
    },
  });
};
