import {
  type Action,
  action,
  copy,
  detail,
  Icons,
  type Item,
  list,
  meta,
  open,
  refresh,
  toast,
  updateCommandMetadata,
} from "@backslash/api";
import {
  aliases,
  allocationExplain,
  type Config,
  config,
  curlCommand,
  deleteIndex,
  health,
  indices,
  refreshIndex,
  root,
  SetupError,
  setupItem,
} from "../api.ts";
import {
  type Alias,
  bytes,
  type ClusterHealth,
  count,
  HEALTH_COLORS,
  type Index,
  parseAliases,
  parseIndices,
  prettyJson,
  product,
  type Root,
  visibleIndices,
  when,
} from "../lib.ts";
import { mappingView, nodesView, searchView } from "../views.ts";

const errorText = (e: unknown) => e instanceof Error ? e.message : String(e);

function clusterItem(c: Config, h: ClusterHealth, r: Root | undefined, shown: Index[]): Item {
  const color = HEALTH_COLORS[h.status] ?? "gray";
  const docs = shown.reduce((n, i) => n + (i.docs ?? 0), 0);
  const size = shown.reduce((n, i) => n + (i.size ?? 0), 0);
  const problems = h.unassigned_shards > 0 || h.initializing_shards > 0;
  return {
    id: "cluster",
    title: h.cluster_name,
    subtitle: product(r),
    icon: { source: Icons.server, tint: color },
    section: "Cluster",
    accessories: [
      ...(h.unassigned_shards ? [{ text: `${h.unassigned_shards} unassigned`, color: color }] : []),
      { text: `${h.number_of_nodes} node${h.number_of_nodes === 1 ? "" : "s"}`, icon: Icons.server },
      { tag: h.status, color },
    ],
    detail: {
      stats: [
        { label: "health", value: h.status, color },
        { label: "nodes", value: h.number_of_nodes },
        { label: "shards", value: h.active_shards },
        ...(h.unassigned_shards ? [{ label: "unassigned", value: h.unassigned_shards, color }] : []),
      ],
      markdown: h.status === "yellow" && h.number_of_data_nodes === 1
        ? "_Yellow on a single node is expected: replicas have no other node to live on. Set `number_of_replicas` to 0 on these indices to make it green._"
        : h.status === "red"
        ? "**Some primary shards are unassigned**: their data can't be searched or written. **Explain Unassigned Shards** tells why."
        : undefined,
      metadata: [
        meta.text("Health", h.status, { icon: Icons.dot, color }),
        meta.text("Version", product(r), { icon: Icons.tag }),
        meta.text("Nodes", `${h.number_of_nodes} (${h.number_of_data_nodes} data)`, { icon: Icons.server }),
        meta.text("Primary shards", String(h.active_primary_shards)),
        meta.text(
          "Active shards",
          `${h.active_shards}${
            h.active_shards_percent_as_number !== undefined
              ? ` (${h.active_shards_percent_as_number.toFixed(1)} %)`
              : ""
          }`,
        ),
        ...(h.relocating_shards ? [meta.text("Relocating", String(h.relocating_shards))] : []),
        ...(h.initializing_shards
          ? [meta.text("Initializing", String(h.initializing_shards), { color: "yellow" })]
          : []),
        ...(h.unassigned_shards ? [meta.text("Unassigned", String(h.unassigned_shards), { color })] : []),
        meta.separator(),
        meta.text("Indices shown", `${shown.length} · ${count(docs)} docs · ${bytes(size)}`, { icon: Icons.database }),
        meta.text("Address", c.url, { icon: Icons.globe }),
      ],
    },
    actions: [
      action("Show Nodes", () => nodesView(c), { icon: Icons.server }),
      action("Search Everything", () => searchView(c, c.defaultIndex), { icon: Icons.search, shortcut: "<Ctrl>f" }),
      ...(problems
        ? [action("Explain Unassigned Shards", async () => {
          const body = await allocationExplain(c).catch((e) => ({ error: errorText(e) }));
          return detail({
            title: "Allocation explain",
            markdown: `\`\`\`json\n${prettyJson(body)}\n\`\`\``,
            actions: [copy(JSON.stringify(body, null, 2), "Copy JSON")],
          });
        }, { icon: Icons.question, shortcut: "<Ctrl>e" })]
        : []),
      open(c.url, "Open Address", { section: "Copy" }),
      copy(curlCommand(c, "/_cluster/health?pretty"), "Copy curl Command", { icon: Icons.terminal, section: "Copy" }),
    ],
  };
}

function indexItem(c: Config, i: Index): Item {
  const color = i.status === "close" ? "gray" : HEALTH_COLORS[i.health ?? ""] ?? "gray";
  const actions: Action[] = [
    ...(i.status === "close" ? [] : [action("Search Index", () => searchView(c, i.name), { icon: Icons.search })]),
    ...(i.dataStream
      ? [action(`Search Data Stream ${i.dataStream}`, () => searchView(c, i.dataStream!), { icon: Icons.layers })]
      : []),
    action("Show Mapping", () => mappingView(c, i.name), { icon: Icons.braces, shortcut: "<Ctrl>m" }),
    copy(i.name, "Copy Name", { shortcut: "<Ctrl>period", section: "Copy" }),
    copy(curlCommand(c, `/${i.name}/_search?pretty`), "Copy curl Command", { icon: Icons.terminal, section: "Copy" }),
    ...(i.status === "close" ? [] : [action("Refresh Index", async () => {
      await refreshIndex(c, i.name);
      await toast(`${i.name} refreshed`, { style: "success" });
      return refresh();
    }, { icon: Icons.refresh, section: "Index" })]),
    action("Delete Index", async () => {
      try {
        await deleteIndex(c, i.name);
      } catch (e) {
        await toast("Delete failed", { style: "failure", message: errorText(e) });
        return;
      }
      await toast(`${i.name} deleted`, { style: "success" });
      return refresh();
    }, {
      icon: Icons.trash,
      destructive: true,
      confirm: `Delete ${i.name} and its ${count(i.docs)} documents? This can't be undone.`,
      section: "Danger",
    }),
  ];
  return {
    id: `index/${i.name}`,
    title: i.name,
    subtitle: i.dataStream ? `data stream ${i.dataStream}` : undefined,
    icon: { source: i.health === "red" ? Icons.alert : Icons.database, tint: color },
    section: i.health === "red" ? "Problems" : i.dataStream ? "Data Streams" : i.hidden ? "System" : "Indices",
    keywords: [i.uuid ?? "", i.dataStream ?? "", i.health ?? "", i.status],
    accessories: [
      {
        text: `${count(i.docs)} doc${i.docs === 1 ? "" : "s"}`,
        tooltip: `${i.docs?.toLocaleString("en-US") ?? "?"} document${i.docs === 1 ? "" : "s"}`,
      },
      { text: bytes(i.size), tooltip: "Size, replicas included" },
      ...(i.status === "close"
        ? [{ tag: "closed", color: "gray" as const }]
        : i.health !== "green"
        ? [{ tag: i.health ?? "?", color }]
        : []),
    ],
    detail: {
      stats: [
        { label: "documents", value: count(i.docs) },
        { label: "size", value: bytes(i.size) },
        { label: "health", value: i.status === "close" ? "closed" : i.health ?? "?", color },
      ],
      metadata: [
        meta.text("Health", i.health ?? "–", { icon: Icons.dot, color }),
        meta.text("Status", i.status === "close" ? "closed" : "open"),
        meta.text("Documents", i.docs?.toLocaleString("en-US") ?? "–", { icon: Icons.file }),
        ...(i.deleted ? [meta.text("Deleted docs", i.deleted.toLocaleString("en-US"))] : []),
        meta.text("Size", `${bytes(i.size)} (${bytes(i.primarySize)} primaries)`, { icon: Icons.drive }),
        meta.text("Shards", `${i.primaries} primary × ${i.replicas + 1} copies`, { icon: Icons.layers }),
        ...(i.dataStream ? [meta.text("Data stream", i.dataStream, { icon: Icons.layers })] : []),
        ...(i.created ? [meta.text("Created", when(i.created), { icon: Icons.calendar })] : []),
        ...(i.uuid ? [meta.text("UUID", i.uuid)] : []),
      ],
    },
    actions,
  };
}

function aliasItem(c: Config, a: Alias, byName: Map<string, Index>): Item {
  const members = a.indices.map((n) => byName.get(n)).filter((i): i is Index => !!i);
  const docs = members.reduce((n, i) => n + (i.docs ?? 0), 0);
  const size = members.reduce((n, i) => n + (i.size ?? 0), 0);
  return {
    id: `alias/${a.name}`,
    title: a.name,
    subtitle: a.indices.length === 1 ? `→ ${a.indices[0]}` : `→ ${a.indices.length} indices`,
    icon: { source: Icons.link, tint: "blue" },
    section: "Aliases",
    keywords: a.indices,
    accessories: [
      ...(a.filtered ? [{ tag: "filtered", color: "blue" as const }] : []),
      ...(members.length ? [{ text: `${count(docs)} doc${docs === 1 ? "" : "s"}` }, { text: bytes(size) }] : []),
    ],
    detail: {
      markdown: a.indices.map((n) => `- \`${n}\`${n === a.writeIndex ? " · **write index**" : ""}`).join("\n"),
      metadata: [
        meta.text("Indices", String(a.indices.length), { icon: Icons.database }),
        ...(a.writeIndex ? [meta.text("Write index", a.writeIndex, { icon: Icons.note })] : []),
        ...(a.filtered ? [meta.text("Filter", "yes: searches see a subset")] : []),
        ...(a.routing ? [meta.text("Routing", a.routing)] : []),
      ],
    },
    actions: [
      action("Search Alias", () => searchView(c, a.name), { icon: Icons.search }),
      ...(a.writeIndex || a.indices.length === 1
        ? [action("Show Mapping", () => mappingView(c, a.writeIndex ?? a.indices[0]), {
          icon: Icons.braces,
          shortcut: "<Ctrl>m",
        })]
        : []),
      copy(a.name, "Copy Name", { shortcut: "<Ctrl>period", section: "Copy" }),
      copy(a.indices.join(","), "Copy Index Names", { section: "Copy" }),
    ],
  };
}

let summary = "";

export default list({
  placeholder: "Filter indices…",
  filter: {
    options: [{ value: "indices", title: "Indices" }, { value: "aliases", title: "Aliases" }],
    default: "indices",
  },
  empty: {
    title: "No indices",
    description: "Nothing here yet, or only system indices (turn them on in Settings)",
    icon: Icons.database,
  },
  status: () => summary,
  actions: [action("Reload", () => refresh(), { icon: Icons.refresh, shortcut: "<Ctrl>r" })],
  async items({ preferences, filter, signal }) {
    summary = "";
    try {
      const c = config(preferences);
      const [h, r, rows, aliasRows] = await Promise.all([
        health(c, signal),
        root(c, signal),
        indices(c, signal),
        filter === "aliases" ? aliases(c, signal) : Promise.resolve([]),
      ]);
      const all = parseIndices(rows);
      const shown = visibleIndices(all, c.showSystem);
      updateCommandMetadata({ subtitle: `${h.cluster_name} · ${h.status}` }).catch(() => {});
      const cluster = clusterItem(c, h, r, shown);
      if (filter === "aliases") {
        const list = parseAliases(aliasRows, c.showSystem);
        summary = `${h.cluster_name} · ${h.status} · ${list.length} alias${list.length === 1 ? "" : "es"}`;
        const byName = new Map(all.map((i) => [i.name, i]));
        return [cluster, ...list.map((a) => aliasItem(c, a, byName))];
      }
      const size = shown.reduce((n, i) => n + (i.size ?? 0), 0);
      summary = `${h.cluster_name} · ${h.status} · ${shown.length} indices · ${bytes(size)}`;
      return [cluster, ...shown.map((i) => indexItem(c, i))];
    } catch (e) {
      if (e instanceof SetupError) return [setupItem(e)];
      throw e;
    }
  },
});
