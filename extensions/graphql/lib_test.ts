import { assert, assertEquals, assertThrows } from "@std/assert";
import { parse } from "@std/toml";
import {
  authValue,
  dataSummary,
  errorsMarkdown,
  type Field,
  fieldSDL,
  type FullType,
  INTROSPECTION_QUERY,
  isSecretHeader,
  maskHeader,
  namedType,
  normalizeUrl,
  operationNames,
  operationOf,
  parseHeaders,
  parseVariables,
  requestBody,
  rootType,
  type Schema,
  schemaFrom,
  schemaSDL,
  skeleton,
  slotEndpoints,
  SLOTS,
  toCurl,
  type TypeRef,
  typeSDL,
  typeString,
  variablesTemplate,
} from "./lib.ts";

// Type references as introspection returns them.
const named = (kind: TypeRef["kind"], name: string): TypeRef => ({ kind, name, ofType: null });
const nn = (t: TypeRef): TypeRef => ({ kind: "NON_NULL", name: null, ofType: t });
const listOf = (t: TypeRef): TypeRef => ({ kind: "LIST", name: null, ofType: t });
const S = named("SCALAR", "String"),
  ID = named("SCALAR", "ID"),
  B = named("SCALAR", "Boolean"),
  I = named("SCALAR", "Int");
const obj = (name: string) => named("OBJECT", name);
const field = (name: string, type: TypeRef, args: Field["args"] = [], extra: Partial<Field> = {}): Field => ({
  name,
  description: null,
  args,
  type,
  isDeprecated: false,
  deprecationReason: null,
  ...extra,
});

// A small `__schema`, shaped like the countries.trevorblades.com answer plus a mutation.
const types: FullType[] = [
  {
    kind: "OBJECT",
    name: "Query",
    fields: [
      field("countries", nn(listOf(nn(obj("Country")))), [{
        name: "filter",
        description: "Filter by code or continent",
        type: named("INPUT_OBJECT", "CountryFilterInput"),
        defaultValue: "{}",
      }]),
      field("country", obj("Country"), [{ name: "code", type: nn(ID), defaultValue: null }], {
        description: "One country by its ISO code",
      }),
      field("search", nn(listOf(named("UNION", "SearchResult"))), [{ name: "text", type: nn(S) }]),
      field("version", nn(S)),
      field("oldCountries", listOf(obj("Country")), [], { isDeprecated: true, deprecationReason: "Use countries" }),
    ],
    interfaces: [],
  },
  {
    kind: "OBJECT",
    name: "Mutation",
    fields: [
      field("createThing", nn(obj("Thing")), [{ name: "input", type: nn(named("INPUT_OBJECT", "ThingInput")) }]),
    ],
    interfaces: [],
  },
  {
    kind: "OBJECT",
    name: "Country",
    description: "A country, with its languages",
    fields: [
      field("code", nn(ID)),
      field("name", nn(S)),
      field("emoji", nn(S)),
      field("capital", S),
      field("continent", nn(obj("Continent"))),
      field("languages", nn(listOf(nn(obj("Language"))))),
      field("states", nn(listOf(nn(obj("State"))))),
      field("subdivisions", nn(listOf(nn(obj("Subdivision")))), [{ name: "first", type: nn(I) }]),
      field("phone", nn(S), [], { isDeprecated: true, deprecationReason: "Use phones" }),
    ],
    interfaces: [{ kind: "INTERFACE", name: "Node" }],
  },
  {
    kind: "OBJECT",
    name: "Continent",
    fields: [field("code", nn(ID)), field("name", nn(S)), field("countries", nn(listOf(nn(obj("Country")))))],
    interfaces: [],
  },
  { kind: "OBJECT", name: "Language", fields: [field("code", nn(ID)), field("rtl", nn(B))], interfaces: [] },
  { kind: "OBJECT", name: "State", fields: [field("name", nn(S))], interfaces: [] },
  { kind: "OBJECT", name: "Subdivision", fields: [field("name", nn(S))], interfaces: [] },
  {
    kind: "OBJECT",
    name: "Thing",
    fields: [field("id", nn(ID)), field("kind", nn(named("ENUM", "Kind")))],
    interfaces: [],
  },
  { kind: "INTERFACE", name: "Node", fields: [field("code", nn(ID))], possibleTypes: [obj("Country")] },
  { kind: "UNION", name: "SearchResult", possibleTypes: [obj("Country"), obj("Continent")] },
  {
    kind: "INPUT_OBJECT",
    name: "CountryFilterInput",
    inputFields: [{ name: "code", type: named("INPUT_OBJECT", "StringQueryOperatorInput"), defaultValue: null }],
  },
  {
    kind: "INPUT_OBJECT",
    name: "StringQueryOperatorInput",
    inputFields: [{ name: "eq", type: S }, { name: "in", type: listOf(nn(S)) }],
  },
  {
    kind: "INPUT_OBJECT",
    name: "ThingInput",
    inputFields: [
      { name: "name", type: nn(S), description: "Shown everywhere" },
      { name: "kind", type: nn(named("ENUM", "Kind")) },
      { name: "count", type: nn(I), defaultValue: "1" },
      { name: "tags", type: listOf(S) },
    ],
  },
  {
    kind: "ENUM",
    name: "Kind",
    description: "What a thing is",
    enumValues: [{ name: "SMALL" }, { name: "LARGE", isDeprecated: true, deprecationReason: "Too big" }],
  },
  { kind: "SCALAR", name: "String" },
  { kind: "SCALAR", name: "DateTime", description: "An ISO 8601 date" },
  { kind: "OBJECT", name: "__Schema", fields: [] },
];

const schema: Schema = {
  queryType: { name: "Query" },
  mutationType: { name: "Mutation" },
  subscriptionType: null,
  types,
};
const queryField = (name: string) => rootType(schema, "query")!.fields!.find((f) => f.name === name)!;

Deno.test("type references", () => {
  assertEquals(typeString(nn(listOf(nn(obj("Country"))))), "[Country!]!");
  assertEquals(typeString(listOf(S)), "[String]");
  assertEquals(namedType(nn(listOf(nn(obj("Country"))))).name, "Country");
});

Deno.test("introspection answers", () => {
  assertEquals(schemaFrom({ data: { __schema: schema } }).types.length, types.length);
  assertThrows(
    () => schemaFrom({ errors: [{ message: "GraphQL introspection is not allowed by Apollo Server" }] }),
    Error,
    "introspection turned off",
  );
  assertThrows(
    () => schemaFrom({ errors: [{ message: "Bad token" }] }),
    Error,
    "refused the introspection query: Bad token",
  );
  assertThrows(() => schemaFrom({ data: null }), Error, "didn't return a schema");
  // The query asks for deep type references (7 levels of ofType).
  assertEquals(INTROSPECTION_QUERY.match(/ofType/g)?.length, 7);
  assert(INTROSPECTION_QUERY.includes("includeDeprecated: true"));
});

Deno.test("SDL of fields and types", () => {
  assertEquals(fieldSDL(queryField("country"), ""), '"One country by its ISO code"\ncountry(code: ID!): Country');
  assertEquals(
    fieldSDL(queryField("countries"), ""),
    'countries(\n  "Filter by code or continent"\n  filter: CountryFilterInput = {}\n): [Country!]!',
  );
  assertEquals(
    fieldSDL(queryField("oldCountries"), ""),
    'oldCountries: [Country] @deprecated(reason: "Use countries")',
  );
  const byName = (n: string) => types.find((t) => t.name === n)!;
  assertEquals(
    typeSDL(byName("Kind")),
    '"What a thing is"\nenum Kind {\n  SMALL\n  LARGE @deprecated(reason: "Too big")\n}',
  );
  assertEquals(typeSDL(byName("SearchResult")), "union SearchResult = Country | Continent");
  assertEquals(
    typeSDL(byName("ThingInput")),
    'input ThingInput {\n  "Shown everywhere"\n  name: String!\n  kind: Kind!\n  count: Int! = 1\n  tags: [String]\n}',
  );
  assert(
    typeSDL(byName("Country")).startsWith(
      '"A country, with its languages"\ntype Country implements Node {\n  code: ID!',
    ),
  );
  assertEquals(typeSDL(byName("DateTime")), '"An ISO 8601 date"\nscalar DateTime');
  const multi: FullType = { kind: "SCALAR", name: "X", description: 'Line one\nSays "hi"' };
  assertEquals(typeSDL(multi), '"""\nLine one\nSays "hi"\n"""\nscalar X');
});

Deno.test("schema SDL: user types, roots first, no builtins", () => {
  const sdl = schemaSDL(schema);
  assert(sdl.startsWith("type Query {"));
  assert(sdl.indexOf("type Mutation {") < sdl.indexOf("type Continent {"));
  assert(!sdl.includes("scalar String"));
  assert(!sdl.includes("__Schema"));
  assert(sdl.includes("scalar DateTime"));
});

Deno.test("query skeletons", () => {
  assertEquals(
    skeleton(schema, "query", queryField("country")),
    [
      "query Country($code: ID!) {",
      "  country(code: $code) {",
      "    code",
      "    name",
      "    emoji",
      "    capital",
      "    continent {",
      "      code",
      "      name",
      "    }",
      "    languages {",
      "      code",
      "      rtl",
      "    }",
      "    states {",
      "      name",
      "    }",
      "  }",
      "}",
    ].join("\n"),
  );
  // Optional arguments aren't variables; deprecated fields and fields with required arguments are left out.
  const countries = skeleton(schema, "query", queryField("countries"), 1);
  assertEquals(countries, "query Countries {\n  countries {\n    code\n    name\n    emoji\n    capital\n  }\n}");
  assertEquals(skeleton(schema, "query", queryField("version")), "query Version {\n  version\n}");
  const search = skeleton(schema, "query", queryField("search"));
  assert(search.includes("    __typename\n    ... on Country {\n      code"));
  assert(search.includes("    ... on Continent {"));
  const mutation = skeleton(schema, "mutation", rootType(schema, "mutation")!.fields![0]);
  assertEquals(
    mutation,
    "mutation CreateThing($input: ThingInput!) {\n  createThing(input: $input) {\n    id\n    kind\n  }\n}",
  );
});

Deno.test("variables templates", () => {
  assertEquals(variablesTemplate(schema, queryField("country")), '{\n  "code": ""\n}');
  assertEquals(variablesTemplate(schema, queryField("countries")), "");
  // Required input fields only (count has a default), enums get their first value.
  assertEquals(
    JSON.parse(variablesTemplate(schema, rootType(schema, "mutation")!.fields![0])),
    { input: { name: "", kind: "SMALL" } },
  );
});

Deno.test("endpoint slots", () => {
  const endpoints = slotEndpoints({
    name1: "GitHub",
    url1: "https://api.github.com/graphql",
    token1: "ghp_abc",
    url2: "localhost:4000/graphql",
    header2: "X-API-Key",
    token2: "k-123",
    name3: "Empty",
  });
  assertEquals(endpoints, [
    {
      id: "slot:1",
      name: "GitHub",
      url: "https://api.github.com/graphql",
      headers: { Authorization: "Bearer ghp_abc" },
      source: "slot",
    },
    {
      id: "slot:2",
      name: "localhost:4000",
      url: "http://localhost:4000/graphql",
      headers: { "X-API-Key": "k-123" },
      source: "slot",
    },
  ]);
  assertEquals(authValue("Basic dXNlcg=="), "Basic dXNlcg==");
  assertEquals(authValue("token ghp_x"), "token ghp_x");
  assertEquals(SLOTS, [1, 2, 3]);
});

Deno.test("urls and headers", () => {
  assertEquals(normalizeUrl("api.example.com/graphql"), "https://api.example.com/graphql");
  assertEquals(normalizeUrl("192.168.1.5:8080/query"), "http://192.168.1.5:8080/query");
  assertEquals(normalizeUrl("ftp://x"), "");
  assertEquals(normalizeUrl("  "), "");
  assertEquals(parseHeaders("X-Client: backslash\n\n# comment\nAccept-Language: fr"), {
    "X-Client": "backslash",
    "Accept-Language": "fr",
  });
  assertThrows(() => parseHeaders("not a header"), Error, "Line 1");
  assert(isSecretHeader("Authorization"));
  assert(isSecretHeader("X-API-Key"));
  assert(isSecretHeader("X-Shopify-Access-Token"));
  assert(isSecretHeader("Cookie"));
  assert(!isSecretHeader("X-Client-Name"));
  assertEquals(maskHeader("Authorization", "Bearer ghp_1234567890"), "Bearer gh…90");
  assertEquals(maskHeader("X-API-Key", "short"), "••••");
  assertEquals(maskHeader("X-Client", "backslash"), "backslash");
});

Deno.test("operations and variables", () => {
  assertEquals(operationOf("query Repo($o: String!) { x }"), { kind: "query", name: "Repo" });
  assertEquals(operationOf("# a comment with mutation Foo\nmutation { x }"), { kind: "mutation" });
  assertEquals(operationOf("{ viewer { login } }"), { kind: "query" });
  assertEquals(operationNames('query A { a(s: "query Fake") } mutation B { b }'), ["A", "B"]);
  assertEquals(parseVariables(""), undefined);
  assertEquals(parseVariables('{"code": "FR"}'), { code: "FR" });
  assertThrows(() => parseVariables("[1]"), Error, "JSON object");
  assertThrows(() => parseVariables("{code: 1}"), Error, "aren't valid JSON");
  assertEquals(requestBody("{ a }"), { query: "{ a }" });
  assertEquals(requestBody("{ a }", { x: 1 }, "A"), { query: "{ a }", variables: { x: 1 }, operationName: "A" });
});

Deno.test("results", () => {
  assertEquals(
    errorsMarkdown([{
      message: "Not found",
      path: ["repository", "issue"],
      locations: [{ line: 2, column: 3 }],
      extensions: { code: "NOT_FOUND" },
    }]),
    "- **Not found** (at `repository.issue` · line 2:3 · `NOT_FOUND`)",
  );
  assertEquals(errorsMarkdown([{ message: "Boom" }]), "- **Boom**");
  assertEquals(
    dataSummary({ countries: [1, 2, 3], viewer: { login: "ada" }, total: 4 }),
    "countries: 3 items · viewer · total: 4",
  );
  assertEquals(dataSummary({ repository: { issues: null }, search: { nodes: [1] } }), "repository · search: 1 item");
  assertEquals(dataSummary(null), "No data");
});

Deno.test("curl without the secret", () => {
  const curl = toCurl(
    {
      id: "slot:1",
      name: "GitHub",
      url: "https://api.github.com/graphql",
      headers: { Authorization: "Bearer ghp_secret", "X-Client": "bs" },
      source: "slot",
    },
    requestBody("query { viewer { login } }"),
  );
  assert(!curl.includes("ghp_secret"));
  assert(curl.includes('-H "Authorization: Bearer $TOKEN"'));
  assert(curl.includes("-H 'X-Client: bs'"));
  assert(curl.includes(`--data '{"query":"query { viewer { login } }"}'`));
});

Deno.test("manifest: any host, three slots with secret tokens", async () => {
  const manifest = parse(await Deno.readTextFile(new URL("./backslash.toml", import.meta.url))) as {
    permissions: { net: string[] };
    commands: { name: string; title: string }[];
    preferences: { name: string; type?: string }[];
  };
  assertEquals(manifest.permissions.net, ["*"]);
  for (const n of SLOTS) {
    for (const key of ["name", "url", "header", "token"]) {
      const p = manifest.preferences.find((x) => x.name === `${key}${n}`);
      assert(p, `${key}${n}`);
      if (key === "token") assertEquals(p.type, "secret");
    }
  }
  for (const c of manifest.commands) await Deno.stat(new URL(`./commands/${c.name}.ts`, import.meta.url));
});
