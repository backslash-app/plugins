import { assert, assertEquals, assertThrows } from "@std/assert";
import {
  atPointer,
  bodyExample,
  curlCommand,
  deref,
  type Docs,
  exampleFor,
  externalRefs,
  fillPath,
  formatExample,
  isSpecFileName,
  looksLikeSpec,
  normalizeUrl,
  operations,
  parseFolders,
  pointerTokens,
  RefError,
  refName,
  refTarget,
  responseExample,
  schemaOutline,
  servers,
  specKind,
  tagOrder,
  typeLabel,
} from "./lib.ts";
import { fileUri, loadSpec, parseText } from "./specs.ts";

const BASE = "file:///home/me/Projects/shop/openapi.yaml";

// A trimmed-down OpenAPI 3.0 spec with the usual shapes.
const SHOP_YAML = `
openapi: 3.0.3
info: { title: Shop, version: "2.1" }
servers:
  - url: https://{region}.shop.example/api/{version}
    variables:
      region: { default: eu, enum: [eu, us] }
      version: { default: v2 }
tags:
  - name: orders
  - name: pets
security:
  - bearer: []
paths:
  /pets/{petId}:
    parameters:
      - $ref: '#/components/parameters/PetId'
      - { name: X-Trace, in: header, schema: { type: string } }
    get:
      tags: [pets]
      summary: Get a pet
      operationId: getPet
      parameters:
        - { name: X-Trace, in: header, required: true, schema: { type: string, example: abc } }
        - { name: fields, in: query, required: true, schema: { type: array, items: { type: string, enum: [name, tag] } } }
      responses:
        "404": { $ref: '#/components/responses/NotFound' }
        "200":
          description: The pet
          content:
            application/xml: { schema: { $ref: '#/components/schemas/Pet' } }
            application/json:
              schema: { $ref: '#/components/schemas/Pet' }
    delete:
      tags: [pets]
      deprecated: true
      security: [{ apiKey: [] }]
      responses: { "204": { description: Deleted } }
  /orders:
    post:
      tags: [orders]
      requestBody:
        $ref: '#/components/requestBodies/Order'
      responses:
        "201":
          description: Created
          content:
            application/json:
              schema: { $ref: '#/components/schemas/Order' }
              examples:
                sample: { $ref: '#/components/examples/OrderSample' }
  /health:
    get:
      responses: { "200": { description: OK } }
components:
  securitySchemes:
    bearer: { type: http, scheme: bearer }
    apiKey: { type: apiKey, in: header, name: X-API-Key }
  parameters:
    PetId: { name: petId, in: path, schema: { type: integer, format: int64, example: 42 } }
  responses:
    NotFound: { description: Not found }
  requestBodies:
    Order:
      required: true
      content:
        application/json:
          schema: { $ref: '#/components/schemas/Order' }
  examples:
    OrderSample: { value: { id: 7, status: placed } }
  schemas:
    Pet:
      type: object
      required: [name]
      properties:
        id: { type: integer, format: int64, readOnly: true }
        name: { type: string, example: Rex }
        tag: { type: string, nullable: true }
        born: { type: string, format: date }
        owner: { $ref: '#/components/schemas/Person' }
    Person:
      type: object
      properties:
        email: { type: string, format: email }
        password: { type: string, format: password, writeOnly: true }
        pets:
          type: array
          items: { $ref: '#/components/schemas/Pet' }
    Order:
      allOf:
        - $ref: '#/components/schemas/Base'
        - type: object
          properties:
            status: { type: string, enum: [placed, shipped] }
            quantity: { type: integer, minimum: 1 }
            pet: { oneOf: [{ $ref: '#/components/schemas/Pet' }, { type: string }] }
    Base:
      type: object
      properties:
        id: { type: integer, readOnly: true }
        createdAt: { type: string, format: date-time }
`;

const shop = () => {
  const doc = parseText(SHOP_YAML, "openapi.yaml") as Record<string, unknown>;
  const docs: Docs = { [BASE]: doc };
  return { doc, docs, ops: operations(doc, BASE, docs) };
};

// ---------------------------------------------------------------------------
// $ref

Deno.test("JSON pointers: escapes, arrays, missing", () => {
  assertEquals(pointerTokens("/paths/~1pets~1{id}/get"), ["paths", "/pets/{id}", "get"]);
  assertEquals(pointerTokens("/a~01"), ["a~1"]);
  assertEquals(pointerTokens(""), []);
  const doc = { a: [{ b: 1 }], "x/y": { "~z": 2 } };
  assertEquals(atPointer(doc, "/a/0/b"), 1);
  assertEquals(atPointer(doc, "/x~1y/~0z"), 2);
  assertEquals(atPointer(doc, ""), doc);
  assertEquals(atPointer(doc, "/a/3/b"), undefined);
});

Deno.test("ref targets: local, relative files, URLs, percent-encoding", () => {
  assertEquals(refTarget("#/components/schemas/Pet", BASE), { doc: BASE, pointer: "/components/schemas/Pet" });
  assertEquals(refTarget("./schemas/pet.yaml#/Pet", BASE), {
    doc: "file:///home/me/Projects/shop/schemas/pet.yaml",
    pointer: "/Pet",
  });
  assertEquals(refTarget("../common.json", BASE).doc, "file:///home/me/Projects/common.json");
  assertEquals(refTarget("#/paths/~1pets%7Bid%7D", BASE).pointer, "/paths/~1pets{id}");
  assertEquals(
    refTarget("defs.json#/A", "https://api.example.com/v1/openapi.json").doc,
    "https://api.example.com/v1/defs.json",
  );
  assertEquals(refName("#/components/schemas/Pet"), "Pet");
  assertEquals(refName("./models/user.yaml"), "user");
  assertEquals(refName("common.yaml#/definitions/Error"), "Error");
});

Deno.test("deref: chains, siblings override, loops and missing targets", () => {
  const doc = {
    a: { $ref: "#/b", description: "from a" },
    b: { $ref: "#/c" },
    c: { type: "string", description: "from c" },
    loop1: { $ref: "#/loop2" },
    loop2: { $ref: "#/loop1" },
  };
  const docs = { [BASE]: doc };
  const r = deref(doc.a, BASE, docs);
  assertEquals(r.value, { type: "string", description: "from a" });
  assertEquals(r.ref, "#/c");
  assertEquals(r.key, `${BASE}#/c`);
  assertThrows(() => deref(doc.loop1, BASE, docs), RefError, "loop");
  assertThrows(() => deref({ $ref: "#/nope" }, BASE, docs), RefError, "nothing at #/nope");
  assertThrows(() => deref({ $ref: "other.yaml#/x" }, BASE, docs), RefError, "not loaded");
  assertEquals(deref(5, BASE, docs).value, 5);
});

Deno.test("deref across documents resolves relative to the document holding the $ref", () => {
  const main = "file:///p/openapi.yaml";
  const models = "file:///p/models/pet.yaml";
  const common = "file:///p/models/common.yaml";
  const docs: Docs = {
    [main]: { s: { $ref: "models/pet.yaml#/Pet" } },
    [models]: { Pet: { properties: { tag: { $ref: "common.yaml#/Tag" } } } },
    [common]: { Tag: { type: "string", example: "cute" } },
  };
  const pet = deref((docs[main] as Record<string, unknown>).s, main, docs);
  assertEquals(pet.base, models);
  assertEquals(exampleFor({ $ref: "models/pet.yaml#/Pet" }, main, docs, { mode: "response" }), { tag: "cute" });
  assertEquals(externalRefs(docs[main], main), [models]);
  assertEquals(externalRefs(docs[models], models), [common]);
  assertEquals(externalRefs({ a: { $ref: "#/x" }, b: [{ $ref: "openapi.yaml#/y" }] }, main), []);
});

// ---------------------------------------------------------------------------
// Example values

Deno.test("examples: formats, readOnly/writeOnly and recursion", () => {
  const { docs } = shop();
  const pet = { $ref: "#/components/schemas/Pet" };
  assertEquals(exampleFor(pet, BASE, docs, { mode: "response" }), {
    id: 0,
    name: "Rex",
    tag: "string",
    born: "2026-01-01",
    owner: { email: "user@example.com", pets: [{}] },
  });
  const req = exampleFor(pet, BASE, docs, { mode: "request" }) as Record<string, unknown>;
  assert(!("id" in req), "readOnly properties are left out of requests");
  assertEquals((req.owner as Record<string, unknown>).password, "********");
});

Deno.test("examples: allOf merges, oneOf picks the first, enum and minimum", () => {
  const { docs } = shop();
  const order = exampleFor({ $ref: "#/components/schemas/Order" }, BASE, docs, { mode: "request" }) as Record<
    string,
    unknown
  >;
  assertEquals(Object.keys(order), ["createdAt", "status", "quantity", "pet"]);
  assertEquals(order.status, "placed");
  assertEquals(order.quantity, 1);
  assertEquals((order.pet as Record<string, unknown>).name, "Rex");
});

Deno.test("examples: OpenAPI 3.1 keywords", () => {
  const docs: Docs = { [BASE]: {} };
  const ex = (schema: unknown) => exampleFor(schema, BASE, docs, { mode: "request" });
  assertEquals(ex({ type: ["null", "integer"], exclusiveMinimum: 5 }), 6);
  assertEquals(ex({ type: "string", examples: ["first", "second"] }), "first");
  assertEquals(ex({ const: "fixed" }), "fixed");
  assertEquals(ex({ type: "array", prefixItems: [{ type: "string" }, { type: "boolean" }] }), ["string", true]);
  assertEquals(ex({ type: "object", additionalProperties: { type: "number", minimum: 2.5 } }), {
    additionalProp1: 2.5,
  });
  assertEquals(ex({ properties: { a: { type: "null" } } }), { a: null });
  assertEquals(ex({ type: "number", multipleOf: 4, minimum: 5 }), 8);
  assertEquals(ex({ enum: [null, "x"] }), "x");
  assertEquals(ex({ type: "string", default: "dflt", example: "ex" }), "ex");
  assertEquals(ex({ type: "string", format: "uuid" }), "3fa85f64-5717-4562-b3fc-2c963f66afa6");
  assertEquals(ex(undefined), undefined);
});

Deno.test("examples: a self-referencing tree stops", () => {
  const docs: Docs = {
    [BASE]: {
      Node: {
        type: "object",
        properties: { name: { type: "string" }, children: { type: "array", items: { $ref: "#/Node" } } },
      },
    },
  };
  assertEquals(exampleFor({ $ref: "#/Node" }, BASE, docs, { mode: "response" }), {
    name: "string",
    children: [{}],
  });
  assert(schemaOutline({ $ref: "#/Node" }, BASE, docs, "response", 4).includes("see above"));
});

Deno.test("examples: deep schemas stop at maxDepth", () => {
  const deep = {
    type: "object",
    properties: { a: { type: "object", properties: { b: { type: "object", properties: { c: { type: "string" } } } } } },
  };
  assertEquals(exampleFor(deep, BASE, { [BASE]: {} }, { mode: "request", maxDepth: 2 }), { a: { b: {} } });
});

// ---------------------------------------------------------------------------
// Operations

Deno.test("operations: order, merged parameters, refs, bodies and responses", () => {
  const { ops, docs } = shop();
  assertEquals(ops.map((o) => o.key), ["GET /pets/{petId}", "DELETE /pets/{petId}", "POST /orders", "GET /health"]);
  const get = ops[0];
  assertEquals(get.parameters.map((p) => `${p.in}:${p.name}:${p.required}`), [
    "path:petId:true",
    "query:fields:true",
    "header:X-Trace:true",
  ]);
  assertEquals(get.responses.map((r) => r.status), ["200", "404"]);
  assertEquals(get.responses[0].contentType, "application/json");
  assertEquals(get.responses[1].description, "Not found");
  assertEquals(get.security, ["bearer"]);
  const del = ops[1];
  assertEquals(del.deprecated, true);
  assertEquals(del.security, ["apiKey"]);
  assertEquals(del.parameters.find((p) => p.name === "X-Trace")?.required, false, "path-level parameter");
  const post = ops[2];
  assertEquals(post.body?.required, true);
  assertEquals(post.body?.contentType, "application/json");
  assertEquals(responseExample(post.responses[0], docs), { id: 7, status: "placed" });
  assertEquals(ops[3].tags, []);
});

Deno.test("tags: declared order, then the rest, untagged as default", () => {
  const { doc, ops } = shop();
  assertEquals(tagOrder(doc, ops), ["orders", "pets", "default"]);
});

Deno.test("servers: variables, Swagger host, relative URLs", () => {
  const { doc } = shop();
  assertEquals(servers(doc), ["https://eu.shop.example/api/v2"]);
  assertEquals(
    servers({ openapi: "3.1.0", servers: [{ url: "/api/v3/" }] }, "https://petstore3.swagger.io/api/v3/openapi.json"),
    [
      "https://petstore3.swagger.io/api/v3",
    ],
  );
  assertEquals(servers({ openapi: "3.1.0" }), [""]);
  assertEquals(servers({ openapi: "3.0.0", servers: [{ url: "/v1" }] }), ["/v1"]);
  assertEquals(servers({ swagger: "2.0", host: "api.example.com", basePath: "/v2", schemes: ["http", "https"] }), [
    "https://api.example.com/v2",
  ]);
  assertEquals(servers({ swagger: "2.0", basePath: "/v2" }), ["/v2"]);
});

Deno.test("curl: URL, path and query examples, auth, headers and body", () => {
  const { doc, docs, ops } = shop();
  const server = servers(doc)[0];
  assertEquals(
    curlCommand(doc, ops[0], server, BASE, docs),
    [
      `curl -X GET 'https://eu.shop.example/api/v2/pets/42?fields=name'`,
      `-H 'Accept: application/json'`,
      `-H "Authorization: Bearer $TOKEN"`,
      `-H 'X-Trace: abc'`,
    ].join(" \\\n  "),
  );
  assertEquals(curlCommand(doc, ops[1], server, BASE, docs).split(" \\\n  ")[1], `-H "X-API-Key: $API_KEY"`);
  const post = curlCommand(doc, ops[2], "", BASE, docs);
  assert(post.startsWith(`curl -X POST "$BASE_URL/orders"`), post);
  assert(post.includes(`-H 'Content-Type: application/json'`));
  assert(post.includes(`"status": "placed"`));
  assertEquals(fillPath(ops[0], docs), "/pets/42");
});

Deno.test("curl: quotes in bodies are escaped for the shell", () => {
  const doc = {
    openapi: "3.0.0",
    paths: {
      "/n": {
        post: {
          requestBody: { content: { "application/json": { example: { text: "it's" } } } },
          responses: {},
        },
      },
    },
  };
  const docs = { [BASE]: doc };
  const [op] = operations(doc, BASE, docs);
  assert(curlCommand(doc, op, "https://x", BASE, docs).endsWith(`-d '{\n  "text": "it'\\''s"\n}'`));
});

// A Swagger 2.0 spec: body and formData parameters, definitions, produces.
const SWAGGER = {
  swagger: "2.0",
  info: { title: "Legacy", version: "1" },
  host: "legacy.example.com",
  basePath: "/v1",
  schemes: ["https"],
  consumes: ["application/json"],
  produces: ["application/json"],
  securityDefinitions: { basic: { type: "basic" }, key: { type: "apiKey", in: "query", name: "api_key" } },
  security: [{ key: [] }],
  paths: {
    "/users": {
      post: {
        tags: ["users"],
        parameters: [{ in: "body", name: "body", required: true, schema: { $ref: "#/definitions/User" } }],
        responses: {
          "200": {
            description: "OK",
            schema: { type: "array", items: { $ref: "#/definitions/User" } },
            examples: { "application/json": [{ name: "Ada" }] },
          },
        },
      },
    },
    "/users/{id}/avatar": {
      put: {
        security: [{ basic: [] }],
        consumes: ["multipart/form-data"],
        parameters: [
          { in: "path", name: "id", type: "integer", "x-example": 3 },
          { in: "formData", name: "file", type: "file", required: true },
          { in: "formData", name: "caption", type: "string" },
          { in: "query", name: "size", type: "integer", required: true, default: 128 },
        ],
        responses: { "204": { description: "Done" } },
      },
    },
  },
  definitions: {
    User: {
      type: "object",
      required: ["name"],
      properties: { name: { type: "string" }, age: { type: "integer", format: "int32", minimum: 18 } },
    },
  },
};

Deno.test("Swagger 2.0: body, formData, definitions, examples and auth", () => {
  const docs = { [BASE]: SWAGGER };
  const ops = operations(SWAGGER, BASE, docs);
  assertEquals(specKind(SWAGGER), "swagger-2.0");
  const [create, avatar] = ops;
  assertEquals(create.parameters, []);
  assertEquals(bodyExample(create.body!, docs), { name: "string", age: 18 });
  assertEquals(create.responses[0].contentType, "application/json");
  assertEquals(responseExample(create.responses[0], docs), [{ name: "Ada" }]);
  assertEquals(typeLabel(create.responses[0].schema, BASE, docs), "array of User");
  assertEquals(avatar.body?.contentType, "multipart/form-data");
  assertEquals(avatar.parameters.map((p) => p.name), ["id", "size"]);
  const curl = curlCommand(SWAGGER, avatar, servers(SWAGGER)[0], BASE, docs);
  assert(curl.startsWith(`curl -X PUT 'https://legacy.example.com/v1/users/3/avatar?size=128'`), curl);
  assert(curl.includes(`-F 'file=@file'`));
  assert(curl.includes(`-F 'caption=string'`));
  assert(curl.includes(`-u "$USERNAME:$PASSWORD"`));
  const createCurl = curlCommand(SWAGGER, create, servers(SWAGGER)[0], BASE, docs);
  assert(createCurl.startsWith(`curl -X POST "https://legacy.example.com/v1/users?api_key=$API_KEY"`), createCurl);
});

Deno.test("type labels and outlines", () => {
  const { docs } = shop();
  assertEquals(typeLabel({ type: "string", format: "date-time" }, BASE, docs), "string (date-time)");
  assertEquals(typeLabel({ type: ["string", "null"] }, BASE, docs), "string | null");
  assertEquals(typeLabel({ type: "string", enum: ["a", "b"] }, BASE, docs), `string: "a", "b"`);
  assertEquals(
    typeLabel({ oneOf: [{ $ref: "#/components/schemas/Pet" }, { type: "string" }] }, BASE, docs),
    "Pet | string",
  );
  assertEquals(typeLabel({ $ref: "#/components/schemas/Order" }, BASE, docs), "Order");
  const outline = schemaOutline({ $ref: "#/components/schemas/Pet" }, BASE, docs, "request", 2);
  assertEquals(outline.split("\n").slice(0, 3), [
    "- `name` string **required**",
    "- `tag` string | null",
    "- `born` string (date)",
  ]);
  assert(outline.includes("  - `email` string (email)"), outline);
  assert(!outline.includes("`id`"), "readOnly hidden in requests");
  const order = schemaOutline({ $ref: "#/components/schemas/Order" }, BASE, docs, "response", 1);
  assert(order.includes("`id` integer") && order.includes("`status` string"), "allOf parts are merged");
});

Deno.test("formatting examples by content type", () => {
  assertEquals(formatExample({ a: 1, b: "x y" }, "application/x-www-form-urlencoded"), "a=1&b=x+y");
  assertEquals(formatExample("plain", "text/plain"), "plain");
  assertEquals(formatExample([1], "application/json"), "[\n  1\n]");
  assertEquals(formatExample(undefined), "");
});

Deno.test("spec detection", () => {
  assertEquals(specKind({ openapi: "3.1.0" }), "openapi-3.1");
  assertEquals(specKind({ openapi: "3.0.3" }), "openapi-3.0");
  assertEquals(specKind({ openapi: "4.0" }), undefined);
  assertEquals(specKind({ info: {} }), undefined);
  for (const n of ["openapi.yaml", "swagger.json", "petstore.openapi.yml", "openapi-v2.json", "api_swagger.yaml"]) {
    assert(isSpecFileName(n), n);
  }
  for (const n of ["openapi.ts", "openapi-generator.toml", "swaggerui.html", "notes.yaml"]) {
    assert(!isSpecFileName(n), n);
  }
  assert(looksLikeSpec("# comment\nopenapi: 3.1.0\ninfo:"));
  assert(looksLikeSpec('{\n  "swagger": "2.0",'));
  assert(looksLikeSpec('{"info":{"title":"x"},"openapi":"3.0.1"}'));
  assert(!looksLikeSpec("name: my-app\nversion: 3.0.0"));
});

Deno.test("URLs and folders", () => {
  assertEquals(
    normalizeUrl(" petstore3.swagger.io/api/v3/openapi.json "),
    "https://petstore3.swagger.io/api/v3/openapi.json",
  );
  assertThrows(() => normalizeUrl("ftp://x/openapi.json"), Error, "Only http and https");
  assertThrows(() => normalizeUrl("http://"), Error, "not a URL");
  assertEquals(parseFolders("~/code, /srv/api", "/home/me"), ["/home/me/code", "/srv/api"]);
});

Deno.test("loading a file spec with $refs to other files", async () => {
  const dir = await Deno.makeTempDir();
  try {
    await Deno.mkdir(`${dir}/schemas`);
    await Deno.writeTextFile(
      `${dir}/openapi.yaml`,
      `openapi: 3.1.0
info: { title: Split, version: "1" }
paths:
  /items:
    $ref: paths/items.yaml
`,
    );
    await Deno.mkdir(`${dir}/paths`);
    await Deno.writeTextFile(
      `${dir}/paths/items.yaml`,
      `get:
  responses:
    "200":
      description: Items
      content:
        application/json:
          schema: { type: array, items: { $ref: '../schemas/item.json' } }
`,
    );
    await Deno.writeTextFile(
      `${dir}/schemas/item.json`,
      JSON.stringify({ type: "object", properties: { sku: { type: "string", example: "A-1" } } }),
    );
    const uri = fileUri(`${dir}/openapi.yaml`);
    const spec = await loadSpec({ uri, path: `${dir}/openapi.yaml` });
    assertEquals(Object.keys(spec.docs).length, 3);
    const [op] = operations(spec.doc, uri, spec.docs);
    assertEquals(op.key, "GET /items");
    assertEquals(responseExample(op.responses[0], spec.docs), [{ sku: "A-1" }]);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("parsing: JSON, YAML and readable errors", () => {
  assertEquals(parseText('{"openapi":"3.0.0"}', "x.json"), { openapi: "3.0.0" });
  assertEquals(parseText("openapi: 3.0.0\npaths: {}", "x.yaml"), { openapi: "3.0.0", paths: {} });
  assertThrows(() => parseText("{bad", "x.json"), Error, "x.json is not valid JSON");
  assertThrows(() => parseText("a: [", "x.yaml"), Error, "x.yaml is not valid YAML");
});

Deno.test("the folders preference stays inside the read permission", async () => {
  const { parse } = await import("@std/toml");
  const manifest = parse(await Deno.readTextFile(new URL("./backslash.toml", import.meta.url))) as {
    permissions: { read: string[] };
    preferences: { name: string; default?: string }[];
  };
  const readable = new Set(manifest.permissions.read);
  const defaults = manifest.preferences.find((p) => p.name === "folders")!.default!;
  for (const f of defaults.split(",").map((s) => s.trim())) assert(readable.has(f), `${f} is not readable`);
});
