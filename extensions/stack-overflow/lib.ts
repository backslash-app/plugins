// Pure logic of the Stack Overflow extension: queries, Stack Exchange API responses, formatting.

import type { Color } from "@backslash/api";
import { htmlToMarkdown, htmlToText } from "./html.ts";

export interface Site {
  /** The API's `site` parameter. */
  id: string;
  title: string;
  host: string;
  tint: Color;
}

export const SITES: Site[] = [
  { id: "stackoverflow", title: "Stack Overflow", host: "stackoverflow.com", tint: "orange" },
  { id: "superuser", title: "Super User", host: "superuser.com", tint: "blue" },
  { id: "askubuntu", title: "Ask Ubuntu", host: "askubuntu.com", tint: "orange" },
  { id: "unix", title: "Unix & Linux", host: "unix.stackexchange.com", tint: "teal" },
  { id: "serverfault", title: "Server Fault", host: "serverfault.com", tint: "red" },
];

/** A site from the preference: its API id, host or title ("unix", "askubuntu.com", "Super User"). */
export function siteFor(value: unknown): Site {
  const v = String(value ?? "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  return SITES.find((s) => s.id === v || s.host === v || s.title.toLowerCase() === v || s.host === `${v}.com`) ??
    SITES[0];
}

export interface Owner {
  name: string;
  reputation?: number;
  link?: string;
}

export interface Question {
  id: number;
  title: string;
  link: string;
  score: number;
  answers: number;
  views: number;
  answered: boolean;
  acceptedAnswerId?: number;
  tags: string[];
  created: number;
  activity: number;
  closed?: string;
  owner?: Owner;
  /** HTML, when fetched with filter=withbody. */
  body?: string;
}

export interface Answer {
  id: number;
  questionId: number;
  score: number;
  accepted: boolean;
  created: number;
  owner?: Owner;
  body: string;
}

const owner = (o: any): Owner | undefined =>
  o && o.display_name
    ? {
      name: htmlToText(o.display_name),
      ...(typeof o.reputation === "number" ? { reputation: o.reputation } : {}),
      ...(o.link ? { link: o.link } : {}),
    }
    : undefined;

export function mapQuestion(q: any): Question {
  return {
    id: q.question_id,
    title: htmlToText(q.title ?? ""),
    link: q.link,
    score: q.score ?? 0,
    answers: q.answer_count ?? 0,
    views: q.view_count ?? 0,
    answered: !!q.is_answered,
    ...(q.accepted_answer_id ? { acceptedAnswerId: q.accepted_answer_id } : {}),
    tags: q.tags ?? [],
    created: q.creation_date ?? 0,
    activity: q.last_activity_date ?? q.creation_date ?? 0,
    ...(q.closed_reason ? { closed: q.closed_reason } : {}),
    ...(owner(q.owner) ? { owner: owner(q.owner) } : {}),
    ...(q.body ? { body: q.body } : {}),
  };
}

export function mapAnswer(a: any): Answer {
  return {
    id: a.answer_id,
    questionId: a.question_id,
    score: a.score ?? 0,
    accepted: !!a.is_accepted,
    created: a.creation_date ?? 0,
    ...(owner(a.owner) ? { owner: owner(a.owner) } : {}),
    body: a.body ?? "",
  };
}

export interface Page<T> {
  items: T[];
  quotaRemaining?: number;
  quotaMax?: number;
  /** Seconds to wait before the next request of the same kind. */
  backoff?: number;
}

export function mapPage<T>(json: any, map: (x: any) => T): Page<T> {
  return {
    items: (json.items ?? []).map(map),
    ...(typeof json.quota_remaining === "number" ? { quotaRemaining: json.quota_remaining } : {}),
    ...(typeof json.quota_max === "number" ? { quotaMax: json.quota_max } : {}),
    ...(typeof json.backoff === "number" ? { backoff: json.backoff } : {}),
  };
}

/** The error the API sends with a 4xx, in plain words. */
export function apiError(status: number, json: any): string {
  const name = json?.error_name;
  const message = json?.error_message ? htmlToText(String(json.error_message)) : "";
  if (name === "throttle_violation" || status === 429) {
    return `Too many requests: ${message || "wait a little"}`;
  }
  if (name === "key_invalid" || name === "access_token_invalid") return "The API key is invalid: check the preference";
  if (name === "quota_exhausted" || /quota/i.test(message)) {
    return "Today's request quota is used up: add a Stack Apps key in the preferences, or try tomorrow";
  }
  return message ? `Stack Exchange: ${message}` : `Stack Exchange answered ${status}`;
}

/** `[rust] [tokio] spawn blocking` → tags and the free text, for search/advanced. */
export function parseQuery(input: string): { q: string; tagged: string[]; accepted: boolean } {
  const tagged: string[] = [];
  let accepted = false;
  const q = input
    .replace(/\[([^\]\s]+)\]/g, (_, t: string) => {
      tagged.push(t.toLowerCase());
      return " ";
    })
    .replace(/(^|\s)is:accepted(?=\s|$)/gi, () => {
      accepted = true;
      return " ";
    })
    .replace(/\s+/g, " ")
    .trim();
  return { q, tagged, accepted };
}

export function searchParams(input: string, site: Site, key?: string): URLSearchParams | undefined {
  const { q, tagged, accepted } = parseQuery(input);
  if (q.length < 2 && !tagged.length) return undefined;
  const p = new URLSearchParams({
    order: "desc",
    sort: "relevance",
    site: site.id,
    pagesize: "20",
    filter: "withbody",
  });
  if (q) p.set("q", q);
  if (tagged.length) p.set("tagged", tagged.join(";"));
  if (accepted) p.set("accepted", "True");
  if (key) p.set("key", key);
  return p;
}

/** The accepted answer, else the best voted one. */
export function pickAnswer(answers: Answer[], acceptedId?: number): Answer | undefined {
  return answers.find((a) => a.accepted || a.id === acceptedId) ??
    [...answers].sort((a, b) => b.score - a.score)[0];
}

export const answerUrl = (site: Site, id: number) => `https://${site.host}/a/${id}`;

/** The first paragraphs of a post as markdown, cut near `max` characters. */
export function excerpt(html: string, base: string, max = 700): string {
  const md = htmlToMarkdown(html, { base });
  if (md.length <= max) return md;
  const out: string[] = [];
  let size = 0;
  for (const block of md.split("\n\n")) {
    if (size && size + block.length > max) break;
    out.push(block);
    size += block.length;
  }
  let text = out.join("\n\n");
  // A code block cut in its middle (it had blank lines) is closed again.
  if ((text.match(/^```/gm)?.length ?? 0) % 2) text += "\n```";
  return text + "\n\n…";
}

/** 1234 → "1.2k", 2500000 → "2.5M". */
export function compact(n: number): string {
  const a = Math.abs(n);
  if (a >= 1e6) return `${(n / 1e6).toFixed(a >= 1e7 ? 0 : 1).replace(/\.0$/, "")}M`;
  if (a >= 1e3) return `${(n / 1e3).toFixed(a >= 1e4 ? 0 : 1).replace(/\.0$/, "")}k`;
  return String(n);
}

/** Unix seconds → "3 years ago". */
export function ago(seconds: number, now = Date.now()): string {
  const s = Math.max(0, Math.round(now / 1000 - seconds));
  const steps: [number, string][] = [[31536000, "year"], [2592000, "month"], [604800, "week"], [86400, "day"], [
    3600,
    "hour",
  ], [60, "minute"]];
  for (const [size, unit] of steps) {
    const n = Math.floor(s / size);
    if (n >= 1) return `${n} ${unit}${n === 1 ? "" : "s"} ago`;
  }
  return "just now";
}

export const date = (seconds: number) =>
  new Date(seconds * 1000).toLocaleDateString("en", { year: "numeric", month: "short", day: "numeric" });

/** Score color: negative red, popular green. */
export const scoreColor = (score: number): Color | undefined => score < 0 ? "red" : score >= 100 ? "green" : undefined;

/** A short title for a code block in the "Copy Code" submenu. */
export function codeTitle(code: string, index: number): string {
  const first = code.split("\n").map((l) => l.trim()).find((l) => l) ?? "";
  const lines = code.split("\n").length;
  const head = first.length > 48 ? first.slice(0, 47) + "…" : first;
  return `${index + 1}. ${head}${lines > 1 ? ` (${lines} lines)` : ""}`;
}

// ---------------------------------------------------------------------------
// Cache

export interface Cached<T> {
  at: number;
  value: T;
}

export const fresh = <T>(c: Cached<T> | undefined, ttlMs: number, now = Date.now()): c is Cached<T> =>
  !!c && now - c.at < ttlMs;

/** Most recent keys first, at most `max`; returns the list and the keys to forget. */
export function touch(keys: string[], key: string, max: number): { keys: string[]; evicted: string[] } {
  const next = [key, ...keys.filter((k) => k !== key)];
  return { keys: next.slice(0, max), evicted: next.slice(max) };
}

export const cacheKey = (kind: string, site: Site, what: string) =>
  `${kind}:${site.id}:${what.trim().toLowerCase().replace(/\s+/g, " ")}`;
