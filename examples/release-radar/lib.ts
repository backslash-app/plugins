/** What we read from `GET /repos/{owner}/{repo}/releases/latest`. */
export interface Release {
  tag_name: string;
  name: string | null;
  html_url: string;
  published_at: string;
  body: string | null;
  author: { login: string; avatar_url: string };
}

/** "denoland/deno, rust-lang/rust" → ["denoland/deno", "rust-lang/rust"], ignoring anything else. */
export function parseRepos(text: string): string[] {
  const repos = text.split(/[\s,]+/).filter((r) => /^[\w.-]+\/[\w.-]+$/.test(r));
  return [...new Set(repos)];
}

/** A short age for the list: "today", "3d", "2mo", "1y". */
export function age(date: string, now = Date.now()): string {
  const days = Math.floor((now - Date.parse(date)) / 86_400_000);
  if (days < 1) return "today";
  if (days < 30) return `${days}d`;
  if (days < 365) return `${Math.floor(days / 30)}mo`;
  return `${Math.floor(days / 365)}y`;
}
