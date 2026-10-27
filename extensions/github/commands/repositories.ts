import { action, copy, detail, list, open } from "@backslash/api";
import { github, readme } from "./api.ts";

interface Repo {
  full_name: string;
  description: string | null;
  html_url: string;
  clone_url: string;
  stargazers_count: number;
  language: string | null;
  updated_at: string;
  owner: { login: string };
}

const stars = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k ★` : `${n} ★`);

export default list({
  placeholder: "Search repositories…",
  empty: { title: "Search GitHub", description: "Type a name, a topic, or `language:rust tui`" },
  async search(query, { signal, preferences }) {
    if (!query.trim()) return [];
    const token = preferences.token as string | undefined;
    const q = encodeURIComponent(query);
    const { items } = await github<{ items: Repo[] }>(`/search/repositories?q=${q}&per_page=25`, token, signal);
    return items.map((r) => ({
      id: r.full_name,
      title: r.full_name,
      subtitle: r.description ?? undefined,
      icon: "folder-remote",
      accessories: [
        ...(r.language ? [{ text: r.language }] : []),
        { tag: stars(r.stargazers_count) },
      ],
      actions: [
        open(r.html_url, "Open in Browser"),
        action("Show README", async () => detail({ title: r.full_name, markdown: await readme(r.full_name, token) })),
        copy(`git clone ${r.clone_url}`, "Copy Clone Command", { shortcut: "<Ctrl><Shift>c" }),
        copy(r.html_url, "Copy URL"),
      ],
    }));
  },
});
