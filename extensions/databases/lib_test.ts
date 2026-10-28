import { assertEquals, assertThrows } from "@std/assert";
import {
  clientCommand,
  type Connection,
  connectionUrl,
  describe,
  installCommand,
  interpretStatus,
  matchPgpass,
  myCnfConnections,
  osFamily,
  parseMyCnf,
  parsePasswords,
  parsePgpass,
  parsePgService,
  pgpassConnections,
  savedConnections,
  serviceConnections,
  sortConnections,
  statusCommand,
  toSaved,
  upsertSaved,
} from "./lib.ts";
import { holdOpen, shellLine, terminalArgs } from "./terminal.ts";

const PGPASS = [
  "# host:port:database:username:password",
  "db.prod.acme.io:5432:shop:app:s3cr\\:et",
  "localhost:5433:*:postgres:local",
  "*:*:*:readonly:ro-pass",
  "db.prod.acme.io:5432:shop:app:duplicate",
  "broken line",
  "",
].join("\n");

Deno.test("pgpass: escapes, wildcards and comments", () => {
  const entries = parsePgpass(PGPASS);
  assertEquals(entries.length, 4);
  assertEquals(entries[0], {
    host: "db.prod.acme.io",
    port: "5432",
    database: "shop",
    user: "app",
    password: "s3cr:et",
  });
  assertEquals(entries[2].host, "*");
});

Deno.test("pgpass: connections skip wildcard hosts and duplicates", () => {
  const conns = pgpassConnections(parsePgpass(PGPASS));
  assertEquals(conns.map((c) => c.name), ["shop on db.prod.acme.io", "any database on localhost"]);
  assertEquals(conns[1].port, 5433);
  assertEquals(conns[1].database, undefined);
  assertEquals(conns[1].user, "postgres");
});

Deno.test("pgpass: matching follows libpq (first match, wildcards, db defaults to user)", () => {
  const entries = parsePgpass(PGPASS);
  assertEquals(
    matchPgpass(entries, { host: "db.prod.acme.io", port: 5432, database: "shop", user: "app" })?.password,
    "s3cr:et",
  );
  assertEquals(matchPgpass(entries, { host: "localhost", port: 5433, user: "postgres" })?.password, "local");
  assertEquals(matchPgpass(entries, { host: "other", database: "x", user: "readonly" })?.password, "ro-pass");
  assertEquals(matchPgpass(entries, { host: "other", database: "x", user: "nobody" }), undefined);
});

Deno.test("pg_service.conf", () => {
  const services = parsePgService(`
# comment
[prod]
host=db.prod.acme.io
port=6432
dbname=shop
user=app
password=hunter2

[local]
dbname = scratch
`);
  assertEquals(services[0], {
    name: "prod",
    host: "db.prod.acme.io",
    port: 6432,
    database: "shop",
    user: "app",
    password: "hunter2",
  });
  const conns = serviceConnections(services);
  assertEquals(conns[1].id, "service:local");
  assertEquals(clientCommand(conns[0], "psql").argv, ["psql", "service=prod"]);
  assertEquals(connectionUrl(conns[0]), "postgresql://?service=prod");
  assertEquals(statusCommand(conns[0]), ["pg_isready", "-t", "3", "-d", "service=prod"]);
});

Deno.test("my.cnf: [client] and suffixed groups", () => {
  const groups = parseMyCnf(`
[mysqld]
datadir=/var/lib/mysql

[client]
user=steven
password="p@ss word"

[mysql]
database=blog

[client_prod]
host=mysql.acme.io
port=3307
user=deploy

!includedir /etc/mysql/conf.d/
`);
  assertEquals(groups, [
    {
      suffix: "",
      host: undefined,
      port: undefined,
      database: "blog",
      user: "steven",
      password: "p@ss word",
      socket: undefined,
    },
    {
      suffix: "_prod",
      host: "mysql.acme.io",
      port: 3307,
      database: undefined,
      user: "deploy",
      password: undefined,
      socket: undefined,
    },
  ]);
  const conns = myCnfConnections(groups);
  assertEquals(conns.map((c) => c.name), ["steven@localhost", "prod"]);
  // The client reads the group itself.
  assertEquals(clientCommand(conns[1], "mysql").argv, ["mysql", "--defaults-group-suffix=_prod"]);
  assertEquals(clientCommand(conns[0], "mariadb").argv, ["mariadb"]);
  assertEquals(statusCommand(conns[1]), [
    "mysqladmin",
    "--defaults-group-suffix=_prod",
    "--connect-timeout=3",
    "-h",
    "mysql.acme.io",
    "-P",
    "3307",
    "ping",
  ]);
});

Deno.test("passwords preference", () => {
  const p = parsePasswords("prod-db=s3cret;cache=a\\;b\nlocal = x=y");
  assertEquals(p.get("prod-db"), "s3cret");
  assertEquals(p.get("cache"), "a;b");
  assertEquals(p.get("local"), " x=y");
  assertEquals(parsePasswords(undefined).size, 0);
});

Deno.test("form values become saved connections", () => {
  assertEquals(
    toSaved({ name: " prod ", type: "postgres", host: "", port: "", database: "shop", user: "app" }, "/home/u"),
    {
      name: "prod",
      type: "postgres",
      host: "localhost",
      port: 5432,
      database: "shop",
      user: "app",
    },
  );
  assertEquals(toSaved({ name: "notes", type: "sqlite", database: "~/data/notes.db" }, "/home/u"), {
    name: "notes",
    type: "sqlite",
    path: "/home/u/data/notes.db",
  });
  assertEquals(toSaved({ name: "cache", type: "redis", port: "6380" }, "/h").port, 6380);
  assertThrows(() => toSaved({ name: "", type: "redis" }, "/h"), Error, "name");
  assertThrows(() => toSaved({ name: "x", type: "mysql", port: "99999" }, "/h"), Error, "Port");
  assertThrows(() => toSaved({ name: "x", type: "sqlite", database: "rel.db" }, "/h"), Error, "absolute");
});

Deno.test("saved connections: upsert, rename, duplicates", () => {
  const a = { name: "a", type: "redis" as const };
  const b = { name: "b", type: "redis" as const };
  assertEquals(upsertSaved([b], a).map((s) => s.name), ["a", "b"]);
  assertEquals(upsertSaved([a, b], { ...a, name: "c" }, "a").map((s) => s.name), ["b", "c"]);
  assertThrows(() => upsertSaved([a, b], { ...a, name: "b" }, "a"), Error, "already exists");
  // Garbage in storage is ignored.
  assertEquals(savedConnections([a, { name: 1 }, null, { name: "z", type: "oracle" }]).length, 1);
  assertEquals(savedConnections("nope"), []);
});

const pg: Connection = {
  id: "saved:prod",
  name: "prod",
  type: "postgres",
  source: "saved",
  host: "db.acme.io",
  port: 5432,
  database: "shop",
  user: "app",
};

Deno.test("URLs mask the password unless revealed", () => {
  assertEquals(connectionUrl(pg), "postgresql://app@db.acme.io:5432/shop");
  assertEquals(connectionUrl(pg, "p@ss"), "postgresql://app:****@db.acme.io:5432/shop");
  assertEquals(connectionUrl(pg, "p@ss", true), "postgresql://app:p%40ss@db.acme.io:5432/shop");
  const redis: Connection = {
    id: "r",
    name: "r",
    type: "redis",
    source: "saved",
    host: "::1",
    port: 6379,
    database: "2",
  };
  assertEquals(connectionUrl(redis, "pw", true), "redis://:pw@[::1]:6379/2");
  const lite: Connection = { id: "s", name: "s", type: "sqlite", source: "saved", path: "/home/u/app.db" };
  assertEquals(connectionUrl(lite), "sqlite:///home/u/app.db");
  assertEquals(describe(lite, "/home/u"), "~/app.db");
  assertEquals(describe(pg), "app@db.acme.io/shop");
});

Deno.test("client commands keep passwords in the environment", () => {
  assertEquals(clientCommand(pg, "psql", "pw"), {
    argv: ["psql", "-h", "db.acme.io", "-p", "5432", "-U", "app", "-d", "shop"],
    env: { PGPASSWORD: "pw" },
  });
  const my: Connection = { ...pg, type: "mysql", port: 3306 };
  assertEquals(clientCommand(my, "mycli", "pw"), {
    argv: ["mycli", "-h", "db.acme.io", "-P", "3306", "-u", "app", "shop"],
    env: { MYSQL_PWD: "pw" },
  });
  const redis: Connection = {
    id: "r",
    name: "r",
    type: "redis",
    source: "saved",
    host: "cache",
    port: 6380,
    database: "1",
  };
  assertEquals(clientCommand(redis, "redis-cli", "pw"), {
    argv: ["redis-cli", "-h", "cache", "-p", "6380", "-n", "1"],
    env: { REDISCLI_AUTH: "pw" },
  });
  assertEquals(clientCommand({ ...pg, type: "sqlite", path: "/x.db" }, "sqlite3").argv, ["sqlite3", "/x.db"]);
});

Deno.test("status: pg_isready exit codes", () => {
  const err = (code: number, msg = "") => new Error(`pg_isready exited with ${code}: ${msg}`);
  assertEquals(interpretStatus("postgres", "db:5432 - accepting connections").health, "up");
  assertEquals(interpretStatus("postgres", undefined, err(1, "rejecting")).health, "rejecting");
  assertEquals(interpretStatus("postgres", undefined, err(2, "db:5432 - no response")), {
    health: "down",
    text: "No response",
  });
  assertEquals(interpretStatus("postgres", undefined, err(3)).health, "unknown");
});

Deno.test("status: redis, mysql and sqlite", () => {
  assertEquals(interpretStatus("redis", "PONG").health, "up");
  assertEquals(interpretStatus("redis", "NOAUTH Authentication required.").health, "auth");
  assertEquals(
    interpretStatus(
      "redis",
      undefined,
      new Error("redis-cli exited with 1: Could not connect to Redis at x:6379: Connection refused"),
    ).health,
    "down",
  );
  assertEquals(interpretStatus("mysql", "mysqld is alive").health, "up");
  assertEquals(
    interpretStatus("mysql", undefined, new Error("mysqladmin exited with 1: error: 'Access denied for user 'x'@'y''"))
      .health,
    "auth",
  );
  assertEquals(
    interpretStatus("mysql", undefined, new Error("mysqladmin exited with 1: Can't connect to server on 'x' (115)"))
      .health,
    "down",
  );
  assertEquals(interpretStatus("sqlite", "12"), { health: "up", text: "12 tables" });
  assertEquals(
    interpretStatus("sqlite", undefined, new Error('sqlite3 exited with 1: Error: unable to open database "/x.db"'))
      .text,
    "File not found",
  );
});

Deno.test("sorting puts saved connections first", () => {
  const conns = sortConnections([
    { ...pg, id: "p", source: "pgpass", name: "a" },
    { ...pg, id: "s", source: "saved", name: "z" },
    { ...pg, id: "v", source: "service", name: "m" },
  ]);
  assertEquals(conns.map((c) => c.id), ["s", "v", "p"]);
});

Deno.test("install commands per distribution", () => {
  assertEquals(osFamily("ID=ubuntu\nID_LIKE=debian\n"), "debian");
  assertEquals(osFamily('ID="fedora"\n'), "fedora");
  assertEquals(installCommand("postgres", "debian"), "sudo apt install postgresql-client");
  assertEquals(installCommand("mysql", "arch"), "sudo pacman -S mariadb-clients");
  assertEquals(installCommand("redis", undefined), "sudo apt install redis-tools");
});

Deno.test("terminal helpers", () => {
  assertEquals(terminalArgs("gnome-terminal", ["psql"]), ["--", "psql"]);
  assertEquals(shellLine(["psql", "-d", "my db"]), "psql -d 'my db'");
  assertEquals(holdOpen(["echo", "hi"])[2].startsWith("echo hi; printf"), true);
});
