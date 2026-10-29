// Firefly III's REST API (personal access token) and actual-http-api (API key,
// budget sync id), behind the same few functions.

import { Icons, type Item, open, storage } from "@backslash/api";
import {
  type Account,
  type ActualAccount,
  actualExpense,
  type ActualMonth,
  type ActualTransaction,
  apiError,
  type BudgetLine,
  daysAgo,
  type Expense,
  type FireflyAccount,
  type FireflyBudget,
  type FireflyBudgetLimit,
  fireflyExpense,
  type FireflyGroup,
  type FireflySummaryEntry,
  fromActualAccount,
  fromActualMonth,
  fromActualTransaction,
  fromFireflyAccount,
  fromFireflyBudgets,
  fromFireflyGroup,
  fromFireflySummary,
  isAllowedHost,
  monthRange,
  type MonthSummary,
  normalizeUrl,
  type Provider,
  PROVIDER_NAMES,
  type Transaction,
} from "./lib.ts";

export class SetupError extends Error {
  constructor(message: string, readonly provider?: Provider, readonly base?: string) {
    super(message);
  }
}

export interface Firefly {
  provider: "firefly";
  base: string;
  token: string;
}

export interface Actual {
  provider: "actual";
  base: string;
  key: string;
  budget: string;
  password: string;
  currency: string;
  web: string;
}

export type Backend = Firefly | Actual;

function checkHost(base: string, provider: Provider) {
  let host: string;
  try {
    host = new URL(base).hostname;
  } catch {
    throw new SetupError(`“${base}” is not an address`, provider);
  }
  if (!isAllowedHost(host)) throw new SetupError(`${host} is outside the networks this extension may reach`, provider);
}

/** The servers the preferences set up; throws a SetupError when there is none. */
export function backends(prefs: Record<string, unknown>): Backend[] {
  const out: Backend[] = [];
  const ff = normalizeUrl(prefs.fireflyUrl);
  const token = String(prefs.fireflyToken ?? "").trim().replace(/^Bearer\s+/i, "");
  if (ff) {
    checkHost(ff, "firefly");
    if (!token) throw new SetupError("Add a Firefly III access token", "firefly", ff);
    out.push({ provider: "firefly", base: ff, token });
  }
  const ac = normalizeUrl(prefs.actualUrl);
  if (ac) {
    checkHost(ac, "actual");
    const key = String(prefs.actualApiKey ?? "").trim();
    const budget = String(prefs.actualBudget ?? "").trim();
    if (!key) throw new SetupError("Add the actual-http-api key", "actual", ac);
    if (!budget) throw new SetupError("Add the sync ID of your Actual budget", "actual", ac);
    out.push({
      provider: "actual",
      base: ac,
      key,
      budget,
      password: String(prefs.actualPassword ?? ""),
      currency: (String(prefs.actualCurrency ?? "").trim() || "EUR").toUpperCase(),
      web: normalizeUrl(prefs.actualWebUrl),
    });
  }
  if (!out.length) throw new SetupError("Connect Firefly III or Actual Budget");
  return out;
}

async function request<T>(
  b: Backend,
  path: string,
  o: { method?: string; body?: unknown; signal?: AbortSignal } = {},
): Promise<T> {
  const timeout = AbortSignal.timeout(20_000);
  const url = b.provider === "firefly"
    ? `${b.base}/api/v1${path}`
    : `${b.base}/v1/budgets/${encodeURIComponent(b.budget)}${path}`;
  const headers: Record<string, string> = {
    Accept: b.provider === "firefly" ? "application/vnd.api+json" : "application/json",
  };
  if (b.provider === "firefly") headers.Authorization = `Bearer ${b.token}`;
  else {
    headers["x-api-key"] = b.key;
    if (b.password) headers["budget-encryption-password"] = b.password;
  }
  if (o.body !== undefined) headers["Content-Type"] = "application/json";
  let res: Response;
  try {
    res = await fetch(url, {
      method: o.method ?? "GET",
      headers,
      signal: o.signal ? AbortSignal.any([o.signal, timeout]) : timeout,
      body: o.body === undefined ? undefined : JSON.stringify(o.body),
    });
  } catch (e) {
    if (o.signal?.aborted) throw e;
    if (e instanceof Deno.errors.NotCapable || e instanceof Deno.errors.PermissionDenied) {
      throw new SetupError(`${new URL(b.base).hostname} is outside the networks this extension may reach`, b.provider);
    }
    throw new SetupError(
      `Can't reach ${PROVIDER_NAMES[b.provider]} at ${new URL(b.base).host}: ${(e as Error).message}`,
      b.provider,
      b.base,
    );
  }
  const text = await res.text();
  if (/^\s*</.test(text) && res.ok) {
    throw new SetupError(
      `${b.base} answers, but not as ${
        b.provider === "firefly" ? "Firefly III" : "actual-http-api"
      }: check the address`,
      b.provider,
      b.base,
    );
  }
  let json: unknown;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = undefined;
  }
  if (!res.ok) {
    const message = apiError(b.provider, res.status, json);
    if (res.status === 401 || res.status === 403) throw new SetupError(message, b.provider, b.base);
    if (res.status === 404 && !json) {
      throw new SetupError(`No ${PROVIDER_NAMES[b.provider]} API at ${b.base}: check the address`, b.provider, b.base);
    }
    throw new Error(message);
  }
  return json as T;
}

type Page<T> = { data: T[]; meta?: { pagination?: { total_pages?: number; current_page?: number } } };

/** Every page of a Firefly list (they are 50 by default; we ask for more). */
async function fireflyAll<T>(f: Firefly, path: string, signal?: AbortSignal, maxPages = 5): Promise<T[]> {
  const out: T[] = [];
  for (let page = 1; page <= maxPages; page++) {
    const sep = path.includes("?") ? "&" : "?";
    const r = await request<Page<T>>(f, `${path}${sep}limit=200&page=${page}`, { signal });
    out.push(...r.data);
    if ((r.meta?.pagination?.total_pages ?? 1) <= page) break;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Accounts

export async function accounts(b: Backend, signal?: AbortSignal): Promise<Account[]> {
  if (b.provider === "firefly") {
    const [assets, liabilities] = await Promise.all([
      fireflyAll<FireflyAccount>(b, "/accounts?type=asset", signal),
      fireflyAll<FireflyAccount>(b, "/accounts?type=liabilities", signal).catch(() => []),
    ]);
    return [...assets, ...liabilities].filter((a) => a.attributes.active !== false).map((a) => fromFireflyAccount(a));
  }
  const { data } = await request<{ data: ActualAccount[] }>(b, "/accounts", { signal });
  const open = data.filter((a) => !a.closed);
  const balances = await Promise.all(
    open.map((a) =>
      request<{ data: number }>(b, `/accounts/${encodeURIComponent(a.id)}/balance`, { signal }).then(
        (r) => r.data,
        () => 0,
      )
    ),
  );
  return open.map((a, i) => fromActualAccount(a, balances[i], b.currency));
}

// ---------------------------------------------------------------------------
// Budgets

export async function month(
  b: Backend,
  offset = 0,
  signal?: AbortSignal,
): Promise<{ lines: BudgetLine[]; summaries: MonthSummary[] }> {
  const r = monthRange(new Date(), offset);
  if (b.provider === "firefly") {
    const q = `start=${r.start}&end=${r.end}`;
    const [budgets, limits, summary] = await Promise.all([
      fireflyAll<FireflyBudget>(b, `/budgets?${q}`, signal),
      fireflyAll<FireflyBudgetLimit>(b, `/budget-limits?${q}`, signal).catch(() => []),
      request<Record<string, FireflySummaryEntry>>(b, `/summary/basic?${q}`, { signal }).catch(() => ({})),
    ]);
    return { lines: fromFireflyBudgets(budgets, limits), summaries: fromFireflySummary(summary) };
  }
  const { data } = await request<{ data: ActualMonth }>(b, `/months/${r.month}`, { signal });
  const m = fromActualMonth(data, b.currency);
  return { lines: m.lines, summaries: [m.summary] };
}

// ---------------------------------------------------------------------------
// Transactions

export async function transactions(
  b: Backend,
  o: { days?: number; account?: string; signal?: AbortSignal } = {},
): Promise<Transaction[]> {
  const since = daysAgo(o.days ?? 30);
  const until = daysAgo(-1);
  if (b.provider === "firefly") {
    const path = o.account
      ? `/accounts/${encodeURIComponent(o.account)}/transactions?start=${since}&end=${until}`
      : `/transactions?start=${since}&end=${until}&type=all`;
    const groups = await fireflyAll<FireflyGroup>(b, path, o.signal, 3);
    return groups.flatMap(fromFireflyGroup);
  }
  const [accountList, payees, categories] = await Promise.all([
    request<{ data: ActualAccount[] }>(b, "/accounts", { signal: o.signal }),
    request<{ data: { id: string; name: string }[] }>(b, "/payees", { signal: o.signal }).catch(() => ({ data: [] })),
    request<{ data: { id: string; name: string }[] }>(b, "/categories", { signal: o.signal }).catch(() => ({
      data: [],
    })),
  ]);
  const names = {
    accounts: new Map(accountList.data.map((a) => [a.id, a.name])),
    payees: new Map(payees.data.map((p) => [p.id, p.name])),
    categories: new Map(categories.data.map((c) => [c.id, c.name])),
  };
  const ids = o.account ? [o.account] : accountList.data.filter((a) => !a.closed).map((a) => a.id);
  const lists = await Promise.all(
    ids.map((id) =>
      request<{ data: ActualTransaction[] }>(
        b,
        `/accounts/${encodeURIComponent(id)}/transactions?since_date=${since}`,
        {
          signal: o.signal,
        },
      ).then((r) => r.data, () => [])
    ),
  );
  // A split shows as its parts; the parent only carries their sum.
  return lists.flat().filter((t) => !t.tombstone && !t.is_parent).map((t) =>
    fromActualTransaction(t, names, b.currency)
  );
}

export async function deleteTransaction(b: Backend, t: Transaction): Promise<void> {
  const path = b.provider === "firefly"
    ? `/transactions/${encodeURIComponent(t.groupId)}`
    : `/transactions/${encodeURIComponent(t.id)}`;
  await request(b, path, { method: "DELETE" });
}

// ---------------------------------------------------------------------------
// Adding an expense

export interface Choices {
  accounts: { value: string; title: string }[];
  categories: { value: string; title: string }[];
  budgets: { value: string; title: string }[];
}

/** What the expense form offers, remembered for the next time it opens. */
export async function choices(b: Backend, signal?: AbortSignal): Promise<Choices> {
  let c: Choices;
  if (b.provider === "firefly") {
    const [accs, cats, buds] = await Promise.all([
      fireflyAll<FireflyAccount>(b, "/accounts?type=asset", signal),
      fireflyAll<{ id: string; attributes: { name: string } }>(b, "/categories", signal).catch(() => []),
      fireflyAll<FireflyBudget>(b, "/budgets", signal).catch(() => []),
    ]);
    c = {
      accounts: accs.filter((a) => a.attributes.active !== false).map((a) => ({
        value: a.id,
        title: a.attributes.name,
      })),
      // Firefly takes the category by name (and creates it if new).
      categories: cats.map((x) => ({ value: x.attributes.name, title: x.attributes.name })),
      budgets: buds.filter((x) => x.attributes.active !== false).map((x) => ({
        value: x.id,
        title: x.attributes.name,
      })),
    };
  } else {
    const [accs, cats] = await Promise.all([
      request<{ data: ActualAccount[] }>(b, "/accounts", { signal }),
      request<{ data: { id: string; name: string; is_income?: boolean; hidden?: boolean }[] }>(b, "/categories", {
        signal,
      }),
    ]);
    c = {
      accounts: accs.data.filter((a) => !a.closed && !a.offbudget).map((a) => ({ value: a.id, title: a.name })),
      categories: cats.data.filter((x) => !x.is_income && !x.hidden).map((x) => ({ value: x.id, title: x.name })),
      budgets: [],
    };
  }
  await storage.set(`choices:${b.provider}:${b.base}`, c as unknown as Parameters<typeof storage.set>[1]).catch(
    () => {},
  );
  return c;
}

export async function savedChoices(b: Backend): Promise<Choices | undefined> {
  return await storage.get(`choices:${b.provider}:${b.base}`).catch(() => undefined) as Choices | undefined;
}

export async function addExpense(b: Backend, e: Expense): Promise<void> {
  if (b.provider === "firefly") {
    await request(b, "/transactions", { method: "POST", body: fireflyExpense(e) });
  } else {
    await request(b, `/accounts/${encodeURIComponent(e.account)}/transactions`, {
      method: "POST",
      body: actualExpense(e),
    });
  }
  await storage.set(`lastAccount:${b.provider}`, e.account).catch(() => {});
}

export async function lastAccount(b: Backend): Promise<string | undefined> {
  return await storage.get<string>(`lastAccount:${b.provider}`).catch(() => undefined);
}

// ---------------------------------------------------------------------------
// Links

export function webUrl(b: Backend, what?: { account?: string; transaction?: string }): string | undefined {
  if (b.provider === "firefly") {
    if (what?.account) return `${b.base}/accounts/show/${what.account}`;
    if (what?.transaction) return `${b.base}/transactions/show/${what.transaction}`;
    return b.base;
  }
  if (!b.web) return undefined;
  return what?.account ? `${b.web}/accounts/${what.account}` : `${b.web}/budget`;
}

// ---------------------------------------------------------------------------
// Setup

const CONFIGURE = "**Settings → Extensions → Budget → Configure**";

export function setupItem(e: SetupError): Item {
  const md = [
    `## ${e.message}`,
    "",
    "Set up one or both, in " + CONFIGURE + ":",
    "",
    "**Firefly III**: its address as you open it in the browser (`http://firefly.local`, `http://192.168.1.20:8080`),",
    "and a token from **Options → Profile → OAuth → Personal Access Tokens → Create new token**.",
    "",
    "**Actual Budget** has no web API of its own: run [actual-http-api](https://github.com/jhonderson/actual-http-api)",
    "next to your Actual server (`docker run -p 5007:5007 -e ACTUAL_SERVER_URL=… -e ACTUAL_SERVER_PASSWORD=… -e API_KEY=… jhonderson/actual-http-api`),",
    "then set its address, the `API_KEY`, and your budget's **Sync ID** (Actual → Settings → Show advanced settings).",
    "",
    "Addresses can be this computer, local names (`*.local`, `*.lan`, `*.home.arpa`…), private networks",
    "(`192.168.x.x`, `10.x.x.x`), Tailscale (`100.64.x.x`, `*.ts.net`) or DuckDNS.",
  ];
  return {
    id: "setup",
    title: e.message,
    subtitle: e.provider ? `${PROVIDER_NAMES[e.provider]} settings` : "Budget settings",
    icon: { source: e.message.includes("token") || e.message.includes("key") ? Icons.key : Icons.plug, tint: "orange" },
    detail: { markdown: md.join("\n") },
    actions: [
      ...(e.base
        ? [open(e.base, `Open ${e.provider ? PROVIDER_NAMES[e.provider] : "Server"}`, { icon: Icons.globe })]
        : []),
      open("https://github.com/jhonderson/actual-http-api", "About actual-http-api", { icon: Icons.external }),
    ],
  };
}

/** Each backend's result, or its error: one server down doesn't hide the other. */
export async function each<T>(
  list: Backend[],
  load: (b: Backend) => Promise<T>,
): Promise<{ ok: { backend: Backend; value: T }[]; errors: { backend: Backend; error: Error }[] }> {
  const settled = await Promise.allSettled(list.map(load));
  const ok: { backend: Backend; value: T }[] = [];
  const errors: { backend: Backend; error: Error }[] = [];
  settled.forEach((r, i) =>
    r.status === "fulfilled"
      ? ok.push({ backend: list[i], value: r.value })
      : errors.push({ backend: list[i], error: r.reason })
  );
  return { ok, errors };
}
