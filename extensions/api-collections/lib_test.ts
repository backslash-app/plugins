import { assert, assertEquals, assertMatch, assertRejects } from "@std/assert";
import {
  bruDefaults,
  bruEnvironment,
  bruRequest,
  dynamicVariable,
  fileFormat,
  interpolate,
  parseBru,
  parseDotenv,
  parseFolders,
  parseHttpEnvironments,
  parseHttpFile,
  parseHurl,
  prettyBody,
  resolveRequest,
  send,
  shortUrl,
  sortRequests,
  stripJsonComments,
  tilde,
  toCurl,
  validate,
  variablesOf,
} from "./lib.ts";
import { findCollections, loadBruno, loadFile } from "./collections.ts";

const BRU = `meta {
  name: Create user
  type: http
  seq: 2
}

post {
  url: {{baseUrl}}/users/:org
  body: json
  auth: bearer
}

params:path {
  org: acme
}

headers {
  Accept: application/json
  ~X-Debug: 1
}

auth:bearer {
  token: {{token}}
}

body:json {
  {
    "name": "Ada",
    "tags": ["a", "b"]
  }
}

vars:pre-request {
  role: admin
}

script:pre-request {
  bru.setVar("x", 1);
}
`;

Deno.test("bruno: blocks", () => {
  const blocks = parseBru(BRU);
  assertEquals(blocks.map((b) => b.name), [
    "meta",
    "post",
    "params:path",
    "headers",
    "auth:bearer",
    "body:json",
    "vars:pre-request",
    "script:pre-request",
  ]);
  // Disabled entries are left out.
  assertEquals(blocks[3].dict, [["Accept", "application/json"]]);
  assertEquals(blocks[5].text, '{\n  "name": "Ada",\n  "tags": ["a", "b"]\n}');
});

Deno.test("bruno: a request with path params, auth, json body and vars", () => {
  const r = bruRequest(BRU, "create-user.bru")!;
  assertEquals(r.name, "Create user");
  assertEquals(r.method, "POST");
  assertEquals(r.url, "{{baseUrl}}/users/acme");
  assertEquals(r.seq, 2);
  assertEquals(r.headers, [
    ["Accept", "application/json"],
    ["Authorization", "Bearer {{token}}"],
    ["Content-Type", "application/json"],
  ]);
  assertEquals(JSON.parse(r.body!), { name: "Ada", tags: ["a", "b"] });
  assertEquals(r.vars, { role: "admin" });
  assertEquals(r.notes, ["Scripts don't run here"]);
});

Deno.test("bruno: inherited auth and headers, form and graphql bodies", () => {
  const defaults = bruDefaults(`headers {
  X-Client: backslash
}

auth {
  mode: apikey
}

auth:apikey {
  key: api_key
  value: {{key}}
  placement: queryparams
}

vars:pre-request {
  version: v2
}
`);
  assertEquals(defaults.vars, { version: "v2" });
  const form = bruRequest(
    `get {\n  url: https://x.test/a?b=1\n  body: formUrlEncoded\n  auth: inherit\n}\n\nbody:form-urlencoded {\n  name: Ada Lovelace\n  ~skip: 1\n}\n`,
    "form.bru",
    defaults,
  )!;
  assertEquals(form.name, "form");
  assertEquals(form.url, "https://x.test/a?b=1&api_key={{key}}");
  assertEquals(form.body, "name=Ada%20Lovelace");
  assertEquals(form.headers, [["X-Client", "backslash"], ["Content-Type", "application/x-www-form-urlencoded"]]);

  const gql = bruRequest(
    `post {\n  url: https://x.test/graphql\n  body: graphql\n  auth: basic\n}\n\nauth:basic {\n  username: ada\n  password: {{pw}}\n}\n\nbody:graphql {\n  query { me { id } }\n}\n\nbody:graphql:vars {\n  {"a": 1}\n}\n`,
    "gql.bru",
  )!;
  assertEquals(JSON.parse(gql.body!), { query: "query { me { id } }", variables: { a: 1 } });
  const resolved = resolveRequest(gql, { pw: "s3cret" }).request;
  assertEquals(resolved.headers[0], ["Authorization", `Basic ${btoa("ada:s3cret")}`]);
});

Deno.test("bruno: environments and non-request files", () => {
  assertEquals(
    bruEnvironment(`vars {\n  baseUrl: http://localhost:3000\n  ~old: x\n}\nvars:secret [\n  token,\n  password\n]\n`),
    { vars: { baseUrl: "http://localhost:3000" }, secrets: ["token", "password"] },
  );
  assertEquals(bruRequest(`vars {\n  a: 1\n}\n`, "Local.bru"), undefined);
});

const HTTP = `@host = https://api.example.com
@token = abc123

### List users
GET {{host}}/users
    ?page=2
    &limit=10
Accept: application/json

###
# @name createUser
POST {{host}}/users HTTP/1.1
Content-Type: application/json
Authorization: Bearer {{token}}

{
  "name": "{{$guid}}"
}

> {% client.global.set("id", response.body.id); %}

### Upload
PUT {{host}}/files/1
Content-Type: application/json

< ./payload.json

### just a comment block
# nothing here

### Plain URL
https://example.org/health
`;

Deno.test("http files: variables, separators, names, bodies and handlers", () => {
  const { vars, requests } = parseHttpFile(HTTP);
  assertEquals(vars, { host: "https://api.example.com", token: "abc123" });
  assertEquals(requests.map((r) => r.name), ["List users", "createUser", "Upload", "Plain URL"]);
  assertEquals(requests[0].url, "{{host}}/users?page=2&limit=10");
  assertEquals(requests[0].headers, [["Accept", "application/json"]]);
  assertEquals(requests[0].body, undefined);
  assertEquals(requests[1].method, "POST");
  assertEquals(requests[1].body, '{\n  "name": "{{$guid}}"\n}');
  assertEquals(requests[1].notes, ["Response handler scripts don't run here"]);
  assertEquals(requests[1].line, 12);
  assertEquals(requests[2].bodyFile, "./payload.json");
  assertEquals(requests[3].method, "GET");
});

Deno.test("http files: environments and JSONC", () => {
  assertEquals(stripJsonComments('{"a": "http://x", // c\n /* b */ "b": [1,],}'), '{"a": "http://x", \n  "b": [1]}');
  const envs = parseHttpEnvironments(
    '{"dev": {"host": "http://localhost:8080", "port": 8080, "nested": {}}, "prod": {"host": "https://x"}}',
    '{"dev": {"token": "secret"}}',
    "not json",
  );
  assertEquals(envs, {
    dev: { host: "http://localhost:8080", port: "8080", token: "secret" },
    prod: { host: "https://x" },
  });
});

const HURL = `# Get the home page
GET https://example.org
User-Agent: hurl
[Query]
q: hello world
HTTP 200
[Asserts]
xpath "string(//title)" == "Example"

# Log in
POST https://example.org/login
[FormParams]
user: ada
password: "p@ss"
HTTP 302

POST https://example.org/api/items
[BasicAuth]
ada: secret
{
  "name": "box",
  "nested": {"a": [1, 2]}
}
HTTP 201
[Captures]
id: jsonpath "$.id"

GET https://example.org/api/items/{{id}}
Cookie: a=1
[Cookies]
b: 2
`;

Deno.test("hurl: requests, sections, bodies and skipped responses", () => {
  const rs = parseHurl(HURL);
  assertEquals(rs.map((r) => `${r.method} ${r.url}`), [
    "GET https://example.org?q=hello%20world",
    "POST https://example.org/login",
    "POST https://example.org/api/items",
    "GET https://example.org/api/items/{{id}}",
  ]);
  assertEquals(rs[0].name, "Get the home page");
  assertEquals(rs[0].headers, [["User-Agent", "hurl"]]);
  assertEquals(rs[1].name, "Log in");
  assertEquals(rs[1].body, "user=ada&password=p%40ss");
  assertEquals(rs[2].name, "POST /api/items");
  assertEquals(JSON.parse(rs[2].body!), { name: "box", nested: { a: [1, 2] } });
  assertEquals(rs[2].headers.map(([k]) => k), ["Authorization", "Content-Type"]);
  assertEquals(rs[3].headers, [["Cookie", "a=1; b=2"]]);
  assertEquals(rs[3].line, 28);
  assertEquals(variablesOf(rs[3]), ["id"]);
});

Deno.test("variables: nested, built-in, dotenv and missing", () => {
  const now = Date.parse("2026-10-28T12:00:00Z");
  const r = interpolate(
    "{{ base }}/x?t={{$timestamp}}&k={{process.env.KEY}}&d={{$dotenv KEY}}&m={{nope}}",
    { base: "{{host}}/v1", host: "https://h.test", "process.env.KEY": "42" },
    now,
  );
  assertEquals(r.text, "https://h.test/v1/x?t=1793188800&k=42&d=42&m={{nope}}");
  assertEquals(r.missing, ["nope"]);
  assertMatch(dynamicVariable("$random.uuid")!, /^[0-9a-f-]{36}$/);
  const n = Number(dynamicVariable("$randomInt 5 10"));
  assert(n >= 5 && n < 10);
  // A variable referring to itself doesn't loop forever.
  assertEquals(interpolate("{{a}}", { a: "{{a}}" }).missing, ["a"]);
  assertEquals(parseDotenv('# c\nexport KEY="v 1"\nB=2 # note\nbad line'), {
    "process.env.KEY": "v 1",
    "process.env.B": "2",
  });
});

Deno.test("resolve: request vars win, missing ones are listed", () => {
  const def = {
    name: "x",
    method: "GET",
    url: "{{host}}/{{role}}",
    headers: [["Authorization", "Bearer {{token}}"]] as [string, string][],
    vars: { role: "admin" },
    seq: 1,
  };
  const { request, missing } = resolveRequest(def, { host: "https://a.test", role: "user" });
  assertEquals(request.url, "https://a.test/admin");
  assertEquals(missing, ["token"]);
});

Deno.test("curl, validation and display", () => {
  assertEquals(
    toCurl({
      method: "POST",
      url: "https://a.test/x",
      headers: [["Content-Type", "application/json"]],
      body: `{"a":"it's"}`,
    }),
    `curl https://a.test/x -H 'Content-Type: application/json' --data-raw '{"a":"it'\\''s"}'`,
  );
  assertEquals(
    toCurl({ method: "DELETE", url: "https://a.test/x/1", headers: [] }),
    "curl -X DELETE https://a.test/x/1",
  );
  let error = "";
  try {
    validate({ method: "GET", url: "{{host}}/x", headers: [] });
  } catch (e) {
    error = (e as Error).message;
  }
  assertEquals(error, "“{{host}}/x” is not a valid URL");
  assertEquals(shortUrl("https://api.test/v1/items?a=1"), "api.test/v1/items?a=1");
  assertEquals(shortUrl("{{host}}/v1"), "{{host}}/v1");
  assertEquals(prettyBody("application/json", '{"a":1}'), { lang: "json", text: '{\n  "a": 1\n}' });
  assertEquals(fileFormat("a.rest"), "http");
  assertEquals(fileFormat("a.hurl"), "hurl");
  assertEquals(fileFormat("a.json"), undefined);
  assertEquals(parseFolders("~/code, /srv/x/, relative", "/home/me"), ["/home/me/code", "/srv/x"]);
  assertEquals(tilde("/home/me/code/a", "/home/me"), "~/code/a");
});

Deno.test("sorting: by folder, then seq", () => {
  const e = (file: string, seq: number, name = file) => ({
    file,
    def: { name, method: "GET", url: "", headers: [], seq },
  });
  assertEquals(
    sortRequests([e("/c/b.bru", 1), e("/c/a.bru", 2), e("/c/sub/z.bru", 1), e("/c/c.bru", 0)]).map((x) => x.file),
    ["/c/b.bru", "/c/a.bru", "/c/c.bru", "/c/sub/z.bru"],
  );
});

Deno.test("send: status, timing, headers and text body", async () => {
  let t = 0;
  const fetchFn = ((_url: string, init: RequestInit) => {
    assertEquals(init.method, "GET");
    assertEquals(init.body, undefined);
    return Promise.resolve(
      new Response('{"ok":true}', {
        status: 201,
        statusText: "Created",
        headers: { "content-type": "application/json" },
      }),
    );
  }) as unknown as typeof fetch;
  const res = await send({ method: "GET", url: "https://a.test", headers: [], body: "ignored" }, {
    fetchFn,
    now: () => (t += 40),
  });
  assertEquals(res.status, 201);
  assertEquals(res.ms, 40);
  assertEquals(res.text, '{"ok":true}');
  assertEquals(res.size, 11);
  await assertRejects(() => send({ method: "GET", url: "ftp://x", headers: [] }, { fetchFn }));
});

Deno.test("files: a Bruno collection and request files are found and loaded", async () => {
  const root = await Deno.makeTempDir();
  try {
    const col = `${root}/app/api`;
    await Deno.mkdir(`${col}/environments`, { recursive: true });
    await Deno.mkdir(`${col}/users`, { recursive: true });
    await Deno.mkdir(`${root}/app/node_modules/x`, { recursive: true });
    await Deno.writeTextFile(`${col}/bruno.json`, '{"version": "1", "name": "Shop API", "type": "collection"}');
    await Deno.writeTextFile(`${col}/collection.bru`, "headers {\n  X-App: shop\n}\n");
    await Deno.writeTextFile(`${col}/users/folder.bru`, "headers {\n  X-Folder: users\n}\n");
    await Deno.writeTextFile(`${col}/environments/Local.bru`, "vars {\n  baseUrl: http://localhost:3000\n}\n");
    await Deno.writeTextFile(`${col}/.env`, "API_KEY=k\n");
    await Deno.writeTextFile(
      `${col}/users/list.bru`,
      "meta {\n  name: List users\n  seq: 1\n}\n\nget {\n  url: {{baseUrl}}/users\n}\n",
    );
    await Deno.writeTextFile(`${col}/health.bru`, "get {\n  url: {{baseUrl}}/health\n}\n");
    await Deno.writeTextFile(
      `${root}/app/requests.http`,
      "### Ping\nGET {{host}}/ping\n\n### Body\nPOST {{host}}/x\n\n< ./body.json\n",
    );
    await Deno.writeTextFile(`${root}/app/body.json`, '{"a": 1}');
    await Deno.writeTextFile(`${root}/app/http-client.env.json`, '{"dev": {"host": "http://localhost:8000"}}');
    await Deno.writeTextFile(`${root}/app/node_modules/x/ignored.http`, "GET https://x.test\n");
    await Deno.writeTextFile(`${root}/smoke.hurl`, "GET https://example.org\nHTTP 200\n");

    const found = await findCollections([root, `${root}/missing`], 4);
    assertEquals(found.bruno, [col]);
    assertEquals(found.files, [`${root}/app/requests.http`, `${root}/smoke.hurl`]);

    const bruno = await loadBruno(col);
    assertEquals(bruno.name, "Shop API");
    assertEquals(bruno.environments, { Local: { baseUrl: "http://localhost:3000" } });
    assertEquals(bruno.vars, { "process.env.API_KEY": "k" });
    assertEquals(bruno.requests.map((r) => r.def.name), ["health", "List users"]);
    assertEquals(bruno.requests[1].def.headers, [["X-App", "shop"], ["X-Folder", "users"]]);

    const http = await loadFile(`${root}/app/requests.http`);
    assertEquals(http.environments, { dev: { host: "http://localhost:8000" } });
    assertEquals(http.requests[1].def.body, '{"a": 1}');
    const hurl = await loadFile(`${root}/smoke.hurl`);
    assertEquals(hurl.requests.length, 1);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
