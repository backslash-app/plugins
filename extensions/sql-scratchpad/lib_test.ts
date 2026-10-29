import { assertEquals, assertThrows } from "@std/assert";
import {
  cleanError,
  connectionUrl,
  dangerous,
  describe,
  fileNameFor,
  formatQueryFile,
  invocation,
  MARKER,
  oneLine,
  parseConnections,
  parseCsv,
  parseMysql,
  parseOutput,
  parsePsql,
  parseQueryFile,
  parseUrl,
  previewQuery,
  splitStatements,
  statementWrites,
  toCsv,
  toJson,
  toMarkdown,
  writes,
} from "./lib.ts";

const HOME = "/home/me";

Deno.test("connection URLs", () => {
  assertEquals(parseUrl("postgresql://app:p%40ss@db.example.com:6543/shop?sslmode=require", HOME, "prod"), {
    name: "prod",
    kind: "postgres",
    host: "db.example.com",
    port: 6543,
    user: "app",
    password: "p@ss",
    database: "shop",
    params: [["sslmode", "require"]],
  });
  assertEquals(parseUrl("mysql://root@localhost/dev", HOME).name, "dev");
  assertEquals(parseUrl("mariadb://u@[::1]:3307/x", HOME).host, "::1");
  assertEquals(parseUrl("sqlite:///var/lib/app.db", HOME).path, "/var/lib/app.db");
  assertEquals(parseUrl("sqlite://~/notes.sqlite3", HOME), {
    name: "notes",
    kind: "sqlite",
    path: "/home/me/notes.sqlite3",
    params: [],
  });
  assertEquals(parseUrl("~/x.db", HOME).path, "/home/me/x.db");
  assertThrows(() => parseUrl("redis://localhost", HOME), Error, "is not a postgresql://");
  assertThrows(() => parseUrl("sqlite:relative.db", HOME), Error, "absolute path");
});

Deno.test("the connections preference", () => {
  const { connections, errors } = parseConnections(
    "prod = postgres://a:b;c@h/db; local=mysql://root@localhost/app\nnotes=sqlite:///n.db;postgresql://u@h2/analytics; bad=ftp://x",
    HOME,
  );
  // `;` inside a password must be escaped: `b;c` splits, so "c@h/db" is reported.
  assertEquals(connections.map((c) => c.name), ["local", "notes", "analytics"]);
  assertEquals(errors.length, 3);
  const escaped = parseConnections("prod=postgres://a:b\\;c@h/db", HOME).connections[0];
  assertEquals(escaped.password, "b;c");
  assertEquals(connectionUrl(escaped), "postgresql://a:****@h/db");
  assertEquals(connectionUrl(escaped, true), "postgresql://a:b%3Bc@h/db");
  assertEquals(describe(escaped), "a@h/db");
  assertEquals(describe(parseUrl("sqlite:///home/me/a.db", HOME), HOME), "~/a.db");
  // Same names get a number.
  assertEquals(parseConnections("x=sqlite:///a.db; x=sqlite:///b.db", HOME).connections.map((c) => c.name), [
    "x",
    "x (2)",
  ]);
});

Deno.test("splitting statements", () => {
  assertEquals(
    splitStatements("select 'a;b'; -- c;\nselect \"x;y\" /* ; */ from t;\n\n;select $$ ; $$, $f$;$f$"),
    ["select 'a;b'", '-- c;\nselect "x;y" /* ; */ from t', "select $$ ; $$, $f$;$f$"],
  );
  assertEquals(splitStatements("select 'it''s; ok'; select 2"), ["select 'it''s; ok'", "select 2"]);
  assertEquals(splitStatements("select 'a\\';b'; select 2", "mysql"), ["select 'a\\';b'", "select 2"]);
  assertEquals(splitStatements("select 1 # x;\n; select `a;b`", "mysql"), ["select 1 # x;", "select `a;b`"]);
  assertEquals(
    splitStatements(
      "CREATE TRIGGER t AFTER INSERT ON a BEGIN UPDATE b SET n = n + 1; DELETE FROM c; END; SELECT 1",
      "sqlite",
    ),
    ["CREATE TRIGGER t AFTER INSERT ON a BEGIN UPDATE b SET n = n + 1; DELETE FROM c; END", "SELECT 1"],
  );
  assertEquals(splitStatements("-- only a comment\n"), []);
});

Deno.test("which statements change data", () => {
  const ro = [
    "SELECT * FROM users WHERE note = 'delete me'",
    "  -- update this later\nselect 1",
    "WITH x AS (SELECT 1) SELECT * FROM x",
    "(SELECT 1) UNION (SELECT 2)",
    "EXPLAIN SELECT * FROM t",
    "SHOW TABLES",
    "DESCRIBE users",
    "VALUES (1), (2)",
    "PRAGMA table_info(users)",
    "SELECT last_update FROM t",
    "SET search_path TO app",
    "SELECT * INTO @x FROM t",
  ];
  for (const s of ro) assertEquals(statementWrites(s), undefined, s);
  assertEquals(statementWrites("SELECT * INTO @x FROM t", "mysql"), undefined);
  assertEquals(statementWrites("insert into t values (1)"), "INSERT");
  assertEquals(statementWrites("WITH d AS (DELETE FROM t RETURNING *) SELECT * FROM d"), "DELETE");
  assertEquals(statementWrites("EXPLAIN ANALYZE UPDATE t SET a = 1"), "UPDATE");
  assertEquals(statementWrites("EXPLAIN ANALYZE SELECT 1"), undefined);
  assertEquals(statementWrites("SELECT * FROM t FOR UPDATE"), "SELECT … FOR UPDATE");
  assertEquals(statementWrites("SELECT * INTO backup FROM t"), "SELECT INTO");
  assertEquals(statementWrites("drop table t"), "DROP");
  assertEquals(statementWrites("PRAGMA journal_mode = WAL", "sqlite"), "PRAGMA");
  assertEquals(statementWrites("SET default_transaction_read_only = off"), "SET");
  assertEquals(statementWrites("VACUUM"), "VACUUM");
  assertEquals(writes("select 1; update t set a = 1; delete from t where id = 2; update t set b = 2"), [
    "UPDATE",
    "DELETE",
  ]);
  assertEquals(writes("select 1; select 2"), []);
  assertEquals(dangerous("delete from t; update t set a = 1 where id = 1; drop table x"), [
    "DELETE without WHERE changes every row",
    "DROP cannot be undone",
  ]);
});

Deno.test("psql invocation: password in the environment, earlier output discarded, read-only session", () => {
  const c = parseUrl("postgresql://app:secret@db:5432/shop?sslmode=require", HOME);
  const inv = invocation(c, "set search_path to app; select * from users", true);
  assertEquals(inv.program, "psql");
  assertEquals(inv.args, [
    "--no-psqlrc",
    "--csv",
    "--set=ON_ERROR_STOP=1",
    "--dbname",
    "postgresql://app@db:5432/shop?sslmode=require",
    "--file=-",
  ]);
  assertEquals(inv.env.PGPASSWORD, "secret");
  assertEquals(
    inv.stdin,
    "\\o /dev/null\nSET default_transaction_read_only = on;\nset search_path to app;\n\\o\nselect * from users;\n",
  );
  assertEquals(
    invocation(c, "delete from t where id = 1", false).stdin,
    "\\o /dev/null\n\\o\ndelete from t where id = 1;\n",
  );
  assertThrows(() => invocation(c, "-- nothing", true), Error, "empty");
});

Deno.test("mysql and sqlite invocations", () => {
  const m = parseUrl("mysql://root:pw@127.0.0.1:3307/app?ssl-mode=required", HOME);
  const inv = invocation(m, "update t set a = 1 where id = 2", true);
  assertEquals(inv.args, [
    "--batch",
    "--default-character-set=utf8mb4",
    "--connect-timeout=10",
    "--host",
    "127.0.0.1",
    "--port",
    "3307",
    "--user",
    "root",
    "--ssl-mode=REQUIRED",
    "app",
  ]);
  assertEquals(inv.env, { MYSQL_PWD: "pw" });
  assertEquals(
    inv.stdin,
    `SET SESSION TRANSACTION READ ONLY;\nSELECT '${MARKER}' AS ${MARKER};\nupdate t set a = 1 where id = 2;\nSELECT ROW_COUNT() AS rows_affected;\n`,
  );
  const s = parseUrl("sqlite:///data/app.db", HOME);
  const ro = invocation(s, "select 1; select 2", true);
  assertEquals(ro.args, ["-readonly", "-bail", "-csv", "-header", "/data/app.db"]);
  assertEquals(ro.stdin, ".bail on\n.output /dev/null\nselect 1;\n.output\nselect 2;\n");
  const rw = invocation(s, "delete from t", false);
  assertEquals(rw.args[0], "-bail");
  assertEquals(rw.stdin, ".bail on\n.output /dev/null\n.output\ndelete from t;\nSELECT changes() AS rows_affected;\n");
});

Deno.test("parsing client output", () => {
  assertEquals(parseCsv('a,b\n1,"x,""y"""\n2,"multi\nline"\n'), [["a", "b"], ["1", 'x,"y"'], ["2", "multi\nline"]]);
  assertEquals(parseCsv("a\n\n"), [["a"], [""]]);
  assertEquals(parsePsql("id,name\n2,z\nUPDATE 1\n", true), {
    columns: ["id", "name"],
    rows: [["2", "z"]],
    message: "UPDATE 1",
  });
  // A read query keeps a last row that looks like a tag.
  assertEquals(parsePsql("status\nACTIVE\n"), { columns: ["status"], rows: [["ACTIVE"]], message: undefined });
  assertEquals(parseOutput("postgres", "DELETE 3\n", true), { columns: [], rows: [], message: "DELETE 3" });
  assertEquals(
    parseMysql(`${MARKER}\n${MARKER}\nid\tnote\n1\ttab\\there\\nnew\n2\tNULL\n`),
    { columns: ["id", "note"], rows: [["1", "tab\there\nnew"], ["2", "NULL"]] },
  );
  assertEquals(parseMysql(`x\n1\n${MARKER}\n${MARKER}\nrows_affected\n3\n`), {
    columns: [],
    rows: [],
    message: "3 rows affected",
  });
  assertEquals(parseOutput("sqlite", "rows_affected\n1\n", true), { columns: [], rows: [], message: "1 row affected" });
  assertEquals(parseOutput("sqlite", ""), { columns: [], rows: [], message: "Done" });
  assertEquals(
    cleanError('psql:<stdin>:4: ERROR:  syntax error at or near "selec"\n', "psql"),
    'syntax error at or near "selec"',
  );
  assertEquals(
    cleanError('psql: error: connection to server at "h" (1.2.3.4), port 5432 failed: Connection refused', "psql"),
    'connection to server at "h" (1.2.3.4), port 5432 failed: Connection refused',
  );
  assertEquals(
    cleanError(
      "mysql: [Warning] Using a password on the command line interface can be insecure.\nERROR 1146 (42S02) at line 2: Table 'a.b' doesn't exist",
      "mysql",
    ),
    "Table 'a.b' doesn't exist",
  );
});

Deno.test("exports", () => {
  const r = { columns: ["id", "name", "note"], rows: [["1", "Ada", "a|b"], ["007", "Bob, Jr", ""]] };
  assertEquals(toCsv(r), 'id,name,note\n1,Ada,a|b\n007,"Bob, Jr",\n');
  assertEquals(JSON.parse(toJson(r)), [{ id: 1, name: "Ada", note: "a|b" }, { id: "007", name: "Bob, Jr", note: "" }]);
  assertEquals(toMarkdown(r), "| id | name | note |\n| --- | --- | --- |\n| 1 | Ada | a\\|b |\n| 007 | Bob, Jr |   |");
  assertEquals(toMarkdown({ columns: [], rows: [], message: "DROP TABLE" }), "DROP TABLE");
});

Deno.test("schema helpers", () => {
  assertEquals(previewQuery("postgres", "public", "users"), 'SELECT * FROM "users" LIMIT 100;');
  assertEquals(previewQuery("postgres", "audit", 'we"ird'), 'SELECT * FROM "audit"."we""ird" LIMIT 100;');
  assertEquals(previewQuery("mysql", "shop", "orders", 10), "SELECT * FROM `shop`.`orders` LIMIT 10;");
});

Deno.test("query files", () => {
  const q = parseQueryFile("active-users.sql", "-- name: Active users\n-- connection: prod\n\nSELECT *\nFROM users;\n");
  assertEquals(q, { file: "active-users.sql", name: "Active users", connection: "prod", sql: "SELECT *\nFROM users;" });
  assertEquals(parseQueryFile("top_10-orders.sql", "select 1").name, "top 10 orders");
  assertEquals(formatQueryFile(q), "-- name: Active users\n-- connection: prod\n\nSELECT *\nFROM users;\n");
  assertEquals(parseQueryFile("x.sql", formatQueryFile({ name: "X", sql: "select 2" })).connection, undefined);
  assertEquals(fileNameFor("Élèves (prod) — top 10", []), "eleves-prod-top-10.sql");
  assertEquals(fileNameFor("A", ["a.sql", "a-2.sql"]), "a-3.sql");
  assertEquals(fileNameFor("!!!", []), "query.sql");
  assertEquals(oneLine("-- c\nSELECT  *\n  FROM t"), "SELECT * FROM t");
});
