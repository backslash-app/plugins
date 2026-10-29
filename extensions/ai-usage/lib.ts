// Turning the Anthropic, OpenAI and OpenRouter usage and cost reports into one shape: month to date,
// today, by model, by day; the forecast and the budget. Pure, tested in lib_test.ts.

export type ProviderId = "anthropic" | "openai" | "openrouter";

export const PROVIDERS: Record<ProviderId, { title: string; console: string; keys: string }> = {
  anthropic: {
    title: "Anthropic",
    console: "https://console.anthropic.com/usage",
    keys: "https://console.anthropic.com/settings/admin-keys",
  },
  openai: {
    title: "OpenAI",
    console: "https://platform.openai.com/usage",
    keys: "https://platform.openai.com/settings/organization/admin-keys",
  },
  openrouter: {
    title: "OpenRouter",
    console: "https://openrouter.ai/activity",
    keys: "https://openrouter.ai/settings/keys",
  },
};

export interface ModelUsage {
  model: string;
  /** US dollars. */
  cost: number;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  requests?: number;
}

export interface Report {
  provider: ProviderId;
  /** US dollars, from the start of the month (UTC) to now. */
  month: number;
  today: number;
  /** `YYYY-MM-DD` → dollars. */
  daily: Record<string, number>;
  models: ModelUsage[];
  /** OpenRouter: what's left on the account. */
  balance?: number;
  /** Something that could not be read, the rest still shown. */
  note?: string;
}

// ---------------------------------------------------------------------------
// Dates (UTC, as all three providers bill)

export const dayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export function monthStart(now: number): number {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
}

export function daysInMonth(now: number): number {
  const d = new Date(now);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
}

/** Days of the month gone, counting today as a fraction. */
export function elapsedDays(now: number): number {
  return Math.max((now - monthStart(now)) / 86_400_000, 1 / 24);
}

/** What the month will cost at this pace. */
export const forecast = (month: number, now: number) => month / elapsedDays(now) * daysInMonth(now);

// ---------------------------------------------------------------------------
// Anthropic Admin API

interface AnthropicBucket<R> {
  starting_at: string;
  ending_at: string;
  results: R[];
}

export interface AnthropicPage<R> {
  data: AnthropicBucket<R>[];
  has_more: boolean;
  next_page?: string | null;
}

export interface AnthropicUsageResult {
  model?: string | null;
  uncached_input_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation?: { ephemeral_5m_input_tokens?: number; ephemeral_1h_input_tokens?: number } | null;
  output_tokens?: number;
}

export interface AnthropicCostResult {
  /** Decimal string in cents. */
  amount: string;
  currency?: string;
  description?: string | null;
  model?: string | null;
  cost_type?: string | null;
  token_type?: string | null;
}

function model(map: Map<string, ModelUsage>, name: string): ModelUsage {
  let m = map.get(name);
  if (!m) map.set(name, m = { model: name, cost: 0, inputTokens: 0, outputTokens: 0, cachedTokens: 0 });
  return m;
}

/** `cost_report` (grouped by description) and `usage_report/messages` (grouped by model). */
export function anthropicReport(
  costs: AnthropicBucket<AnthropicCostResult>[],
  usage: AnthropicBucket<AnthropicUsageResult>[],
  now: number,
): Report {
  const today = dayOf(now);
  const daily: Record<string, number> = {};
  const models = new Map<string, ModelUsage>();
  let month = 0;
  for (const b of costs) {
    const day = b.starting_at.slice(0, 10);
    for (const r of b.results) {
      const dollars = Number(r.amount) / 100;
      if (!Number.isFinite(dollars)) continue;
      month += dollars;
      daily[day] = (daily[day] ?? 0) + dollars;
      const name = r.model || (r.cost_type === "web_search" ? "Web search" : r.description || "Other");
      model(models, name).cost += dollars;
    }
  }
  for (const b of usage) {
    for (const r of b.results) {
      const m = model(models, r.model || "Other");
      const created = (r.cache_creation?.ephemeral_5m_input_tokens ?? 0) +
        (r.cache_creation?.ephemeral_1h_input_tokens ?? 0);
      m.inputTokens += (r.uncached_input_tokens ?? 0) + created + (r.cache_read_input_tokens ?? 0);
      m.cachedTokens += r.cache_read_input_tokens ?? 0;
      m.outputTokens += r.output_tokens ?? 0;
    }
  }
  return { provider: "anthropic", month, today: daily[today] ?? 0, daily, models: sortModels(models) };
}

// ---------------------------------------------------------------------------
// OpenAI organization costs and usage

interface OpenAIBucket<R> {
  start_time: number;
  end_time: number;
  results: R[];
}

export interface OpenAIPage<R> {
  data: OpenAIBucket<R>[];
  has_more: boolean;
  next_page?: string | null;
}

export interface OpenAICostResult {
  amount?: { value?: number | string; currency?: string };
  /** `gpt-4o-2024-08-06, input`. */
  line_item?: string | null;
  project_id?: string | null;
}

export interface OpenAIUsageResult {
  model?: string | null;
  input_tokens?: number;
  output_tokens?: number;
  input_cached_tokens?: number;
  num_model_requests?: number;
}

/** `gpt-4o-2024-08-06, cached input` → `gpt-4o-2024-08-06`. */
export const lineItemModel = (item: string | null | undefined) => (item ?? "").split(",")[0].trim() || "Other";

export function openaiReport(
  costs: OpenAIBucket<OpenAICostResult>[],
  usage: OpenAIBucket<OpenAIUsageResult>[],
  now: number,
): Report {
  const today = dayOf(now);
  const daily: Record<string, number> = {};
  const models = new Map<string, ModelUsage>();
  let month = 0;
  for (const b of costs) {
    const day = dayOf(b.start_time * 1000);
    for (const r of b.results) {
      const dollars = Number(r.amount?.value ?? 0);
      if (!Number.isFinite(dollars)) continue;
      month += dollars;
      daily[day] = (daily[day] ?? 0) + dollars;
      model(models, lineItemModel(r.line_item)).cost += dollars;
    }
  }
  for (const b of usage) {
    for (const r of b.results) {
      const m = model(models, r.model || "Other");
      m.inputTokens += r.input_tokens ?? 0;
      m.outputTokens += r.output_tokens ?? 0;
      m.cachedTokens += r.input_cached_tokens ?? 0;
      m.requests = (m.requests ?? 0) + (r.num_model_requests ?? 0);
    }
  }
  // Usage reports name snapshots ("gpt-4o-2024-08-06"), cost line items too: they meet by name.
  return { provider: "openai", month, today: daily[today] ?? 0, daily, models: sortModels(models) };
}

// ---------------------------------------------------------------------------
// OpenRouter

export interface OpenRouterKey {
  data: {
    label?: string;
    usage?: number;
    usage_daily?: number;
    usage_monthly?: number;
    limit?: number | null;
    limit_remaining?: number | null;
  };
}

export interface OpenRouterCredits {
  data: { total_credits?: number; total_usage?: number };
}

export interface OpenRouterActivity {
  data: {
    date: string;
    model?: string;
    usage?: number;
    requests?: number;
    prompt_tokens?: number;
    completion_tokens?: number;
  }[];
}

export function openrouterReport(
  key: OpenRouterKey | undefined,
  credits: OpenRouterCredits | undefined,
  activity: OpenRouterActivity | undefined,
  now: number,
): Report {
  const today = dayOf(now);
  const start = dayOf(monthStart(now));
  const daily: Record<string, number> = {};
  const models = new Map<string, ModelUsage>();
  let fromActivity = 0;
  for (const a of activity?.data ?? []) {
    const day = a.date.slice(0, 10);
    if (day < start) continue;
    const dollars = Number(a.usage ?? 0);
    fromActivity += dollars;
    daily[day] = (daily[day] ?? 0) + dollars;
    const m = model(models, a.model || "Other");
    m.cost += dollars;
    m.inputTokens += a.prompt_tokens ?? 0;
    m.outputTokens += a.completion_tokens ?? 0;
    m.requests = (m.requests ?? 0) + (a.requests ?? 0);
  }
  const month = key?.data.usage_monthly ?? fromActivity;
  const day = key?.data.usage_daily ?? daily[today] ?? 0;
  const c = credits?.data;
  const balance = c && c.total_credits !== undefined ? c.total_credits - (c.total_usage ?? 0) : undefined;
  return {
    provider: "openrouter",
    month,
    today: day,
    daily,
    models: sortModels(models),
    balance,
    note: activity ? undefined : "Per-model activity needs a provisioning key",
  };
}

function sortModels(map: Map<string, ModelUsage>): ModelUsage[] {
  return [...map.values()].filter((m) => m.cost > 0 || m.inputTokens || m.outputTokens)
    .sort((a, b) => b.cost - a.cost || b.inputTokens + b.outputTokens - a.inputTokens - a.outputTokens);
}

// ---------------------------------------------------------------------------
// Budget

export type Level = "ok" | "warn" | "over";

export interface Budget {
  /** US dollars a month; 0 for none. */
  amount: number;
  /** Percent at which to warn. */
  warnAt: number;
}

export function budgetOf(prefs: Record<string, unknown>): Budget {
  const amount = Math.max(0, Number(prefs.budget) || 0);
  const warnAt = Math.min(100, Math.max(1, Number(prefs.warnAt) || 80));
  return { amount, warnAt };
}

export function level(spent: number, b: Budget): Level {
  if (!b.amount) return "ok";
  if (spent >= b.amount) return "over";
  return spent >= b.amount * b.warnAt / 100 ? "warn" : "ok";
}

const RANK: Record<Level, number> = { ok: 0, warn: 1, over: 2 };

/**
 * Whether to notify: only when the level rises within the same month, so
 * the warning comes once at 80 % and once at 100 %, not every hour.
 */
export function shouldNotify(
  previous: { month: string; level: Level } | undefined,
  month: string,
  now: Level,
): boolean {
  if (now === "ok") return false;
  if (!previous || previous.month !== month) return true;
  return RANK[now] > RANK[previous.level];
}

// ---------------------------------------------------------------------------
// Formatting

export function money(dollars: number): string {
  const abs = Math.abs(dollars);
  const digits = abs > 0 && abs < 1 ? (abs < 0.01 ? 4 : 2) : 2;
  return `$${dollars.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: digits })}`;
}

/** `$1,234` in the tray, with cents below $100. */
export const shortMoney = (dollars: number) =>
  dollars >= 100 ? `$${Math.round(dollars).toLocaleString("en-US")}` : money(dollars);

export function tokens(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
  return String(n);
}

export const percent = (part: number, whole: number) => whole ? Math.round(part / whole * 100) : 0;

/** A small bar chart of the month's days for the detail panel, newest last. */
export function dailyChart(daily: Record<string, number>, now: number): string {
  const start = monthStart(now);
  const days = Math.max(1, Math.ceil(elapsedDays(now)));
  const rows: [string, number][] = Array.from({ length: days }, (_, i) => {
    const d = dayOf(start + i * 86_400_000);
    return [d, daily[d] ?? 0];
  });
  const max = Math.max(...rows.map(([, v]) => v), 0);
  if (!max) return "_Nothing spent this month yet._";
  const lines = rows.slice(-14).map(([d, v]) => {
    const bar = "█".repeat(Math.max(v > 0 ? 1 : 0, Math.round(v / max * 20)));
    return `${d.slice(5)} ${bar.padEnd(20, " ")} ${money(v)}`;
  });
  return ["```", ...lines, "```"].join("\n");
}

/** Merges the days of several reports. */
export function sumDaily(reports: Report[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of reports) for (const [d, v] of Object.entries(r.daily)) out[d] = (out[d] ?? 0) + v;
  return out;
}

/** "openai/gpt-4.1" → "gpt-4.1"; "claude-opus-5-5" unchanged. */
export const shortModel = (m: string) => m.includes("/") ? m.split("/").slice(1).join("/") : m;
