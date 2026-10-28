// Views shared by the commands: endpoint form, query form and result, schema browser.

import {
  type Action,
  action,
  type Context,
  copy,
  detail,
  type DetailSpec,
  field,
  form,
  type FormSpec,
  Icons,
  type Item,
  list,
  meta,
  pop,
  refresh,
  toast,
} from "@backslash/api";
import { lastQuery, loadSchema, rememberQuery, saveEndpoint, send, type Sent } from "./api.ts";
import {
  dataSummary,
  type Endpoint,
  errorsMarkdown,
  fence,
  type Field,
  fieldSDL,
  formatBytes,
  type FullType,
  headerLines,
  hostOf,
  isBuiltin,
  isSecretHeader,
  maskHeader,
  namedType,
  normalizeUrl,
  operationNames,
  operationOf,
  parseHeaders,
  parseVariables,
  requestBody,
  type RootKind,
  rootType,
  type SavedEndpoint,
  type Schema,
  schemaSDL,
  skeleton,
  toCurl,
  typeMap,
  typeSDL,
  typeString,
  variablesTemplate,
} from "./lib.ts";

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

// ---------------------------------------------------------------------------
// Endpoints

export function endpointForm(existing?: SavedEndpoint): FormSpec {
  return form({
    title: existing ? `Edit ${existing.name}` : "Add GraphQL Endpoint",
    submitTitle: existing ? "Save" : "Add Endpoint",
    fields: [
      field.text("name", "Name", { required: true, placeholder: "Countries API", value: existing?.name ?? "" }),
      field.text("url", "URL", {
        required: true,
        placeholder: "https://api.example.com/graphql",
        value: existing?.url ?? "",
      }),
      field.textArea("headers", "Headers", {
        placeholder: "X-Client-Name: backslash\n(no tokens here: use an endpoint slot in Settings)",
        value: existing ? headerLines(existing.headers) : "",
      }),
    ],
    async submit(values) {
      const url = normalizeUrl(String(values.url ?? ""));
      if (!url) throw new Error("Type the endpoint's URL, e.g. https://api.example.com/graphql");
      const headers = parseHeaders(String(values.headers ?? ""));
      const secret = Object.keys(headers).find(isSecretHeader);
      if (secret) {
        throw new Error(
          `${secret} looks like a credential: put it in an endpoint slot in Settings → Extensions → GraphQL Explorer, where it's kept in the keyring`,
        );
      }
      const name = String(values.name ?? "").trim() || hostOf(url);
      await saveEndpoint({ id: existing?.id ?? `saved:${crypto.randomUUID()}`, name, url, headers });
      await toast(existing ? `${name} saved` : `${name} added`, { style: "success" });
      return pop();
    },
  });
}

// ---------------------------------------------------------------------------
// Running queries

export async function queryForm(
  endpoints: Endpoint[],
  initial: { endpointId?: string; query?: string; variables?: string } = {},
): Promise<FormSpec> {
  if (!endpoints.length) {
    throw new Error("Add an endpoint first: GraphQL Explorer → Add Endpoint, or a slot in Settings");
  }
  const chosen = endpoints.find((e) => e.id === initial.endpointId) ?? endpoints[0];
  const last = initial.query === undefined ? await lastQuery(chosen.id) : undefined;
  return form({
    title: `Run GraphQL Query${endpoints.length === 1 ? ` on ${chosen.name}` : ""}`,
    submitTitle: "Run",
    fields: [
      ...(endpoints.length > 1
        ? [
          field.dropdown(
            "endpoint",
            "Endpoint",
            endpoints.map((e) => ({ value: e.id, title: `${e.name} · ${hostOf(e.url)}` })),
            {
              value: chosen.id,
            },
          ),
        ]
        : []),
      field.textArea("query", "Query", {
        required: true,
        placeholder: "query {\n  __typename\n}",
        value: initial.query ?? last?.query ?? "",
      }),
      field.textArea("variables", "Variables (JSON)", {
        placeholder: '{ "id": "42" }',
        value: initial.variables ?? last?.variables ?? "",
      }),
      field.text("operationName", "Operation", { placeholder: "When the document has several operations" }),
    ],
    async submit(values, ctx) {
      const endpoint = endpoints.find((e) => e.id === values.endpoint) ?? chosen;
      const query = String(values.query ?? "");
      const variablesText = String(values.variables ?? "");
      const variables = parseVariables(variablesText);
      const names = operationNames(query);
      let operationName = String(values.operationName ?? "").trim();
      if (!operationName && names.length > 1) {
        throw new Error(`The document has ${names.length} operations (${names.join(", ")}): name the one to run`);
      }
      if (operationName && names.length && !names.includes(operationName)) {
        throw new Error(`No operation named ${operationName} (there is ${names.join(", ")})`);
      }
      if (names.length <= 1) operationName = "";
      await rememberQuery(endpoint.id, { query, variables: variablesText });
      return await run(endpoint, endpoints, query, variablesText, variables, operationName, ctx);
    },
  });
}

async function run(
  endpoint: Endpoint,
  endpoints: Endpoint[],
  query: string,
  variablesText: string,
  variables: Record<string, unknown> | undefined,
  operationName: string,
  ctx: Context,
): Promise<DetailSpec> {
  const body = requestBody(query, variables, operationName || undefined);
  const sent = await send(endpoint, body, ctx.signal);
  return resultView(endpoint, endpoints, query, variablesText, body, sent, ctx);
}

const LIMIT = 40_000;

function resultView(
  endpoint: Endpoint,
  endpoints: Endpoint[],
  query: string,
  variablesText: string,
  body: ReturnType<typeof requestBody>,
  sent: Sent,
  ctx: Context,
): DetailSpec {
  const { response } = sent;
  const errors = response.errors ?? [];
  const data = JSON.stringify(response.data ?? null, null, 2);
  const full = JSON.stringify(response, null, 2);
  const shown = data.length > LIMIT
    ? `${data.slice(0, LIMIT)}\n… (${formatBytes(data.length - LIMIT)} more: copy it)`
    : data;
  const op = operationOf(query);
  const ok = !errors.length && sent.status < 400;
  return detail({
    title: `${op.name ?? capitalizeKind(op.kind)} · ${endpoint.name}`,
    stats: [
      { label: "Status", value: sent.status, color: sent.status < 400 ? "green" : "red" },
      { label: "Time", value: `${sent.ms} ms` },
      { label: "Size", value: formatBytes(sent.bytes) },
      { label: "Errors", value: errors.length, color: errors.length ? "red" : "green" },
    ],
    markdown: [
      ...(errors.length ? [`### ${plural(errors.length, "error")}`, "", errorsMarkdown(errors), ""] : []),
      ...(response.data !== undefined ? ["### Data", "", fence(shown, "json")] : []),
      ...(response.extensions
        ? ["", "### Extensions", "", fence(JSON.stringify(response.extensions, null, 2), "json")]
        : []),
    ].join("\n"),
    status: ok ? dataSummary(response.data) : `${plural(errors.length, "error")} · ${dataSummary(response.data)}`,
    metadata: [
      meta.text("Endpoint", endpoint.name, { icon: Icons.server }),
      meta.text("URL", endpoint.url, { icon: Icons.globe }),
      meta.text("Operation", `${op.kind}${op.name ? ` ${op.name}` : ""}`, { icon: Icons.braces }),
      ...Object.entries(endpoint.headers).map(([k, v]) => meta.text(k, maskHeader(k, v), { icon: Icons.key })),
    ],
    actions: [
      copy(data, "Copy Data JSON"),
      action("Edit Query", () => queryForm(endpoints, { endpointId: endpoint.id, query, variables: variablesText }), {
        icon: Icons.text,
        shortcut: "<Ctrl>e",
      }),
      action(
        "Run Again",
        () => run(endpoint, endpoints, query, variablesText, body.variables, body.operationName ?? "", ctx),
        {
          icon: Icons.refresh,
          shortcut: "<Ctrl>r",
        },
      ),
      copy(full, "Copy Full Response", { section: "Copy" }),
      copy(query, "Copy Query", { section: "Copy", icon: Icons.braces }),
      copy(toCurl(endpoint, body), "Copy as curl", { section: "Copy", icon: Icons.terminal }),
      ...(errors.length ? [copy(errors.map((e) => e.message).join("\n"), "Copy Errors", { section: "Copy" })] : []),
    ],
  });
}

const capitalizeKind = (k: string) => k.charAt(0).toUpperCase() + k.slice(1);

// ---------------------------------------------------------------------------
// Schema browser

const KIND_LOOK: Record<
  string,
  { icon: string; tint: "blue" | "purple" | "orange" | "teal" | "green" | "pink" | "gray"; title: string }
> = {
  OBJECT: { icon: Icons.box, tint: "blue", title: "Object" },
  INTERFACE: { icon: Icons.layers, tint: "purple", title: "Interface" },
  UNION: { icon: Icons.layers, tint: "pink", title: "Union" },
  ENUM: { icon: Icons.tag, tint: "orange", title: "Enum" },
  INPUT_OBJECT: { icon: Icons.arrowRight, tint: "teal", title: "Input" },
  SCALAR: { icon: Icons.dot, tint: "gray", title: "Scalar" },
};

const ROOT_LOOK: Record<RootKind, { icon: string; tint: "green" | "orange" | "purple"; title: string }> = {
  query: { icon: Icons.search, tint: "green", title: "Queries" },
  mutation: { icon: Icons.bolt, tint: "orange", title: "Mutations" },
  subscription: { icon: Icons.bell, tint: "purple", title: "Subscriptions" },
};

function argsMarkdown(f: Field): string[] {
  if (!f.args.length) return [];
  return [
    "| Argument | Type | Default | |",
    "|---|---|---|---|",
    ...f.args.map((a) =>
      `| \`${a.name}\` | \`${typeString(a.type)}\` | ${a.defaultValue != null ? `\`${a.defaultValue}\`` : ""} | ${
        (a.description ?? "").replace(/\s*\n\s*/g, " ").replace(/\|/g, "\\|")
      } |`
    ),
    "",
  ];
}

function typeDetail(t: FullType, schema: Schema, endpoint: Endpoint): DetailSpec {
  return detail({
    title: t.name,
    markdown: [t.description?.trim() ?? "", "", fence(typeSDL(t), "graphql")].join("\n").trim(),
    metadata: [
      meta.tags("Kind", [{ text: KIND_LOOK[t.kind]?.title ?? t.kind, color: KIND_LOOK[t.kind]?.tint }]),
      ...(t.fields ? [meta.text("Fields", String(t.fields.length))] : []),
      ...(t.inputFields ? [meta.text("Fields", String(t.inputFields.length))] : []),
      ...(t.enumValues ? [meta.text("Values", String(t.enumValues.length))] : []),
      ...(t.possibleTypes?.length ? [meta.tags("Types", t.possibleTypes.map((p) => p.name ?? "").slice(0, 10))] : []),
      meta.text("Endpoint", endpoint.name, { icon: Icons.server }),
    ],
    actions: [
      copy(typeSDL(t), "Copy SDL"),
      copy(t.name, "Copy Type Name"),
      copy(schemaSDL(schema), "Copy Whole Schema SDL"),
    ],
  });
}

function fieldItem(
  f: Field,
  kind: RootKind,
  schema: Schema,
  endpoint: Endpoint,
  endpoints: Endpoint[],
): Item {
  const look = ROOT_LOOK[kind];
  const ret = namedType(f.type);
  const retType = typeMap(schema).get(ret.name ?? "");
  const query = skeleton(schema, kind, f);
  const variables = variablesTemplate(schema, f);
  const required = f.args.filter((a) => a.type.kind === "NON_NULL" && a.defaultValue == null).length;
  return {
    id: `${kind}:${f.name}`,
    title: f.name,
    subtitle: f.description?.split("\n")[0]?.slice(0, 100) ?? "",
    icon: { source: look.icon, tint: f.isDeprecated ? "gray" : look.tint },
    section: look.title,
    keywords: [ret.name ?? "", ...f.args.map((a) => a.name)],
    accessories: [
      ...(f.isDeprecated
        ? [{ tag: "deprecated", color: "gray" as const, tooltip: f.deprecationReason ?? undefined }]
        : []),
      ...(f.args.length
        ? [{
          text: `${f.args.length} arg${f.args.length === 1 ? "" : "s"}${required ? ` (${required} required)` : ""}`,
        }]
        : []),
      { tag: typeString(f.type), color: "blue" as const },
    ],
    detail: {
      markdown: [
        fence(fieldSDL(f, ""), "graphql"),
        "",
        ...argsMarkdown(f),
        "**Skeleton**",
        "",
        fence(query, "graphql"),
        ...(variables ? ["", fence(variables, "json")] : []),
      ].join("\n"),
      metadata: [
        meta.text("Returns", typeString(f.type), { icon: Icons.arrowRight }),
        ...(retType ? [meta.text("Kind", KIND_LOOK[retType.kind]?.title ?? retType.kind)] : []),
        ...(f.isDeprecated ? [meta.text("Deprecated", f.deprecationReason ?? "Yes", { color: "orange" })] : []),
      ],
    },
    actions: [
      copy(query, "Copy Query Skeleton"),
      action("Run This Query…", () => queryForm(endpoints, { endpointId: endpoint.id, query, variables }), {
        icon: Icons.play,
      }),
      ...(variables ? [copy(variables, "Copy Variables", { icon: Icons.braces, shortcut: "<Ctrl><Shift>v" })] : []),
      copy(fieldSDL(f, ""), "Copy Field SDL", { icon: Icons.code, shortcut: "<Ctrl><Shift>c" }),
      ...(retType && !["SCALAR"].includes(retType.kind)
        ? [
          action(`Show ${retType.name}`, () => typeDetail(retType, schema, endpoint), {
            icon: Icons.arrowRight,
            shortcut: "<Ctrl>t",
          }),
        ]
        : []),
      copy(skeleton(schema, kind, f, 1), "Copy Shallow Skeleton", { section: "Copy" }),
      copy(skeleton(schema, kind, f, 3), "Copy Deep Skeleton", { section: "Copy" }),
    ],
  };
}

function typeItem(t: FullType, schema: Schema, endpoint: Endpoint): Item {
  const look = KIND_LOOK[t.kind] ?? KIND_LOOK.SCALAR;
  const count = t.fields?.length ?? t.inputFields?.length ?? t.enumValues?.length ?? t.possibleTypes?.length;
  return {
    id: `type:${t.name}`,
    title: t.name,
    subtitle: t.description?.split("\n")[0]?.slice(0, 100) ?? "",
    icon: { source: look.icon, tint: look.tint },
    section: "Types",
    keywords: [look.title, ...(t.fields ?? []).map((f) => f.name).slice(0, 30)],
    accessories: [
      ...(count !== undefined
        ? [{ text: plural(count, t.kind === "ENUM" ? "value" : t.kind === "UNION" ? "type" : "field") }]
        : []),
      { tag: look.title, color: look.tint },
    ],
    detail: { markdown: fence(typeSDL(t), "graphql") },
    actions: [
      copy(typeSDL(t), "Copy SDL"),
      action("Show Type", () => typeDetail(t, schema, endpoint), { icon: Icons.eye }),
      copy(t.name, "Copy Type Name", { section: "Copy" }),
    ],
  };
}

export function schemaView(endpoint: Endpoint, endpoints: Endpoint[]) {
  let total = "";
  return list({
    title: endpoint.name,
    placeholder: `Search ${endpoint.name}'s queries, mutations and types…`,
    filter: {
      options: [
        { value: "all", title: "All" },
        { value: "query", title: "Queries" },
        { value: "mutation", title: "Mutations" },
        { value: "types", title: "Types" },
      ],
    },
    empty: { title: "Nothing here", description: "This schema has none of these", icon: Icons.braces },
    status: (items) => total || plural(items.length, "item"),
    actions: [
      action("Refresh Schema", async ({ signal }) => {
        await loadSchema(endpoint, signal, true);
        return refresh();
      }, { icon: Icons.refresh, shortcut: "<Ctrl>r" }),
      action("Run a Query…", () => queryForm(endpoints, { endpointId: endpoint.id }), { icon: Icons.play }),
    ],
    async items({ signal, filter }) {
      const schema = await loadSchema(endpoint, signal);
      const items: Item[] = [];
      const kinds: RootKind[] = ["query", "mutation", "subscription"];
      const counts: string[] = [];
      for (const kind of kinds) {
        const root = rootType(schema, kind);
        const fields = (root?.fields ?? []).filter((f) => !isBuiltin(f.name));
        if (fields.length) {
          counts.push(
            fields.length === 1 ? `1 ${kind}` : `${fields.length} ${kind === "query" ? "queries" : `${kind}s`}`,
          );
        }
        if (filter && filter !== "all" && filter !== kind) continue;
        items.push(...fields.map((f) => fieldItem(f, kind, schema, endpoint, endpoints)));
      }
      const roots = new Set(kinds.map((k) => rootType(schema, k)?.name));
      const types = schema.types.filter((t) => t.name && !isBuiltin(t.name) && !roots.has(t.name))
        .sort((a, b) => a.name.localeCompare(b.name));
      counts.push(plural(types.length, "type"));
      total = `${counts.join(" · ")} · ${hostOf(endpoint.url)}`;
      if (!filter || filter === "all" || filter === "types") {
        items.push(...types.map((t) => typeItem(t, schema, endpoint)));
      }
      return items;
    },
  });
}

export function endpointActions(e: Endpoint, endpoints: Endpoint[], extra: Action[] = []): Action[] {
  return [
    action("Browse Schema", () => schemaView(e, endpoints), { icon: Icons.braces }),
    action("Run Query…", () => queryForm(endpoints, { endpointId: e.id }), { icon: Icons.play }),
    action("Show Schema SDL", async ({ signal }) => {
      const sdl = schemaSDL(await loadSchema(e, signal));
      return detail({
        title: `${e.name} schema`,
        markdown: fence(sdl.slice(0, 60_000), "graphql"),
        actions: [copy(sdl, "Copy SDL")],
      });
    }, { icon: Icons.code, shortcut: "<Ctrl><Shift>s" }),
    copy(e.url, "Copy URL", { section: "Copy", icon: Icons.link }),
    ...extra,
  ];
}
