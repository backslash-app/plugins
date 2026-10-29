// Month-to-date spend of AWS, Google Cloud, Azure and Hetzner Cloud as plain
// data: the CLI arguments and request bodies, their answers parsed, Hetzner's
// estimate, forecasts and the budget. Pure, tested in lib_test.ts.

import type { Color } from "@backslash/api";

export type ProviderId = "aws" | "gcp" | "azure" | "hetzner";

export const PROVIDERS: ProviderId[] = ["aws", "gcp", "azure", "hetzner"];

export const PROVIDER_NAMES: Record<ProviderId, string> = {
  aws: "AWS",
  gcp: "Google Cloud",
  azure: "Azure",
  hetzner: "Hetzner Cloud",
};

export const PROVIDER_COLORS: Record<ProviderId, Color> = {
  aws: "orange",
  gcp: "blue",
  azure: "teal",
  hetzner: "red",
};

// Type aliases (not interfaces) so that they are plain JSON for storage.
export type Amount = {
  name: string;
  amount: number;
};

/** One provider's month, JSON-safe (it is cached in storage). */
export type Costs = {
  provider: ProviderId;
  currency: string;
  /** Month to date. */
  total: number;
  /** For the whole month, when known. */
  forecast?: number;
  /** "provider": its own forecast; "linear": the daily average so far; "estimate": from list prices. */
  forecastKind?: "provider" | "linear" | "estimate";
  /** Biggest first. */
  byService: Amount[];
  /** `YYYY-MM-DD`, oldest first. */
  byDay: Amount[];
  /** Unix ms. */
  fetched: number;
  note?: string;
};

// ---------------------------------------------------------------------------
// The month

export interface Period {
  /** `YYYY-MM-01`. */
  start: string;
  /** Today, `YYYY-MM-DD` (UTC). */
  today: string;
  /** Tomorrow: the exclusive end of "month to date". */
  end: string;
  /** The first day of next month: the exclusive end of the month. */
  nextMonth: string;
  daysInMonth: number;
  /** 1 on the first of the month. */
  day: number;
  /** `YYYYMM`, as BigQuery's invoice month. */
  invoiceMonth: string;
}

const iso = (d: Date) => d.toISOString().slice(0, 10);

export function period(now = new Date()): Period {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const today = new Date(Date.UTC(y, m, now.getUTCDate()));
  return {
    start: iso(new Date(Date.UTC(y, m, 1))),
    today: iso(today),
    end: iso(new Date(today.getTime() + 86400_000)),
    nextMonth: iso(new Date(Date.UTC(y, m + 1, 1))),
    daysInMonth: new Date(Date.UTC(y, m + 1, 0)).getUTCDate(),
    day: now.getUTCDate(),
    invoiceMonth: `${y}${String(m + 1).padStart(2, "0")}`,
  };
}

/** Sorted biggest first, tiny amounts (< 0.005) dropped. */
function amounts(map: Map<string, number>, byName = false): Amount[] {
  const list = [...map].map(([name, amount]) => ({ name, amount: round(amount) }));
  return byName
    ? list.sort((a, b) => a.name.localeCompare(b.name))
    : list.filter((a) => Math.abs(a.amount) >= 0.005).sort((a, b) => b.amount - a.amount);
}

export const round = (n: number) => Math.round(n * 100) / 100;

const add = (map: Map<string, number>, key: string, n: number) => map.set(key, (map.get(key) ?? 0) + n);

/** The daily average so far, over the whole month; today counts as half a day (it isn't over). */
export function linearForecast(total: number, p: Period): number | undefined {
  const elapsed = p.day - 0.5;
  return elapsed > 0 ? round((total / elapsed) * p.daysInMonth) : undefined;
}

/** Every day of the month so far, zero where nothing was spent. */
export function fillDays(days: Amount[], p: Period): Amount[] {
  const known = new Map(days.map((d) => [d.name, d.amount]));
  const out: Amount[] = [];
  for (let d = new Date(`${p.start}T00:00:00Z`); iso(d) <= p.today; d = new Date(d.getTime() + 86400_000)) {
    out.push({ name: iso(d), amount: round(known.get(iso(d)) ?? 0) });
  }
  return out;
}

// ---------------------------------------------------------------------------
// AWS Cost Explorer (aws ce)

export function awsCostArgs(p: Period, nextPageToken?: string): string[] {
  return [
    "ce",
    "get-cost-and-usage",
    "--time-period",
    `Start=${p.start},End=${p.end}`,
    "--granularity",
    "DAILY",
    "--metrics",
    "UnblendedCost",
    "--group-by",
    "Type=DIMENSION,Key=SERVICE",
    ...(nextPageToken ? ["--next-page-token", nextPageToken] : []),
  ];
}

/** Cost Explorer forecasts from today to the end of the month. */
export const awsForecastArgs = (p: Period) => [
  "ce",
  "get-cost-forecast",
  "--time-period",
  `Start=${p.today},End=${p.nextMonth}`,
  "--metric",
  "UNBLENDED_COST",
  "--granularity",
  "MONTHLY",
];

/** Pages of `get-cost-and-usage` grouped by SERVICE, daily. */
export function parseAwsCosts(pages: any[], p: Period, now = Date.now()): Costs {
  const services = new Map<string, number>();
  const days = new Map<string, number>();
  let currency = "USD";
  for (const page of pages) {
    for (const r of page?.ResultsByTime ?? []) {
      const day = String(r.TimePeriod?.Start ?? "").slice(0, 10);
      const groups = r.Groups ?? [];
      for (const g of groups) {
        const m = g.Metrics?.UnblendedCost;
        const n = Number(m?.Amount ?? 0);
        if (m?.Unit) currency = m.Unit;
        add(services, String(g.Keys?.[0] ?? "Other"), n);
        add(days, day, n);
      }
      if (!groups.length && r.Total?.UnblendedCost) add(days, day, Number(r.Total.UnblendedCost.Amount ?? 0));
    }
  }
  const byDay = fillDays(amounts(days, true), p);
  return {
    provider: "aws",
    currency,
    total: round(byDay.reduce((s, d) => s + d.amount, 0)),
    byService: amounts(services),
    byDay,
    fetched: now,
  };
}

/** The month: what was spent before today, plus Cost Explorer's forecast from today on. */
export function withAwsForecast(c: Costs, forecast: any, p: Period): Costs {
  const rest = Number(forecast?.Total?.Amount);
  if (!Number.isFinite(rest)) return { ...c, forecast: linearForecast(c.total, p), forecastKind: "linear" };
  const before = c.byDay.filter((d) => d.name < p.today).reduce((s, d) => s + d.amount, 0);
  return { ...c, forecast: round(before + rest), forecastKind: "provider" };
}

// ---------------------------------------------------------------------------
// Google Cloud: the BigQuery billing export (bq query)

/** `my-project.billing.gcp_billing_export_v1_0123AB_CDEF12_345678`, or `project:dataset.table`. */
export function gcpTable(input: unknown): string {
  const t = String(input ?? "").trim().replace(/^`|`$/g, "");
  const m = /^([a-z][a-z0-9-]{4,61}[a-z0-9])[.:]([A-Za-z0-9_]+)\.([A-Za-z0-9_]+)$/.exec(t);
  if (!m) throw new Error(`“${t}” is not a BigQuery table: project.dataset.table`);
  return `${m[1]}.${m[2]}.${m[3]}`;
}

/** Cost per service and day of this invoice month, credits (free tier, discounts) included. */
export function gcpQuery(table: string, p: Period): string {
  return [
    "SELECT service.description AS service, FORMAT_DATE('%F', DATE(usage_start_time)) AS day, currency,",
    "  SUM(cost) + SUM(IFNULL((SELECT SUM(c.amount) FROM UNNEST(credits) c), 0)) AS cost",
    `FROM \`${gcpTable(table)}\``,
    `WHERE invoice.month = '${p.invoiceMonth}'`,
    // The export is partitioned by load time: this skips older months' partitions.
    `  AND DATE(_PARTITIONTIME) >= DATE_SUB(DATE '${p.start}', INTERVAL 2 DAY)`,
    "GROUP BY service, day, currency",
  ].join("\n");
}

export const bqArgs = (table: string, p: Period) => [
  "query",
  "--use_legacy_sql=false",
  "--format=json",
  "--quiet",
  "--max_rows=100000",
  `--project_id=${gcpTable(table).split(".")[0]}`,
  gcpQuery(table, p),
];

/** `bq query --format=json`: an array of rows with string values. */
export function parseBqCosts(rows: any, p: Period, now = Date.now()): Costs {
  const services = new Map<string, number>();
  const days = new Map<string, number>();
  const currencies = new Map<string, number>();
  for (const r of Array.isArray(rows) ? rows : []) {
    const n = Number(r.cost ?? 0);
    if (!Number.isFinite(n)) continue;
    add(services, String(r.service ?? "Other"), n);
    // Usage of the last hours of last month can be billed this month.
    add(days, String(r.day ?? "") < p.start ? p.start : String(r.day), n);
    add(currencies, String(r.currency ?? "USD"), Math.abs(n));
  }
  const byDay = fillDays(amounts(days, true), p);
  const total = round(byDay.reduce((s, d) => s + d.amount, 0));
  return {
    provider: "gcp",
    currency: [...currencies].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "USD",
    total,
    forecast: linearForecast(total, p),
    forecastKind: "linear",
    byService: amounts(services),
    byDay,
    fetched: now,
    note: "From the BigQuery billing export, which lags a few hours behind; the forecast is the daily average so far.",
  };
}

// ---------------------------------------------------------------------------
// Azure Cost Management (az rest)

export const azureQueryUrl = (subscription: string) =>
  `https://management.azure.com/subscriptions/${subscription}/providers/Microsoft.CostManagement/query?api-version=2023-03-01`;

export const azureForecastUrl = (subscription: string) =>
  `https://management.azure.com/subscriptions/${subscription}/providers/Microsoft.CostManagement/forecast?api-version=2023-03-01`;

export function azureSubscription(input: unknown): string | undefined {
  const s = String(input ?? "").trim().replace(/^\/?subscriptions\//i, "");
  if (!s) return undefined;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)) {
    throw new Error(`“${s}” is not a subscription ID (a GUID)`);
  }
  return s.toLowerCase();
}

export const azureQueryBody = () => ({
  type: "ActualCost",
  timeframe: "MonthToDate",
  dataset: {
    granularity: "Daily",
    aggregation: { totalCost: { name: "Cost", function: "Sum" } },
    grouping: [{ type: "Dimension", name: "ServiceName" }],
  },
});

export const azureForecastBody = (p: Period) => ({
  type: "ActualCost",
  timeframe: "Custom",
  timePeriod: { from: `${p.today}T00:00:00Z`, to: `${iso(new Date(Date.parse(p.nextMonth) - 86400_000))}T23:59:59Z` },
  dataset: { granularity: "Daily", aggregation: { totalCost: { name: "Cost", function: "Sum" } } },
  includeActualCost: false,
  includeFreshPartialCost: false,
});

/** `20261029` or `2026-10-29T00:00:00` → `2026-10-29`. */
function azureDate(v: unknown): string {
  const s = String(v ?? "");
  return /^\d{8}$/.test(s) ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : s.slice(0, 10);
}

/** Rows as objects, by the response's column names. */
function azureRows(body: any): Record<string, unknown>[] {
  const columns: string[] = (body?.properties?.columns ?? []).map((c: any) => String(c.name));
  return (body?.properties?.rows ?? []).map((row: unknown[]) => Object.fromEntries(columns.map((c, i) => [c, row[i]])));
}

const costOf = (r: Record<string, unknown>) => Number(r.Cost ?? r.PreTaxCost ?? r.CostUSD ?? 0);

/** Pages of the query API. */
export function parseAzureCosts(pages: any[], p: Period, now = Date.now()): Costs {
  const services = new Map<string, number>();
  const days = new Map<string, number>();
  let currency = "USD";
  for (const r of pages.flatMap(azureRows)) {
    const n = costOf(r);
    if (!Number.isFinite(n)) continue;
    add(services, String(r.ServiceName || "Other"), n);
    add(days, azureDate(r.UsageDate), n);
    if (r.Currency) currency = String(r.Currency);
  }
  const byDay = fillDays(amounts(days, true), p);
  return {
    provider: "azure",
    currency,
    total: round(byDay.reduce((s, d) => s + d.amount, 0)),
    byService: amounts(services),
    byDay,
    fetched: now,
  };
}

/** Actual cost before today, plus Azure's forecast rows from today on. */
export function withAzureForecast(c: Costs, body: any, p: Period): Costs {
  const rows = azureRows(body).filter((r) => String(r.CostStatus ?? "Forecast") === "Forecast");
  if (!rows.length) return { ...c, forecast: linearForecast(c.total, p), forecastKind: "linear" };
  const before = c.byDay.filter((d) => d.name < p.today).reduce((s, d) => s + d.amount, 0);
  const rest = rows.filter((r) => azureDate(r.UsageDate) >= p.today).reduce((s, r) => s + costOf(r), 0);
  return { ...c, forecast: round(before + rest), forecastKind: "provider" };
}

// ---------------------------------------------------------------------------
// Hetzner Cloud: resources × list prices

export interface HetznerPrice {
  hourly: number;
  monthly: number;
}

export interface HetznerPricing {
  currency: string;
  /** Server type name → location → price. */
  servers: Record<string, Record<string, HetznerPrice>>;
  loadBalancers: Record<string, Record<string, HetznerPrice>>;
  /** IP type ("ipv4") → location → price. */
  primaryIps: Record<string, Record<string, HetznerPrice>>;
  /** Per GB and month. */
  volumeGb: number;
  /** % of the server price. */
  backupPercent: number;
}

const gross = (p: any) => Number(p?.gross ?? p?.net ?? 0);

function byLocation(prices: any[]): Record<string, HetznerPrice> {
  return Object.fromEntries(
    (prices ?? []).map((
      x: any,
    ) => [String(x.location), { hourly: gross(x.price_hourly), monthly: gross(x.price_monthly) }]),
  );
}

/** `GET /v1/pricing`, prices with VAT. */
export function parseHetznerPricing(body: any): HetznerPricing {
  const p = body?.pricing ?? {};
  return {
    currency: String(p.currency ?? "EUR"),
    servers: Object.fromEntries((p.server_types ?? []).map((t: any) => [String(t.name), byLocation(t.prices)])),
    loadBalancers: Object.fromEntries(
      (p.load_balancer_types ?? []).map((t: any) => [String(t.name), byLocation(t.prices)]),
    ),
    primaryIps: Object.fromEntries((p.primary_ips ?? []).map((t: any) => [String(t.type), byLocation(t.prices)])),
    volumeGb: gross(p.volume?.price_per_gb_month),
    backupPercent: Number(p.server_backup?.percentage ?? 20),
  };
}

export interface Resource {
  kind: "Servers" | "Backups" | "Volumes" | "Load Balancers" | "Primary IPs";
  name: string;
  /** Unix ms. */
  created: number;
  hourly: number;
  /** Hetzner bills by the hour up to this monthly cap. */
  monthly: number;
}

const priceAt = (prices: Record<string, HetznerPrice> | undefined, location: string) =>
  prices?.[location] ?? Object.values(prices ?? {})[0];

/** Servers (with their backups), volumes, load balancers and primary IPs, each with its price. */
export function hetznerResources(
  pricing: HetznerPricing,
  data: { servers?: any[]; volumes?: any[]; loadBalancers?: any[]; primaryIps?: any[] },
): Resource[] {
  const out: Resource[] = [];
  for (const s of data.servers ?? []) {
    const location = String(s.datacenter?.location?.name ?? "");
    // Server-embedded prices are the ones of its own project and location; /pricing is the fallback.
    const own = (s.server_type?.prices ?? []).find((x: any) => x.location === location);
    const price = own
      ? { hourly: gross(own.price_hourly), monthly: gross(own.price_monthly) }
      : priceAt(pricing.servers[String(s.server_type?.name)], location);
    if (!price) continue;
    const created = Date.parse(s.created);
    out.push({ kind: "Servers", name: `${s.name} (${s.server_type?.name ?? "?"})`, created, ...price });
    if (s.backup_window) {
      const f = pricing.backupPercent / 100;
      out.push({
        kind: "Backups",
        name: `${s.name} backups`,
        created,
        hourly: price.hourly * f,
        monthly: price.monthly * f,
      });
    }
  }
  for (const v of data.volumes ?? []) {
    const monthly = Number(v.size ?? 0) * pricing.volumeGb;
    out.push({
      kind: "Volumes",
      name: `${v.name} (${v.size} GB)`,
      created: Date.parse(v.created),
      hourly: monthly / 730,
      monthly,
    });
  }
  for (const lb of data.loadBalancers ?? []) {
    const price = priceAt(pricing.loadBalancers[String(lb.load_balancer_type?.name)], String(lb.location?.name ?? ""));
    if (price) out.push({ kind: "Load Balancers", name: String(lb.name), created: Date.parse(lb.created), ...price });
  }
  for (const ip of data.primaryIps ?? []) {
    const price = priceAt(pricing.primaryIps[String(ip.type)], String(ip.datacenter?.location?.name ?? ""));
    if (price && price.monthly > 0) {
      out.push({
        kind: "Primary IPs",
        name: `${ip.name ?? ip.ip} (${ip.type})`,
        created: Date.parse(ip.created),
        ...price,
      });
    }
  }
  return out;
}

const HOUR = 3600_000;

/** Hours of `[from, to)` a resource created at `created` existed. */
const hoursIn = (created: number, from: number, to: number) =>
  Math.max(0, (to - Math.max(created || from, from)) / HOUR);

/**
 * The month so far and the whole month at list prices: hours used × hourly
 * price, capped at the monthly price. Resources deleted earlier this month
 * are gone from the API, so this misses them.
 */
export function estimateHetzner(resources: Resource[], currency: string, now = new Date()): Costs {
  const p = period(now);
  const monthStart = Date.parse(`${p.start}T00:00:00Z`);
  const monthEnd = Date.parse(`${p.nextMonth}T00:00:00Z`);
  const t = now.getTime();
  const services = new Map<string, number>();
  const days = new Map<string, number>();
  let total = 0;
  let forecast = 0;
  for (const r of resources) {
    const spent = Math.min(r.monthly, r.hourly * hoursIn(r.created, monthStart, t));
    total += spent;
    forecast += Math.min(r.monthly, r.hourly * hoursIn(r.created, monthStart, monthEnd));
    add(services, r.kind, spent);
    // Spread over the days by the hour, the cap applied to the last ones.
    let left = spent;
    for (let d = monthStart; d < t && left > 0; d += 86400_000) {
      const n = Math.min(left, r.hourly * hoursIn(r.created, d, Math.min(d + 86400_000, t)));
      add(days, iso(new Date(d)), n);
      left -= n;
    }
  }
  return {
    provider: "hetzner",
    currency,
    total: round(total),
    forecast: round(forecast),
    forecastKind: "estimate",
    byService: amounts(services),
    byDay: fillDays(amounts(days, true), p),
    fetched: t,
    note: "Estimated from list prices (VAT included) of the resources that exist now: traffic overage, snapshots, " +
      "floating IPs and resources deleted this month are not counted.",
  };
}

// ---------------------------------------------------------------------------
// Totals and budget

/** `$1,234.56`, `€12.30`, `CHF 8.00`. */
export function money(n: number | undefined, currency: string): string {
  if (n === undefined || !Number.isFinite(n)) return "–";
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 2 }).format(n);
  } catch {
    return `${n.toFixed(2)} ${currency}`;
  }
}

export interface Total {
  currency: string;
  total: number;
  forecast?: number;
  providers: ProviderId[];
}

/** Sums by currency, the biggest first (amounts in different currencies are never added). */
export function totals(all: Costs[]): Total[] {
  const map = new Map<string, Total>();
  for (const c of all) {
    const t = map.get(c.currency) ?? { currency: c.currency, total: 0, forecast: 0, providers: [] };
    t.total = round(t.total + c.total);
    t.forecast = t.forecast === undefined || c.forecast === undefined ? undefined : round(t.forecast + c.forecast);
    t.providers.push(c.provider);
    map.set(c.currency, t);
  }
  return [...map.values()].sort((a, b) => b.total - a.total);
}

export type BudgetLevel = "none" | "ok" | "forecast" | "warn" | "over";

export interface Budget {
  level: BudgetLevel;
  currency: string;
  budget: number;
  spent: number;
  forecast?: number;
  /** Spent / budget. */
  ratio: number;
}

/** The budget applies to the main currency's total (the biggest). */
export function budgetStatus(all: Costs[], budget: number, warnPercent = 80): Budget | undefined {
  const main = totals(all)[0];
  if (!main || !(budget > 0)) return undefined;
  const ratio = main.total / budget;
  const level: BudgetLevel = ratio >= 1
    ? "over"
    : ratio * 100 >= warnPercent
    ? "warn"
    : (main.forecast ?? 0) > budget
    ? "forecast"
    : "ok";
  return { level, currency: main.currency, budget, spent: main.total, forecast: main.forecast, ratio };
}

export const BUDGET_LOOK: Record<BudgetLevel, { title: string; color: Color }> = {
  none: { title: "No budget", color: "gray" },
  ok: { title: "On track", color: "green" },
  forecast: { title: "Forecast over budget", color: "yellow" },
  warn: { title: "Near the budget", color: "orange" },
  over: { title: "Over budget", color: "red" },
};

/** A notification is sent once per month and level: `2026-10:warn`. */
export const alertKey = (p: Period, level: BudgetLevel) => `${p.start.slice(0, 7)}:${level}`;

/** `▁▂▅▇` of the daily amounts. */
export function sparkline(values: number[]): string {
  if (values.length < 2) return "";
  const max = Math.max(...values);
  const bars = "▁▂▃▄▅▆▇█";
  return values.map((v) => (max <= 0 ? bars[0] : bars[Math.max(0, Math.round((v / max) * 7))])).join("");
}

/** A text bar for a share, 10 cells: `███▌      `. */
export function bar(ratio: number, width = 10): string {
  const cells = Math.max(0, Math.min(1, ratio)) * width;
  const full = Math.floor(cells);
  return `${"█".repeat(full)}${cells - full >= 0.5 ? "▌" : ""}`;
}

/** How long cached costs stay fresh: Cost Explorer charges $0.01 per request. */
export const CACHE_MS: Record<ProviderId, number> = {
  aws: 6 * HOUR,
  gcp: 3 * HOUR,
  azure: 3 * HOUR,
  hetzner: HOUR,
};

export const isFresh = (c: Pick<Costs, "fetched"> | undefined, provider: ProviderId, now = Date.now()) =>
  !!c && now - c.fetched < CACHE_MS[provider] && new Date(c.fetched).getUTCMonth() === new Date(now).getUTCMonth();

/** What a CLI or API error means, and what to do about it. */
export function classifyError(provider: ProviderId, message: string): { title: string; hint?: string } {
  const m = message;
  if (provider === "aws") {
    if (/ExpiredToken|token has expired|sso.*expired|Error loading SSO Token/i.test(m)) {
      return { title: "The AWS session expired", hint: "aws sso login" };
    }
    if (/Unable to locate credentials|could not be found|NoCredentialProviders/i.test(m)) {
      return { title: "No AWS credentials", hint: "aws configure sso" };
    }
    if (/AccessDenied|not authorized/i.test(m)) {
      return { title: "AWS denied Cost Explorer", hint: "Allow ce:GetCostAndUsage and ce:GetCostForecast" };
    }
    if (/DataUnavailable|not enabled|opt.?in/i.test(m)) {
      return { title: "Cost Explorer is not enabled", hint: "Enable it in Billing → Cost Explorer (data takes a day)" };
    }
  }
  if (provider === "azure") {
    if (/az login|AADSTS|No subscription found|Please run/i.test(m)) {
      return { title: "Sign in to Azure", hint: "az login" };
    }
    if (/AuthorizationFailed|does not have authorization|RBACAccessDenied/i.test(m)) {
      return { title: "Azure denied Cost Management", hint: "Needs the Cost Management Reader role" };
    }
    if (/429|Too many requests|throttl/i.test(m)) return { title: "Azure throttled the request: try again later" };
  }
  if (provider === "gcp") {
    if (/Not found: (Table|Dataset)/i.test(m)) return { title: "The billing export table was not found" };
    if (/Access Denied|permission/i.test(m)) {
      return { title: "BigQuery denied the query", hint: "Needs BigQuery Data Viewer and Job User" };
    }
    if (/active account|gcloud auth|credentials|Anonymous/i.test(m)) {
      return { title: "Sign in to Google Cloud", hint: "gcloud auth login" };
    }
  }
  if (provider === "hetzner" && /refused the token|401|unauthorized/i.test(m)) {
    return { title: "Hetzner refused the token: check it in Settings" };
  }
  return { title: `${PROVIDER_NAMES[provider]} failed` };
}
