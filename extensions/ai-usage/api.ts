// The three providers' admin APIs, page by page, with a short cache shared by the list and the tray menu.

import { storage } from "@backslash/api";
import {
  type AnthropicCostResult,
  type AnthropicPage,
  anthropicReport,
  type AnthropicUsageResult,
  dayOf,
  monthStart,
  type OpenAICostResult,
  type OpenAIPage,
  openaiReport,
  type OpenAIUsageResult,
  type OpenRouterActivity,
  type OpenRouterCredits,
  type OpenRouterKey,
  openrouterReport,
  type ProviderId,
  PROVIDERS,
  type Report,
} from "./lib.ts";

/** A missing or refused key: shown as a setup row, not as an error. */
export class SetupError extends Error {
  constructor(readonly provider: ProviderId, message: string) {
    super(message);
  }
}

export interface Keys {
  anthropic?: string;
  openai?: string;
  openrouter?: string;
}

export function keysOf(prefs: Record<string, unknown>): Keys {
  const k = (name: string) => String(prefs[name] ?? "").trim() || undefined;
  return { anthropic: k("anthropicAdminKey"), openai: k("openaiAdminKey"), openrouter: k("openrouterKey") };
}

async function getJson<T>(provider: ProviderId, url: string, headers: Record<string, string>, signal?: AbortSignal) {
  const res = await fetch(url, { headers, signal });
  if (res.status === 401 || res.status === 403) {
    await res.body?.cancel();
    const hint = provider === "openrouter"
      ? "OpenRouter refused the key"
      : `${PROVIDERS[provider].title} refused the key: it must be an Admin key`;
    throw new SetupError(provider, `${hint} (${res.status})`);
  }
  if (!res.ok) {
    const body = await res.json().catch(() => undefined) as { error?: { message?: string } | string } | undefined;
    const message = typeof body?.error === "string" ? body.error : body?.error?.message;
    throw new Error(`${PROVIDERS[provider].title} answered ${res.status}${message ? `: ${message}` : ""}`);
  }
  return await res.json() as T;
}

/** Follows `next_page` until the end (at most 10 pages: a month is one or two). */
async function pages<R, P extends { data: R[]; has_more: boolean; next_page?: string | null }>(
  provider: ProviderId,
  base: string,
  headers: Record<string, string>,
  signal?: AbortSignal,
): Promise<R[]> {
  const out: R[] = [];
  let page: string | undefined;
  for (let i = 0; i < 10; i++) {
    const p: P = await getJson<P>(provider, page ? `${base}&page=${encodeURIComponent(page)}` : base, headers, signal);
    out.push(...p.data);
    if (!p.has_more || !p.next_page) break;
    page = p.next_page;
  }
  return out;
}

export async function anthropic(key: string, now: number, signal?: AbortSignal): Promise<Report> {
  const headers = { "x-api-key": key, "anthropic-version": "2023-06-01" };
  const start = `${dayOf(monthStart(now))}T00:00:00Z`;
  const end = `${dayOf(now + 86_400_000)}T00:00:00Z`;
  const range = `starting_at=${start}&ending_at=${end}`;
  const [costs, usage] = await Promise.all([
    pages<AnthropicPage<AnthropicCostResult>["data"][number], AnthropicPage<AnthropicCostResult>>(
      "anthropic",
      `https://api.anthropic.com/v1/organizations/cost_report?${range}&group_by[]=description&limit=31`,
      headers,
      signal,
    ),
    pages<AnthropicPage<AnthropicUsageResult>["data"][number], AnthropicPage<AnthropicUsageResult>>(
      "anthropic",
      `https://api.anthropic.com/v1/organizations/usage_report/messages?${range}&bucket_width=1d&group_by[]=model&limit=31`,
      headers,
      signal,
    ),
  ]);
  return anthropicReport(costs, usage, now);
}

export async function openai(key: string, now: number, signal?: AbortSignal): Promise<Report> {
  const headers = { Authorization: `Bearer ${key}` };
  const range = `start_time=${Math.floor(monthStart(now) / 1000)}&bucket_width=1d&limit=31`;
  const [costs, usage] = await Promise.all([
    pages<OpenAIPage<OpenAICostResult>["data"][number], OpenAIPage<OpenAICostResult>>(
      "openai",
      `https://api.openai.com/v1/organization/costs?${range}&group_by=line_item`,
      headers,
      signal,
    ),
    pages<OpenAIPage<OpenAIUsageResult>["data"][number], OpenAIPage<OpenAIUsageResult>>(
      "openai",
      `https://api.openai.com/v1/organization/usage/completions?${range}&group_by=model`,
      headers,
      signal,
    ).catch((e) => {
      // Costs are what matters; token counts are a bonus.
      if (e instanceof SetupError) throw e;
      return [];
    }),
  ]);
  return openaiReport(costs, usage, now);
}

export async function openrouter(key: string, now: number, signal?: AbortSignal): Promise<Report> {
  const headers = { Authorization: `Bearer ${key}` };
  const [k, credits, activity] = await Promise.all([
    getJson<OpenRouterKey>("openrouter", "https://openrouter.ai/api/v1/key", headers, signal),
    getJson<OpenRouterCredits>("openrouter", "https://openrouter.ai/api/v1/credits", headers, signal).catch(() =>
      undefined
    ),
    // Only provisioning keys may read the activity: an ordinary key gets a 401 or 403 here.
    getJson<OpenRouterActivity>("openrouter", "https://openrouter.ai/api/v1/activity", headers, signal).catch(() =>
      undefined
    ),
  ]);
  return openrouterReport(k, credits, activity, now);
}

export interface Snapshot {
  at: number;
  reports: Report[];
  problems: { provider: ProviderId; message: string; setup: boolean }[];
  /** Providers without a key. */
  missing: ProviderId[];
}

const CACHE = "snapshot";
/** Cost reports update a few times an hour at best. */
const FRESH_MS = 10 * 60_000;

export async function load(keys: Keys, o: { signal?: AbortSignal; force?: boolean } = {}): Promise<Snapshot> {
  const cached = await storage.get(CACHE).catch(() => undefined) as unknown as
    | (Snapshot & { keys: string })
    | undefined;
  // The cache is only good for the same set of keys (not the keys themselves: a fingerprint).
  const fingerprint = (["anthropic", "openai", "openrouter"] as ProviderId[]).map((p) => keys[p] ? p : "").join(",");
  const now = Date.now();
  if (
    !o.force && cached && cached.keys === fingerprint && now - cached.at < FRESH_MS &&
    dayOf(cached.at).slice(0, 7) === dayOf(now).slice(0, 7)
  ) return cached;

  const jobs: [ProviderId, (k: string, now: number, s?: AbortSignal) => Promise<Report>][] = [
    ["anthropic", anthropic],
    ["openai", openai],
    ["openrouter", openrouter],
  ];
  const snap: Snapshot = { at: now, reports: [], problems: [], missing: [] };
  await Promise.all(jobs.map(async ([id, fn]) => {
    const key = keys[id];
    if (!key) {
      snap.missing.push(id);
      return;
    }
    try {
      snap.reports.push(await fn(key, now, o.signal));
    } catch (e) {
      if ((e as Error).name === "AbortError") throw e;
      snap.problems.push({ provider: id, message: (e as Error).message, setup: e instanceof SetupError });
    }
  }));
  const order = (p: ProviderId) => ["anthropic", "openai", "openrouter"].indexOf(p);
  snap.reports.sort((a, b) => order(a.provider) - order(b.provider));
  if (!snap.problems.length) await storage.set(CACHE, { ...snap, keys: fingerprint } as never).catch(() => {});
  return snap;
}
