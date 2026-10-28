// GraphQL: endpoints, introspection, SDL, query skeletons, variables and results.

// ---------------------------------------------------------------------------
// Endpoints

export interface Endpoint {
  /** `slot:1` for the preference slots, `saved:<uuid>` for saved ones. */
  id: string;
  name: string;
  url: string;
  /** Headers sent with every request, secrets included (they only live in memory). */
  headers: Record<string, string>;
  /** Where it comes from: preferences can hold a secret, saved ones can't. */
  source: "slot" | "saved";
}

export interface SavedEndpoint {
  id: string;
  name: string;
  url: string;
  headers: Record<string, string>;
}

export const SLOTS = [1, 2, 3];

/** The endpoints set in the preference slots (`name1`, `url1`, `header1`, `token1`…). */
export function slotEndpoints(prefs: Record<string, unknown>): Endpoint[] {
  const out: Endpoint[] = [];
  for (const n of SLOTS) {
    const url = normalizeUrl(String(prefs[`url${n}`] ?? ""));
    if (!url) continue;
    const headerName = String(prefs[`header${n}`] ?? "").trim() || "Authorization";
    const token = String(prefs[`token${n}`] ?? "").trim();
    const name = String(prefs[`name${n}`] ?? "").trim() || hostOf(url);
    const headers: Record<string, string> = {};
    if (token) headers[headerName] = headerName.toLowerCase() === "authorization" ? authValue(token) : token;
    out.push({ id: `slot:${n}`, name, url, headers, source: "slot" });
  }
  return out;
}

/** A bare token gets `Bearer `; `Bearer x`, `Basic x`, `token x` are kept. */
export function authValue(token: string): string {
  return /^(bearer|basic|token|bot|apikey|api-key|digest)\s+\S/i.test(token) ? token : `Bearer ${token}`;
}

/** `api.example.com/graphql` → `https://api.example.com/graphql`; `localhost:4000` → `http://…`. */
export function normalizeUrl(input: string): string {
  const text = input.trim();
  if (!text) return "";
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text)
    ? text
    : `${
      /^(localhost|127\.|0\.0\.0\.0|\[::1\]|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(text) ? "http" : "https"
    }://${text}`;
  try {
    const u = new URL(withScheme);
    if (u.protocol !== "http:" && u.protocol !== "https:") return "";
    return u.toString();
  } catch {
    return "";
  }
}

export function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/** Header lines `Name: value` → an object; throws on a malformed line. */
export function parseHeaders(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [i, raw] of text.split("\n").entries()) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = /^([A-Za-z0-9!#$%&'*+.^_`|~-]+)\s*:\s*(.*)$/.exec(line);
    if (!m) throw new Error(`Line ${i + 1} isn't a header like “X-Client: backslash”`);
    out[m[1]] = m[2];
  }
  return out;
}

export const headerLines = (headers: Record<string, string>) =>
  Object.entries(headers).map(([k, v]) => `${k}: ${v}`).join("\n");

/** Headers that carry credentials and so belong in a secret preference. */
export function isSecretHeader(name: string): boolean {
  return /^(authorization|proxy-authorization|cookie)$|token|secret|key|auth|session|password/i.test(name);
}

/** `Authorization: Bearer abcdef…` → `Authorization: Bearer ab…ef`. */
export function maskHeader(name: string, value: string): string {
  if (!isSecretHeader(name)) return value;
  const m = /^(\w+\s+)?(.*)$/.exec(value)!;
  const secret = m[2];
  const shown = secret.length > 8 ? `${secret.slice(0, 2)}…${secret.slice(-2)}` : "••••";
  return `${m[1] ?? ""}${shown}`;
}

// ---------------------------------------------------------------------------
// Introspection

export const INTROSPECTION_QUERY = `query IntrospectionQuery {
  __schema {
    queryType { name }
    mutationType { name }
    subscriptionType { name }
    types { ...FullType }
  }
}

fragment FullType on __Type {
  kind
  name
  description
  fields(includeDeprecated: true) {
    name
    description
    args { ...InputValue }
    type { ...TypeRef }
    isDeprecated
    deprecationReason
  }
  inputFields { ...InputValue }
  interfaces { ...TypeRef }
  enumValues(includeDeprecated: true) {
    name
    description
    isDeprecated
    deprecationReason
  }
  possibleTypes { ...TypeRef }
}

fragment InputValue on __InputValue {
  name
  description
  type { ...TypeRef }
  defaultValue
}

fragment TypeRef on __Type {
  kind
  name
  ofType {
    kind
    name
    ofType {
      kind
      name
      ofType {
        kind
        name
        ofType {
          kind
          name
          ofType {
            kind
            name
            ofType {
              kind
              name
              ofType { kind name }
            }
          }
        }
      }
    }
  }
}`;

export type Kind = "SCALAR" | "OBJECT" | "INTERFACE" | "UNION" | "ENUM" | "INPUT_OBJECT" | "LIST" | "NON_NULL";

export interface TypeRef {
  kind: Kind;
  name: string | null;
  ofType?: TypeRef | null;
}

export interface InputValue {
  name: string;
  description?: string | null;
  type: TypeRef;
  defaultValue?: string | null;
}

export interface Field {
  name: string;
  description?: string | null;
  args: InputValue[];
  type: TypeRef;
  isDeprecated?: boolean;
  deprecationReason?: string | null;
}

export interface FullType {
  kind: Kind;
  name: string;
  description?: string | null;
  fields?: Field[] | null;
  inputFields?: InputValue[] | null;
  interfaces?: TypeRef[] | null;
  enumValues?: {
    name: string;
    description?: string | null;
    isDeprecated?: boolean;
    deprecationReason?: string | null;
  }[] | null;
  possibleTypes?: TypeRef[] | null;
}

export interface Schema {
  queryType?: { name: string } | null;
  mutationType?: { name: string } | null;
  subscriptionType?: { name: string } | null;
  types: FullType[];
}

/** The `__schema` of an introspection answer, or a sentence saying why there is none. */
export function schemaFrom(answer: GraphQLResponse): Schema {
  const schema = (answer.data as { __schema?: Schema } | undefined)?.__schema;
  if (schema?.types) return schema;
  const message = answer.errors?.map((e) => e.message).join("; ") ?? "";
  if (/introspection/i.test(message)) {
    throw new Error("This server has introspection turned off: run queries without the schema browser");
  }
  throw new Error(
    message ? `The server refused the introspection query: ${message}` : "The server didn't return a schema",
  );
}

/** `[String!]!` */
export function typeString(t: TypeRef): string {
  if (t.kind === "NON_NULL") return `${typeString(t.ofType!)}!`;
  if (t.kind === "LIST") return `[${typeString(t.ofType!)}]`;
  return t.name ?? "?";
}

export function namedType(t: TypeRef): TypeRef {
  let cur = t;
  while ((cur.kind === "NON_NULL" || cur.kind === "LIST") && cur.ofType) cur = cur.ofType;
  return cur;
}

export const isRequired = (a: InputValue) => a.type.kind === "NON_NULL" && (a.defaultValue ?? null) === null;

export const isBuiltin = (name: string) => name.startsWith("__");

export function typeMap(schema: Schema): Map<string, FullType> {
  return new Map(schema.types.filter((t) => t.name).map((t) => [t.name, t]));
}

export type RootKind = "query" | "mutation" | "subscription";

export function rootType(schema: Schema, kind: RootKind): FullType | undefined {
  const name = kind === "query"
    ? schema.queryType?.name
    : kind === "mutation"
    ? schema.mutationType?.name
    : schema.subscriptionType?.name;
  return name ? typeMap(schema).get(name) : undefined;
}

// ---------------------------------------------------------------------------
// SDL

function description(text: string | null | undefined, indent = ""): string[] {
  if (!text?.trim()) return [];
  const t = text.trim();
  if (!t.includes("\n") && !t.includes('"')) return [`${indent}"${t}"`];
  return [
    `${indent}"""`,
    ...t.replace(/"""/g, '\\"""').split("\n").map((l) => `${indent}${l}`.trimEnd()),
    `${indent}"""`,
  ];
}

const deprecated = (x: { isDeprecated?: boolean; deprecationReason?: string | null }) =>
  x.isDeprecated
    ? ` @deprecated${
      x.deprecationReason && x.deprecationReason !== "No longer supported"
        ? `(reason: ${JSON.stringify(x.deprecationReason)})`
        : ""
    }`
    : "";

function argList(args: InputValue[], indent: string): string {
  if (!args.length) return "";
  const one = args.map((a) =>
    `${a.name}: ${typeString(a.type)}${a.defaultValue != null ? ` = ${a.defaultValue}` : ""}`
  );
  const inline = `(${one.join(", ")})`;
  if (inline.length <= 80 && !args.some((a) => a.description)) return inline;
  const lines = args.flatMap((a, i) => [...description(a.description, `${indent}  `), `${indent}  ${one[i]}`]);
  return `(\n${lines.join("\n")}\n${indent})`;
}

export function fieldSDL(f: Field, indent = "  "): string {
  return [
    ...description(f.description, indent),
    `${indent}${f.name}${argList(f.args, indent)}: ${typeString(f.type)}${deprecated(f)}`,
  ]
    .join("\n");
}

export function typeSDL(t: FullType): string {
  const head = description(t.description);
  switch (t.kind) {
    case "SCALAR":
      return [...head, `scalar ${t.name}`].join("\n");
    case "ENUM":
      return [
        ...head,
        `enum ${t.name} {`,
        ...(t.enumValues ?? []).flatMap((v) => [...description(v.description, "  "), `  ${v.name}${deprecated(v)}`]),
        "}",
      ].join("\n");
    case "UNION":
      return [...head, `union ${t.name} = ${(t.possibleTypes ?? []).map((p) => p.name).join(" | ")}`].join("\n");
    case "INPUT_OBJECT":
      return [
        ...head,
        `input ${t.name} {`,
        ...(t.inputFields ?? []).flatMap((f) => [
          ...description(f.description, "  "),
          `  ${f.name}: ${typeString(f.type)}${f.defaultValue != null ? ` = ${f.defaultValue}` : ""}`,
        ]),
        "}",
      ].join("\n");
    default: {
      const keyword = t.kind === "INTERFACE" ? "interface" : "type";
      const impl = (t.interfaces ?? []).length
        ? ` implements ${(t.interfaces ?? []).map((i) => i.name).join(" & ")}`
        : "";
      return [...head, `${keyword} ${t.name}${impl} {`, ...(t.fields ?? []).map((f) => fieldSDL(f)), "}"].join("\n");
    }
  }
}

/** The whole schema, user types only, root types first. */
export function schemaSDL(schema: Schema): string {
  const roots = [schema.queryType?.name, schema.mutationType?.name, schema.subscriptionType?.name].filter(
    (n): n is string => !!n,
  );
  const BUILTIN_SCALARS = new Set(["String", "Int", "Float", "Boolean", "ID"]);
  const types = schema.types
    .filter((t) => t.name && !isBuiltin(t.name) && !(t.kind === "SCALAR" && BUILTIN_SCALARS.has(t.name)))
    .sort((a, b) =>
      (roots.indexOf(a.name) + 1 || 99) - (roots.indexOf(b.name) + 1 || 99) || a.name.localeCompare(b.name)
    );
  return types.map(typeSDL).join("\n\n");
}

// ---------------------------------------------------------------------------
// Skeletons

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** The fields to select under a type, down to `depth` levels of objects. */
function selection(
  typeName: string,
  types: Map<string, FullType>,
  depth: number,
  indent: string,
  seen: Set<string>,
): string[] {
  const t = types.get(typeName);
  if (!t) return [`${indent}__typename`];
  if (t.kind === "UNION" || (t.kind === "INTERFACE" && !(t.fields ?? []).length)) {
    const out = [`${indent}__typename`];
    for (const p of (t.possibleTypes ?? []).slice(0, 4)) {
      const inner = selection(p.name!, types, Math.min(depth, 1), `${indent}  `, new Set([...seen, typeName]));
      out.push(`${indent}... on ${p.name} {`, ...inner, `${indent}}`);
    }
    return out;
  }
  const fields = (t.fields ?? []).filter((f) => !f.isDeprecated && !f.args.some(isRequired));
  const leaves = fields.filter((f) => ["SCALAR", "ENUM"].includes(namedType(f.type).kind));
  const out = leaves.slice(0, 12).map((f) => `${indent}${f.name}`);
  if (depth > 1) {
    const objects = fields.filter((f) => {
      const n = namedType(f.type);
      return ["OBJECT", "INTERFACE", "UNION"].includes(n.kind) && !seen.has(n.name!);
    });
    for (const f of objects.slice(0, 3)) {
      const n = namedType(f.type).name!;
      const inner = selection(n, types, depth - 1, `${indent}  `, new Set([...seen, typeName]));
      out.push(`${indent}${f.name} {`, ...inner, `${indent}}`);
    }
  }
  return out.length ? out : [`${indent}__typename`];
}

/** A ready-to-run operation for a root field: required arguments as variables, a selection of its fields. */
export function skeleton(schema: Schema, kind: RootKind, field: Field, depth = 2): string {
  const types = typeMap(schema);
  const required = field.args.filter(isRequired);
  const vars = required.map((a) => `$${a.name}: ${typeString(a.type)}`);
  const head = `${kind} ${capitalize(field.name)}${vars.length ? `(${vars.join(", ")})` : ""} {`;
  const call = `  ${field.name}${
    required.length ? `(${required.map((a) => `${a.name}: $${a.name}`).join(", ")})` : ""
  }`;
  const target = namedType(field.type);
  const lines = ["SCALAR", "ENUM"].includes(target.kind)
    ? [head, call, "}"]
    : [head, `${call} {`, ...selection(target.name!, types, depth, "    ", new Set()), "  }", "}"];
  return lines.join("\n");
}

/** A placeholder value of a type, for the variables JSON. */
export function placeholder(t: TypeRef, types: Map<string, FullType>, depth = 0): unknown {
  if (t.kind === "NON_NULL") return placeholder(t.ofType!, types, depth);
  if (t.kind === "LIST") return [];
  const full = types.get(t.name ?? "");
  switch (t.name) {
    case "Int":
    case "Float":
      return 0;
    case "Boolean":
      return false;
    case "String":
    case "ID":
      return "";
  }
  if (full?.kind === "ENUM") return full.enumValues?.[0]?.name ?? "";
  if (full?.kind === "INPUT_OBJECT" && depth < 3) {
    const out: Record<string, unknown> = {};
    for (const f of full.inputFields ?? []) if (isRequired(f)) out[f.name] = placeholder(f.type, types, depth + 1);
    return out;
  }
  return "";
}

/** `{ "owner": "", "name": "" }` for the required arguments. */
export function variablesTemplate(schema: Schema, field: Field): string {
  const types = typeMap(schema);
  const required = field.args.filter(isRequired);
  if (!required.length) return "";
  return JSON.stringify(Object.fromEntries(required.map((a) => [a.name, placeholder(a.type, types)])), null, 2);
}

// ---------------------------------------------------------------------------
// Running

export interface GraphQLError {
  message: string;
  path?: (string | number)[];
  locations?: { line: number; column: number }[];
  extensions?: Record<string, unknown>;
}

export interface GraphQLResponse {
  data?: unknown;
  errors?: GraphQLError[];
  extensions?: Record<string, unknown>;
}

/** Variables typed in the form: empty, or a JSON object. */
export function parseVariables(text: string): Record<string, unknown> | undefined {
  const t = text.trim();
  if (!t) return undefined;
  let value: unknown;
  try {
    value = JSON.parse(t);
  } catch (e) {
    throw new Error(`The variables aren't valid JSON: ${e instanceof Error ? e.message : e}`);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error('The variables must be a JSON object, like {"id": "42"}');
  }
  return value as Record<string, unknown>;
}

/** The operation's kind and name: `mutation CreateIssue`. */
export function operationOf(query: string): { kind: RootKind; name?: string } {
  const stripped = query.replace(/#[^\n]*/g, "").replace(/"""[\s\S]*?"""|"(?:[^"\\]|\\.)*"/g, '""');
  const m = /^\s*(query|mutation|subscription)\b\s*([_A-Za-z][_0-9A-Za-z]*)?/m.exec(stripped);
  if (m) return { kind: m[1] as RootKind, ...(m[2] ? { name: m[2] } : {}) };
  return { kind: "query" };
}

/** The names of the operations a document defines. */
export function operationNames(query: string): string[] {
  const stripped = query.replace(/#[^\n]*/g, "").replace(/"""[\s\S]*?"""|"(?:[^"\\]|\\.)*"/g, '""');
  return [...stripped.matchAll(/\b(?:query|mutation|subscription)\s+([_A-Za-z][_0-9A-Za-z]*)/g)].map((m) => m[1]);
}

export const requestBody = (query: string, variables?: Record<string, unknown>, operationName?: string) => ({
  query,
  ...(variables ? { variables } : {}),
  ...(operationName ? { operationName } : {}),
});

/** A curl command for the request; secret header values become `$TOKEN`. */
export function toCurl(endpoint: Endpoint, body: unknown): string {
  const q = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
  const headers = Object.entries(endpoint.headers).map(([k, v]) => {
    const value = isSecretHeader(k) ? v.replace(/^(\w+\s+)?.*$/, (_, scheme) => `${scheme ?? ""}$TOKEN`) : v;
    return `-H ${isSecretHeader(k) ? `"${k}: ${value}"` : q(`${k}: ${value}`)}`;
  });
  return [
    "curl",
    q(endpoint.url),
    "-H 'Content-Type: application/json'",
    ...headers,
    `--data ${q(JSON.stringify(body))}`,
  ]
    .join(" \\\n  ");
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function fence(text: string, lang = ""): string {
  const ticks = "`".repeat(Math.max(3, ...[...text.matchAll(/`{3,}/g)].map((m) => m[0].length + 1)));
  return `${ticks}${lang}\n${text}\n${ticks}`;
}

/** Errors as a markdown list: message, path and line. */
export function errorsMarkdown(errors: GraphQLError[]): string {
  return errors.map((e) => {
    const where = [
      e.path?.length ? `at \`${e.path.join(".")}\`` : "",
      e.locations?.length ? `line ${e.locations[0].line}:${e.locations[0].column}` : "",
      typeof e.extensions?.code === "string" ? `\`${e.extensions.code}\`` : "",
    ].filter(Boolean).join(" · ");
    return `- **${e.message}**${where ? ` (${where})` : ""}`;
  }).join("\n");
}

/** What a result holds: "3 repositories", "1 object", "null". */
export function dataSummary(data: unknown): string {
  if (data === null || data === undefined) return "No data";
  if (typeof data !== "object") return String(data);
  const entries = Object.entries(data as Record<string, unknown>);
  return entries.map(([k, v]) => {
    if (Array.isArray(v)) return `${k}: ${v.length} item${v.length === 1 ? "" : "s"}`;
    if (v && typeof v === "object") {
      const edges = (v as { edges?: unknown[]; nodes?: unknown[] }).edges ?? (v as { nodes?: unknown[] }).nodes;
      if (Array.isArray(edges)) return `${k}: ${edges.length} item${edges.length === 1 ? "" : "s"}`;
      return k;
    }
    return `${k}: ${v === null ? "null" : String(v)}`;
  }).join(" · ");
}

export const EXAMPLE_ENDPOINT: SavedEndpoint = {
  id: "saved:example-countries",
  name: "Countries (public example)",
  url: "https://countries.trevorblades.com/",
  headers: {},
};
