// Endpoint rows and their detail, shared by both commands.

import { type Action, action, copy, detail, Icons, type Item, list, type ListSpec, meta, open } from "@backslash/api";
import {
  bodyExample,
  curlCommand,
  formatExample,
  METHOD_COLORS,
  type Operation,
  operations,
  paramExample,
  responseExample,
  schemaOutline,
  servers,
  tagOrder,
  tilde,
  typeLabel,
} from "./lib.ts";
import { HOME, loadSpec, type Source, type Spec } from "./specs.ts";

const fence = (text: string, lang = "") => {
  const longest = Math.max(2, ...(text.match(/`+/g) ?? []).map((t) => t.length));
  const f = "`".repeat(longest + 1);
  return `${f}${lang}\n${text}\n${f}`;
};

const cut = (text: string, max: number) => text.length > max ? `${text.slice(0, max)}\n…` : text;

export const where = (s: Source) => s.path ? tilde(s.path, HOME) : s.url ?? s.uri;

/** Everything about an operation, as markdown: parameters, body, responses. */
export function operationMarkdown(spec: Spec, op: Operation, full: boolean): string {
  const { docs } = spec;
  const out: string[] = [`## ${op.method.toUpperCase()} \`${op.path}\``];
  if (op.summary) out.push(`**${op.summary}**`);
  if (op.deprecated) out.push("> Deprecated");
  if (op.description && op.description !== op.summary) {
    out.push(full ? op.description : cut(op.description, 600));
  }
  if (op.parameters.length) {
    out.push("### Parameters");
    out.push(
      op.parameters.map((p) => {
        const ex = paramExample(p, docs);
        const exText = ex !== undefined && ex !== "string"
          ? ` · e.g. \`${typeof ex === "object" ? JSON.stringify(ex) : String(ex)}\``
          : "";
        return `- \`${p.name}\` _${p.in}_ ${typeLabel(p.schema, p.base, docs)}${p.required ? " **required**" : ""}${
          p.deprecated ? " _deprecated_" : ""
        }${p.description ? ` — ${p.description.replace(/\s+/g, " ")}` : ""}${exText}`;
      }).join("\n"),
    );
  }
  if (op.body) {
    const b = op.body;
    out.push(`### Request body${b.required ? " (required)" : ""}`);
    out.push(
      `\`${b.contentType}\`${
        b.contentTypes.length > 1 ? ` (also ${b.contentTypes.filter((t) => t !== b.contentType).join(", ")})` : ""
      }${b.description ? ` — ${b.description}` : ""}`,
    );
    if (b.schema !== undefined) {
      out.push(`Type: ${typeLabel(b.schema, b.base, docs)}`);
      const outline = schemaOutline(b.schema, b.base, docs, "request", full ? 4 : 2);
      if (outline) out.push(outline);
    }
    const ex = formatExample(bodyExample(b, docs), b.contentType);
    if (ex) out.push(fence(full ? ex : cut(ex, 1500), /json/i.test(b.contentType) ? "json" : ""));
  }
  if (op.responses.length) {
    out.push("### Responses");
    for (const r of op.responses) {
      const desc = r.description?.replace(/\s+/g, " ");
      out.push([`**${r.status}**`, desc, r.contentType ? `\`${r.contentType}\`` : ""].filter(Boolean).join(" · "));
      if (r.schema !== undefined) {
        out.push(`Type: ${typeLabel(r.schema, r.base, docs)}`);
        if (full) {
          const outline = schemaOutline(r.schema, r.base, docs, "response", 3);
          if (outline) out.push(outline);
        }
      }
      if (full || /^2/.test(r.status)) {
        const ex = formatExample(responseExample(r, docs), r.contentType);
        if (ex) out.push(fence(full ? ex : cut(ex, 1200), "json"));
      }
      if (full && r.headers.length) out.push(`Headers: ${r.headers.map((h) => `\`${h}\``).join(", ")}`);
    }
  }
  return out.join("\n\n");
}

function operationActions(spec: Spec, op: Operation, server: string): Action[] {
  const { doc, docs, source } = spec;
  const curl = curlCommand(doc, op, server, source.uri, docs);
  const body = op.body ? formatExample(bodyExample(op.body, docs), op.body.contentType) : "";
  const ok = op.responses.find((r) => /^2/.test(r.status) && (r.schema !== undefined || r.example !== undefined));
  const response = ok ? formatExample(responseExample(ok, docs), ok.contentType) : "";
  const fullUrl = server && /^[a-z]+:\/\//i.test(server) ? `${server}${op.path}` : undefined;
  return [
    copy(curl, "Copy curl Command", { icon: Icons.terminal }),
    copy(op.path, "Copy Path", { icon: Icons.link }),
    ...(body ? [copy(body, "Copy Example Body", { icon: Icons.braces, shortcut: "<Ctrl>b" })] : []),
    action("Show Full Details", () =>
      detail({
        title: op.key,
        markdown: operationMarkdown(spec, op, true),
        metadata: operationMeta(spec, op, server),
        actions: [
          copy(curl, "Copy curl Command", { icon: Icons.terminal }),
          copy(op.path, "Copy Path", { icon: Icons.link }),
          ...(body ? [copy(body, "Copy Example Body", { icon: Icons.braces, shortcut: "<Ctrl>b" })] : []),
          ...(response ? [copy(response, "Copy Example Response", { icon: Icons.braces })] : []),
        ],
      }), { icon: Icons.eye, shortcut: "<Ctrl>d" }),
    ...(response ? [copy(response, "Copy Example Response", { icon: Icons.braces, section: "Copy" })] : []),
    ...(fullUrl ? [copy(fullUrl, "Copy Full URL", { section: "Copy", shortcut: "<Ctrl><Shift>c" })] : []),
    ...(op.operationId ? [copy(op.operationId, "Copy Operation ID", { section: "Copy" })] : []),
    copy(op.key, "Copy Method and Path", { section: "Copy" }),
    ...(source.path
      ? [open(source.path, "Open Spec File", { icon: Icons.file, shortcut: "<Ctrl>o", section: "Spec" })]
      : source.url
      ? [open(source.url, "Open Spec URL", { shortcut: "<Ctrl>o", section: "Spec" })]
      : []),
  ];
}

function operationMeta(spec: Spec, op: Operation, server: string) {
  return [
    meta.tags("Method", [{ text: op.method.toUpperCase(), color: METHOD_COLORS[op.method] }]),
    meta.text("Path", op.path, { icon: Icons.link }),
    ...(op.operationId ? [meta.text("Operation ID", op.operationId, { icon: Icons.hash })] : []),
    ...(op.tags.length ? [meta.tags("Tags", op.tags)] : []),
    ...(server ? [meta.text("Server", server, { icon: Icons.server })] : []),
    ...(op.security.length ? [meta.tags("Auth", op.security)] : []),
    meta.separator(),
    meta.text("Spec", where(spec.source), { icon: Icons.file }),
  ];
}

export function operationItem(spec: Spec, op: Operation, section: string, extraKeywords: string[] = []): Item {
  const server = servers(spec.doc, spec.specUrl, op.servers)[0] ?? "";
  const statuses = op.responses.map((r) => r.status);
  return {
    id: `${spec.source.uri} ${op.key}`,
    title: op.path,
    subtitle: op.summary ?? op.operationId,
    section,
    icon: { source: op.deprecated ? Icons.canceled : Icons.dot, tint: METHOD_COLORS[op.method] },
    keywords: [op.method, op.operationId ?? "", ...op.tags, ...extraKeywords].filter(Boolean),
    accessories: [
      ...(op.deprecated ? [{ tag: "deprecated", color: "gray" as const }] : []),
      ...(op.security.length ? [{ icon: Icons.lock, tooltip: `Auth: ${op.security.join(", ")}` }] : []),
      { tag: op.method.toUpperCase(), color: METHOD_COLORS[op.method] },
    ],
    detail: {
      markdown: operationMarkdown(spec, op, false),
      metadata: [
        ...operationMeta(spec, op, server),
        ...(statuses.length
          ? [
            meta.tags(
              "Responses",
              statuses.map((s) => ({
                text: s,
                color: /^2/.test(s) ? "green" as const : /^[45]/.test(s) ? "red" as const : undefined,
              })),
            ),
          ]
          : []),
      ],
    },
    actions: operationActions(spec, op, server),
  };
}

/** The operations of a spec, grouped by tag. */
export function operationItems(spec: Spec, sectionPrefix = ""): Item[] {
  const ops = operations(spec.doc, spec.source.uri, spec.docs);
  const order = tagOrder(spec.doc, ops);
  const items: Item[] = [];
  for (const tag of order) {
    for (const op of ops.filter((o) => (o.tags.length ? o.tags[0] : "default") === tag)) {
      items.push(operationItem(spec, op, `${sectionPrefix}${tag}`));
    }
  }
  return items;
}

export function endpointsView(source: Source, title: string): ListSpec {
  return list({
    title,
    placeholder: `Filter ${title} endpoints by path, summary, method or tag…`,
    empty: { title: "No endpoint in this spec", description: "Its paths object is empty", icon: Icons.link },
    status: (items) => `${items.length} endpoint${items.length === 1 ? "" : "s"}`,
    async items({ signal }) {
      const spec = await loadSpec(source, signal);
      return operationItems(spec);
    },
  });
}
