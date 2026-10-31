// Views both commands open: a search of an index or pattern, its mapping, the nodes.

import {
  action,
  copy,
  detail,
  type DetailSpec,
  Icons,
  type Item,
  list,
  type ListSpec,
  meta,
  submenu,
} from "@backslash/api";
import { type Config, curlCommand, mapping, nodes, RequestError, search, SetupError, setupItem } from "./api.ts";
import {
  flattenMapping,
  type Hit,
  hitFields,
  hitTime,
  hitTitle,
  mappingMarkdown,
  prettyJson,
  totalText,
  when,
} from "./lib.ts";

const fence = (lang: string, text: string) => `\`\`\`${lang}\n${text.replace(/```/g, "ʼʼʼ")}\n\`\`\``;

function hitItem(c: Config, target: string, hit: Hit): Item {
  const time = hitTime(hit);
  const fields = hitFields(hit);
  const json = JSON.stringify(hit._source ?? {}, null, 2);
  return {
    id: `${hit._index}/${hit._id}`,
    title: hitTitle(hit),
    subtitle: target.includes("*") || target.includes(",") ? hit._index : undefined,
    icon: { source: Icons.file, tint: "blue" },
    keywords: [hit._id, hit._index],
    accessories: [
      ...(typeof hit._score === "number" ? [{ text: hit._score.toFixed(1), tooltip: "Score" }] : []),
      ...(time !== undefined ? [{ text: when(time), tooltip: new Date(time).toLocaleString("en-GB") }] : []),
    ],
    detail: {
      markdown: fence("json", prettyJson(hit._source ?? {})),
      metadata: [
        meta.text("Index", hit._index, { icon: Icons.database }),
        meta.text("ID", hit._id, { icon: Icons.hash }),
        ...(time !== undefined
          ? [meta.text("Time", new Date(time).toLocaleString("en-GB"), { icon: Icons.clock })]
          : []),
      ],
    },
    actions: [
      copy(json, "Copy Document JSON"),
      copy(hit._id, "Copy ID", { shortcut: "<Ctrl>period" }),
      ...(fields.length
        ? [submenu("Copy Field", fields.map((f) => copy(f.value, `${f.key}: ${f.value.slice(0, 50)}`)), {
          icon: Icons.copy,
          shortcut: "<Ctrl><Shift>c",
        })]
        : []),
      copy(curlCommand(c, `/${hit._index}/_doc/${encodeURIComponent(hit._id)}?pretty`), "Copy curl Command", {
        icon: Icons.terminal,
        section: "Copy",
      }),
    ],
  };
}

function messageItem(title: string, description: string, tint: "orange" | "red" = "orange"): Item {
  return {
    id: "message",
    title,
    icon: { source: Icons.alert, tint },
    detail: { markdown: description },
  };
}

const QUERY_HELP = [
  "Lucene query string syntax:",
  "",
  "- `error timeout`: both words",
  "- `status:500`, `level:(error OR warn)`",
  "- `path:/api/*`, `user.name:ad*`",
  "- `duration:>1000`, `@timestamp:[now-1h TO now]`",
  '- `NOT status:200`, `"exact phrase"`',
].join("\n");

/** Documents of an index, alias or pattern: newest first, or matching a Lucene query as you type. */
export function searchView(c: Config, target: string): ListSpec {
  let status = "";
  return list({
    title: target,
    placeholder: `Search ${target}: status:500 AND path:/api*…`,
    empty: { title: "No documents match", description: "Try fewer words, or a wildcard: user:ad*", icon: Icons.search },
    status: () => status,
    async search(query, { signal }) {
      try {
        const res = await search(c, target, query, signal);
        status = `${totalText(res.hits.total)}${res.took !== undefined ? ` · ${res.took} ms` : ""}${
          res.hits.hits.length < (typeof res.hits.total === "number" ? res.hits.total : res.hits.total?.value ?? 0)
            ? ` · first ${res.hits.hits.length}`
            : ""
        }`;
        return res.hits.hits.map((h) => hitItem(c, target, h));
      } catch (e) {
        status = "";
        if (e instanceof SetupError) return [setupItem(e)];
        if (e instanceof RequestError) {
          return [
            e.status === 404
              ? messageItem(
                `No index matches ${target}`,
                `${e.message}\n\nCheck the name, or use a pattern like \`logs-*\`.`,
              )
              : messageItem(
                `The query was refused: ${e.message.slice(0, 120)}`,
                `${fence("", e.message)}\n\n${QUERY_HELP}`,
                "red",
              ),
          ];
        }
        throw e;
      }
    },
  });
}

export async function mappingView(c: Config, index: string): Promise<DetailSpec> {
  const fields = flattenMapping(await mapping(c, index));
  const types = new Map<string, number>();
  for (const f of fields) types.set(f.type, (types.get(f.type) ?? 0) + 1);
  return detail({
    title: `${index} · mapping`,
    markdown: mappingMarkdown(index, fields),
    metadata: [
      meta.text("Fields", String(fields.length), { icon: Icons.braces }),
      meta.tags("Types", [...types].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([t, n]) => `${t} ${n}`)),
    ],
    actions: [
      copy(fields.map((f) => f.path).join("\n"), "Copy Field Names"),
      copy(curlCommand(c, `/${index}/_mapping?pretty`), "Copy curl Command", { icon: Icons.terminal }),
    ],
  });
}

export async function nodesView(c: Config): Promise<DetailSpec> {
  const rows = await nodes(c);
  const cell = (v: string | undefined) => (v ?? "").replace(/\|/g, "\\|") || "–";
  return detail({
    title: "Nodes",
    markdown: [
      "| Node | Roles | Heap | RAM | CPU | Load | Disk | Up |",
      "| --- | --- | --- | --- | --- | --- | --- | --- |",
      ...rows.map((n) =>
        `| ${n.master === "*" ? "★ " : ""}${cell(n.name)} | ${cell(n["node.role"])} | ${cell(n["heap.percent"])}% | ${
          cell(n["ram.percent"])
        }% | ${cell(n.cpu)}% | ${cell(n.load_1m)} | ${cell(n["disk.used_percent"])}% | ${cell(n.uptime)} |`
      ),
      "",
      "_★ elected master. Roles: m master, d data, h hot, w warm, c cold, i ingest, l ml, r remote._",
    ].join("\n"),
    metadata: rows.slice(0, 8).map((n) => meta.text(n.name ?? "?", `${n.ip ?? ""} · ${n.version ?? ""}`)),
    actions: [action("Reload", () => nodesView(c), { icon: Icons.refresh, shortcut: "<Ctrl>r" })],
  });
}
