import { copy, Icons, list, meta, open } from "@backslash/api";
import { age, parseRepos, type Release } from "../lib.ts";

export default list({
  placeholder: "Filter releases…",
  empty: { title: "No releases yet", description: "Add repositories in Settings → Extensions", icon: Icons.tag },
  status: (items) => `${items.length} repositories`,
  async items({ preferences, signal }) {
    const headers: Record<string, string> = { Accept: "application/vnd.github+json" };
    if (preferences.token) headers.Authorization = `Bearer ${preferences.token}`;

    const found = await Promise.all(
      parseRepos(String(preferences.repos)).map(async (repo) => {
        const res = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, { headers, signal });
        return res.ok ? { repo, release: (await res.json()) as Release } : null;
      }),
    );

    return found
      .filter((f) => f !== null)
      .sort((a, b) => b.release.published_at.localeCompare(a.release.published_at))
      .map(({ repo, release }) => ({
        id: repo,
        title: repo,
        subtitle: release.name ?? release.tag_name,
        icon: { source: Icons.tag, tint: "purple" },
        tags: [release.tag_name],
        accessories: [{ text: age(release.published_at) }],
        detail: {
          markdown: release.body ?? "_No release notes._",
          metadata: [
            meta.text("Version", release.tag_name, { icon: Icons.tag }),
            meta.text("Published", new Date(release.published_at).toLocaleDateString()),
            meta.person("Author", release.author.login, release.author.avatar_url),
          ],
        },
        actions: [
          open(release.html_url, "Open Release"),
          copy(release.tag_name, "Copy Version"),
          open(`https://github.com/${repo}`, "Open Repository", { shortcut: "<Ctrl>o" }),
        ],
      }));
  },
});
