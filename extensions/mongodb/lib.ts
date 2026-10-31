// MongoDB logic: HTTP digest authentication (MD5) for the Atlas Admin API,
// Atlas clusters, connection strings, the mongosh scripts and their output.
// Pure, tested in lib_test.ts.

// ---------------------------------------------------------------------------
// MD5 (RFC 1321): Web Crypto has none, and Atlas API keys use HTTP digest.

const S = [
  7,
  12,
  17,
  22,
  7,
  12,
  17,
  22,
  7,
  12,
  17,
  22,
  7,
  12,
  17,
  22,
  5,
  9,
  14,
  20,
  5,
  9,
  14,
  20,
  5,
  9,
  14,
  20,
  5,
  9,
  14,
  20,
  4,
  11,
  16,
  23,
  4,
  11,
  16,
  23,
  4,
  11,
  16,
  23,
  4,
  11,
  16,
  23,
  6,
  10,
  15,
  21,
  6,
  10,
  15,
  21,
  6,
  10,
  15,
  21,
  6,
  10,
  15,
  21,
];
const K = Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) >>> 0);

/** The MD5 of a UTF-8 string, as 32 hex digits. */
export function md5(text: string): string {
  const msg = new TextEncoder().encode(text);
  const len = ((msg.length + 8) >>> 6) + 1 << 6;
  const buf = new Uint8Array(len);
  buf.set(msg);
  buf[msg.length] = 0x80;
  const view = new DataView(buf.buffer);
  view.setUint32(len - 8, (msg.length * 8) >>> 0, true);
  view.setUint32(len - 4, Math.floor(msg.length / 0x20000000), true);
  let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
  for (let off = 0; off < len; off += 64) {
    let a = a0, b = b0, c = c0, d = d0;
    for (let i = 0; i < 64; i++) {
      let f: number, g: number;
      if (i < 16) [f, g] = [(b & c) | (~b & d), i];
      else if (i < 32) [f, g] = [(d & b) | (~d & c), (5 * i + 1) % 16];
      else if (i < 48) [f, g] = [b ^ c ^ d, (3 * i + 5) % 16];
      else [f, g] = [c ^ (b | ~d), (7 * i) % 16];
      const sum = (a + f + K[i] + view.getUint32(off + g * 4, true)) >>> 0;
      a = d;
      d = c;
      c = b;
      b = (b + ((sum << S[i]) | (sum >>> (32 - S[i])))) >>> 0;
    }
    a0 = (a0 + a) >>> 0;
    b0 = (b0 + b) >>> 0;
    c0 = (c0 + c) >>> 0;
    d0 = (d0 + d) >>> 0;
  }
  const out = new DataView(new ArrayBuffer(16));
  [a0, b0, c0, d0].forEach((v, i) => out.setUint32(i * 4, v, true));
  return [...new Uint8Array(out.buffer)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

// ---------------------------------------------------------------------------
// HTTP digest (RFC 2617 / 7616, MD5, qop=auth)

export interface Challenge {
  realm: string;
  nonce: string;
  qop?: string;
  opaque?: string;
  algorithm?: string;
}

/** `Digest realm="MMS Public API", nonce="…", algorithm=MD5, qop="auth"` → its parameters. */
export function parseChallenge(header: string | null): Challenge | undefined {
  if (!header || !/^\s*Digest\s/i.test(header)) return undefined;
  const params: Record<string, string> = {};
  for (const m of header.replace(/^\s*Digest\s+/i, "").matchAll(/(\w+)=(?:"((?:[^"\\]|\\.)*)"|([^\s,]+))/g)) {
    params[m[1].toLowerCase()] = m[2] !== undefined ? m[2].replace(/\\(.)/g, "$1") : m[3];
  }
  if (!params.nonce) return undefined;
  return {
    realm: params.realm ?? "",
    nonce: params.nonce,
    qop: params.qop,
    opaque: params.opaque,
    algorithm: params.algorithm,
  };
}

/** The Authorization header answering a digest challenge. */
export function digestHeader(
  c: Challenge,
  o: { username: string; password: string; method: string; uri: string; cnonce: string; nc?: number },
): string {
  const nc = (o.nc ?? 1).toString(16).padStart(8, "0");
  const ha1 = md5(`${o.username}:${c.realm}:${o.password}`);
  const ha2 = md5(`${o.method}:${o.uri}`);
  const qop = c.qop?.split(",").map((q) => q.trim()).includes("auth") ? "auth" : undefined;
  const response = qop ? md5(`${ha1}:${c.nonce}:${nc}:${o.cnonce}:${qop}:${ha2}`) : md5(`${ha1}:${c.nonce}:${ha2}`);
  const q = (s: string) => `"${s.replace(/(["\\])/g, "\\$1")}"`;
  return [
    `Digest username=${q(o.username)}`,
    `realm=${q(c.realm)}`,
    `nonce=${q(c.nonce)}`,
    `uri=${q(o.uri)}`,
    ...(qop ? [`qop=${qop}`, `nc=${nc}`, `cnonce=${q(o.cnonce)}`] : []),
    `response=${q(response)}`,
    `algorithm=MD5`,
    ...(c.opaque ? [`opaque=${q(c.opaque)}`] : []),
  ].join(", ");
}

// ---------------------------------------------------------------------------
// Atlas

export interface AtlasProject {
  id: string;
  name: string;
  orgId?: string;
  clusterCount?: number;
}

export interface RegionConfig {
  providerName?: string;
  backingProviderName?: string;
  regionName?: string;
  priority?: number;
  electableSpecs?: { instanceSize?: string; nodeCount?: number };
}

/** GET /groups/{id}/clusters (version 2023-02-01), or /flexClusters. */
export interface AtlasClusterRaw {
  id?: string;
  name: string;
  stateName?: "IDLE" | "CREATING" | "UPDATING" | "DELETING" | "REPAIRING" | string;
  paused?: boolean;
  mongoDBVersion?: string;
  clusterType?: string;
  diskSizeGB?: number;
  backupEnabled?: boolean;
  terminationProtectionEnabled?: boolean;
  createDate?: string;
  connectionStrings?: { standard?: string; standardSrv?: string; private?: string; privateSrv?: string };
  replicationSpecs?: { numShards?: number; regionConfigs?: RegionConfig[] }[];
  providerSettings?: { providerName?: string; backingProviderName?: string; regionName?: string };
}

export interface AtlasCluster {
  project: AtlasProject;
  name: string;
  state: string;
  paused: boolean;
  version?: string;
  type: string;
  tier: string;
  provider?: string;
  region?: string;
  shards?: number;
  diskGB?: number;
  backup?: boolean;
  protected?: boolean;
  created?: string;
  srv?: string;
  standard?: string;
  privateSrv?: string;
  /** Dedicated clusters (M10 and up) can be paused; M0, flex and serverless can't. */
  pausable: boolean;
}

export function parseCluster(project: AtlasProject, raw: AtlasClusterRaw, flex = false): AtlasCluster {
  const region = raw.replicationSpecs?.[0]?.regionConfigs?.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))[0];
  const instance = region?.electableSpecs?.instanceSize;
  const provider = raw.providerSettings?.backingProviderName ?? region?.backingProviderName ??
    (region?.providerName === "TENANT" ? undefined : region?.providerName) ?? raw.providerSettings?.providerName;
  const tier = flex ? "Flex" : instance ?? "?";
  return {
    project,
    name: raw.name,
    state: raw.paused ? "PAUSED" : raw.stateName ?? "IDLE",
    paused: !!raw.paused,
    version: raw.mongoDBVersion,
    type: flex ? "FLEX" : raw.clusterType ?? "REPLICASET",
    tier,
    provider,
    region: raw.providerSettings?.regionName ?? region?.regionName,
    shards: raw.replicationSpecs?.reduce((n, s) => n + (s.numShards ?? 1), 0),
    diskGB: raw.diskSizeGB,
    backup: raw.backupEnabled,
    protected: raw.terminationProtectionEnabled,
    created: raw.createDate,
    srv: raw.connectionStrings?.standardSrv,
    standard: raw.connectionStrings?.standard,
    privateSrv: raw.connectionStrings?.privateSrv,
    pausable: !flex && /^M([1-9]\d+)$/.test(tier) && Number(tier.slice(1)) >= 10,
  };
}

export type Tint = "red" | "orange" | "yellow" | "green" | "gray" | "blue";

export const STATE_COLORS: Record<string, Tint> = {
  IDLE: "green",
  CREATING: "blue",
  UPDATING: "yellow",
  REPAIRING: "orange",
  DELETING: "red",
  PAUSED: "gray",
};

export function stateTitle(state: string): string {
  return state === "IDLE" ? "available" : state.toLowerCase();
}

/** Busy clusters first, then by project and name. */
export function sortClusters(list: AtlasCluster[]): AtlasCluster[] {
  const rank = (c: AtlasCluster) => c.state === "IDLE" ? 1 : c.paused ? 2 : 0;
  return [...list].sort((a, b) =>
    rank(a) - rank(b) || a.project.name.localeCompare(b.project.name) || a.name.localeCompare(b.name)
  );
}

export const atlasUrl = (c: Pick<AtlasCluster, "project" | "name">) =>
  `https://cloud.mongodb.com/v2/${c.project.id}#/clusters/detail/${encodeURIComponent(c.name)}`;

// ---------------------------------------------------------------------------
// Connection strings

export interface Connection {
  /** What the list shows: the label given, or the hosts. */
  label: string;
  uri: string;
}

const URI = /^(mongodb(?:\+srv)?:\/\/)([^/?#]*)(\/[^?#]*)?(\?[^#]*)?$/i;

/**
 * Connection strings separated by spaces or new lines (commas belong to
 * replica set hosts), each optionally named: `prod=mongodb+srv://…`.
 */
export function parseConnections(text: unknown): Connection[] {
  const out: Connection[] = [];
  for (const token of String(text ?? "").split(/\s+/).filter(Boolean)) {
    const m = /^([\w.-]+)=(mongodb(?:\+srv)?:\/\/.+)$/i.exec(token);
    const uri = m ? m[2] : token;
    if (!URI.test(uri)) continue;
    if (!out.some((c) => c.uri === uri)) out.push({ label: m ? m[1] : hostsOf(uri), uri });
  }
  return out.length ? out : [{ label: "localhost:27017", uri: "mongodb://localhost:27017" }];
}

/** The hosts of a connection string, without credentials. */
export function hostsOf(uri: string): string {
  const m = URI.exec(uri);
  if (!m) return uri;
  const authority = m[2];
  return authority.slice(authority.lastIndexOf("@") + 1);
}

export const hasPassword = (uri: string) => /^mongodb(?:\+srv)?:\/\/[^/?#@]*:[^/?#@]*@/i.test(uri);

/** The connection string with its password hidden, for display. */
export function redact(uri: string): string {
  return uri.replace(/^(mongodb(?:\+srv)?:\/\/[^/?#:@]*):[^/?#@]*@/i, "$1:****@");
}

/** The same server with another default database: `mongodb://h/?tls=true` + shop → `mongodb://h/shop?tls=true`. */
export function withDatabase(uri: string, db: string): string {
  const m = URI.exec(uri);
  if (!m) return uri;
  return `${m[1]}${m[2]}/${encodeURIComponent(db)}${m[4] ?? ""}`;
}

/** Adds an option unless the string already sets it. */
export function withOption(uri: string, key: string, value: string): string {
  const m = URI.exec(uri);
  if (!m) return uri;
  const query = m[4] ?? "";
  if (new RegExp(`[?&]${key}=`, "i").test(query)) return uri;
  return `${m[1]}${m[2]}${m[3] ?? "/"}${query ? `${query}&` : "?"}${key}=${encodeURIComponent(value)}`;
}

// ---------------------------------------------------------------------------
// mongosh scripts: the connection string and names come in environment
// variables (never in the command line), the answer between two markers.

export const MARK = "@@BACKSLASH-MONGODB@@";

const PRELUDE = `const conn = connect(process.env.BS_MONGO_URI);
const out = (value) => print("${MARK}" + EJSON.stringify(value, { relaxed: true }) + "${MARK}");`;

export const DATABASES_SCRIPT = `${PRELUDE}
const res = { version: conn.version(), databases: [] };
try {
  const h = conn.adminCommand({ hello: 1 });
  res.setName = h.setName;
  res.writable = h.isWritablePrimary;
  res.shard = h.msg === "isdbgrid";
} catch (e) {}
const list = conn.adminCommand({ listDatabases: 1, authorizedDatabases: true });
for (const d of list.databases) {
  const row = { name: d.name, sizeOnDisk: d.sizeOnDisk, empty: d.empty };
  try {
    const s = conn.getSiblingDB(d.name).runCommand({ dbStats: 1 });
    Object.assign(row, { collections: s.collections, views: s.views, objects: s.objects, dataSize: s.dataSize, indexes: s.indexes });
  } catch (e) {}
  res.databases.push(row);
}
out(res);`;

export const COLLECTIONS_SCRIPT = `${PRELUDE}
const d = conn.getSiblingDB(process.env.BS_DB);
const res = [];
for (const info of d.getCollectionInfos()) {
  const row = { name: info.name, type: info.type, capped: !!(info.options && info.options.capped), viewOn: info.options && info.options.viewOn };
  if (info.type !== "view") {
    try { row.count = d.getCollection(info.name).estimatedDocumentCount(); } catch (e) {}
    try {
      const s = d.runCommand({ collStats: info.name });
      Object.assign(row, { size: s.size, storageSize: s.storageSize, indexes: s.nindexes, indexSize: s.totalIndexSize, avgObjSize: s.avgObjSize });
    } catch (e) {}
  }
  res.push(row);
}
out(res);`;

/** The latest documents, or those matching a filter typed in shell syntax: `{ status: "paid", total: { $gt: 100 } }`. */
export const DOCUMENTS_SCRIPT = `${PRELUDE}
const c = conn.getSiblingDB(process.env.BS_DB).getCollection(process.env.BS_COLLECTION);
const text = (process.env.BS_FILTER || "").trim();
const filter = text ? eval("(" + text + ")") : {};
const docs = c.find(filter).sort({ _id: -1 }).limit(Number(process.env.BS_LIMIT || 20)).toArray();
let total;
try { total = text ? c.countDocuments(filter, { maxTimeMS: 3000 }) : c.estimatedDocumentCount(); } catch (e) {}
out({ docs, total });`;

/** What a script printed between the markers, parsed. */
export function extractResult<T>(stdout: string): T {
  const start = stdout.indexOf(MARK);
  const end = stdout.lastIndexOf(MARK);
  if (start < 0 || end <= start) {
    throw new Error(cleanMongoshError(stdout) || "mongosh gave no answer");
  }
  return JSON.parse(stdout.slice(start + MARK.length, end)) as T;
}

/** The useful line of a mongosh failure: `MongoServerSelectionError: connect ECONNREFUSED …`. */
export function cleanMongoshError(text: string): string {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const err =
    lines.find((l) =>
      /^(Mongo\w*Error|MongoshInvalidInputError|SyntaxError|TypeError|ReferenceError|Error)\b/.test(l)
    ) ??
      lines.find((l) => /error/i.test(l)) ?? lines[lines.length - 1] ?? "";
  return err.replace(/^Uncaught:?\s*/, "").slice(0, 300);
}

/** A sentence for the usual connection failures. */
export function explainError(message: string): string {
  if (/ECONNREFUSED/.test(message)) return `Nothing answers there: is mongod running? (${message})`;
  if (/Authentication failed|AuthenticationFailed/i.test(message)) {
    return "Authentication failed: check the user and password in the connection string";
  }
  if (/requires authentication|not authorized/i.test(message)) {
    return "The server wants a user: add one to the connection string (mongodb://user:password@host)";
  }
  if (/ENOTFOUND|querySrv/i.test(message)) return `The host can't be found: ${message}`;
  if (/Server selection timed out|ServerSelectionError/i.test(message)) {
    return `The server doesn't answer in time (is your IP on the access list?): ${message}`;
  }
  return message;
}

export interface DatabaseRow {
  name: string;
  sizeOnDisk?: number;
  empty?: boolean;
  collections?: number;
  views?: number;
  objects?: number;
  dataSize?: number;
  indexes?: number;
}

export interface ServerInfo {
  version?: string;
  setName?: string;
  writable?: boolean;
  shard?: boolean;
  databases: DatabaseRow[];
}

export interface CollectionRow {
  name: string;
  type?: "collection" | "view" | "timeseries" | string;
  capped?: boolean;
  viewOn?: string;
  count?: number;
  size?: number;
  storageSize?: number;
  indexes?: number;
  indexSize?: number;
  avgObjSize?: number;
}

const SYSTEM_DBS = ["admin", "config", "local"];

export const isSystemDb = (name: string) => SYSTEM_DBS.includes(name);

/** Your databases by size, then admin, config and local. */
export function sortDatabases(list: DatabaseRow[]): DatabaseRow[] {
  return [...list].sort((a, b) =>
    Number(isSystemDb(a.name)) - Number(isSystemDb(b.name)) || (b.sizeOnDisk ?? 0) - (a.sizeOnDisk ?? 0) ||
    a.name.localeCompare(b.name)
  );
}

/** Collections by document count, views and system.* after. */
export function sortCollections(list: CollectionRow[]): CollectionRow[] {
  const rank = (c: CollectionRow) => c.name.startsWith("system.") ? 2 : c.type === "view" ? 1 : 0;
  return [...list].sort((a, b) => rank(a) - rank(b) || (b.count ?? 0) - (a.count ?? 0) || a.name.localeCompare(b.name));
}

// ---------------------------------------------------------------------------
// Documents

/** Relaxed EJSON `_id` → its text: `{ $oid: "…" }` → the hex, a string as is. */
export function idText(id: unknown): string {
  if (id && typeof id === "object") {
    const o = id as Record<string, unknown>;
    if (typeof o.$oid === "string") return o.$oid;
    if (typeof o.$uuid === "string") return o.$uuid;
    return JSON.stringify(id);
  }
  return String(id);
}

/** `ObjectId("…")` for the shell, or a JSON literal. */
export function idLiteral(id: unknown): string {
  if (id && typeof id === "object" && typeof (id as { $oid?: unknown }).$oid === "string") {
    return `ObjectId(${JSON.stringify((id as { $oid: string }).$oid)})`;
  }
  return JSON.stringify(id);
}

/** The time an ObjectId was made, in Unix ms. */
export function objectIdTime(id: unknown): number | undefined {
  const hex = id && typeof id === "object" ? (id as { $oid?: unknown }).$oid : undefined;
  return typeof hex === "string" && /^[0-9a-f]{24}$/i.test(hex) ? parseInt(hex.slice(0, 8), 16) * 1000 : undefined;
}

const TITLE_FIELDS = ["name", "title", "email", "username", "slug", "label", "subject", "message", "type", "status"];

/** A line that says what a document is. */
export function docTitle(doc: Record<string, unknown>): string {
  for (const f of TITLE_FIELDS) {
    const v = doc[f];
    if (typeof v === "string" && v.trim()) return v.replace(/\s+/g, " ").trim().slice(0, 120);
  }
  return idText(doc._id);
}

/** Shell-friendly JSON: `{ "$oid": "…" }` → `ObjectId("…")`, `{ "$date": "…" }` → `ISODate("…")`. */
export function shellJson(doc: unknown): string {
  return JSON.stringify(doc, null, 2)
    .replace(/\{\s*"\$oid":\s*("[0-9a-f]{24}")\s*\}/gi, "ObjectId($1)")
    .replace(/\{\s*"\$date":\s*("[^"]+")\s*\}/g, "ISODate($1)");
}

// ---------------------------------------------------------------------------
// Formatting

export function bytes(n: number | undefined): string {
  if (n === undefined || !Number.isFinite(n)) return "–";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let v = n, u = 0;
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024;
    u++;
  }
  return `${u === 0 ? v : v < 10 ? v.toFixed(1) : Math.round(v)} ${units[u]}`;
}

export function count(n: number | undefined): string {
  if (n === undefined || !Number.isFinite(n)) return "–";
  if (n < 1000) return String(n);
  if (n < 1e6) return `${(n / 1e3).toFixed(n < 1e4 ? 1 : 0)}k`;
  if (n < 1e9) return `${(n / 1e6).toFixed(n < 1e7 ? 1 : 0)}M`;
  return `${(n / 1e9).toFixed(1)}B`;
}

export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
