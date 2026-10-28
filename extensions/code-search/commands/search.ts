import { type Action, copy, Icons, type Item, list, meta, open, storage } from "@backslash/api";
import { AuthError, searchGrepApp, searchSourcegraph } from "../api.ts";
import {
  compactNumber,
  describeQuery,
  fileUrl,
  firstMatch,
  grepAppWebUrl,
  type Hit,
  languageOf,
  parseQuery,
  type Query,
  rangeUrl,
  repoUrl,
  type Results,
  snippetMarkdown,
  snippetText,
  sourcegraphFileUrl,
  sourcegraphWebUrl,
  summary,
} from "../lib.ts";

const RECENT = "recent";
const MIN_LENGTH = 3;

let lastSummary = "";

const SYNTAX = [
  "## Search public code",
  "",
  "Type what you're looking for; add filters anywhere:",
  "",
  "| Filter | Example |",
  "|---|---|",
  "| `lang:` | `lang:rust`, `lang:ts` |",
  "| `repo:` | `repo:denoland/deno`, `repo:facebook` (owner) |",
  "| `path:` | `path:src/` |",
  "| `case:yes` | case-sensitive |",
  "| `/…/` | a regular expression: `/fn \\w+_test/` |",
  '| `"…"` | an exact phrase with spaces |',
  "",
  "Tab switches between **grep.app** (GitHub, fast) and **Sourcegraph** (GitHub, GitLab, permalinks).",
].join("\n");

async function remember(text: string) {
  const list = ((await storage.get(RECENT).catch(() => undefined)) as string[] | undefined) ?? [];
  await storage.set(RECENT, [text, ...list.filter((t) => t !== text)].slice(0, 8)).catch(() => {});
}

function hitItem(h: Hit, q: Query): Item {
  const line = firstMatch(h);
  const url = fileUrl(h);
  const permalink = h.commit ? rangeUrl(h) : undefined;
  const lang = languageOf(h);
  const name = h.path.split("/").pop() ?? h.path;
  const forge = h.host === "github.com" ? "GitHub" : h.host || "Sourcegraph";
  const actions: Action[] = [
    open(url, `Open on ${forge}${line ? ` at Line ${line}` : ""}`),
    copy(snippetText(h), "Copy Snippet", { icon: Icons.code }),
    copy(permalink ?? rangeUrl(h), permalink ? "Copy Permalink" : `Copy ${forge} Link`, {
      icon: Icons.link,
      shortcut: "<Ctrl><Shift>c",
    }),
    open(repoUrl(h), "Open Repository", { icon: Icons.repository, shortcut: "<Ctrl>o" }),
    copy(h.path, "Copy File Path", { section: "Copy" }),
    copy(`${h.repo}`, "Copy Repository Name", { section: "Copy" }),
    ...(h.host === "github.com"
      ? [
        copy(`git clone https://github.com/${h.repo}.git`, "Copy Clone Command", {
          icon: Icons.terminal,
          section: "Copy",
        }),
      ]
      : []),
    open(sourcegraphFileUrl(h, line), "Open on Sourcegraph", { section: "Links", icon: Icons.globe }),
    open(
      h.engine === "grep.app"
        ? grepAppWebUrl({ ...q, repos: [h.repo] })
        : sourcegraphWebUrl({ ...q, repos: [`${h.host}/${h.repo}`] }),
      "Search This Repository on the Web",
      { section: "Links", icon: Icons.search },
    ),
  ];
  return {
    id: `${h.engine}:${h.repo}/${h.path}`,
    title: h.path,
    subtitle: h.repo,
    icon: { source: Icons.code, tint: "blue" },
    keywords: [name, lang, h.repo.split("/")[0]],
    accessories: [
      ...(lang ? [{ text: lang }] : []),
      ...(h.stars ? [{ text: `★ ${compactNumber(h.stars)}`, tooltip: "Repository stars" }] : []),
      ...(line ? [{ tag: `L${line}`, tooltip: "First match" }] : []),
      {
        tag: `${h.matches}`,
        color: "blue" as const,
        tooltip: `${h.matches} match${h.matches === 1 ? "" : "es"} in this file`,
      },
    ],
    detail: {
      markdown: [`**${name}** · ${h.repo}`, "", h.lines.length ? snippetMarkdown(h) : "_Only the file name matches._"]
        .join("\n"),
      metadata: [
        meta.text("Repository", h.repo, { icon: Icons.repository }),
        meta.text("Path", h.path, { icon: Icons.file }),
        meta.text(h.commit ? "Commit" : "Branch", h.commit ? h.commit.slice(0, 12) : h.ref, {
          icon: h.commit ? Icons.commit : Icons.branch,
        }),
        ...(lang ? [meta.text("Language", lang)] : []),
        meta.text("Matches", String(h.matches)),
        meta.separator(),
        meta.link(forge, `${h.host || "sourcegraph.com"}/${h.repo}`, url),
      ],
    },
    actions,
  };
}

function hintItems(recent: string[]): Item[] {
  const examples = [
    ["useEffectEvent lang:ts", "A function name, in TypeScript"],
    ["/fn \\w+_test\\(/ lang:rust", "A regular expression"],
    ['"Deno.serve(" repo:denoland/deno', "An exact phrase in one repository"],
    ["MAX_CONNECTIONS path:config case:yes", "A constant in config files"],
  ];
  return [
    ...recent.map((r) => ({ query: r, title: "Recent search", section: "Recent", icon: Icons.history })),
    ...examples.map(([query, title]) => ({ query, title, section: "Try", icon: Icons.search })),
  ].map((e) => ({
    id: `hint:${e.section}:${e.query}`,
    title: e.query,
    subtitle: e.title,
    icon: { source: e.icon, tint: "gray" as const },
    section: e.section,
    detail: { markdown: SYNTAX },
    actions: [copy(e.query, "Copy Query")],
  }));
}

export default list({
  placeholder: "Search public code: useState lang:ts repo:facebook/react",
  filter: {
    options: [{ value: "grep", title: "grep.app" }, { value: "sourcegraph", title: "Sourcegraph" }],
    default: "grep",
  },
  empty: {
    title: "No code found",
    description: "Loosen the filters, or try the other engine with Tab",
    icon: Icons.code,
  },
  status: (items) => {
    if (!items.length || items[0].id?.startsWith("hint:")) return "Public code on GitHub · grep.app or Sourcegraph";
    if (items[0].id === "problem:auth") return "Sourcegraph needs a token";
    return lastSummary || `${items.length} files`;
  },
  async search(text, { signal, filter, preferences }) {
    const q = parseQuery(text);
    if (q.pattern.trim().length < MIN_LENGTH) {
      const recent = ((await storage.get(RECENT).catch(() => undefined)) as string[] | undefined) ?? [];
      return hintItems(recent);
    }
    const engine = filter === "sourcegraph" ? "Sourcegraph" : "grep.app";
    let results: Results;
    try {
      results = engine === "Sourcegraph"
        ? await searchSourcegraph(q, String(preferences.sourcegraphToken ?? "").trim(), signal)
        : await searchGrepApp(q, signal);
    } catch (e) {
      if (!(e instanceof AuthError)) throw e;
      return [{
        id: "problem:auth",
        title: e.message,
        subtitle: "Sourcegraph → Settings → Access tokens; or use grep.app (Tab)",
        icon: { source: Icons.key, tint: "orange" },
        actions: [
          open("https://sourcegraph.com/user/settings/tokens", "Create Access Token", { icon: Icons.key }),
          open(sourcegraphWebUrl(q), "Search on sourcegraph.com"),
        ],
      }];
    }
    lastSummary = [summary(results) || `${results.hits.length} files`, engine].join(" · ");
    if (results.hits.length) await remember(text.trim());
    const notes: Item[] = results.notes.map((n, i) => ({
      id: `problem:note:${i}`,
      title: n,
      subtitle: engine,
      icon: { source: Icons.info, tint: "orange" },
      actions: [open(engine === "grep.app" ? grepAppWebUrl(q) : sourcegraphWebUrl(q), `Open on ${engine}`)],
    }));
    const section = `${describeQuery(q)}${
      results.total !== undefined ? ` · ${compactNumber(results.total)} files` : ""
    }`;
    return [
      ...notes,
      ...results.hits.map((h) => ({ ...hitItem(h, q), section })),
      ...(results.hits.length
        ? [{
          id: "more",
          title: `See all results on ${engine}`,
          subtitle: results.repos.slice(0, 3).map((r) => `${r.name} (${compactNumber(r.count)})`).join(", "),
          icon: { source: Icons.external, tint: "gray" as const },
          section: "More",
          actions: [open(engine === "grep.app" ? grepAppWebUrl(q) : sourcegraphWebUrl(q), `Open on ${engine}`)],
        }]
        : []),
    ];
  },
});
