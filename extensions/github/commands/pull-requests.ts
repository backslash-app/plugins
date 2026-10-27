import { copy, type Item, list, open } from "@backslash/api";
import { ago, github } from "./api.ts";

interface Issue {
  number: number;
  title: string;
  html_url: string;
  updated_at: string;
  draft?: boolean;
  repository_url: string;
  user: { login: string };
}

function item(pr: Issue, section: string): Item {
  const repo = pr.repository_url.replace("https://api.github.com/repos/", "");
  return {
    id: pr.html_url,
    title: pr.title,
    subtitle: `${repo} #${pr.number} · ${ago(pr.updated_at)}`,
    icon: "mail-forward",
    section,
    keywords: [repo, pr.user.login, String(pr.number)],
    accessories: pr.draft ? [{ tag: "Draft", color: "gray" }] : [],
    actions: [open(pr.html_url, "Open in Browser"), copy(pr.html_url, "Copy URL")],
  };
}

export default list({
  placeholder: "Filter pull requests…",
  empty: {
    title: "No open pull requests",
    description: "Nothing waits for you. (A token is needed: Settings → Extensions → GitHub.)",
  },
  async items({ preferences, signal }) {
    const token = preferences.token as string | undefined;
    if (!token) {
      throw new Error("Add a GitHub token in Settings → Extensions → GitHub to see your pull requests");
    }
    const search = (q: string) =>
      github<{ items: Issue[] }>(`/search/issues?q=${encodeURIComponent(q)}&per_page=50`, token, signal);
    const [review, mine] = await Promise.all([
      search("is:pr is:open review-requested:@me archived:false"),
      search("is:pr is:open author:@me archived:false"),
    ]);
    return [
      ...review.items.map((pr) => item(pr, "Waiting for your review")),
      ...mine.items.map((pr) => item(pr, "Opened by you")),
    ];
  },
});
