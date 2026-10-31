// Gerrit's REST answers: XSSI prefix, changes, labels, download commands. No I/O here.

import type { Color } from "@backslash/api";

/** Gerrit prefixes every JSON answer with `)]}'` so that it can't be loaded as a script. */
export function parseGerritJson<T = unknown>(text: string): T {
  return JSON.parse(text.replace(/^\s*\)\]\}'\r?\n?/, "")) as T;
}

/**
 * `review.opendev.org`, `https://gerrit.example.com/r/#/q/status:open`,
 * `https://review.example.com/c/project/+/123`, `…/a/` → the base address,
 * path prefix kept, no trailing slash.
 */
export function normalizeUrl(input: unknown): string {
  let url = String(input ?? "").trim();
  if (!url) return "";
  if (!/^https?:\/\//i.test(url)) {
    const local = /^(localhost|\d{1,3}(\.\d{1,3}){3}|[^/:]+\.(local|lan|home\.arpa|internal))(:|\/|$)/i.test(url);
    url = `${local ? "http" : "https"}://${url}`;
  }
  return url
    .replace(/[?#].*$/, "")
    .replace(/\/(c|q|dashboard|admin|settings|plugins)\/.*$/, "")
    .replace(/\/+$/, "")
    .replace(/\/a$/, "");
}

/** HTTP basic credentials, UTF-8 safe. */
export function basicAuth(user: string, password: string): string {
  const bytes = new TextEncoder().encode(`${user}:${password}`);
  return `Basic ${btoa(String.fromCharCode(...bytes))}`;
}

/** `2026-10-30 14:02:11.000000000` (UTC) → milliseconds. */
export function gerritTime(text: unknown): number | undefined {
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(\.\d{1,3})?/.exec(String(text ?? ""));
  if (!m) return undefined;
  const t = Date.parse(`${m[1]}T${m[2]}${m[3] ?? ""}Z`);
  return Number.isNaN(t) ? undefined : t;
}

// ---------------------------------------------------------------------------
// Changes

export interface Account {
  id?: number;
  name: string;
  email?: string;
  username?: string;
  avatar?: string;
}

export interface Vote {
  account: Account;
  value: number;
}

export interface Label {
  name: string;
  /** The value that sums it up: the veto or approval when there is one, else the strongest vote. */
  value: number;
  /** `approved` / `rejected` are the label's maximum and minimum (they block or allow submit). */
  state: "approved" | "rejected" | "recommended" | "disliked" | "none";
  votes: Vote[];
  /** The range of values, e.g. -2 to +2. */
  min: number;
  max: number;
  optional: boolean;
}

export interface Fetch {
  scheme: string;
  url: string;
  ref: string;
  commands: Record<string, string>;
}

export type Status = "NEW" | "MERGED" | "ABANDONED";

export interface Change {
  number: number;
  /** Triplet or `project~number`, for REST calls. */
  id: string;
  changeId: string;
  project: string;
  branch: string;
  topic?: string;
  hashtags: string[];
  subject: string;
  status: Status;
  wip: boolean;
  private: boolean;
  owner: Account;
  created?: number;
  updated?: number;
  insertions: number;
  deletions: number;
  comments: number;
  unresolved: number;
  submittable?: boolean;
  mergeable?: boolean;
  labels: Label[];
  attention: Account[];
  reviewers: Account[];
  revision?: string;
  patchset?: number;
  ref?: string;
  fetch: Fetch[];
  message?: string;
}

const num = (v: unknown) => typeof v === "number" && Number.isFinite(v) ? v : undefined;
const str = (v: unknown) => typeof v === "string" && v ? v : undefined;

export function parseAccount(a: any): Account {
  const avatars: any[] = Array.isArray(a?.avatars) ? a.avatars : [];
  const avatar = avatars.sort((x, y) => (num(y?.height) ?? 0) - (num(x?.height) ?? 0))[0]?.url;
  return {
    id: num(a?._account_id),
    name: str(a?.display_name) ?? str(a?.name) ?? str(a?.username) ?? str(a?.email) ??
      (a?._account_id ? `Account ${a._account_id}` : "Someone"),
    email: str(a?.email),
    username: str(a?.username),
    avatar: str(avatar),
  };
}

/** A label with LABELS and DETAILED_LABELS: `approved`/`rejected`… and `all` votes. */
export function parseLabel(name: string, l: any): Label {
  const votes: Vote[] = (Array.isArray(l?.all) ? l.all : [])
    .filter((v: any) => num(v?.value) !== undefined && v.value !== 0)
    .map((v: any) => ({ account: parseAccount(v), value: v.value as number }))
    .sort((a: Vote, b: Vote) => Math.abs(b.value) - Math.abs(a.value) || a.value - b.value);
  const range = Object.keys(l?.values ?? {}).map((k) => Number.parseInt(k.trim(), 10)).filter(Number.isFinite);
  const min = range.length ? Math.min(...range) : -1;
  const max = range.length ? Math.max(...range) : 1;
  const lowest = votes.reduce((m, v) => Math.min(m, v.value), 0);
  const highest = votes.reduce((m, v) => Math.max(m, v.value), 0);
  let state: Label["state"] = "none";
  let value = lowest < 0 ? lowest : highest;
  if (l?.rejected) [state, value] = ["rejected", lowest < 0 ? lowest : min];
  else if (l?.approved) [state, value] = ["approved", highest > 0 ? highest : max];
  else if (l?.disliked) [state, value] = ["disliked", lowest < 0 ? lowest : num(l?.value) ?? -1];
  else if (l?.recommended) [state, value] = ["recommended", highest > 0 ? highest : num(l?.value) ?? 1];
  return { name, value, state, votes, min, max, optional: !!l?.optional };
}

function parseFetch(fetch: any): Fetch[] {
  if (!fetch || typeof fetch !== "object") return [];
  return Object.entries(fetch).flatMap(([scheme, f]: [string, any]) =>
    str(f?.url) && str(f?.ref)
      ? [{
        scheme,
        url: f.url,
        ref: f.ref,
        commands: Object.fromEntries(
          Object.entries(f.commands ?? {}).filter(([, c]) => typeof c === "string"),
        ) as Record<string, string>,
      }]
      : []
  );
}

/** One ChangeInfo of `/changes/?q=…`. */
export function parseChange(c: any): Change {
  const rev = str(c?.current_revision);
  const r = rev ? c?.revisions?.[rev] : undefined;
  const labels = Object.entries(c?.labels ?? {}).map(([name, l]) => parseLabel(name, l));
  const order = (n: string) => (n === "Code-Review" ? 0 : n === "Verified" ? 1 : 2);
  labels.sort((a, b) => order(a.name) - order(b.name) || a.name.localeCompare(b.name));
  const reviewers = Array.isArray(c?.reviewers?.REVIEWER) ? c.reviewers.REVIEWER.map(parseAccount) : [];
  return {
    number: num(c?._number) ?? 0,
    id: str(c?.id) ?? String(c?._number ?? ""),
    changeId: str(c?.change_id) ?? "",
    project: str(c?.project) ?? "",
    branch: str(c?.branch) ?? "",
    topic: str(c?.topic),
    hashtags: Array.isArray(c?.hashtags) ? c.hashtags.map(String) : [],
    subject: str(c?.subject) ?? "(no subject)",
    status: c?.status === "MERGED" || c?.status === "ABANDONED" ? c.status : "NEW",
    wip: !!c?.work_in_progress,
    private: !!c?.is_private,
    owner: parseAccount(c?.owner),
    created: gerritTime(c?.created),
    updated: gerritTime(c?.updated),
    insertions: num(c?.insertions) ?? 0,
    deletions: num(c?.deletions) ?? 0,
    comments: num(c?.total_comment_count) ?? 0,
    unresolved: num(c?.unresolved_comment_count) ?? 0,
    submittable: typeof c?.submittable === "boolean" ? c.submittable : undefined,
    mergeable: typeof c?.mergeable === "boolean" ? c.mergeable : undefined,
    labels,
    attention: Object.values(c?.attention_set ?? {}).map((a: any) => parseAccount(a?.account)),
    reviewers,
    revision: rev,
    patchset: num(r?._number),
    ref: str(r?.ref),
    fetch: parseFetch(r?.fetch),
    message: str(r?.commit?.message),
  };
}

/** A `/changes/` answer: one list, or a list per query when several `q` were sent. */
export function parseChanges(json: unknown): { changes: Change[]; more: boolean } {
  const list: any[] = Array.isArray(json) ? (Array.isArray(json[0]) ? json.flat() : json) : [];
  return {
    changes: list.filter((c) => c && typeof c === "object").map(parseChange),
    more: !!list[list.length - 1]?._more_changes,
  };
}

// ---------------------------------------------------------------------------
// Views of the change list

export const FILTERS = [
  { value: "review", title: "To Review", query: "is:open reviewer:self -owner:self -is:wip -is:ignored" },
  { value: "attention", title: "Attention", query: "attention:self" },
  { value: "mine", title: "Mine", query: "is:open owner:self" },
  { value: "cc", title: "CC", query: "is:open cc:self -owner:self" },
  { value: "merged", title: "Merged", query: "owner:self is:merged -age:4w" },
] as const;

export const OPTIONS = [
  "LABELS",
  "DETAILED_LABELS",
  "DETAILED_ACCOUNTS",
  "CURRENT_REVISION",
  "CURRENT_COMMIT",
  "DOWNLOAD_COMMANDS",
  "SUBMITTABLE",
];

export function changesPath(query: string, limit = 50): string {
  const q = new URLSearchParams({ q: query, n: String(limit) });
  for (const o of OPTIONS) q.append("o", o);
  return `/changes/?${q}`;
}

/** The web page of a change: `/c/<project>/+/<number>`. */
export function changeUrl(base: string, c: Pick<Change, "project" | "number">, patchset?: number): string {
  const project = c.project.split("/").map(encodeURIComponent).join("/");
  return `${base}/c/${project}/+/${c.number}${patchset ? `/${patchset}` : ""}`;
}

export const searchUrl = (base: string, query: string) => `${base}/q/${encodeURIComponent(query)}`;

const SCHEMES = ["anonymous http", "http", "ssh"];

function pickFetch(c: Change, scheme?: string): Fetch | undefined {
  const wanted = scheme?.trim().toLowerCase();
  return (wanted ? c.fetch.find((f) => f.scheme.toLowerCase() === wanted) : undefined) ??
    [...c.fetch].sort((a, b) => rank(a.scheme) - rank(b.scheme))[0];
}
const rank = (s: string) => {
  const i = SCHEMES.indexOf(s.toLowerCase());
  return i === -1 ? SCHEMES.length : i;
};

/**
 * `git fetch <url> refs/changes/45/12345/3 && git checkout FETCH_HEAD`: the
 * server's own command when its download-commands plugin offers one, else
 * built from the fetch URL (or the project on the server).
 */
export function gitCommand(
  base: string,
  c: Change,
  kind: "Checkout" | "Cherry Pick" | "Branch",
  scheme?: string,
): string | undefined {
  const f = pickFetch(c, scheme);
  const own = f?.commands[kind];
  if (own) return own.replace(/\s+$/, "");
  const ref = f?.ref ?? c.ref;
  if (!ref) return undefined;
  const url = f?.url ?? `${base}/${c.project}`;
  const fetch = `git fetch ${url} ${ref}`;
  if (kind === "Checkout") return `${fetch} && git checkout FETCH_HEAD`;
  if (kind === "Cherry Pick") return `${fetch} && git cherry-pick FETCH_HEAD`;
  return `${fetch} && git checkout -b change-${c.number}-${c.patchset ?? 1} FETCH_HEAD`;
}

/** "+2", "-1", "0". */
export const signed = (n: number) => (n > 0 ? `+${n}` : String(n));

/** "CR", "V", or the label's initials. */
export function shortLabel(name: string): string {
  if (name === "Code-Review") return "CR";
  if (name === "Verified") return "V";
  return name.split(/[-_\s]+/).map((w) => w[0]?.toUpperCase() ?? "").join("");
}

export function labelColor(l: Pick<Label, "value" | "state" | "max" | "min">): Color {
  if (l.state === "rejected" || (l.value < 0 && l.value === l.min)) return "red";
  if (l.value < 0) return "orange";
  if (l.state === "approved" || (l.value > 0 && l.value === l.max)) return "green";
  if (l.value > 0) return "teal";
  return "gray";
}

/** The two labels everyone looks at, when the server has them. */
export function mainLabels(c: Change): Label[] {
  return c.labels.filter((l) => l.name === "Code-Review" || l.name === "Verified");
}

/** "+120 −14". */
export const sizeText = (c: Pick<Change, "insertions" | "deletions">) => `+${c.insertions} −${c.deletions}`;

/** XS…XL as Gerrit's own size badge reads lines changed. */
export function sizeBucket(c: Pick<Change, "insertions" | "deletions">): string {
  const n = c.insertions + c.deletions;
  return n < 10 ? "XS" : n < 50 ? "S" : n < 250 ? "M" : n < 1000 ? "L" : "XL";
}

export function age(at: number | undefined, now = Date.now()): string {
  if (at === undefined) return "";
  const m = Math.max(0, Math.floor((now - at) / 60_000));
  if (m < 1) return "now";
  if (m < 60) return `${m}m`;
  if (m < 1440) return `${Math.floor(m / 60)}h`;
  const d = Math.floor(m / 1440);
  if (d < 30) return `${d}d`;
  if (d < 365) return `${Math.floor(d / 30)}mo`;
  return `${Math.floor(d / 365)}y`;
}

/** The commit message without its subject and Gerrit trailers, for the preview. */
export function messageBody(message: string | undefined): string {
  if (!message) return "";
  const lines = message.replace(/\r/g, "").split("\n");
  const body = lines.slice(1).join("\n")
    .replace(
      /^(Change-Id|Signed-off-by|Reviewed-on|Reviewed-by|Tested-by|Acked-by|Cc|Bug|Test|Fixes|Depends-On):.*$/gim,
      "",
    )
    .trim();
  return body;
}

export type ChangeState = { title: string; color: Color };

/** What a change waits for, from its status, WIP flag, votes and submittability. */
export function changeState(c: Change): ChangeState {
  if (c.status === "MERGED") return { title: "Merged", color: "purple" };
  if (c.status === "ABANDONED") return { title: "Abandoned", color: "gray" };
  if (c.wip) return { title: "WIP", color: "gray" };
  if (c.labels.some((l) => l.state === "rejected")) return { title: "Blocked", color: "red" };
  if (c.mergeable === false) return { title: "Merge conflict", color: "red" };
  if (c.submittable) return { title: "Ready to submit", color: "green" };
  if (c.unresolved) return { title: "Unresolved comments", color: "orange" };
  return { title: "In review", color: "blue" };
}
