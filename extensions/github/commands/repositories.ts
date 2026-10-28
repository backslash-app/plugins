import { action, type Context, copy, detail, Icons, type Item, list, meta, open } from "@backslash/api";
import { ago, compact, github, languageColor, readme, token } from "../api.ts";

interface Repo {
  full_name: string;
  name: string;
  description: string | null;
  html_url: string;
  clone_url: string;
  ssh_url: string;
  stargazers_count: number;
  forks_count: number;
  open_issues_count: number;
  language: string | null;
  topics?: string[];
  license?: { spdx_id: string } | null;
  default_branch: string;
  pushed_at: string;
  updated_at: string;
  archived?: boolean;
  private?: boolean;
  fork?: boolean;
  owner: { login: string; avatar_url: string };
}

function item(r: Repo, t: string | undefined, section?: string): Item {
  return {
    id: r.full_name,
    title: r.full_name,
    subtitle: r.description ?? undefined,
    icon: r.owner.avatar_url,
    section,
    keywords: [r.language ?? "", ...(r.topics ?? [])],
    accessories: [
      ...(r.private ? [{ icon: Icons.lock, tooltip: "Private" }] : []),
      ...(r.archived ? [{ tag: "Archived", color: "gray" as const }] : []),
      ...(r.language ? [{ icon: { source: Icons.dot, tint: languageColor(r.language) }, text: r.language }] : []),
      { icon: Icons.star, text: compact(r.stargazers_count), tooltip: `${r.stargazers_count} stars` },
      { text: ago(r.pushed_at), tooltip: "Last push" },
    ],
    detail: {
      markdown: r.description ?? undefined,
      stats: [
        { label: "stars", value: compact(r.stargazers_count) },
        { label: "forks", value: compact(r.forks_count) },
        { label: "open issues", value: compact(r.open_issues_count) },
      ],
      metadata: [
        ...(r.language
          ? [meta.text("Language", r.language, { icon: Icons.dot, color: languageColor(r.language) })]
          : []),
        ...(r.license?.spdx_id && r.license.spdx_id !== "NOASSERTION" ? [meta.text("License", r.license.spdx_id)] : []),
        ...(r.topics?.length ? [meta.tags("Topics", r.topics.slice(0, 8))] : []),
        meta.text("Branch", r.default_branch, { icon: Icons.branch }),
        meta.separator(),
        meta.person("Owner", r.owner.login, r.owner.avatar_url),
        meta.text("Last push", ago(r.pushed_at)),
        meta.link("Page", r.full_name, r.html_url),
      ],
    },
    actions: [
      open(r.html_url, "Open in Browser"),
      action("Show README", async () => detail({ title: r.name, markdown: await readme(r.full_name, t) }), {
        icon: Icons.file,
      }),
      open(`${r.html_url}/issues`, "Open Issues", { icon: Icons.issue }),
      open(`${r.html_url}/pulls`, "Open Pull Requests", { icon: Icons.pullRequest }),
      copy(`git clone ${r.clone_url}`, "Copy Clone Command (HTTPS)", { shortcut: "<Ctrl><Shift>c", section: "Copy" }),
      copy(`git clone ${r.ssh_url}`, "Copy Clone Command (SSH)", { section: "Copy" }),
      copy(r.html_url, "Copy URL", { section: "Copy" }),
    ],
  };
}

export default (_ctx: Context) =>
  list({
    placeholder: "Search repositories, or browse yours…",
    empty: { title: "Search GitHub", description: "Type a name, a topic, or `language:rust tui`", icon: "bs-search" },
    status: (items) => `${items.length} repositor${items.length === 1 ? "y" : "ies"}`,
    async search(query, { signal, preferences }) {
      const t = await token(preferences);
      if (!query.trim()) {
        if (!t) return [];
        const mine = await github<Repo[]>("/user/repos?sort=pushed&per_page=30", t, signal);
        return mine.map((r) => item(r, t, "Recently pushed"));
      }
      const q = encodeURIComponent(query);
      const { items } = await github<{ items: Repo[] }>(`/search/repositories?q=${q}&per_page=25`, t, signal);
      return items.map((r) => item(r, t));
    },
  });
