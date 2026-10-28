import { assert, assertEquals } from "@std/assert";
import {
  appendMissing,
  assignment,
  compareFiles,
  describe,
  exampleOf,
  expand,
  exportLines,
  extraKeys,
  isEnvFile,
  mask,
  missingKeys,
  parseEnv,
  parseFolders,
  purpose,
  references,
  shellQuote,
  tilde,
} from "./lib.ts";
import { scan } from "./scan.ts";

const ENV = `# Database
DB_HOST=localhost
DB_PORT = 5432   # default port
export DB_USER=app
DB_PASS='p@ss # not a comment'
DATABASE_URL="postgres://\${DB_USER}:\${DB_PASS}@\${DB_HOST}:$DB_PORT/app"
EMPTY=
GREETING="Hello\\nWorld"
PRIVATE_KEY="-----BEGIN KEY-----
abc
-----END KEY-----"
LITERAL='\${NOT_EXPANDED}'
PRICE=\\$5
FALLBACK=\${MISSING:-none}
UNKNOWN=\${NOWHERE}/x
TEMPLATE=\`line one
line two\`
YAML_STYLE: yes
`;

Deno.test("parse: plain, spaced, exported, quoted, inline comments", () => {
  const { entries, issues } = parseEnv(ENV);
  assertEquals(issues, []);
  const by = Object.fromEntries(entries.map((e) => [e.key, e]));
  assertEquals(by.DB_HOST.value, "localhost");
  assertEquals(by.DB_PORT.value, "5432");
  assertEquals(by.DB_PORT.comment, "default port");
  assertEquals(by.DB_USER.exported, true);
  assertEquals(by.DB_PASS.value, "p@ss # not a comment");
  assertEquals(by.DB_PASS.quote, "'");
  assertEquals(by.EMPTY.value, "");
  assertEquals(by.GREETING.value, "Hello\nWorld");
  assertEquals(by.YAML_STYLE.value, "yes");
  assertEquals(entries.length, 14);
});

Deno.test("parse: multi-line values keep their lines and raw text", () => {
  const { entries } = parseEnv(ENV);
  const key = entries.find((e) => e.key === "PRIVATE_KEY")!;
  assertEquals(key.value, "-----BEGIN KEY-----\nabc\n-----END KEY-----");
  assertEquals([key.line, key.lines], [9, 3]);
  assert(key.raw.startsWith('PRIVATE_KEY="') && key.raw.endsWith('END KEY-----"'));
  const tpl = entries.find((e) => e.key === "TEMPLATE")!;
  assertEquals(tpl.value, "line one\nline two");
  assertEquals(entries.find((e) => e.key === "LITERAL")!.line, 12, "lines after a multi-line value are counted");
});

Deno.test("parse: references, not in single quotes, not escaped", () => {
  const by = Object.fromEntries(parseEnv(ENV).entries.map((e) => [e.key, e]));
  assertEquals(by.DATABASE_URL.refs, ["DB_USER", "DB_PASS", "DB_HOST", "DB_PORT"]);
  assertEquals(by.LITERAL.refs, []);
  assertEquals(by.PRICE.refs, []);
  assertEquals(references("${A:-x} $B ${A}"), ["A", "B"]);
});

Deno.test("expand: from the file, defaults, unknown kept", () => {
  const values = expand(parseEnv(ENV).entries);
  assertEquals(values.get("DATABASE_URL")!.value, "postgres://app:p@ss # not a comment@localhost:5432/app");
  assertEquals(values.get("FALLBACK")!.value, "none");
  assertEquals(values.get("UNKNOWN"), { value: "${NOWHERE}/x", unresolved: ["NOWHERE"] });
  assertEquals(values.get("LITERAL")!.value, "${NOT_EXPANDED}");
  assertEquals(values.get("PRICE")!.value, "$5");
});

Deno.test("expand: cycles don't loop", () => {
  const values = expand(parseEnv("A=${B}\nB=${A}\nC=${C}").entries);
  assertEquals(values.get("C")!.unresolved, ["C"]);
  assert(values.get("A")!.value.includes("${"));
});

Deno.test("parse: problems are reported with their line", () => {
  const { entries, issues } = parseEnv(
    'GOOD=1\nthis is not valid\nAFTER=2\nGOOD=3\nexport PATH\nBAD="x" trailing\nOPEN="never closed\nLAST=1\n',
  );
  assertEquals(entries.map((e) => e.key), ["GOOD", "AFTER", "BAD", "OPEN", "LAST"]);
  assertEquals(entries[0].value, "3", "the last assignment wins");
  assertEquals(issues.map((i) => i.line), [2, 4, 6, 7]);
  assert(issues[3].message.includes("never closed"));
});

Deno.test("parse: CRLF and a byte order mark", () => {
  const { entries } = parseEnv('﻿A=1\r\nB="two"\r\n');
  assertEquals(entries.map((e) => [e.key, e.value]), [["A", "1"], ["B", "two"]]);
});

Deno.test("example comparison and appending missing keys", () => {
  const example =
    parseEnv("# Copy to .env\nDB_HOST=localhost\nAPI_KEY=\nSENTRY_DSN=https://example@sentry.io/1 # optional\n")
      .entries;
  const file = parseEnv("DB_HOST=db\nLOCAL_ONLY=1").entries;
  assertEquals(missingKeys(file, example), ["API_KEY", "SENTRY_DSN"]);
  assertEquals(extraKeys(file, example), ["LOCAL_ONLY"]);
  const missing = example.filter((e) => missingKeys(file, example).includes(e.key));
  assertEquals(
    appendMissing("DB_HOST=db\nLOCAL_ONLY=1", missing, ".env.example", "2026-10-28"),
    "DB_HOST=db\nLOCAL_ONLY=1\n\n# Added from .env.example on 2026-10-28\nAPI_KEY=\nSENTRY_DSN=https://example@sentry.io/1 # optional\n",
  );
  assertEquals(appendMissing("", missing.slice(0, 1), ".env.sample", "d"), "# Added from .env.sample on d\nAPI_KEY=\n");
  assertEquals(appendMissing("A=1\n", [], ".env.example", "d"), "A=1\n");
  const after = parseEnv(appendMissing("DB_HOST=db\n", missing, ".env.example", "d")).entries;
  assertEquals(missingKeys(after, example), []);
});

Deno.test("export lines and assignments", () => {
  const entries = parseEnv('A=plain\nB="it\'s"\nC="x y"\nD=${A}/bin').entries;
  assertEquals(exportLines(entries), "export A=plain\nexport B='it'\\''s'\nexport C='x y'\nexport D=plain/bin");
  assertEquals(shellQuote("it's"), `'it'\\''s'`);
  assertEquals(assignment("K", "simple"), "K=simple");
  assertEquals(assignment("K", 'a "b"\nc'), 'K="a \\"b\\"\\nc"');
});

Deno.test("masking never shows the value", () => {
  assertEquals(mask(""), "(empty)");
  assertEquals(mask("a"), "••••");
  assertEquals(mask("x".repeat(100)), "••••••••••••");
  assert(!mask("secret123").includes("s"));
});

Deno.test("file names", () => {
  for (const n of [".env", ".env.local", ".env.production.local", ".env.example"]) assert(isEnvFile(n), n);
  for (const n of [".envrc", ".env.vault", "env", ".environment", ".env~", ".env.swp"]) assert(!isEnvFile(n), n);
  assertEquals(exampleOf([".env", ".env.sample", ".env.example"]), ".env.example");
  assertEquals(exampleOf([".env"]), undefined);
  assertEquals([".env.example", ".env.local", ".env"].sort(compareFiles), [".env", ".env.local", ".env.example"]);
  assertEquals(purpose(".env.production.local"), "Production, local overrides");
  assertEquals(purpose(".env.local"), "Local overrides");
  assertEquals(purpose(".env.sample"), "Example");
});

Deno.test("row tags", () => {
  const [e] = parseEnv('export URL="${HOST}:${PORT}/${PATH_}"').entries;
  assertEquals(describe(e), ["export", "uses HOST, PORT…"]);
});

Deno.test("folders preference", () => {
  assertEquals(parseFolders("~/Projects, ~/code/, ~/Projects\n/abs", "/home/me"), [
    "/home/me/Projects",
    "/home/me/code",
    "/abs",
  ]);
  assertEquals(parseFolders("", "/h").length, 10);
  assertEquals(tilde("/home/me/Projects/app", "/home/me"), "~/Projects/app");
});

Deno.test("scan: finds env files, skips node_modules, respects depth, pairs examples", async () => {
  const root = await Deno.makeTempDir();
  try {
    await Deno.mkdir(`${root}/app/node_modules/pkg`, { recursive: true });
    await Deno.mkdir(`${root}/deep/a/b/c`, { recursive: true });
    await Deno.writeTextFile(`${root}/app/.env`, "A=1\n");
    await Deno.writeTextFile(`${root}/app/.env.example`, "A=\nB=\n");
    await Deno.writeTextFile(`${root}/app/.envrc`, "use nix\n");
    await Deno.writeTextFile(`${root}/app/node_modules/pkg/.env`, "X=1\n");
    await Deno.writeTextFile(`${root}/deep/a/b/c/.env`, "Y=1\n");
    const r = await scan([root, `${root}/missing`], 2);
    assertEquals(r.denied, []);
    assertEquals(r.folders.length, 1);
    const [app] = r.folders;
    assertEquals(app.files.map((f) => f.name), [".env", ".env.example"]);
    assertEquals(app.example?.name, ".env.example");
    assertEquals(missingKeys(app.files[0].parsed.entries, app.example!.parsed.entries), ["B"]);
    assertEquals((await scan([root], 4)).folders.length, 2);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("the folders preference stays inside the read permission", async () => {
  const { parse } = await import("@std/toml");
  const manifest = parse(await Deno.readTextFile(new URL("./backslash.toml", import.meta.url))) as {
    permissions: { read: string[]; write: string[] };
    preferences: { name: string; default?: string }[];
  };
  const readable = new Set(manifest.permissions.read);
  const defaults = manifest.preferences.find((p) => p.name === "folders")!.default!;
  for (const f of defaults.split(",").map((s) => s.trim())) assert(readable.has(f), `${f} is not readable`);
  assertEquals(manifest.permissions.write, manifest.permissions.read);
});
