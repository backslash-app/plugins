// The stand-up window, git log, GitHub and Linear results, and the draft in Markdown or Slack format.

// --- The window --------------------------------------------------------------

export const isoDay = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

/** "mon-fri" (default), "sun-thu", "mon,tue,thu" → days of the week, Sunday = 0. */
export function parseWorkdays(text: string): number[] {
  const names = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
  const t = text.trim().toLowerCase();
  if (!t) return [1, 2, 3, 4, 5];
  const index = (w: string) => {
    const i = names.indexOf(w.slice(0, 3));
    if (i < 0) throw new Error(`“${w}” is not a day: write working days like mon-fri or sun-thu`);
    return i;
  };
  const out = new Set<number>();
  for (const part of t.split(/[\s,;]+/).filter(Boolean)) {
    const [a, b] = part.split(/[-–]/);
    if (b === undefined) {
      out.add(index(a));
      continue;
    }
    for (let i = index(a), guard = 0; guard < 7; i = (i + 1) % 7, guard++) {
      out.add(i);
      if (i === index(b)) break;
    }
  }
  return [...out].sort();
}

/** The working day before `now`: Friday on a Monday (and on weekends), else yesterday. */
export function lastWorkingDay(now: Date, workdays = [1, 2, 3, 4, 5]): Date {
  const d = startOfDay(now);
  for (let i = 0; i < 7; i++) {
    d.setDate(d.getDate() - 1);
    if (workdays.includes(d.getDay())) return d;
  }
  const yesterday = startOfDay(now);
  yesterday.setDate(yesterday.getDate() - 1);
  return yesterday;
}

export type Range = "last" | "today" | "week";

export interface Window {
  since: Date;
  until: Date;
  /** "Yesterday", "Friday", "Today", "This week". */
  label: string;
}

/** Since the start of the last working day (or today, or Monday) until now. */
export function standupWindow(now: Date, range: Range = "last", workdays?: number[]): Window {
  if (range === "today") return { since: startOfDay(now), until: now, label: "Today" };
  if (range === "week") {
    const monday = startOfDay(now);
    monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
    return { since: monday, until: now, label: "This week" };
  }
  const since = lastWorkingDay(now, workdays);
  const yesterday = startOfDay(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const label = since.getTime() === yesterday.getTime()
    ? "Yesterday"
    : since.toLocaleDateString("en-US", { weekday: "long" });
  return { since, until: now, label };
}

/** "Fri, Oct 30" */
export const shortDate = (d: Date) =>
  d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });

// --- git ---------------------------------------------------------------------

export const GIT_FORMAT = "%H%x1f%h%x1f%aI%x1f%an%x1f%ae%x1f%s%x1f%D%x1e";

/** `git log` for a window: every branch, no merges, by the given authors (OR'ed). */
export function gitLogArgs(repo: string, since: Date, authors: string[], until?: Date): string[] {
  return [
    "-C",
    repo,
    "log",
    "--all",
    "--no-merges",
    `--since=${since.toISOString()}`,
    ...(until ? [`--until=${until.toISOString()}`] : []),
    ...authors.map((a) => `--author=${escapeRegex(a)}`),
    "--regexp-ignore-case",
    `--pretty=format:${GIT_FORMAT}`,
  ];
}

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export interface Commit {
  repo: string;
  hash: string;
  short: string;
  date: Date;
  author: string;
  email: string;
  subject: string;
  refs: string;
}

export function parseGitLog(output: string, repo: string): Commit[] {
  return output.split("\x1e").map((r) => r.replace(/^\s+/, "")).filter(Boolean).flatMap((r) => {
    const [hash, short, date, author, email, subject, refs] = r.split("\x1f");
    if (!hash || !/^[0-9a-f]{7,64}$/.test(hash)) return [];
    return [{
      repo,
      hash,
      short,
      date: new Date(date),
      author,
      email,
      subject: subject ?? "",
      refs: (refs ?? "").trim(),
    }];
  });
}

/** Commits worth telling: no fixups or WIP, one per subject per repo (rebased copies), oldest first. */
export function cleanCommits(commits: Commit[]): Commit[] {
  const seen = new Set<string>();
  const out: Commit[] = [];
  for (const c of [...commits].sort((a, b) => b.date.getTime() - a.date.getTime())) {
    if (/^(fixup!|squash!|amend!)/i.test(c.subject) || /^(wip|tmp|temp)\b/i.test(c.subject.trim())) continue;
    const key = `${c.repo}\0${c.subject.trim().toLowerCase()}`;
    if (seen.has(c.hash) || seen.has(key)) continue;
    seen.add(c.hash);
    seen.add(key);
    out.push(c);
  }
  return out.reverse();
}

/** "feat(api): add search" → "Add search"; "Fix the tray (#123)" stays as is. */
export function tidySubject(subject: string): string {
  const s = subject.trim().replace(
    /^(?:\w+)(?:\([^)]*\))?!?:\s+/,
    (m) => /^(feat|fix|chore|docs|refactor|perf|test|tests|build|ci|style|revert)\b/i.test(m) ? "" : m,
  );
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** "~/Code, ~/work/api" → paths. */
export const parsePaths = (
  text: string,
  home: string,
) => [...new Set(text.split(/[,\n]+/).map((p) => p.trim()).filter(Boolean).map((p) => p.replace(/^~(?=$|\/)/, home)))];

export const basename = (path: string) => path.replace(/\/+$/, "").split("/").pop() ?? path;

export const splitList = (text: string) => [...new Set(text.split(/[,\n]+/).map((s) => s.trim()).filter(Boolean))];

// --- GitHub ------------------------------------------------------------------

export interface PullRequest {
  repo: string;
  number: number;
  title: string;
  url: string;
  state: "merged" | "open" | "reviewed";
  draft?: boolean;
}

/** Search queries: merged since the day, opened since and still open, reviewed (others' PRs). */
export function githubQueries(since: Date): Record<PullRequest["state"], string> {
  const day = isoDay(since);
  return {
    merged: `is:pr author:@me is:merged merged:>=${day}`,
    open: `is:pr author:@me is:open created:>=${day}`,
    reviewed: `is:pr reviewed-by:@me -author:@me updated:>=${day}`,
  };
}

export const githubSearchUrl = (q: string) =>
  `https://api.github.com/search/issues?q=${encodeURIComponent(q)}&per_page=50&sort=updated&order=desc`;

/** `GET /search/issues`: `{ items: [{ number, title, html_url, repository_url, draft }] }`. */
export function parseGithubSearch(body: unknown, state: PullRequest["state"]): PullRequest[] {
  const items = (body as { items?: unknown })?.items;
  if (!Array.isArray(items)) return [];
  return items.filter((i) => i && typeof i.number === "number" && typeof i.title === "string").map((i) => ({
    repo: String(i.repository_url ?? "").replace(/^https:\/\/api\.github\.com\/repos\//, "") ||
      String(i.html_url ?? "").replace(/^https:\/\/github\.com\/([^/]+\/[^/]+)\/.*$/, "$1"),
    number: i.number,
    title: i.title,
    url: String(i.html_url ?? ""),
    state,
    draft: i.draft === true || undefined,
  }));
}

// --- Linear ------------------------------------------------------------------

export interface Issue {
  identifier: string;
  title: string;
  url: string;
  state: string;
  kind: "completed" | "started";
}

/** The viewer's issues completed since the day, and those in progress. */
export function linearQuery(since: Date): string {
  const fields = "nodes { identifier title url completedAt state { name type } }";
  return `query Standup {
  viewer {
    completed: assignedIssues(first: 50, filter: { completedAt: { gte: ${
    JSON.stringify(since.toISOString())
  } } }) { ${fields} }
    started: assignedIssues(first: 50, filter: { state: { type: { eq: "started" } } }) { ${fields} }
  }
}`;
}

export function parseLinear(body: unknown): Issue[] {
  const b = body as { data?: { viewer?: Record<string, { nodes?: unknown[] }> }; errors?: { message?: string }[] };
  if (b?.errors?.length) throw new Error(`Linear: ${b.errors[0].message ?? "the query failed"}`);
  const viewer = b?.data?.viewer ?? {};
  const pick = (key: "completed" | "started") =>
    (viewer[key]?.nodes ?? []).filter((n: any) => n && typeof n.identifier === "string").map((n: any): Issue => ({
      identifier: n.identifier,
      title: String(n.title ?? ""),
      url: String(n.url ?? ""),
      state: String(n.state?.name ?? ""),
      kind: key,
    }));
  return [...pick("completed"), ...pick("started")];
}

// --- The draft ---------------------------------------------------------------

export type Format = "markdown" | "slack";

export interface Sources {
  commits: Commit[];
  prs: PullRequest[];
  issues: Issue[];
}

export interface Line {
  text: string;
  url?: string;
  /** Shown before the link: "Merged", "Done", "repo:". */
  prefix?: string;
  suffix?: string;
}

export interface Draft {
  window: Window;
  done: Line[];
  next: Line[];
}

/** Commits grouped by repository, a few subjects per line. */
function commitLines(commits: Commit[], maxPerRepo: number, tidy: boolean): Line[] {
  const byRepo = new Map<string, Commit[]>();
  for (const c of commits) {
    if (!byRepo.has(c.repo)) byRepo.set(c.repo, []);
    byRepo.get(c.repo)!.push(c);
  }
  return [...byRepo].map(([repo, list]) => {
    const subjects = list.map((c) => tidy ? tidySubject(c.subject) : c.subject);
    const shown = subjects.slice(0, maxPerRepo).join("; ");
    const more = subjects.length > maxPerRepo ? ` (+${subjects.length - maxPerRepo} more)` : "";
    return { prefix: `${basename(repo)}:`, text: `${shown}${more}` };
  });
}

export function buildDraft(w: Window, s: Sources, o: { maxPerRepo?: number; tidy?: boolean } = {}): Draft {
  const pr = (p: PullRequest, prefix: string): Line => ({
    prefix,
    text: `${p.title} (#${p.number})`,
    url: p.url,
    suffix: p.repo ? `in ${p.repo}` : undefined,
  });
  const done: Line[] = [
    ...s.issues.filter((i) => i.kind === "completed").map((i): Line => ({
      prefix: "Done",
      text: `${i.identifier} ${i.title}`,
      url: i.url,
    })),
    ...s.prs.filter((p) => p.state === "merged").map((p) => pr(p, "Merged")),
    ...s.prs.filter((p) => p.state === "reviewed").map((p) => pr(p, "Reviewed")),
    ...commitLines(s.commits, o.maxPerRepo ?? 4, o.tidy !== false),
  ];
  const next: Line[] = [
    ...s.issues.filter((i) => i.kind === "started").map((i): Line => ({
      prefix: i.state ? `${i.state}:` : undefined,
      text: `${i.identifier} ${i.title}`,
      url: i.url,
    })),
    ...s.prs.filter((p) => p.state === "open").map((p) => pr(p, p.draft ? "Draft PR" : "In review")),
  ];
  return { window: w, done, next };
}

const escapeMd = (t: string) => t.replace(/([\\`*_[\]<>])/g, "\\$1");
const escapeSlack = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function line(l: Line, f: Format): string {
  const esc = f === "slack" ? escapeSlack : escapeMd;
  const text = l.url
    ? f === "slack" ? `<${l.url}|${escapeSlack(l.text).replace(/\|/g, "¦")}>` : `[${esc(l.text)}](${l.url})`
    : esc(l.text);
  const prefix = l.prefix ? (f === "slack" ? `*${esc(l.prefix)}* ` : `**${esc(l.prefix)}** `) : "";
  return `${f === "slack" ? "•" : "-"} ${prefix}${text}${l.suffix ? ` ${esc(l.suffix)}` : ""}`;
}

/** The stand-up as text: "Yesterday / Today / Blockers", in Markdown or Slack's mrkdwn. */
export function renderDraft(d: Draft, f: Format, o: { blockers?: string } = {}): string {
  const heading = (t: string) => f === "slack" ? `*${t}*` : `**${t}**`;
  const when = d.window.label === "Today" || d.window.label === "This week"
    ? d.window.label
    : `${d.window.label} (${shortDate(d.window.since)})`;
  const empty = f === "slack" ? "• …" : "- …";
  const blockers = (o.blockers ?? "").trim() || "None";
  return [
    heading(when),
    ...(d.done.length ? d.done.map((l) => line(l, f)) : [empty]),
    "",
    heading("Today"),
    ...(d.next.length ? d.next.map((l) => line(l, f)) : [empty]),
    "",
    heading("Blockers"),
    `${f === "slack" ? "•" : "-"} ${blockers}`,
  ].join("\n");
}

/** "6 commits in 2 repos · 1 merged PR · 2 issues done". */
export function summary(s: Sources): string {
  const repos = new Set(s.commits.map((c) => c.repo)).size;
  const merged = s.prs.filter((p) => p.state === "merged").length;
  const done = s.issues.filter((i) => i.kind === "completed").length;
  const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
  return [
    s.commits.length ? `${plural(s.commits.length, "commit")} in ${plural(repos, "repo")}` : "No commit",
    merged ? `${merged} merged PR${merged === 1 ? "" : "s"}` : "",
    done ? `${plural(done, "issue")} done` : "",
  ].filter(Boolean).join(" · ");
}
