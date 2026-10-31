// Elasticsearch / OpenSearch logic: the _cat and _cluster answers, search
// bodies and hits, mappings, sizes. Pure, tested in lib_test.ts.

export type Tint = "red" | "orange" | "yellow" | "green" | "gray" | "blue";
export type Health = "green" | "yellow" | "red";

export const HEALTH_COLORS: Record<string, Tint> = { green: "green", yellow: "yellow", red: "red" };

/** GET / */
export interface Root {
  name?: string;
  cluster_name?: string;
  version?: { number?: string; distribution?: string; build_flavor?: string };
  tagline?: string;
}

/** GET /_cluster/health */
export interface ClusterHealth {
  cluster_name: string;
  status: Health;
  timed_out?: boolean;
  number_of_nodes: number;
  number_of_data_nodes: number;
  active_primary_shards: number;
  active_shards: number;
  relocating_shards: number;
  initializing_shards: number;
  unassigned_shards: number;
  number_of_pending_tasks?: number;
  active_shards_percent_as_number?: number;
}

/** "Elasticsearch 8.15.0", "OpenSearch 2.17.1". */
export function product(root: Root | undefined): string {
  const v = root?.version;
  if (!v?.number) return "Elasticsearch";
  return `${v.distribution === "opensearch" ? "OpenSearch" : "Elasticsearch"} ${v.number}`;
}

export const isOpenSearch = (root: Root | undefined) => root?.version?.distribution === "opensearch";

// ---------------------------------------------------------------------------
// Indices

export const INDEX_COLUMNS =
  "health,status,index,uuid,pri,rep,docs.count,docs.deleted,store.size,pri.store.size,creation.date";

/** A row of `_cat/indices?format=json&bytes=b`: every value is a string, or null for closed indices. */
export type CatIndex = Record<string, string | null | undefined>;

export interface Index {
  name: string;
  health?: Health;
  status: "open" | "close" | string;
  uuid?: string;
  primaries: number;
  replicas: number;
  docs?: number;
  deleted?: number;
  /** Bytes, replicas included. */
  size?: number;
  primarySize?: number;
  /** Unix ms. */
  created?: number;
  /** For `.ds-logs-app-2026.10.31-000004`: `logs-app`. */
  dataStream?: string;
  hidden: boolean;
}

const num = (v: string | null | undefined) => {
  if (v === null || v === undefined || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};

/** `.ds-logs-nginx-default-2026.10.31-000004` → `logs-nginx-default`. */
export function dataStreamOf(index: string): string | undefined {
  return /^\.ds-(.+)-\d{4}\.\d{2}\.\d{2}-\d+$/.exec(index)?.[1];
}

export function parseIndices(rows: CatIndex[]): Index[] {
  return rows.filter((r) => r.index).map((r) => {
    const name = String(r.index);
    return {
      name,
      health: (r.health || undefined) as Health | undefined,
      status: String(r.status ?? "open"),
      uuid: r.uuid ?? undefined,
      primaries: num(r.pri) ?? 0,
      replicas: num(r.rep) ?? 0,
      docs: num(r["docs.count"]),
      deleted: num(r["docs.deleted"]),
      size: num(r["store.size"]),
      primarySize: num(r["pri.store.size"]),
      created: num(r["creation.date"]),
      dataStream: dataStreamOf(name),
      hidden: name.startsWith("."),
    };
  });
}

/**
 * What the list shows: system indices (`.kibana`, `.security`…) only when
 * asked, a data stream's backing indices always; red first, then biggest.
 */
export function visibleIndices(all: Index[], showSystem: boolean): Index[] {
  const order = (i: Index) => i.health === "red" ? 0 : i.status === "close" ? 2 : 1;
  // Elasticsearch's own data streams (ILM and SLM history, deprecation logs) are system ones too.
  const userStream = (i: Index) => !!i.dataStream && !/^(\.|ilm-history-|slm-history-)/.test(i.dataStream);
  return all.filter((i) => showSystem || !i.hidden || userStream(i))
    .sort((a, b) => order(a) - order(b) || (b.size ?? -1) - (a.size ?? -1) || a.name.localeCompare(b.name));
}

/** A row of `_cat/aliases?format=json`. */
export interface CatAlias {
  alias: string;
  index: string;
  filter?: string;
  "routing.index"?: string;
  "routing.search"?: string;
  is_write_index?: string;
}

export interface Alias {
  name: string;
  indices: string[];
  writeIndex?: string;
  filtered: boolean;
  routing?: string;
}

export function parseAliases(rows: CatAlias[], showSystem: boolean): Alias[] {
  const byName = new Map<string, Alias>();
  for (const r of rows) {
    if (!r.alias || (!showSystem && r.alias.startsWith("."))) continue;
    const a = byName.get(r.alias) ?? { name: r.alias, indices: [], filtered: false };
    a.indices.push(r.index);
    if (r.is_write_index === "true") a.writeIndex = r.index;
    if (r.filter && r.filter !== "-" && r.filter !== "*") a.filtered = true;
    const routing = [r["routing.index"], r["routing.search"]].find((x) => x && x !== "-");
    if (routing) a.routing = routing;
    byName.set(r.alias, a);
  }
  return [...byName.values()].map((a) => ({ ...a, indices: a.indices.sort() }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// ---------------------------------------------------------------------------
// Search

export interface Hit {
  _index: string;
  _id: string;
  _score?: number | null;
  _source?: Record<string, unknown>;
  sort?: unknown[];
}

export interface SearchResponse {
  took?: number;
  timed_out?: boolean;
  hits: { total?: { value: number; relation: "eq" | "gte" } | number; hits: Hit[] };
}

/**
 * A search body: newest first when nothing is typed, a Lucene query string
 * (`status:500 AND path:/api*`) otherwise. Sorting on a missing @timestamp
 * is harmless thanks to `unmapped_type`.
 */
export function searchBody(query: string, size = 25): Record<string, unknown> {
  const q = query.trim();
  const byTime = { "@timestamp": { order: "desc", unmapped_type: "date" } };
  return {
    size,
    track_total_hits: true,
    query: q ? { query_string: { query: q, default_operator: "AND", lenient: true } } : { match_all: {} },
    sort: q ? ["_score", byTime] : [byTime],
  };
}

/** "1,234 hits", "10,000+ hits". */
export function totalText(total: SearchResponse["hits"]["total"]): string {
  const n = typeof total === "number" ? total : total?.value ?? 0;
  const more = typeof total === "object" && total?.relation === "gte";
  return `${n.toLocaleString("en-US")}${more ? "+" : ""} hit${n === 1 && !more ? "" : "s"}`;
}

const TITLE_FIELDS = ["title", "name", "message", "subject", "summary", "description", "event.original", "log", "msg"];

/** A value at a dotted path, in nested objects or flat `a.b` keys. */
export function getPath(doc: Record<string, unknown> | undefined, path: string): unknown {
  if (!doc) return undefined;
  if (path in doc) return doc[path];
  let cur: unknown = doc;
  for (const part of path.split(".")) {
    if (!cur || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

const oneLine = (s: string, n = 140) => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

/** A line that says what a document is: its title, name or message, else its first text field. */
export function hitTitle(hit: Hit): string {
  const src = hit._source ?? {};
  for (const f of TITLE_FIELDS) {
    const v = getPath(src, f);
    if (typeof v === "string" && v.trim()) return oneLine(v);
  }
  for (const [k, v] of Object.entries(src)) {
    if (typeof v === "string" && v.trim() && !k.startsWith("@") && !/(^|_)id$/i.test(k)) return oneLine(v);
  }
  return hit._id;
}

/** The document's time (@timestamp, timestamp, created_at…), as Unix ms. */
export function hitTime(hit: Hit): number | undefined {
  for (const f of ["@timestamp", "timestamp", "time", "date", "created_at", "createdAt", "updated_at"]) {
    const v = getPath(hit._source, f);
    const t = typeof v === "number" ? (v > 1e11 ? v : v * 1000) : typeof v === "string" ? Date.parse(v) : NaN;
    if (Number.isFinite(t)) return t;
  }
  return undefined;
}

/** Top-level fields with a short value, for the side panel and "Copy Field". */
export function hitFields(hit: Hit, n = 12): { key: string; value: string }[] {
  return Object.entries(hit._source ?? {}).filter(([, v]) => v !== null && v !== undefined).slice(0, n).map((
    [key, v],
  ) => ({ key, value: typeof v === "string" ? v : JSON.stringify(v) }));
}

/** The reason Elasticsearch gives for a failed request, in one sentence. */
export function errorReason(body: unknown): string | undefined {
  const e = (body as { error?: unknown })?.error;
  if (typeof e === "string") return e;
  if (!e || typeof e !== "object") return undefined;
  const err = e as {
    reason?: string;
    type?: string;
    root_cause?: { reason?: string }[];
    caused_by?: { reason?: string };
  };
  const deep = err.caused_by?.reason ?? err.root_cause?.[0]?.reason;
  return [err.reason, deep && deep !== err.reason ? deep : undefined].filter(Boolean).join(": ") || err.type;
}

// ---------------------------------------------------------------------------
// Mappings

export interface Field {
  path: string;
  type: string;
}

/** Fields of `GET /<index>/_mapping`, multi-fields (`title.keyword`) included, sorted. */
export function flattenMapping(response: Record<string, unknown>): Field[] {
  const out = new Map<string, string>();
  const walk = (props: Record<string, any> | undefined, prefix: string) => {
    for (const [name, def] of Object.entries(props ?? {})) {
      const path = `${prefix}${name}`;
      if (def?.type || !def?.properties) out.set(path, def?.type ?? "object");
      if (def?.properties) walk(def.properties, `${path}.`);
      for (const [sub, sd] of Object.entries((def?.fields ?? {}) as Record<string, any>)) {
        out.set(`${path}.${sub}`, sd?.type ?? "object");
      }
    }
  };
  for (const idx of Object.values(response) as { mappings?: Record<string, any> }[]) {
    let m = idx?.mappings ?? {};
    // Elasticsearch 6 has a level for the type name.
    if (!m.properties) {
      const inner = Object.values(m).find((v) => v && typeof v === "object" && (v as any).properties);
      if (inner) m = inner as Record<string, any>;
    }
    walk(m.properties, "");
  }
  return [...out].map(([path, type]) => ({ path, type })).sort((a, b) => a.path.localeCompare(b.path));
}

export function mappingMarkdown(index: string, fields: Field[]): string {
  if (!fields.length) return `## ${index}\n\n_No mapped fields yet._`;
  return [
    `## ${index}`,
    "",
    `${fields.length} field${fields.length === 1 ? "" : "s"}.`,
    "",
    "| Field | Type |",
    "| --- | --- |",
    ...fields.slice(0, 500).map((f) => `| \`${f.path}\` | ${f.type} |`),
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Formatting

/** 0 → "0 B", 1536 → "1.5 KB", 3.2e9 → "3.2 GB" (powers of 1024, as Elasticsearch shows them). */
export function bytes(n: number | undefined): string {
  if (n === undefined) return "–";
  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  let v = n, u = 0;
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024;
    u++;
  }
  return `${u === 0 ? v : v < 10 ? v.toFixed(1) : Math.round(v)} ${units[u]}`;
}

/** 1234567 → "1.2M", 9876 → "9.9k". */
export function count(n: number | undefined): string {
  if (n === undefined) return "–";
  if (n < 1000) return String(n);
  if (n < 1e6) return `${(n / 1e3).toFixed(n < 1e4 ? 1 : 0)}k`;
  if (n < 1e9) return `${(n / 1e6).toFixed(n < 1e7 ? 1 : 0)}M`;
  return `${(n / 1e9).toFixed(1)}B`;
}

/** JSON for a code block, cut when huge. */
export function prettyJson(value: unknown, max = 20_000): string {
  const text = JSON.stringify(value, null, 2) ?? "";
  return text.length > max ? `${text.slice(0, max)}\n…` : text;
}

/** "5 min", "3 h", "12 Oct 2026". */
export function when(ms: number | undefined, now = Date.now()): string {
  if (ms === undefined) return "";
  const s = (now - ms) / 1000;
  if (s < 0) return new Date(ms).toLocaleString("en-GB");
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min`;
  if (s < 86400) return `${Math.floor(s / 3600)} h`;
  return new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}
