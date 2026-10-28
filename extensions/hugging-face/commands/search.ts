import {
  type Action,
  action,
  copy,
  detail,
  type DetailSpec,
  type Icon,
  Icons,
  type Item,
  list,
  meta,
  type Metadata,
  open,
  type Stat,
} from "@backslash/api";
import { getRepo, readme, searchHub } from "../api.ts";
import {
  compact,
  facts,
  gatedLabel,
  humanize,
  type Kind,
  KINDS,
  modelCard,
  pageUrl,
  paramsLabel,
  parseQuery,
  plainTags,
  relativeDate,
  type Repo,
  snippets,
  spaceAppUrl,
} from "../lib.ts";

interface Prefs {
  token?: string;
}

const TOKEN_PAGE = "https://huggingface.co/settings/tokens";

function icon(r: Repo): Icon {
  // A Space's own emoji is its icon on the Hub too.
  if (r.kind === "space" && r.emoji) return r.emoji;
  if (r.kind === "dataset") return { source: Icons.database, tint: KINDS.dataset.tint };
  if (r.kind === "space") return { source: Icons.rocket, tint: KINDS.space.tint };
  return { source: r.gguf ? Icons.box : Icons.cpu, tint: KINDS.model.tint };
}

function stats(r: Repo): Stat[] {
  return [
    ...(r.downloads !== undefined ? [{ label: "Downloads · 30 days", value: compact(r.downloads) }] : []),
    ...(r.likes !== undefined ? [{ label: "Likes", value: compact(r.likes) }] : []),
    ...(r.parameters ? [{ label: "Parameters", value: compact(r.parameters) }] : []),
    ...(r.kind === "space" && r.stage
      ? [{
        label: "Status",
        value: humanize(r.stage.toLowerCase()),
        color: r.stage === "RUNNING" ? "green" as const : "gray" as const,
      }]
      : []),
    ...(r.lastModified && (!r.parameters || r.kind !== "model")
      ? [{ label: "Updated", value: relativeDate(r.lastModified) }]
      : []),
  ];
}

function metadata(r: Repo): Metadata[] {
  const f = facts(r);
  const tags = plainTags(r);
  return [
    meta.tags("Type", [{ text: KINDS[r.kind].title, color: KINDS[r.kind].tint }]),
    ...(r.pipeline ? [meta.text("Task", humanize(r.pipeline), { icon: Icons.sparkle })] : []),
    ...(f.tasks.length ? [meta.tags("Tasks", f.tasks.map(humanize))] : []),
    ...(r.library ? [meta.text("Library", r.library, { icon: Icons.package })] : []),
    ...(r.sdk ? [meta.text("SDK", r.sdk, { icon: Icons.code })] : []),
    ...(r.hardware ? [meta.text("Hardware", r.hardware, { icon: Icons.cpu })] : []),
    ...(r.gguf?.architecture ? [meta.text("Architecture", r.gguf.architecture)] : []),
    ...(r.gguf?.contextLength ? [meta.text("Context", `${compact(r.gguf.contextLength)} tokens`)] : []),
    ...(r.license ? [meta.text("License", r.license, { icon: Icons.shield })] : []),
    ...(r.gated ? [meta.tags("Access", [{ text: gatedLabel(r.gated), color: "orange" }])] : []),
    ...(r.private ? [meta.tags("Visibility", [{ text: "Private", color: "red" }])] : []),
    ...(f.baseModels.length ? [meta.text("Base model", f.baseModels.join(", "))] : []),
    ...(f.languages.length ? [meta.tags("Languages", f.languages)] : []),
    ...(f.datasets.length ? [meta.tags("Datasets", f.datasets)] : []),
    ...(tags.length ? [meta.tags("Tags", tags)] : []),
    meta.separator(),
    ...(r.author ? [meta.person("Author", r.author)] : []),
    ...(r.lastModified
      ? [
        meta.text("Updated", new Date(r.lastModified).toLocaleDateString("en", { dateStyle: "medium" }), {
          icon: Icons.calendar,
        }),
      ]
      : []),
    ...(r.createdAt
      ? [meta.text("Created", new Date(r.createdAt).toLocaleDateString("en", { dateStyle: "medium" }))]
      : []),
    meta.link("Page", pageUrl(r.kind, r.id).replace("https://", ""), pageUrl(r.kind, r.id)),
  ];
}

function actions(r: Repo, prefs: Prefs, withCard: boolean): Action[] {
  const url = pageUrl(r.kind, r.id);
  const app = spaceAppUrl(r);
  const s = snippets(r);
  return [
    ...(withCard
      ? [
        action(
          r.kind === "model" ? "Show Model Card" : r.kind === "dataset" ? "Show Dataset Card" : "Show README",
          () => card(r, prefs),
          { icon: Icons.book },
        ),
      ]
      : []),
    open(url, "Open on Hugging Face"),
    ...(app ? [open(app, "Open App", { icon: Icons.window, shortcut: "<Ctrl>o" })] : []),
    copy(r.id, "Copy ID", { shortcut: "<Ctrl><Shift>c" }),
    ...s.map((x, i) =>
      copy(x.text, `Copy ${x.title}`, {
        icon: Icons.terminal,
        section: "Use",
        ...(i === 0 ? { shortcut: "<Ctrl><Shift>d" } : x.title === "ollama run" ? { shortcut: "<Ctrl><Shift>o" } : {}),
      })
    ),
    copy(url, "Copy URL", { icon: Icons.link, section: "Copy" }),
    ...(prefs.token?.trim()
      ? []
      : [open(TOKEN_PAGE, "Create an Access Token", { icon: Icons.key, section: "Account" })]),
  ];
}

async function card(r: Repo, prefs: Prefs): Promise<DetailSpec> {
  const token = prefs.token?.trim() || undefined;
  const { text, problem } = await readme(r.kind, r.id, token);
  const body = text ? modelCard(text, 120) : `_${problem}_`;
  const main = snippets(r)[r.gguf ? 2 : 0];
  return detail({
    title: r.title ?? r.id,
    stats: stats(r),
    markdown: [body || "_The README is empty._", "", "```", main.text, "```"].join("\n"),
    metadata: metadata(r),
    actions: actions(r, prefs, false),
  });
}

function item(r: Repo, prefs: Prefs, section?: string): Item {
  const sub = r.kind === "space" ? (r.description ?? r.title) : r.kind === "dataset" ? r.description : [
    r.pipeline ? humanize(r.pipeline) : undefined,
    r.library,
    paramsLabel(r.parameters || r.gguf?.total) || undefined,
  ].filter(Boolean).join(" · ");
  const lines = r.kind === "space" && r.title && r.description
    ? [`**${r.title}**`, "", r.description]
    : r.description
    ? [r.description]
    : [];
  const main = snippets(r)[r.gguf ? 2 : 0];
  return {
    id: `${r.kind}:${r.id}`,
    title: r.id,
    subtitle: sub || undefined,
    icon: icon(r),
    section,
    keywords: [r.pipeline ?? "", r.library ?? "", ...(r.title ? [r.title] : [])].filter(Boolean),
    accessories: [
      ...(r.gated ? [{ icon: Icons.lock, tooltip: gatedLabel(r.gated) }] : []),
      ...(r.private ? [{ tag: "Private", color: "red" as const }] : []),
      ...(r.gguf ? [{ tag: "GGUF", color: "orange" as const }] : []),
      ...(r.downloads !== undefined
        ? [{ icon: Icons.download, text: compact(r.downloads), tooltip: "Downloads, last 30 days" }]
        : []),
      ...(r.likes !== undefined ? [{ icon: Icons.heart, text: compact(r.likes), tooltip: "Likes" }] : []),
      ...(r.lastModified ? [{ text: relativeDate(r.lastModified), tooltip: "Last modified" }] : []),
    ],
    detail: {
      stats: stats(r),
      markdown: [...lines, ...(lines.length ? [""] : []), "```", main.text, "```"].join("\n"),
      metadata: metadata(r),
    },
    actions: actions(r, prefs, true),
  };
}

let status = "";

export default list({
  placeholder: "Search models, datasets and Spaces… (add gguf for GGUF models, or paste a URL)",
  filter: {
    options: [
      { value: "model", title: "Models" },
      { value: "dataset", title: "Datasets" },
      { value: "space", title: "Spaces" },
    ],
  },
  empty: { title: "Nothing found", description: "Try fewer words: the Hub matches names.", icon: Icons.search },
  status: () => status,
  async search(input, { filter, preferences, signal }) {
    const prefs = preferences as Prefs;
    const token = prefs.token?.trim() || undefined;
    const kind = (["model", "dataset", "space"].includes(filter ?? "") ? filter : "model") as Kind;
    const q = parseQuery(input, kind);
    const k = q.exact?.kind ?? kind;
    try {
      const [found, exact] = await Promise.all([
        searchHub(k, q, token, signal),
        q.exact ? getRepo(q.exact.kind, q.exact.id, token, signal).catch(() => undefined) : Promise.resolve(undefined),
      ]);
      const rest = exact ? found.filter((r) => r.id !== exact.id) : found;
      const what = KINDS[k].plural.toLowerCase();
      status = q.text
        ? `${rest.length + (exact ? 1 : 0)} ${what}${q.gguf ? " in GGUF" : ""} · most downloaded first`
        : `Trending ${what}${q.gguf ? " in GGUF" : ""}${token ? "" : " · public only"}`;
      return [
        ...(exact ? [item(exact, prefs, "Exact Match")] : []),
        ...rest.map((r) =>
          item(r, prefs, exact ? KINDS[k].plural : q.text ? undefined : `Trending ${KINDS[k].plural}`)
        ),
        ...(q.text
          ? [{
            id: "web",
            title: `Search “${q.text}” on Hugging Face`,
            subtitle: "Full-text search, filters and collections",
            icon: { source: Icons.search, tint: "gray" as const },
            section: "More",
            actions: [
              open(
                `https://huggingface.co/${KINDS[k].api}?search=${encodeURIComponent(q.text)}`,
                "Search on Hugging Face",
              ),
            ],
          }]
          : []),
      ];
    } catch (e) {
      if (signal.aborted) throw e;
      status = "Hugging Face is unreachable";
      return [{
        id: "error",
        title: "Can't reach Hugging Face",
        subtitle: e instanceof Error ? e.message : String(e),
        icon: { source: Icons.wifiOff, tint: "red" },
        actions: [
          open(`https://huggingface.co/${KINDS[k].api}?search=${encodeURIComponent(q.text)}`, "Search on Hugging Face"),
          open(TOKEN_PAGE, "Manage Access Tokens", { icon: Icons.key }),
        ],
      }];
    }
  },
});
