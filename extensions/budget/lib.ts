// Firefly III and Actual Budget (through actual-http-api) as one model:
// accounts, budgets for a month, transactions; money, dates and amounts typed by hand.

/**
 * Where these servers usually run, as declared in `[permissions] net` (kept
 * equal by a test). Extensions declare their hosts statically.
 */
export const HOSTS = [
  "localhost",
  "127.0.0.1",
  "firefly",
  "firefly-iii",
  "actual",
  "actual-http-api",
  "*.local",
  "*.lan",
  "*.home",
  "*.home.arpa",
  "*.internal",
  "*.duckdns.org",
  "*.ts.net",
  "10.0.0.0/8",
  "172.16.0.0/12",
  "192.168.0.0/16",
  "100.64.0.0/10",
  "demo.firefly-iii.org",
];

function ipv4(host: string): number | undefined {
  const parts = host.split(".");
  if (parts.length !== 4 || parts.some((p) => !/^\d{1,3}$/.test(p) || Number(p) > 255)) return undefined;
  return parts.reduce((n, p) => n * 256 + Number(p), 0);
}

/** Whether Deno's `--allow-net` with {@link HOSTS} lets us reach `host`. */
export function isAllowedHost(host: string, patterns = HOSTS): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, "");
  return patterns.some((p) => {
    if (p.startsWith("*.")) return h.endsWith(p.slice(1)) || h === p.slice(2);
    const cidr = /^([\d.]+)\/(\d+)$/.exec(p);
    if (cidr) {
      const ip = ipv4(h), net = ipv4(cidr[1]);
      if (ip === undefined || net === undefined) return false;
      const bits = Number(cidr[2]);
      const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
      return ((ip & mask) >>> 0) === ((net & mask) >>> 0);
    }
    return h === p;
  });
}

/** `firefly.local/` or `http://x:8080/api/v1` → `http://firefly.local`; a sub-path is kept. */
export function normalizeUrl(input: unknown): string {
  let url = String(input ?? "").trim();
  if (!url) return "";
  if (!/^https?:\/\//i.test(url)) url = `http://${url}`;
  try {
    const u = new URL(url);
    const path = u.pathname.replace(/\/(api(\/v1)?|v1|login|budget|accounts)\/?$/i, "").replace(/\/+$/, "");
    return `${u.protocol}//${u.host}${path}`;
  } catch {
    return "";
  }
}

// ---------------------------------------------------------------------------
// Model

export type Provider = "firefly" | "actual";
export const PROVIDER_NAMES: Record<Provider, string> = { firefly: "Firefly III", actual: "Actual Budget" };

export interface Account {
  provider: Provider;
  id: string;
  name: string;
  /** "Checking", "Savings", "Credit card", "Cash", "Off budget"… */
  group: string;
  balance: number;
  currency: string;
  iban?: string;
  /** Counts in the net worth. */
  netWorth: boolean;
}

export interface BudgetLine {
  provider: Provider;
  id: string;
  name: string;
  group?: string;
  /** What was planned for the month (0 when none). */
  budgeted: number;
  /** Spent this month, as a positive number. */
  spent: number;
  currency: string;
}

export type Kind = "withdrawal" | "deposit" | "transfer";

export interface Transaction {
  provider: Provider;
  id: string;
  /** What to delete or open: Firefly's group, Actual's transaction. */
  groupId: string;
  date: string;
  /** Signed: negative leaves your accounts. */
  amount: number;
  currency: string;
  kind: Kind;
  description: string;
  account: string;
  counterparty: string;
  category?: string;
  budget?: string;
  notes?: string;
  tags?: string[];
}

export interface MonthSummary {
  provider: Provider;
  currency: string;
  spent: number;
  earned: number;
  /** Firefly: left to spend in budgets; Actual: still to budget. */
  left?: number;
  netWorth?: number;
}

// ---------------------------------------------------------------------------
// Money and dates

/** "12,50", "12.50 €", "-€1 234,56", "1,234.56", "1.500" → 12.5, 12.5, 1234.56, 1234.56, 1500 (always positive). */
export function parseAmount(input: unknown): number | undefined {
  let s = String(input ?? "").replace(/[^\d.,]/g, "");
  if (!s) return undefined;
  const lastComma = s.lastIndexOf(","), lastDot = s.lastIndexOf(".");
  if (lastComma > -1 && lastDot > -1) {
    // The last separator is the decimal one.
    s = lastComma > lastDot ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  } else if (/^\d{1,3}([.,]\d{3})+$/.test(s)) {
    // "1,234" or "1.500": money has two decimals, so three digits after the separator are thousands.
    s = s.replace(/[.,]/g, "");
  } else {
    s = s.replace(",", ".");
  }
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : undefined;
}

export function money(value: number, currency = "EUR", o: { sign?: boolean } = {}): string {
  let text: string;
  try {
    text = new Intl.NumberFormat("en-GB", { style: "currency", currency: currency.toUpperCase() }).format(
      Math.abs(value),
    );
  } catch {
    text = `${Math.abs(value).toFixed(2)} ${currency}`;
  }
  if (value < 0) return `−${text}`;
  return o.sign && value > 0 ? `+${text}` : text;
}

/** Cents (Actual's integers) → units. */
export const fromCents = (n: unknown) => (Number(n) || 0) / 100;
export const toCents = (n: number) => Math.round(n * 100);

const pad = (n: number) => String(n).padStart(2, "0");
export const isoDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** The first and last day of the month `offset` months from `now`. */
export function monthRange(now = new Date(), offset = 0): { start: string; end: string; month: string; title: string } {
  const first = new Date(now.getFullYear(), now.getMonth() + offset, 1);
  const last = new Date(now.getFullYear(), now.getMonth() + offset + 1, 0);
  return {
    start: isoDate(first),
    end: isoDate(last),
    month: `${first.getFullYear()}-${pad(first.getMonth() + 1)}`,
    title: first.toLocaleDateString("en-GB", { month: "long", year: "numeric" }),
  };
}

export function daysAgo(n: number, now = new Date()): string {
  return isoDate(new Date(now.getFullYear(), now.getMonth(), now.getDate() - n));
}

/** "2026-10-29" or "29/10/2026" or "today" / "yesterday" → "2026-10-29". */
export function parseDate(input: unknown, now = new Date()): string | undefined {
  const s = String(input ?? "").trim().toLowerCase();
  if (!s || s === "today" || s === "aujourd'hui") return isoDate(now);
  if (s === "yesterday" || s === "hier") return daysAgo(1, now);
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (m) return valid(Number(m[1]), Number(m[2]), Number(m[3]));
  m = /^(\d{1,2})[/.](\d{1,2})(?:[/.](\d{2,4}))?$/.exec(s);
  if (m) {
    const y = m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : now.getFullYear();
    return valid(y, Number(m[2]), Number(m[1]));
  }
  return undefined;
}

function valid(y: number, m: number, d: number): string | undefined {
  const date = new Date(y, m - 1, d);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d ? isoDate(date) : undefined;
}

/** "Today", "Yesterday", "Monday 26 October". */
export function dayTitle(date: string, now = new Date()): string {
  if (date === isoDate(now)) return "Today";
  if (date === daysAgo(1, now)) return "Yesterday";
  const [y, m, d] = date.split("-").map(Number);
  // Built from parts: ICU versions disagree on the comma after the weekday.
  const dt = new Date(y, m - 1, d);
  const part = (o: Intl.DateTimeFormatOptions) => dt.toLocaleDateString("en-GB", o);
  const day = `${part({ weekday: "long" })} ${d} ${part({ month: "long" })}`;
  return y !== now.getFullYear() ? `${day} ${y}` : day;
}

/** How much of a budget is gone, and how it looks. */
export function usage(b: Pick<BudgetLine, "budgeted" | "spent">, dayRatio = 1): {
  ratio: number;
  color: "green" | "orange" | "red" | "gray";
} {
  if (b.budgeted <= 0) return { ratio: b.spent > 0 ? 1 : 0, color: b.spent > 0 ? "orange" : "gray" };
  const ratio = b.spent / b.budgeted;
  // Ahead of the month's pace is a warning before it is overspent.
  return { ratio, color: ratio > 1 ? "red" : ratio > Math.min(1, dayRatio + 0.1) ? "orange" : "green" };
}

/** How far into the month we are, 0 to 1. */
export function monthProgress(now = new Date()): number {
  const days = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  return (now.getDate() - 1 + now.getHours() / 24) / days;
}

/** Budgets most used first, the ones without a plan last. */
export function sortBudgets(list: BudgetLine[]): BudgetLine[] {
  return [...list].sort((a, b) =>
    Number(a.budgeted <= 0) - Number(b.budgeted <= 0) ||
    usage(b).ratio - usage(a).ratio ||
    b.spent - a.spent
  );
}

/** Totals per currency. */
export function totals(accounts: Account[]): { currency: string; total: number }[] {
  const by = new Map<string, number>();
  for (const a of accounts) if (a.netWorth) by.set(a.currency, (by.get(a.currency) ?? 0) + a.balance);
  return [...by].map(([currency, total]) => ({ currency, total: Math.round(total * 100) / 100 }));
}

// ---------------------------------------------------------------------------
// Firefly III

export interface FireflyAccount {
  id: string;
  attributes: {
    name: string;
    type?: string;
    active?: boolean;
    account_role?: string | null;
    current_balance?: string;
    currency_code?: string | null;
    iban?: string | null;
    include_net_worth?: boolean;
    liability_type?: string | null;
  };
}

const ROLES: Record<string, string> = {
  defaultAsset: "Checking",
  sharedAsset: "Shared",
  savingAsset: "Savings",
  ccAsset: "Credit card",
  cashWalletAsset: "Cash",
};

export function fromFireflyAccount(a: FireflyAccount, fallbackCurrency = "EUR"): Account {
  const at = a.attributes;
  return {
    provider: "firefly",
    id: a.id,
    name: at.name,
    group: at.type === "liabilities" || at.type === "liability"
      ? "Liabilities"
      : ROLES[at.account_role ?? ""] ?? "Accounts",
    balance: Number(at.current_balance ?? 0) || 0,
    currency: at.currency_code || fallbackCurrency,
    iban: at.iban || undefined,
    netWorth: at.include_net_worth !== false,
  };
}

export interface FireflySummaryEntry {
  key?: string;
  monetary_value?: number | string;
  currency_code?: string;
}

/** `/summary/basic` keys: spent-in-EUR, earned-in-EUR, left-to-spend-in-EUR, net-worth-in-EUR… */
export function fromFireflySummary(json: Record<string, FireflySummaryEntry>): MonthSummary[] {
  const by = new Map<string, MonthSummary>();
  for (const [key, e] of Object.entries(json ?? {})) {
    const m = /^(spent|earned|left-to-spend|net-worth)-in-(\w+)$/.exec(key);
    if (!m) continue;
    const currency = e.currency_code || m[2];
    const s = by.get(currency) ?? { provider: "firefly" as const, currency, spent: 0, earned: 0 };
    const v = Number(e.monetary_value) || 0;
    if (m[1] === "spent") s.spent = Math.abs(v);
    if (m[1] === "earned") s.earned = Math.abs(v);
    if (m[1] === "left-to-spend") s.left = v;
    if (m[1] === "net-worth") s.netWorth = v;
    by.set(currency, s);
  }
  return [...by.values()];
}

export interface FireflyBudget {
  id: string;
  attributes: { name: string; active?: boolean; spent?: { sum?: string; currency_code?: string }[] };
}

export interface FireflyBudgetLimit {
  id: string;
  attributes: { budget_id: string | number; amount: string; currency_code?: string; spent?: string | null };
}

export function fromFireflyBudgets(
  budgets: FireflyBudget[],
  limits: FireflyBudgetLimit[],
  fallbackCurrency = "EUR",
): BudgetLine[] {
  return budgets.filter((b) => b.attributes.active !== false).map((b) => {
    const mine = limits.filter((l) => String(l.attributes.budget_id) === b.id);
    const currency = mine[0]?.attributes.currency_code || b.attributes.spent?.[0]?.currency_code || fallbackCurrency;
    const spentIn = (b.attributes.spent ?? []).filter((s) => !s.currency_code || s.currency_code === currency);
    return {
      provider: "firefly" as const,
      id: b.id,
      name: b.attributes.name,
      budgeted: mine.filter((l) => (l.attributes.currency_code || currency) === currency)
        .reduce((n, l) => n + (Number(l.attributes.amount) || 0), 0),
      spent: Math.abs(spentIn.reduce((n, s) => n + (Number(s.sum) || 0), 0)),
      currency,
    };
  });
}

export interface FireflySplit {
  transaction_journal_id?: string;
  type: string;
  date: string;
  amount: string;
  currency_code?: string;
  description: string;
  source_name?: string | null;
  destination_name?: string | null;
  category_name?: string | null;
  budget_name?: string | null;
  notes?: string | null;
  tags?: string[];
}

export interface FireflyGroup {
  id: string;
  attributes: { group_title?: string | null; transactions: FireflySplit[] };
}

export function fromFireflyGroup(g: FireflyGroup): Transaction[] {
  return g.attributes.transactions.map((t, i) => {
    const kind: Kind = t.type === "deposit" ? "deposit" : t.type === "transfer" ? "transfer" : "withdrawal";
    const amount = Math.abs(Number(t.amount) || 0);
    return {
      provider: "firefly",
      id: t.transaction_journal_id ?? `${g.id}-${i}`,
      groupId: g.id,
      date: t.date.slice(0, 10),
      // Transfers stay positive: they move money between your own accounts.
      amount: kind === "withdrawal" ? -amount : amount,
      currency: t.currency_code || "EUR",
      kind,
      description: t.description || g.attributes.group_title || "(no description)",
      account: (kind === "deposit" ? t.destination_name : t.source_name) ?? "",
      counterparty: (kind === "deposit" ? t.source_name : t.destination_name) ?? "",
      category: t.category_name || undefined,
      budget: t.budget_name || undefined,
      notes: t.notes || undefined,
      tags: t.tags?.length ? t.tags : undefined,
    };
  });
}

/** The body of POST /api/v1/transactions for one expense. */
export function fireflyExpense(e: Expense): Record<string, unknown> {
  return {
    error_if_duplicate_hash: false,
    apply_rules: true,
    fire_webhooks: true,
    transactions: [{
      type: "withdrawal",
      date: e.date,
      amount: e.amount.toFixed(2),
      description: e.description,
      source_id: e.account,
      destination_name: e.payee || e.description,
      ...(e.category ? { category_name: e.category } : {}),
      ...(e.budget ? { budget_id: e.budget } : {}),
      ...(e.notes ? { notes: e.notes } : {}),
    }],
  };
}

// ---------------------------------------------------------------------------
// Actual Budget (actual-http-api)

export interface ActualAccount {
  id: string;
  name: string;
  offbudget?: boolean;
  closed?: boolean;
}

export function fromActualAccount(a: ActualAccount, balanceCents: number, currency: string): Account {
  return {
    provider: "actual",
    id: a.id,
    name: a.name,
    group: a.offbudget ? "Off budget" : "On budget",
    balance: fromCents(balanceCents),
    currency,
    netWorth: true,
  };
}

export interface ActualMonth {
  month?: string;
  totalIncome?: number;
  totalSpent?: number;
  totalBudgeted?: number;
  toBudget?: number;
  categoryGroups?: {
    id: string;
    name: string;
    is_income?: boolean;
    hidden?: boolean;
    categories?: {
      id: string;
      name: string;
      is_income?: boolean;
      hidden?: boolean;
      budgeted?: number;
      spent?: number;
      balance?: number;
    }[];
  }[];
}

/** Expense categories of a month (amounts in cents; spending is negative). */
export function fromActualMonth(m: ActualMonth, currency: string): { lines: BudgetLine[]; summary: MonthSummary } {
  const lines: BudgetLine[] = [];
  for (const g of m.categoryGroups ?? []) {
    if (g.is_income || g.hidden) continue;
    for (const c of g.categories ?? []) {
      if (c.is_income || c.hidden) continue;
      lines.push({
        provider: "actual",
        id: c.id,
        name: c.name,
        group: g.name,
        budgeted: fromCents(c.budgeted),
        spent: Math.max(0, -fromCents(c.spent)),
        currency,
      });
    }
  }
  return {
    lines,
    summary: {
      provider: "actual",
      currency,
      spent: Math.abs(fromCents(m.totalSpent)),
      earned: Math.abs(fromCents(m.totalIncome)),
      left: m.toBudget === undefined ? undefined : fromCents(m.toBudget),
    },
  };
}

export interface ActualTransaction {
  id: string;
  account: string;
  date: string;
  amount: number;
  payee?: string | null;
  payee_name?: string | null;
  imported_payee?: string | null;
  category?: string | null;
  notes?: string | null;
  transfer_id?: string | null;
  is_parent?: boolean;
  is_child?: boolean;
  tombstone?: boolean;
}

export function fromActualTransaction(
  t: ActualTransaction,
  names: { accounts: Map<string, string>; payees: Map<string, string>; categories: Map<string, string> },
  currency: string,
): Transaction {
  const amount = fromCents(t.amount);
  const payee = t.payee_name || (t.payee ? names.payees.get(t.payee) : undefined) || t.imported_payee || "";
  return {
    provider: "actual",
    id: t.id,
    groupId: t.id,
    date: t.date,
    amount,
    currency,
    kind: t.transfer_id ? "transfer" : amount < 0 ? "withdrawal" : "deposit",
    description: t.notes?.trim() || payee || "(no payee)",
    account: names.accounts.get(t.account) ?? "",
    counterparty: payee,
    category: t.category ? names.categories.get(t.category) : undefined,
    notes: t.notes || undefined,
  };
}

/** The body for POST …/accounts/{id}/transactions. */
export function actualExpense(e: Expense): Record<string, unknown> {
  return {
    transaction: {
      account: e.account,
      date: e.date,
      amount: -toCents(e.amount),
      payee_name: e.payee || e.description,
      ...(e.category ? { category: e.category } : {}),
      notes: e.notes ? `${e.description} · ${e.notes}` : e.description,
      cleared: false,
    },
  };
}

// ---------------------------------------------------------------------------
// Expenses

export interface Expense {
  amount: number;
  description: string;
  date: string;
  /** Account id. */
  account: string;
  /** Firefly: the category name; Actual: the category id. */
  category?: string;
  budget?: string;
  payee?: string;
  notes?: string;
}

/** The form's values as an expense, or the sentence saying what is wrong. */
export function readExpense(values: Record<string, string | boolean>, now = new Date()): Expense | string {
  const amount = parseAmount(values.amount);
  if (!amount) return "Type an amount, e.g. 12.50";
  const description = String(values.description ?? "").trim();
  if (!description) return "Describe the expense";
  const date = parseDate(values.date, now);
  if (!date) return "The date should look like 2026-10-29 or 29/10";
  const account = String(values.account ?? "");
  if (!account) return "Pick an account";
  const pick = (k: string) => String(values[k] ?? "").trim() || undefined;
  return {
    amount,
    description,
    date,
    account,
    category: pick("category"),
    budget: pick("budget"),
    payee: pick("payee"),
    notes: pick("notes"),
  };
}

export function kindLook(t: Pick<Transaction, "kind" | "amount">): { color: "red" | "green" | "blue"; label: string } {
  if (t.kind === "transfer") return { color: "blue", label: "Transfer" };
  return t.amount < 0 ? { color: "red", label: "Expense" } : { color: "green", label: "Income" };
}

/** A Firefly or actual-http-api error as a sentence. */
export function apiError(provider: Provider, status: number, body: unknown): string {
  const name = PROVIDER_NAMES[provider];
  const b = body as { message?: string; error?: string; errors?: Record<string, string[]> } | undefined;
  if (status === 401 || status === 403) {
    return provider === "firefly"
      ? "Firefly III refused the access token: create a new one in Options → Profile → OAuth"
      : "actual-http-api refused the API key: check it in Settings";
  }
  if (status === 422 && b?.errors) {
    return `${name}: ${Object.values(b.errors).flat().join(" ") || b.message || "invalid"}`;
  }
  const detail = b?.message || b?.error;
  return `${name} answered ${status}${detail ? `: ${detail}` : ""}`;
}
