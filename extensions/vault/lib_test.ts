import { assert, assertEquals } from "@std/assert";
import { parse } from "@std/toml";
import {
  baseName,
  classifyError,
  cleanError,
  duration,
  formatDate,
  joinPath,
  MASK,
  normalizeAddress,
  parseList,
  parseMetadata,
  parseMounts,
  parseSecret,
  parseStatus,
  parseToken,
  relative,
  shellQuote,
  shownValue,
  ttlColor,
  uiUrl,
  valueText,
  versionState,
} from "./lib.ts";
import { TERMINALS } from "./terminal.ts";

// `vault secrets list -format=json` on a dev server with an extra KV v1 mount.
const MOUNTS = JSON.stringify({
  "cubbyhole/": {
    uuid: "4b1c1a7e",
    type: "cubbyhole",
    description: "per-token private secret storage",
    accessor: "cubbyhole_7f8a3c1d",
    config: { default_lease_ttl: 0, max_lease_ttl: 0 },
    options: null,
    local: true,
    seal_wrap: false,
  },
  "identity/": { type: "identity", description: "identity store", accessor: "identity_1", options: null },
  "secret/": {
    type: "kv",
    description: "key/value secret storage",
    accessor: "kv_2e4c5d6f",
    options: { version: "2" },
    local: false,
    seal_wrap: false,
  },
  "legacy": { type: "kv", description: "", accessor: "kv_99", options: { version: "1" } },
  "old/": { type: "generic", description: "pre-0.8 mount", accessor: "generic_1", options: null, seal_wrap: true },
  "sys/": { type: "system", description: "system endpoints", accessor: "system_1", options: null },
  "pki/": { type: "pki", accessor: "pki_1", options: null },
});

// `vault kv get -format=json secret/app/db` (KV v2).
const SECRET_V2 = JSON.stringify({
  request_id: "a1f6d6e1-8b0e-6b47-3c2d-2c3d4e5f6a7b",
  lease_id: "",
  lease_duration: 0,
  renewable: false,
  data: {
    data: {
      password: "s3cr3t!",
      port: 5432,
      tls: true,
      hosts: ["db1", "db2"],
      cert: "-----BEGIN-----\nAAA\n-----END-----",
    },
    metadata: {
      created_time: "2026-10-27T09:15:03.123456Z",
      custom_metadata: { owner: "platform" },
      deletion_time: "",
      destroyed: false,
      version: 3,
    },
  },
  warnings: null,
});

// `vault kv metadata get -format=json secret/app/db`.
const METADATA = JSON.stringify({
  request_id: "x",
  data: {
    cas_required: false,
    created_time: "2026-09-01T10:00:00.000000Z",
    current_version: 3,
    custom_metadata: { owner: "platform" },
    delete_version_after: "0s",
    max_versions: 0,
    oldest_version: 0,
    updated_time: "2026-10-27T09:15:03.123456Z",
    versions: {
      "1": { created_time: "2026-09-01T10:00:00Z", deletion_time: "", destroyed: true },
      "2": { created_time: "2026-10-01T10:00:00Z", deletion_time: "2026-10-02T10:00:00Z", destroyed: false },
      "3": { created_time: "2026-10-27T09:15:03Z", deletion_time: "", destroyed: false },
      "10": { created_time: "2026-10-28T09:15:03Z", deletion_time: "", destroyed: false },
    },
  },
});

// `vault token lookup -format=json`.
const TOKEN = JSON.stringify({
  data: {
    accessor: "8609694a-cdbc-db9b-d345-e782dbb562ed",
    creation_time: 1761600000,
    creation_ttl: 2764800,
    display_name: "oidc-ada@example.com",
    entity_id: "7d2e3179-f69b-450c-7179-ac8ee8bd8ca9",
    expire_time: "2026-11-27T21:20:00.123456789Z",
    explicit_max_ttl: 0,
    id: "hvs.CAESIJ-not-shown",
    identity_policies: ["developers"],
    issue_time: "2026-10-28T21:20:00.123456789Z",
    meta: { role: "default", email: "ada@example.com" },
    num_uses: 0,
    orphan: true,
    path: "auth/oidc/oidc/callback",
    policies: ["default", "app-read"],
    renewable: true,
    ttl: 2764000,
    type: "service",
  },
});

Deno.test("terminals and programs match the manifest", async () => {
  const manifest = parse(await Deno.readTextFile(new URL("./backslash.toml", import.meta.url))) as {
    permissions: { run: string[]; env: string[] };
    commands: { name: string }[];
  };
  assertEquals(manifest.permissions.run, ["vault", "bao", ...TERMINALS]);
  for (const c of manifest.commands) {
    await Deno.stat(new URL(`./commands/${c.name}.ts`, import.meta.url));
  }
});

Deno.test("addresses", () => {
  assertEquals(normalizeAddress("vault.lan:8200"), "https://vault.lan:8200");
  assertEquals(normalizeAddress("http://127.0.0.1:8200/ui/vault/secrets"), "http://127.0.0.1:8200");
  assertEquals(normalizeAddress("https://vault.example.com/"), "https://vault.example.com");
  assertEquals(normalizeAddress("  "), "");
  assertEquals(normalizeAddress(undefined), "");
});

Deno.test("paths", () => {
  assertEquals(joinPath("secret/", "app/", "db"), "secret/app/db");
  assertEquals(joinPath("secret/", ""), "secret/");
  assertEquals(joinPath("secret/app/", "/x"), "secret/app/x");
  assertEquals(baseName("secret/app/db"), "db");
  assertEquals(baseName("secret/app/"), "app/");
  assertEquals(shellQuote("secret/app/db"), "secret/app/db");
  assertEquals(shellQuote("secret/it's here"), "'secret/it'\\''s here'");
});

Deno.test("mounts: only KV engines, with their version", () => {
  const { kv, other } = parseMounts(MOUNTS);
  assertEquals(kv.map((m) => [m.path, m.version, m.type]), [
    ["legacy/", 1, "kv"],
    ["old/", 1, "generic"],
    ["secret/", 2, "kv"],
  ]);
  assertEquals(other, 4);
  assertEquals(kv[1].sealWrap, true);
  assertEquals(kv[2].description, "key/value secret storage");
  assertEquals(parseMounts("{}").kv, []);
});

Deno.test("listing: folders first", () => {
  assertEquals(parseList('["zeta","app/","alpha","db/"]'), [
    { name: "app/", folder: true },
    { name: "db/", folder: true },
    { name: "alpha", folder: false },
    { name: "zeta", folder: false },
  ]);
  // The raw API shape, should a wrapper print it.
  assertEquals(parseList('{"data":{"keys":["a"]}}'), [{ name: "a", folder: false }]);
  assertEquals(parseList(""), []);
});

Deno.test("KV v2 secret", () => {
  const s = parseSecret(SECRET_V2, 2);
  assertEquals(s.data.password, "s3cr3t!");
  assertEquals(s.data.port, "5432");
  assertEquals(s.data.tls, "true");
  assertEquals(s.data.hosts, '["db1","db2"]');
  assertEquals(s.data.cert.split("\n").length, 3);
  assertEquals(s.version?.version, 3);
  assertEquals(s.customMetadata, { owner: "platform" });
  assertEquals(s.gone, false);
});

Deno.test("KV v1 secret and deleted v2 version", () => {
  const v1 = parseSecret(JSON.stringify({ request_id: "r", lease_duration: 2764800, data: { token: "abc" } }), 1);
  assertEquals(v1.data, { token: "abc" });
  assertEquals(v1.version, undefined);
  const deleted = parseSecret(
    JSON.stringify({
      data: {
        data: null,
        metadata: {
          created_time: "2026-10-01T10:00:00Z",
          deletion_time: "2026-10-02T10:00:00Z",
          destroyed: false,
          version: 2,
        },
      },
    }),
    2,
  );
  assertEquals(deleted.gone, true);
  assertEquals(deleted.data, {});
  assertEquals(deleted.version?.deleted, "2026-10-02T10:00:00Z");
});

Deno.test("values as text", () => {
  assertEquals(valueText("x"), "x");
  assertEquals(valueText(42), "42");
  assertEquals(valueText(null), "");
  assertEquals(valueText({ a: 1 }), '{"a":1}');
});

Deno.test("metadata and version states", () => {
  const md = parseMetadata(METADATA);
  assertEquals(md.currentVersion, 3);
  assertEquals(md.versions.map((v) => v.version), [10, 3, 2, 1]);
  assertEquals(md.versions.map((v) => versionState(v, md.currentVersion)), ["live", "current", "deleted", "destroyed"]);
  assertEquals(md.customMetadata.owner, "platform");
  assertEquals(md.deleteVersionAfter, "0s");
});

Deno.test("token lookup", () => {
  const t = parseToken(TOKEN);
  assertEquals(t.displayName, "oidc-ada@example.com");
  assertEquals(t.policies, ["default", "app-read", "developers"]);
  assertEquals(t.ttl, 2764000);
  assertEquals(t.renewable, true);
  assertEquals(t.orphan, true);
  assertEquals(t.meta.email, "ada@example.com");
  assert(!JSON.stringify(t).includes("hvs."), "the token itself is never kept");
  const root = parseToken(
    JSON.stringify({ data: { display_name: "root", policies: ["root"], ttl: 0, expire_time: null } }),
  );
  assertEquals(root.ttl, 0);
  assertEquals(root.expireTime, "");
});

Deno.test("durations and TTL colors", () => {
  assertEquals(duration(0), "never expires");
  assertEquals(duration(42), "42s");
  assertEquals(duration(3599), "59m");
  assertEquals(duration(3600), "1h");
  assertEquals(duration(5400), "1h 30m");
  assertEquals(duration(90061), "1d 1h");
  assertEquals(duration(2764800), "32d");
  assertEquals(ttlColor(0), "green");
  assertEquals(ttlColor(1800), "red");
  assertEquals(ttlColor(7200), "orange");
  assertEquals(ttlColor(200000), "green");
});

Deno.test("server status", () => {
  const s = parseStatus(JSON.stringify({
    type: "shamir",
    initialized: true,
    sealed: true,
    t: 3,
    n: 5,
    progress: 1,
    nonce: "",
    version: "1.17.2",
    build_date: "2024-07-05T15:19:12Z",
    migration: false,
    recovery_seal: false,
    storage_type: "raft",
    ha_enabled: true,
    is_self: false,
    leader_address: "https://vault-0.vault-internal:8200",
  }));
  assertEquals(s.sealed, true);
  assertEquals([s.threshold, s.shares, s.progress], [3, 5, 1]);
  assertEquals(s.haMode, "standby");
  assertEquals(s.storage, "raft");
  assertEquals(parseStatus('{"sealed":false,"version":"2.0.0","ha_enabled":false}').haMode, "");
});

Deno.test("CLI errors", () => {
  const denied = `Error listing secret/metadata/team: Error making API request.

URL: GET http://127.0.0.1:8200/v1/secret/metadata/team?list=true
Code: 403. Errors:

* permission denied`;
  assertEquals(classifyError(denied), "denied");
  assertEquals(cleanError(denied), "permission denied");
  assertEquals(classifyError("No value found at secret/metadata/empty"), "empty");
  assertEquals(
    classifyError(
      'Error checking seal status: Get "https://127.0.0.1:8200/v1/sys/seal-status": http: server gave HTTP response to HTTPS client',
    ),
    "tls",
  );
  assertEquals(
    classifyError('Get "http://127.0.0.1:8200/v1/sys/mounts": dial tcp 127.0.0.1:8200: connect: connection refused'),
    "address",
  );
  assertEquals(classifyError("Error looking up token: ...\nCode: 403. Errors:\n\n* missing client token"), "token");
  assertEquals(classifyError("Error making API request.\nCode: 503. Errors:\n\n* Vault is sealed"), "sealed");
  assertEquals(cleanError("Error: something odd happened"), "something odd happened");
});

Deno.test("Vault UI links", () => {
  const v2 = parseMounts(MOUNTS).kv.find((m) => m.path === "secret/")!;
  const v1 = parseMounts(MOUNTS).kv.find((m) => m.path === "legacy/")!;
  const a = "http://127.0.0.1:8200";
  assertEquals(uiUrl(a, "vault", v2), `${a}/ui/vault/secrets/secret/kv/list`);
  assertEquals(uiUrl(a, "vault", v2, "app/"), `${a}/ui/vault/secrets/secret/kv/list/app/`);
  assertEquals(uiUrl(a, "vault", v2, "app/db"), `${a}/ui/vault/secrets/secret/kv/app%2Fdb/details`);
  assertEquals(uiUrl(a, "bao", v2, "app/db"), `${a}/ui/vault/secrets/secret/show/app/db`);
  assertEquals(uiUrl(a, "vault", v1, "team/x y"), `${a}/ui/vault/secrets/legacy/show/team/x%20y`);
  assertEquals(uiUrl(a, "vault", v1, "team/"), `${a}/ui/vault/secrets/legacy/list/team/`);
});

Deno.test("concealed values", () => {
  assertEquals(shownValue("hunter2", false), MASK);
  assertEquals(shownValue("hunter2", true), "hunter2");
  assertEquals(shownValue("x".repeat(200), true).length, 118);
});

Deno.test("dates", () => {
  const now = Date.parse("2026-10-28T12:00:00Z");
  assertEquals(formatDate("2026-10-27T09:15:03.123456Z"), "27 Oct 2026, 09:15 UTC");
  assertEquals(formatDate(""), "");
  assertEquals(formatDate("0001-01-01T00:00:00Z"), "");
  assertEquals(relative("2026-10-25T12:00:00Z", now), "3 days ago");
  assertEquals(relative("2026-10-28T14:30:00Z", now), "in 2 hours");
  assertEquals(relative("2026-10-28T11:59:30Z", now), "just now");
});
