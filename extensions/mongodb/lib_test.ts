import { assert, assertEquals, assertThrows } from "@std/assert";
import { credentials, SetupError } from "./atlas.ts";
import {
  atlasUrl,
  bytes,
  cleanMongoshError,
  count,
  DATABASES_SCRIPT,
  digestHeader,
  docTitle,
  DOCUMENTS_SCRIPT,
  explainError,
  extractResult,
  hasPassword,
  hostsOf,
  idLiteral,
  idText,
  MARK,
  md5,
  objectIdTime,
  parseChallenge,
  parseCluster,
  parseConnections,
  redact,
  shellJson,
  sortClusters,
  sortCollections,
  sortDatabases,
  withDatabase,
  withOption,
} from "./lib.ts";

Deno.test("md5 test vectors", () => {
  assertEquals(md5(""), "d41d8cd98f00b204e9800998ecf8427e");
  assertEquals(md5("abc"), "900150983cd24fb0d6963f7d28e17f72");
  assertEquals(md5("The quick brown fox jumps over the lazy dog"), "9e107d9d372bb6826bd81d3542a419d6");
  assertEquals(md5("1234567890".repeat(8)), "57edf4a22be3c955ac49da2e2107b67a");
  assertEquals(md5("é"), "66ddcd97cfdeabb2f6fb8a999b4bc76f");
  // 55 and 56 bytes: the padding edge.
  assertEquals(md5("a".repeat(55)), "ef1772b6dff9a122358552954ad0df65");
  assertEquals(md5("a".repeat(56)), "3b0c8ac703f828b04c6c197006d17218");
});

Deno.test("digest challenge and response (RFC 2617 example)", () => {
  const c = parseChallenge(
    'Digest realm="testrealm@host.com", qop="auth,auth-int", nonce="dcd98b7102dd2f0e8b11d0f600bfb0c093", opaque="5ccc069c403ebaf9f0171e9517f40e41"',
  )!;
  assertEquals(c.realm, "testrealm@host.com");
  assertEquals(c.qop, "auth,auth-int");
  const h = digestHeader(c, {
    username: "Mufasa",
    password: "Circle Of Life",
    method: "GET",
    uri: "/dir/index.html",
    cnonce: "0a4f113b",
  });
  assert(h.includes('response="6629fae49393a05397450978507c4ef1"'), h);
  assert(h.includes("qop=auth, nc=00000001"));
  assert(h.includes('opaque="5ccc069c403ebaf9f0171e9517f40e41"'));
  // Atlas's challenge.
  const atlas = parseChallenge(
    'Digest realm="MMS Public API", domain="", nonce="Q0pGwq3C/2V3", algorithm=MD5, qop="auth", stale=false',
  )!;
  assertEquals([atlas.realm, atlas.nonce, atlas.algorithm], ["MMS Public API", "Q0pGwq3C/2V3", "MD5"]);
  assertEquals(parseChallenge('Basic realm="x"'), undefined);
  assertEquals(parseChallenge(null), undefined);
});

// GET /api/atlas/v2/groups/{id}/clusters (application/vnd.atlas.2023-02-01+json), abridged.
const PROJECT = { id: "5f1e0c0ffee0123456789abc", name: "Shop" };
const DEDICATED = {
  id: "6501",
  name: "prod",
  stateName: "IDLE",
  paused: false,
  mongoDBVersion: "8.0.3",
  clusterType: "REPLICASET",
  diskSizeGB: 40,
  backupEnabled: true,
  terminationProtectionEnabled: true,
  createDate: "2025-03-04T10:00:00Z",
  connectionStrings: {
    standard: "mongodb://prod-shard-00-00.ab12c.mongodb.net:27017,prod-shard-00-01.ab12c.mongodb.net:27017/?ssl=true",
    standardSrv: "mongodb+srv://prod.ab12c.mongodb.net",
  },
  replicationSpecs: [{
    numShards: 1,
    regionConfigs: [
      {
        providerName: "AWS",
        regionName: "EU_WEST_3",
        priority: 6,
        electableSpecs: { instanceSize: "M10", nodeCount: 2 },
      },
      {
        providerName: "AWS",
        regionName: "EU_WEST_1",
        priority: 7,
        electableSpecs: { instanceSize: "M10", nodeCount: 1 },
      },
    ],
  }],
};
const FREE = {
  name: "Cluster0",
  stateName: "IDLE",
  mongoDBVersion: "8.0.4",
  clusterType: "REPLICASET",
  connectionStrings: { standardSrv: "mongodb+srv://cluster0.xy9.mongodb.net" },
  replicationSpecs: [{
    regionConfigs: [{
      providerName: "TENANT",
      backingProviderName: "GCP",
      regionName: "WESTERN_EUROPE",
      electableSpecs: { instanceSize: "M0" },
    }],
  }],
};

Deno.test("atlas clusters", () => {
  const prod = parseCluster(PROJECT, DEDICATED);
  assertEquals([prod.tier, prod.provider, prod.region, prod.state], ["M10", "AWS", "EU_WEST_1", "IDLE"]);
  assertEquals(prod.pausable, true);
  assertEquals(prod.srv, "mongodb+srv://prod.ab12c.mongodb.net");
  const free = parseCluster(PROJECT, FREE);
  assertEquals([free.tier, free.provider, free.pausable], ["M0", "GCP", false]);
  const flex = parseCluster(PROJECT, {
    name: "dev",
    stateName: "IDLE",
    connectionStrings: { standardSrv: "mongodb+srv://dev.zz1.mongodb.net" },
    providerSettings: { providerName: "FLEX", backingProviderName: "AWS", regionName: "US_EAST_1" },
  }, true);
  assertEquals([flex.tier, flex.provider, flex.region, flex.type, flex.pausable], [
    "Flex",
    "AWS",
    "US_EAST_1",
    "FLEX",
    false,
  ]);
  const paused = parseCluster({ id: "p2", name: "Analytics" }, { ...DEDICATED, name: "olap", paused: true });
  const busy = parseCluster(PROJECT, { ...DEDICATED, name: "new", stateName: "CREATING" });
  assertEquals(paused.state, "PAUSED");
  assertEquals(sortClusters([paused, free, prod, busy]).map((c) => c.name), ["new", "Cluster0", "prod", "olap"]);
  assertEquals(atlasUrl(prod), "https://cloud.mongodb.com/v2/5f1e0c0ffee0123456789abc#/clusters/detail/prod");
});

Deno.test("atlas credentials", () => {
  assertEquals(credentials({}), undefined);
  assertEquals(credentials({ atlasPublicKey: "abcd", atlasPrivateKey: "x-y" })?.publicKey, "abcd");
  assertEquals(credentials({ atlasClientId: "mdb_sa_id_1", atlasClientSecret: "s" })?.clientId, "mdb_sa_id_1");
  assertThrows(() => credentials({ atlasPublicKey: "abcd" }), SetupError, "private key");
});

Deno.test("connection strings", () => {
  assertEquals(parseConnections(""), [{ label: "localhost:27017", uri: "mongodb://localhost:27017" }]);
  assertEquals(
    parseConnections(
      "mongodb://localhost:27017\nprod=mongodb+srv://app:s3cr%40t@prod.ab12c.mongodb.net/shop?retryWrites=true  nonsense mongodb://h1:27017,h2:27017/?replicaSet=rs0 mongodb://localhost:27017",
    ),
    [
      { label: "localhost:27017", uri: "mongodb://localhost:27017" },
      { label: "prod", uri: "mongodb+srv://app:s3cr%40t@prod.ab12c.mongodb.net/shop?retryWrites=true" },
      { label: "h1:27017,h2:27017", uri: "mongodb://h1:27017,h2:27017/?replicaSet=rs0" },
    ],
  );
  const uri = "mongodb+srv://app:s3cr%40t@prod.ab12c.mongodb.net/shop?retryWrites=true";
  assertEquals(hostsOf(uri), "prod.ab12c.mongodb.net");
  assert(hasPassword(uri));
  assert(!hasPassword("mongodb://app@localhost"));
  assertEquals(redact(uri), "mongodb+srv://app:****@prod.ab12c.mongodb.net/shop?retryWrites=true");
  assertEquals(
    withDatabase(uri, "billing"),
    "mongodb+srv://app:s3cr%40t@prod.ab12c.mongodb.net/billing?retryWrites=true",
  );
  assertEquals(withDatabase("mongodb://localhost:27017", "my db"), "mongodb://localhost:27017/my%20db");
  assertEquals(
    withOption("mongodb://localhost:27017", "appName", "Backslash"),
    "mongodb://localhost:27017/?appName=Backslash",
  );
  assertEquals(withOption(uri, "appName", "x"), `${uri}&appName=x`);
  assertEquals(withOption("mongodb://h/?appName=mine", "appName", "x"), "mongodb://h/?appName=mine");
});

Deno.test("mongosh output and errors", () => {
  assertEquals(
    extractResult(
      `Warning: something\n${MARK}{"version":"7.0.14","databases":[{"name":"shop","sizeOnDisk":73728}]}${MARK}\n`,
    ),
    { version: "7.0.14", databases: [{ name: "shop", sizeOnDisk: 73728 }] },
  );
  assertThrows(
    () => extractResult("MongoServerSelectionError: connect ECONNREFUSED 127.0.0.1:27017\n"),
    Error,
    "ECONNREFUSED",
  );
  assertEquals(
    cleanMongoshError(
      "Current Mongosh Log ID: 6720\nMongoServerError: Authentication failed.\n    at Connection.onMessage (/usr/lib/…)",
    ),
    "MongoServerError: Authentication failed.",
  );
  assertEquals(
    cleanMongoshError("Uncaught:\nSyntaxError: Unexpected token (1:9)\n"),
    "SyntaxError: Unexpected token (1:9)",
  );
  assert(explainError("MongoServerSelectionError: connect ECONNREFUSED 127.0.0.1:27017").startsWith("Nothing answers"));
  assert(explainError("MongoServerError: Authentication failed.").startsWith("Authentication failed"));
  // Names and the URI reach the scripts through the environment, never in the code.
  assert(DATABASES_SCRIPT.includes("process.env.BS_MONGO_URI"));
  assert(DOCUMENTS_SCRIPT.includes("process.env.BS_COLLECTION"));
});

Deno.test("sorting databases and collections", () => {
  assertEquals(
    sortDatabases([
      { name: "admin", sizeOnDisk: 40960 },
      { name: "shop", sizeOnDisk: 73728 },
      { name: "blog", sizeOnDisk: 9_000_000 },
      { name: "local", sizeOnDisk: 1e9 },
    ]).map((d) => d.name),
    ["blog", "shop", "local", "admin"],
  );
  assertEquals(
    sortCollections([
      { name: "system.views", type: "collection", count: 2 },
      { name: "orders", type: "collection", count: 120 },
      { name: "paid_orders", type: "view" },
      { name: "users", type: "collection", count: 4500 },
    ]).map((c) => c.name),
    ["users", "orders", "paid_orders", "system.views"],
  );
});

Deno.test("documents", () => {
  const doc = {
    _id: { $oid: "6720f1a2b3c4d5e6f7a8b9c0" },
    email: "ada@example.com",
    createdAt: { $date: "2026-10-29T10:00:00Z" },
    total: 42.5,
  };
  assertEquals(idText(doc._id), "6720f1a2b3c4d5e6f7a8b9c0");
  assertEquals(idText("sku-1"), "sku-1");
  assertEquals(idText(7), "7");
  assertEquals(idLiteral(doc._id), 'ObjectId("6720f1a2b3c4d5e6f7a8b9c0")');
  assertEquals(idLiteral("sku-1"), '"sku-1"');
  assertEquals(objectIdTime(doc._id), 0x6720f1a2 * 1000);
  assertEquals(objectIdTime("x"), undefined);
  assertEquals(docTitle(doc), "ada@example.com");
  assertEquals(docTitle({ _id: { $oid: "6720f1a2b3c4d5e6f7a8b9c0" }, n: 1 }), "6720f1a2b3c4d5e6f7a8b9c0");
  const shell = shellJson(doc);
  assert(shell.includes('"_id": ObjectId("6720f1a2b3c4d5e6f7a8b9c0")'));
  assert(shell.includes('"createdAt": ISODate("2026-10-29T10:00:00Z")'));
});

Deno.test("formatting", () => {
  assertEquals(bytes(73728), "72 KB");
  assertEquals(bytes(undefined), "–");
  assertEquals(count(4500), "4.5k");
  assertEquals(count(undefined), "–");
});
