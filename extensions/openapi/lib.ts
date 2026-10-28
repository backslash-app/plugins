// OpenAPI 3.0 / 3.1 and Swagger 2.0: $ref resolution, operations, example values and curl commands.
// Pure, tested in lib_test.ts.

import type { Color } from "@backslash/api";

// deno-lint-ignore no-explicit-any
type Obj = Record<string, any>;

const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | undefined => typeof v === "string" && v.trim() ? v : undefined;

// ---------------------------------------------------------------------------
// Documents and $ref

/**
 * Every document a spec is made of, by absolute URI without fragment
 * (`file:///…/openapi.yaml`, `https://…/schemas.json`): the spec itself and
 * the files its `$ref`s point to.
 */
export type Docs = Record<string, unknown>;

/** A value and the document it was found in, which relative `$ref`s inside it are resolved against. */
export interface Located<T = unknown> {
  value: T;
  base: string;
  /** The last `$ref` followed to get here, if any: `#/components/schemas/Pet`. */
  ref?: string;
  /** Where that `$ref` points, as `<document>#<pointer>`: the same target always has the same key. */
  key?: string;
}

/** `a/b~1c` → `["a", "b/c"]` (RFC 6901). */
export function pointerTokens(pointer: string): string[] {
  if (!pointer || pointer === "/") return pointer === "/" ? [""] : [];
  return pointer.replace(/^\//, "").split("/").map((t) => t.replace(/~1/g, "/").replace(/~0/g, "~"));
}

/** The value at a JSON pointer, or undefined. */
export function atPointer(doc: unknown, pointer: string): unknown {
  let node = doc;
  for (const token of pointerTokens(pointer)) {
    if (Array.isArray(node)) node = node[Number(token)];
    else if (isObj(node)) node = node[token];
    else return undefined;
    if (node === undefined) return undefined;
  }
  return node;
}

/** The document part of a URI: `file:///a/b.yaml#/x` → `file:///a/b.yaml`. */
export const docUri = (uri: string) => uri.replace(/#.*$/, "");

/** Where a `$ref` points, as an absolute URI with its fragment. */
export function refTarget(ref: string, base: string): { doc: string; pointer: string } {
  let url: URL;
  try {
    url = new URL(ref, base);
  } catch {
    return { doc: base, pointer: "" };
  }
  const hash = url.hash.replace(/^#/, "");
  let pointer = hash;
  try {
    pointer = decodeURIComponent(hash);
  } catch {
    // keep it as written
  }
  url.hash = "";
  return { doc: url.href, pointer };
}

/** The name a `$ref` gives its target: `#/components/schemas/Pet` → `Pet`, `./pet.yaml` → `pet`. */
export function refName(ref: string): string {
  const [file, pointer = ""] = ref.split("#");
  const tokens = pointerTokens(pointer);
  if (tokens.length) return tokens[tokens.length - 1];
  return (file.split("/").pop() ?? file).replace(/\.(ya?ml|json)$/i, "") || ref;
}

export class RefError extends Error {}

/**
 * Follows `$ref`s until a value that is not one. Sibling keywords next to a
 * `$ref` (allowed in OpenAPI 3.1: `description`, `summary`…) are kept over
 * the target's. Throws {@link RefError} for a missing target or a loop.
 */
export function deref<T = unknown>(value: unknown, base: string, docs: Docs): Located<T> {
  let node = value;
  let at = base;
  let ref: string | undefined;
  let key: string | undefined;
  const followed: string[] = [];
  let siblings: Obj = {};
  while (isObj(node) && typeof node.$ref === "string") {
    const { $ref, ...rest } = node;
    siblings = { ...rest, ...siblings };
    const target = refTarget($ref, at);
    key = `${target.doc}#${target.pointer}`;
    if (followed.includes(key)) throw new RefError(`$ref loop at ${$ref}`);
    followed.push(key);
    const doc = docs[target.doc];
    if (doc === undefined) throw new RefError(`Cannot resolve ${$ref}: ${target.doc} is not loaded`);
    const found = atPointer(doc, target.pointer);
    if (found === undefined) throw new RefError(`Cannot resolve ${$ref}: nothing at #${target.pointer}`);
    node = found;
    at = target.doc;
    ref = $ref;
  }
  if (Object.keys(siblings).length && isObj(node)) node = { ...node, ...siblings };
  return { value: node as T, base: at, ref, key };
}

/** Like {@link deref}, but returns undefined instead of throwing. */
export function tryDeref<T = unknown>(value: unknown, base: string, docs: Docs): Located<T> | undefined {
  try {
    return deref<T>(value, base, docs);
  } catch (e) {
    if (e instanceof RefError) return undefined;
    throw e;
  }
}

/** Documents other than `base` that `$ref`s inside `doc` point to (to load them before resolving). */
export function externalRefs(doc: unknown, base: string): string[] {
  const found = new Set<string>();
  const visit = (node: unknown, depth: number) => {
    if (depth > 200) return;
    if (Array.isArray(node)) node.forEach((n) => visit(n, depth + 1));
    else if (isObj(node)) {
      for (const [k, v] of Object.entries(node)) {
        if (k === "$ref" && typeof v === "string" && !v.startsWith("#")) {
          const target = refTarget(v, base).doc;
          if (target !== docUri(base)) found.add(target);
        } else visit(v, depth + 1);
      }
    }
  };
  visit(doc, 0);
  return [...found];
}

// ---------------------------------------------------------------------------
// The spec

export type SpecKind = "openapi-3.0" | "openapi-3.1" | "swagger-2.0";

export function specKind(doc: unknown): SpecKind | undefined {
  if (!isObj(doc)) return undefined;
  const openapi = String(doc.openapi ?? "");
  if (/^3\.0(\.|$)/.test(openapi)) return "openapi-3.0";
  if (/^3\.[1-9]/.test(openapi)) return "openapi-3.1";
  if (String(doc.swagger ?? "") === "2.0") return "swagger-2.0";
  return undefined;
}

export function kindLabel(doc: Obj): string {
  return doc.openapi ? `OpenAPI ${doc.openapi}` : doc.swagger ? `Swagger ${doc.swagger}` : "Unknown";
}

export const METHODS = ["get", "put", "post", "delete", "options", "head", "patch", "trace"] as const;
export type Method = typeof METHODS[number];

export const METHOD_COLORS: Record<Method, Color> = {
  get: "blue",
  post: "green",
  put: "orange",
  patch: "yellow",
  delete: "red",
  head: "purple",
  options: "gray",
  trace: "gray",
};

export interface Param {
  name: string;
  in: "path" | "query" | "header" | "cookie" | "body" | "formData" | string;
  required: boolean;
  description?: string;
  deprecated: boolean;
  schema?: unknown;
  /** The document `schema` belongs to. */
  base: string;
  example?: unknown;
}

export interface Body {
  required: boolean;
  description?: string;
  /** The preferred content type (JSON when offered). */
  contentType: string;
  contentTypes: string[];
  schema?: unknown;
  base: string;
  /** An example given by the spec for the content type, if any. */
  example?: unknown;
}

export interface Response {
  status: string;
  description?: string;
  contentType?: string;
  schema?: unknown;
  base: string;
  example?: unknown;
  headers: string[];
}

export interface Operation {
  /** `GET /pets/{petId}` */
  key: string;
  method: Method;
  path: string;
  operationId?: string;
  summary?: string;
  description?: string;
  tags: string[];
  deprecated: boolean;
  parameters: Param[];
  body?: Body;
  responses: Response[];
  /** Names of the security schemes that work for it (any one of them). */
  security: string[];
  /** Servers of the operation or its path, when they override the spec's. */
  servers?: Obj[];
}

/** JSON first, then anything +json, then the first one. */
export function preferredType(types: string[]): string | undefined {
  return types.find((t) => /^application\/json\b/i.test(t)) ?? types.find((t) => /\+json\b/i.test(t)) ??
    types.find((t) => /json/i.test(t)) ?? types[0];
}

/** The example a media type object gives: `example`, or the first of `examples` (resolving `$ref`s). */
function mediaExample(media: Obj, base: string, docs: Docs): unknown {
  if (media.example !== undefined) return media.example;
  if (isObj(media.examples)) {
    for (const ex of Object.values(media.examples)) {
      const r = tryDeref<Obj>(ex, base, docs);
      if (r && isObj(r.value) && r.value.value !== undefined) return r.value.value;
    }
  }
  return undefined;
}

/** A Swagger 2.0 non-body parameter's type keywords as a schema. */
function swagger2Schema(p: Obj): Obj {
  const schema: Obj = {};
  for (const k of ["type", "format", "items", "enum", "default", "minimum", "maximum", "pattern"]) {
    if (p[k] !== undefined) schema[k] = p[k];
  }
  return schema;
}

function readParam(raw: unknown, base: string, docs: Docs, swagger2: boolean): Param | undefined {
  const r = tryDeref<Obj>(raw, base, docs);
  if (!r || !isObj(r.value) || !str(r.value.name) || !str(r.value.in)) return undefined;
  const p = r.value;
  const schema = p.schema ?? (swagger2 && p.in !== "body" ? swagger2Schema(p) : undefined);
  let example = p.example ?? p["x-example"];
  if (example === undefined && isObj(p.examples)) {
    const first = Object.values(p.examples)[0];
    const ex = tryDeref<Obj>(first, r.base, docs);
    if (ex && isObj(ex.value)) example = ex.value.value;
  }
  return {
    name: p.name,
    in: p.in,
    required: p.in === "path" ? true : !!p.required,
    description: str(p.description),
    deprecated: !!p.deprecated,
    schema,
    base: r.base,
    example,
  };
}

/** Path-level parameters, overridden by the operation's (same name and location). */
function mergeParams(pathLevel: Param[], opLevel: Param[]): Param[] {
  const key = (p: Param) => `${p.in}:${p.name}`;
  const own = new Set(opLevel.map(key));
  return [...pathLevel.filter((p) => !own.has(key(p))), ...opLevel];
}

const ORDER: Record<string, number> = { path: 0, query: 1, header: 2, cookie: 3, formData: 4, body: 5 };

/** Every operation of the spec, in the order of `paths`. */
export function operations(doc: Obj, base: string, docs: Docs): Operation[] {
  const kind = specKind(doc);
  const swagger2 = kind === "swagger-2.0";
  const out: Operation[] = [];
  const paths = isObj(doc.paths) ? doc.paths : {};
  for (const [path, rawItem] of Object.entries(paths)) {
    const located = tryDeref<Obj>(rawItem, base, docs);
    if (!located || !isObj(located.value)) continue;
    const item = located.value;
    const itemBase = located.base;
    const pathParams = (Array.isArray(item.parameters) ? item.parameters : [])
      .map((p) => readParam(p, itemBase, docs, swagger2)).filter((p): p is Param => !!p);
    for (const method of METHODS) {
      const op = item[method];
      if (!isObj(op)) continue;
      const opParams = (Array.isArray(op.parameters) ? op.parameters : [])
        .map((p) => readParam(p, itemBase, docs, swagger2)).filter((p): p is Param => !!p);
      const all = mergeParams(pathParams, opParams);
      let body: Body | undefined;
      let parameters = all;
      if (swagger2) {
        body = swagger2Body(doc, op, all, itemBase);
        parameters = all.filter((p) => p.in !== "body" && p.in !== "formData");
      } else if (op.requestBody !== undefined) {
        body = openapi3Body(op.requestBody, itemBase, docs);
      }
      parameters.sort((a, b) => (ORDER[a.in] ?? 9) - (ORDER[b.in] ?? 9) || Number(b.required) - Number(a.required));
      const security = (Array.isArray(op.security) ? op.security : Array.isArray(doc.security) ? doc.security : [])
        .flatMap((req: unknown) => isObj(req) ? Object.keys(req) : []);
      out.push({
        key: `${method.toUpperCase()} ${path}`,
        method,
        path,
        operationId: str(op.operationId),
        summary: str(op.summary) ?? str(item.summary),
        description: str(op.description) ?? str(item.description),
        tags: Array.isArray(op.tags) ? op.tags.filter((t: unknown) => typeof t === "string") : [],
        deprecated: !!op.deprecated,
        parameters,
        body,
        responses: responses(doc, op, itemBase, docs, swagger2),
        security: [...new Set(security)] as string[],
        servers: Array.isArray(op.servers) && op.servers.length
          ? op.servers
          : Array.isArray(item.servers) && item.servers.length
          ? item.servers
          : undefined,
      });
    }
  }
  return out;
}

function openapi3Body(raw: unknown, base: string, docs: Docs): Body | undefined {
  const r = tryDeref<Obj>(raw, base, docs);
  if (!r || !isObj(r.value)) return undefined;
  const content = isObj(r.value.content) ? r.value.content : {};
  const types = Object.keys(content);
  const type = preferredType(types);
  const media = type && isObj(content[type]) ? content[type] : {};
  return {
    required: !!r.value.required,
    description: str(r.value.description),
    contentType: type ?? "application/json",
    contentTypes: types,
    schema: media.schema,
    base: r.base,
    example: mediaExample(media, r.base, docs),
  };
}

function swagger2Body(doc: Obj, op: Obj, params: Param[], base: string): Body | undefined {
  const consumes: string[] = Array.isArray(op.consumes) ? op.consumes : Array.isArray(doc.consumes) ? doc.consumes : [];
  const bodyParam = params.find((p) => p.in === "body");
  if (bodyParam) {
    return {
      required: bodyParam.required,
      description: bodyParam.description,
      contentType: preferredType(consumes) ?? "application/json",
      contentTypes: consumes,
      schema: bodyParam.schema,
      base: bodyParam.base,
      example: bodyParam.example,
    };
  }
  const form = params.filter((p) => p.in === "formData");
  if (!form.length) return undefined;
  const multipart = form.some((p) => isObj(p.schema) && p.schema.type === "file") ||
    consumes.includes("multipart/form-data");
  const properties: Obj = {};
  for (const p of form) {
    properties[p.name] = {
      ...(isObj(p.schema) ? p.schema : {}),
      ...(p.description ? { description: p.description } : {}),
    };
    if (properties[p.name].type === "file") properties[p.name] = { type: "string", format: "binary" };
  }
  return {
    required: form.some((p) => p.required),
    contentType: multipart ? "multipart/form-data" : "application/x-www-form-urlencoded",
    contentTypes: consumes,
    schema: { type: "object", properties, required: form.filter((p) => p.required).map((p) => p.name) },
    base,
  };
}

function responses(doc: Obj, op: Obj, base: string, docs: Docs, swagger2: boolean): Response[] {
  const raw = isObj(op.responses) ? op.responses : {};
  const produces: string[] = Array.isArray(op.produces) ? op.produces : Array.isArray(doc.produces) ? doc.produces : [];
  const out: Response[] = [];
  for (const [status, value] of Object.entries(raw)) {
    const r = tryDeref<Obj>(value, base, docs);
    if (!r || !isObj(r.value)) continue;
    const res = r.value;
    const headers = isObj(res.headers) ? Object.keys(res.headers) : [];
    if (swagger2) {
      const examples = isObj(res.examples) ? res.examples : {};
      const type = preferredType(Object.keys(examples)) ?? (res.schema ? preferredType(produces) : undefined);
      out.push({
        status,
        description: str(res.description),
        contentType: type,
        schema: res.schema,
        base: r.base,
        example: type ? examples[type] : undefined,
        headers,
      });
      continue;
    }
    const content = isObj(res.content) ? res.content : {};
    const type = preferredType(Object.keys(content));
    const media = type && isObj(content[type]) ? content[type] : {};
    out.push({
      status,
      description: str(res.description),
      contentType: type,
      schema: media.schema,
      base: r.base,
      example: mediaExample(media, r.base, docs),
      headers,
    });
  }
  // 2xx first, then the others by code, `default` last.
  const rank = (s: string) =>
    s === "default" ? 999 : /^2/.test(s) ? Number(s.replace(/X/gi, "0")) - 1000 : Number(s.replace(/X/gi, "0")) || 998;
  return out.sort((a, b) => rank(a.status) - rank(b.status));
}

/** Tags in the order the spec declares them, then the others as they appear; `default` for untagged operations. */
export function tagOrder(doc: Obj, ops: Operation[]): string[] {
  const declared = (Array.isArray(doc.tags) ? doc.tags : []).map((t: Obj) => t?.name).filter((n: unknown) =>
    typeof n === "string"
  );
  const used = new Set(ops.flatMap((o) => o.tags.length ? o.tags : ["default"]));
  return [...new Set([...declared, ...used])].filter((t) => used.has(t));
}

// ---------------------------------------------------------------------------
// Servers

/** `{scheme}://{host}/v1` with each variable's default. */
export function serverUrl(server: Obj): string {
  let url = String(server.url ?? "/");
  const vars = isObj(server.variables) ? server.variables : {};
  url = url.replace(/\{([^}]+)\}/g, (all, name: string) => {
    const v = vars[name];
    if (isObj(v) && v.default !== undefined) return String(v.default);
    if (isObj(v) && Array.isArray(v.enum) && v.enum.length) return String(v.enum[0]);
    return all;
  });
  return url;
}

/**
 * The base URLs of the spec. Relative ones are resolved against the spec's own
 * URL when it was downloaded; for a file they stay relative (the caller adds a
 * `$BASE_URL` placeholder).
 */
export function servers(doc: Obj, specUrl?: string, override?: Obj[]): string[] {
  let urls: string[];
  if (specKind(doc) === "swagger-2.0") {
    const basePath = str(doc.basePath) ?? "";
    if (str(doc.host)) {
      const schemes: string[] = Array.isArray(doc.schemes) && doc.schemes.length ? doc.schemes : ["https"];
      const scheme = schemes.includes("https") ? "https" : schemes[0];
      urls = [`${scheme}://${doc.host}${basePath}`];
    } else urls = [basePath || "/"];
  } else {
    const list = override ?? (Array.isArray(doc.servers) && doc.servers.length ? doc.servers : [{ url: "/" }]);
    urls = list.filter(isObj).map(serverUrl);
  }
  return urls.map((u) => {
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(u)) return u.replace(/\/+$/, "");
    if (specUrl && /^https?:/i.test(specUrl)) {
      try {
        return new URL(u, specUrl).href.replace(/\/+$/, "");
      } catch {
        return u;
      }
    }
    return u === "/" ? "" : u.replace(/\/+$/, "");
  });
}

// ---------------------------------------------------------------------------
// Example values

export interface ExampleOptions {
  /** `request` leaves out readOnly properties, `response` writeOnly ones. */
  mode: "request" | "response";
  maxDepth?: number;
}

const FORMATS: Record<string, string> = {
  "date-time": "2026-01-01T12:00:00Z",
  date: "2026-01-01",
  time: "12:00:00",
  duration: "P1D",
  email: "user@example.com",
  "idn-email": "user@example.com",
  uuid: "3fa85f64-5717-4562-b3fc-2c963f66afa6",
  uri: "https://example.com",
  url: "https://example.com",
  "uri-reference": "/path",
  hostname: "example.com",
  ipv4: "192.0.2.1",
  ipv6: "2001:db8::1",
  byte: "U3dhZ2dlciByb2Nrcw==",
  binary: "<binary>",
  password: "********",
};

/** The first type of a type list that isn't `null` (OpenAPI 3.1 `type: [string, "null"]`). */
function mainType(s: Obj): string | undefined {
  if (Array.isArray(s.type)) return s.type.find((t: unknown) => t !== "null") ?? s.type[0];
  if (typeof s.type === "string") return s.type;
  if (isObj(s.properties) || s.additionalProperties !== undefined) return "object";
  if (s.items !== undefined) return "array";
  return undefined;
}

function numberExample(s: Obj, integer: boolean): number {
  let n: number | undefined;
  if (typeof s.minimum === "number") n = s.minimum;
  if (typeof s.exclusiveMinimum === "number") n = s.exclusiveMinimum + (integer ? 1 : 0.5);
  else if (s.exclusiveMinimum === true && n !== undefined) n += integer ? 1 : 0.5;
  if (n === undefined && typeof s.maximum === "number" && s.maximum < 0) n = s.maximum;
  n ??= 0;
  if (typeof s.multipleOf === "number" && s.multipleOf > 0) n = Math.ceil(n / s.multipleOf) * s.multipleOf;
  return integer ? Math.round(n) : n;
}

/**
 * An example value for a schema, as Swagger UI would show it: the schema's
 * own `example`/`examples`/`default`/`const`/`enum` first, else a value made
 * from its type and format. `$ref`s are followed; a schema that contains
 * itself stops at the second level (`{}` or `[]`).
 */
export function exampleFor(schema: unknown, base: string, docs: Docs, options: ExampleOptions): unknown {
  return build(schema, base, docs, options, [], 0);
}

function build(schema: unknown, base: string, docs: Docs, o: ExampleOptions, stack: string[], depth: number): unknown {
  if (schema === true || schema === undefined) return undefined;
  const r = tryDeref<Obj>(schema, base, docs);
  if (!r || !isObj(r.value)) return undefined;
  const s = r.value;
  const at = r.base;
  const key = r.key;
  const recursive = key !== undefined && stack.includes(key);
  const nextStack = key ? [...stack, key] : stack;

  if (s.example !== undefined) return s.example;
  if (Array.isArray(s.examples) && s.examples.length) return s.examples[0];
  if (s.const !== undefined) return s.const;
  if (s.default !== undefined) return s.default;
  if (Array.isArray(s.enum) && s.enum.length) return s.enum.find((v: unknown) => v !== null) ?? s.enum[0];

  if (Array.isArray(s.allOf) && s.allOf.length) {
    if (recursive) return {};
    let merged: unknown;
    for (const part of s.allOf) {
      const v = build(part, at, docs, o, nextStack, depth);
      if (isObj(v) && (isObj(merged) || merged === undefined)) merged = { ...(merged as Obj ?? {}), ...v };
      else if (v !== undefined) merged = v;
    }
    // Properties next to allOf belong to the same object.
    if (isObj(s.properties)) {
      const own = build({ ...s, allOf: undefined, type: "object" }, at, docs, o, nextStack, depth);
      if (isObj(own)) merged = { ...(merged as Obj ?? {}), ...own };
    }
    return merged ?? {};
  }
  for (const k of ["oneOf", "anyOf"]) {
    if (Array.isArray(s[k]) && s[k].length) {
      const choice = s[k].find((c: unknown) => !(isObj(c) && c.type === "null")) ?? s[k][0];
      const v = build(choice, at, docs, o, nextStack, depth);
      if (isObj(s.properties) && isObj(v)) {
        const own = build({ ...s, [k]: undefined, type: "object" }, at, docs, o, nextStack, depth);
        return { ...(own as Obj), ...v };
      }
      return v;
    }
  }

  const type = mainType(s);
  const max = o.maxDepth ?? 8;
  switch (type) {
    case "object": {
      if (recursive || depth >= max) return {};
      const out: Obj = {};
      const props = isObj(s.properties) ? Object.entries(s.properties) : [];
      for (const [name, prop] of props.slice(0, 60)) {
        const p = tryDeref<Obj>(prop, at, docs)?.value;
        if (isObj(p) && ((o.mode === "request" && p.readOnly) || (o.mode === "response" && p.writeOnly))) continue;
        const v = build(prop, at, docs, o, nextStack, depth + 1);
        if (v !== undefined) out[name] = v;
      }
      if (!props.length && isObj(s.additionalProperties)) {
        const v = build(s.additionalProperties, at, docs, o, nextStack, depth + 1);
        if (v !== undefined) out.additionalProp1 = v;
      }
      return out;
    }
    case "array": {
      if (recursive || depth >= max) return [];
      const items = Array.isArray(s.prefixItems) ? s.prefixItems : s.items !== undefined ? [s.items] : [];
      return items.map((i: unknown) => build(i, at, docs, o, nextStack, depth + 1)).filter((v: unknown) =>
        v !== undefined
      );
    }
    case "string": {
      if (typeof s.format === "string" && FORMATS[s.format]) return FORMATS[s.format];
      if (typeof s.minLength === "number" && s.minLength > 6) return "s".repeat(Math.min(s.minLength, 64));
      return "string";
    }
    case "integer":
      return numberExample(s, true);
    case "number":
      return numberExample(s, false);
    case "boolean":
      return true;
    case "null":
      return null;
    case "file":
      return "<binary>";
    default:
      return isObj(s.properties) ? build({ ...s, type: "object" }, at, docs, o, stack, depth) : undefined;
  }
}

/** The body to send: the spec's example for it, else one made from the schema. */
export function bodyExample(body: Body, docs: Docs): unknown {
  if (body.example !== undefined) return body.example;
  return exampleFor(body.schema, body.base, docs, { mode: "request" });
}

export function responseExample(res: Response, docs: Docs): unknown {
  if (res.example !== undefined) return res.example;
  if (res.schema === undefined) return undefined;
  return exampleFor(res.schema, res.base, docs, { mode: "response" });
}

export function paramExample(p: Param, docs: Docs): unknown {
  if (p.example !== undefined) return p.example;
  return exampleFor(p.schema, p.base, docs, { mode: "request" });
}

/** An example as text: JSON pretty-printed, form bodies as `a=1&b=2`, text as is. */
export function formatExample(value: unknown, contentType = "application/json"): string {
  if (value === undefined) return "";
  if (typeof value === "string" && !/json/i.test(contentType)) return value;
  if (/x-www-form-urlencoded/i.test(contentType) && isObj(value)) {
    return new URLSearchParams(
      Object.entries(value).map(([k, v]) => [k, typeof v === "string" ? v : JSON.stringify(v)]),
    )
      .toString();
  }
  return JSON.stringify(value, null, 2);
}

// ---------------------------------------------------------------------------
// Describing schemas

/** `string (date-time)`, `array of Pet`, `integer | null`, `Pet`. */
export function typeLabel(schema: unknown, base: string, docs: Docs): string {
  if (schema === undefined) return "any";
  if (isObj(schema) && typeof schema.$ref === "string") {
    const r = tryDeref<Obj>(schema, base, docs);
    const name = refName(schema.$ref);
    if (r && isObj(r.value) && mainType(r.value) === "array") return `${name} (${typeLabel(r.value, r.base, docs)})`;
    return name;
  }
  if (!isObj(schema)) return "any";
  for (const k of ["oneOf", "anyOf"]) {
    if (Array.isArray(schema[k])) return schema[k].map((s: unknown) => typeLabel(s, base, docs)).join(" | ");
  }
  if (Array.isArray(schema.allOf)) {
    const names = schema.allOf.map((s: unknown) => typeLabel(s, base, docs)).filter((n: string) => n !== "object");
    return names.length ? names.join(" & ") : "object";
  }
  const type = mainType(schema) ?? "any";
  const nullable = schema.nullable === true || (Array.isArray(schema.type) && schema.type.includes("null"));
  let label = type;
  if (type === "array") label = `array of ${typeLabel(schema.items, base, docs)}`;
  else if (schema.format) label = `${type} (${schema.format})`;
  if (Array.isArray(schema.enum) && schema.enum.length <= 6) {
    label += `: ${schema.enum.map((v: unknown) => JSON.stringify(v)).join(", ")}`;
  }
  return nullable ? `${label} | null` : label;
}

const oneLine = (s: string | undefined, max = 140) => {
  const t = (s ?? "").replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};

/**
 * A schema as a markdown outline: one line per property with its type,
 * whether it is required and its description, nested objects indented.
 */
export function schemaOutline(
  schema: unknown,
  base: string,
  docs: Docs,
  mode: "request" | "response",
  maxDepth = 3,
): string {
  const lines: string[] = [];
  const walk = (node: unknown, at: string, indent: number, stack: string[]) => {
    const r = tryDeref<Obj>(node, at, docs);
    if (!r || !isObj(r.value)) return;
    const s = r.value;
    const key = r.key;
    if (key && stack.includes(key)) {
      lines.push(`${"  ".repeat(indent)}- _(${refName(r.ref!)}, see above)_`);
      return;
    }
    const next = key ? [...stack, key] : stack;
    const parts: [unknown, string][] = Array.isArray(s.allOf) ? s.allOf.map((p: unknown) => [p, r.base]) : [];
    parts.push([s, r.base]);
    const required = new Set<string>();
    const props: [string, unknown, string][] = [];
    for (const [part, partBase] of parts) {
      const pr = part === s ? r : tryDeref<Obj>(part, partBase, docs);
      if (!pr || !isObj(pr.value)) continue;
      if (Array.isArray(pr.value.required)) pr.value.required.forEach((n: string) => required.add(n));
      if (isObj(pr.value.properties)) {
        for (const [n, p] of Object.entries(pr.value.properties)) props.push([n, p, pr.base]);
      }
    }
    if (!props.length && mainType(s) === "array" && s.items !== undefined && indent < maxDepth) {
      walk(s.items, r.base, indent, next);
      return;
    }
    for (const [name, prop, propBase] of props.slice(0, 40)) {
      const p = tryDeref<Obj>(prop, propBase, docs);
      const v = p && isObj(p.value) ? p.value : {};
      if ((mode === "request" && v.readOnly) || (mode === "response" && v.writeOnly)) continue;
      const flags = [required.has(name) ? "**required**" : "", v.deprecated ? "_deprecated_" : ""].filter(Boolean);
      const desc = oneLine(str(v.description) ?? str(v.title));
      lines.push(
        `${"  ".repeat(indent)}- \`${name}\` ${typeLabel(prop, propBase, docs)}${
          flags.length ? ` ${flags.join(" ")}` : ""
        }${desc ? ` — ${desc}` : ""}`,
      );
      if (indent + 1 < maxDepth) {
        const t = mainType(v);
        const inner = t === "array" ? v.items : v;
        const ir = tryDeref<Obj>(inner, p?.base ?? propBase, docs);
        if (ir && isObj(ir.value) && (isObj(ir.value.properties) || Array.isArray(ir.value.allOf))) {
          walk(inner, p?.base ?? propBase, indent + 1, next);
        }
      }
    }
    if (props.length > 40) lines.push(`${"  ".repeat(indent)}- … ${props.length - 40} more`);
  };
  walk(schema, base, 0, []);
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// URLs and curl

/** The path with its path parameters filled with their example when they have one. */
export function fillPath(op: Operation, docs: Docs): string {
  return op.path.replace(/\{([^}]+)\}/g, (all, name: string) => {
    const p = op.parameters.find((x) => x.in === "path" && x.name === name);
    if (!p) return all;
    const ex = p.example !== undefined ? p.example : exampleFor(p.schema, p.base, docs, { mode: "request" });
    if (ex === undefined || ex === "string" || ex === null || typeof ex === "object") return all;
    return encodeURIComponent(String(ex));
  });
}

/** `?limit=0&status=available` for the required query parameters. */
export function requiredQuery(op: Operation, docs: Docs, extra: [string, string][] = []): string {
  const pairs: [string, string][] = op.parameters.filter((p) => p.in === "query" && p.required).map((p) => {
    const ex = paramExample(p, docs);
    const value = Array.isArray(ex)
      ? ex.join(",")
      : ex === undefined || ex === null
      ? ""
      : typeof ex === "object"
      ? JSON.stringify(ex)
      : String(ex);
    return [p.name, value];
  });
  const all = [...pairs, ...extra];
  if (!all.length) return "";
  return `?${
    all.map(([k, v]) => `${encodeURIComponent(k)}=${v.startsWith("$") ? v : encodeURIComponent(v)}`).join("&")
  }`;
}

export interface Auth {
  headers: string[];
  query: [string, string][];
  cookies: string[];
  user?: string;
}

/** How to send the credentials of the operation's first security scheme, with shell variables for the secrets. */
export function authFor(doc: Obj, op: Operation, base: string, docs: Docs): Auth {
  const auth: Auth = { headers: [], query: [], cookies: [] };
  const schemes = isObj(doc.components?.securitySchemes)
    ? doc.components.securitySchemes
    : isObj(doc.securityDefinitions)
    ? doc.securityDefinitions
    : {};
  const name = op.security.find((n) => schemes[n] !== undefined);
  if (!name) return auth;
  const s = tryDeref<Obj>(schemes[name], base, docs)?.value;
  if (!isObj(s)) return auth;
  const type = String(s.type ?? "");
  const scheme = String(s.scheme ?? "").toLowerCase();
  if (type === "apiKey") {
    const key = String(s.name ?? "api_key");
    if (s.in === "query") auth.query.push([key, "$API_KEY"]);
    else if (s.in === "cookie") auth.cookies.push(`${key}=$API_KEY`);
    else auth.headers.push(`${key}: $API_KEY`);
  } else if ((type === "http" && scheme === "basic") || type === "basic") auth.user = "$USERNAME:$PASSWORD";
  else if (type === "http" || type === "oauth2" || type === "openIdConnect") {
    auth.headers.push(`Authorization: ${type === "http" && scheme !== "bearer" ? s.scheme : "Bearer"} $TOKEN`);
  }
  return auth;
}

/** Single quotes, or double quotes when the text uses one of the `$VARIABLES` above. */
export function shellArg(text: string): string {
  if (/\$[A-Z_]+/.test(text) && !/["`\\]/.test(text)) return `"${text}"`;
  return `'${text.replace(/'/g, `'\\''`)}'`;
}

/** A curl command for the operation, ready to paste in a terminal. */
export function curlCommand(doc: Obj, op: Operation, server: string, base: string, docs: Docs): string {
  const auth = authFor(doc, op, base, docs);
  const prefix = server && /^[a-z]+:\/\//i.test(server) ? server : `$BASE_URL${server}`;
  const url = `${prefix}${fillPath(op, docs)}${requiredQuery(op, docs, auth.query)}`;
  const parts = [`curl -X ${op.method.toUpperCase()} ${shellArg(url)}`];
  const accept = op.responses.find((r) => /^2/.test(r.status) && r.contentType)?.contentType;
  if (accept) parts.push(`-H ${shellArg(`Accept: ${accept}`)}`);
  for (const h of auth.headers) parts.push(`-H ${shellArg(h)}`);
  for (const p of op.parameters.filter((x) => x.in === "header" && x.required)) {
    const ex = paramExample(p, docs);
    parts.push(`-H ${shellArg(`${p.name}: ${ex === undefined ? "" : String(ex)}`)}`);
  }
  if (auth.cookies.length) parts.push(`-b ${shellArg(auth.cookies.join("; "))}`);
  if (auth.user) parts.push(`-u ${shellArg(auth.user)}`);
  if (op.body) {
    const example = bodyExample(op.body, docs);
    if (/multipart\/form-data/i.test(op.body.contentType) && isObj(example)) {
      for (const [k, v] of Object.entries(example)) {
        parts.push(
          `-F ${shellArg(v === "<binary>" ? `${k}=@file` : `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`)}`,
        );
      }
    } else {
      parts.push(`-H ${shellArg(`Content-Type: ${op.body.contentType}`)}`);
      if (example !== undefined) parts.push(`-d ${shellArg(formatExample(example, op.body.contentType))}`);
    }
  }
  return parts.join(" \\\n  ");
}

// ---------------------------------------------------------------------------
// Finding spec files

/** File names that are specs: `openapi.yaml`, `swagger.json`, `petstore.openapi.yml`, `openapi-v2.json`… */
export function isSpecFileName(name: string): boolean {
  return /^(?:.*[._-])?(?:openapi|swagger)(?:[._-].*)?\.(?:ya?ml|json)$/i.test(name) && !/\.lock\./i.test(name);
}

/** Cheap check before parsing: the file starts like a spec. */
export function looksLikeSpec(text: string): boolean {
  const head = text.slice(0, 4096);
  return /(^|\n)\s*["']?(openapi|swagger)["']?\s*:\s*["']?(3\.|2\.0)/.test(head) ||
    /"(openapi|swagger)"\s*:\s*"(3\.|2\.0)/.test(text.slice(0, 65536));
}

export const DEFAULT_FOLDERS =
  "~/Projects, ~/projects, ~/code, ~/Code, ~/src, ~/dev, ~/git, ~/repos, ~/workspace, ~/work";

/** The folders preference: commas, colons or new lines; `~` expanded; duplicates dropped. */
export function parseFolders(pref: string | undefined, home: string): string[] {
  const raw = (pref?.trim() || DEFAULT_FOLDERS).split(/[,\n]/).map((f) => f.trim()).filter(Boolean);
  const expanded = raw.map((f) => f.replace(/^~(?=\/|$)/, home).replace(/\/+$/, "") || "/");
  return [...new Set(expanded)].filter((f) => f.startsWith("/"));
}

export const SKIP_DIRS = new Set([
  "node_modules",
  "vendor",
  "target",
  "dist",
  "build",
  "out",
  "venv",
  ".venv",
  "__pycache__",
  ".git",
  "coverage",
  ".next",
  ".cache",
]);

/** A saved spec URL, checked: http(s) only. */
export function normalizeUrl(text: string): string {
  const t = text.trim();
  let url: URL;
  try {
    url = new URL(/^[a-z]+:\/\//i.test(t) ? t : `https://${t}`);
  } catch {
    throw new Error("That is not a URL: paste the address of an openapi.json or swagger.yaml file");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("Only http and https URLs can be added");
  return url.href;
}

export const tilde = (path: string, home: string) =>
  home && (path === home || path.startsWith(`${home}/`)) ? `~${path.slice(home.length)}` : path;
