// Splitwise balances, groups and expenses in the shapes the commands show,
// money formatting, and the body of a new equally split expense.

import { Icons, type Item, open } from "@backslash/api";

export const API = "https://secure.splitwise.com/api/v3.0";
export const WEB = "https://secure.splitwise.com";

export class AuthError extends Error {}

export function keyOf(prefs: Record<string, unknown>): string {
  const key = String(prefs.apiKey ?? "").trim().replace(/^Bearer\s+/i, "");
  if (!key) throw new AuthError("Add your Splitwise API key");
  return key;
}

/** Splitwise errors come as `{ error }`, `{ errors: { base: [...] } }` or `{ errors: [...] }`. */
export function errorText(body: unknown): string {
  const b = body as { error?: unknown; errors?: unknown; message?: unknown } | undefined;
  if (!b) return "";
  if (typeof b.error === "string") return b.error;
  if (typeof b.message === "string") return b.message;
  const errors = b.errors;
  if (Array.isArray(errors)) return errors.map(String).join(", ");
  if (errors && typeof errors === "object") {
    return Object.entries(errors as Record<string, unknown>)
      .flatMap(([k, v]) => [v].flat().map((m) => (k === "base" ? String(m) : `${k} ${m}`)))
      .join(", ");
  }
  return "";
}

export function splitwiseError(status: number, body: unknown): Error {
  const message = errorText(body);
  if (status === 401) return new AuthError("Splitwise refused the API key");
  if (status === 403) return new Error(`Splitwise doesn't allow this${message ? `: ${message}` : ""}`);
  if (status === 404) return new Error("Not found on Splitwise: it may have been deleted");
  if (status === 429) return new Error("Splitwise is rate limiting: try again in a minute");
  return new Error(`Splitwise answered ${status}${message ? `: ${message}` : ""}`);
}

// ---------------------------------------------------------------------------
// API types (the fields used)

export interface SwBalance {
  currency_code: string;
  amount: string;
}

export interface SwUser {
  id: number;
  first_name: string;
  last_name?: string | null;
  email?: string | null;
  picture?: { small?: string; medium?: string; large?: string } | null;
  default_currency?: string;
}

export interface SwFriend extends SwUser {
  balance: SwBalance[];
  groups?: { group_id: number; balance: SwBalance[] }[];
  updated_at?: string;
}

export interface SwDebt {
  from: number;
  to: number;
  amount: string;
  currency_code: string;
}

export interface SwGroup {
  id: number;
  name: string;
  group_type?: string | null;
  updated_at?: string;
  simplify_by_default?: boolean;
  members: (SwUser & { balance: SwBalance[] })[];
  original_debts?: SwDebt[];
  simplified_debts?: SwDebt[];
}

export interface SwExpense {
  id: number;
  group_id: number | null;
  friendship_id?: number | null;
  description: string;
  details?: string | null;
  payment: boolean;
  cost: string;
  currency_code: string;
  date: string;
  created_at?: string;
  deleted_at?: string | null;
  created_by?: SwUser | null;
  category?: { id: number; name: string } | null;
  users: {
    user?: SwUser | null;
    user_id: number;
    paid_share: string;
    owed_share: string;
    net_balance: string;
  }[];
}

// ---------------------------------------------------------------------------
// Money

export interface Money {
  currency: string;
  amount: number;
}

const cents = (n: number) => Math.round(n * 100) / 100;

/** Non-zero balances, rounded to the cent. */
export function balancesOf(list: SwBalance[] | undefined): Money[] {
  return (list ?? [])
    .map((b) => ({ currency: b.currency_code, amount: cents(Number(b.amount)) }))
    .filter((m) => Number.isFinite(m.amount) && m.amount !== 0);
}

/** €12.50, −US$3.00, +£5.00 (with `sign`). */
export function money(amount: number, currency: string, o: { sign?: boolean } = {}): string {
  let s: string;
  try {
    s = new Intl.NumberFormat("en-GB", { style: "currency", currency, currencyDisplay: "symbol" }).format(
      Math.abs(amount),
    );
  } catch {
    s = `${Math.abs(amount).toFixed(2)} ${currency}`;
  }
  if (amount < 0) return `−${s}`;
  return o.sign && amount > 0 ? `+${s}` : s;
}

/** "€12.50 + US$3.00". */
export const moneyList = (list: Money[]) => list.map((m) => money(Math.abs(m.amount), m.currency)).join(" + ");

/** Sum by currency. */
export function sumByCurrency(list: Money[]): Money[] {
  const by = new Map<string, number>();
  for (const m of list) by.set(m.currency, (by.get(m.currency) ?? 0) + m.amount);
  return [...by].map(([currency, amount]) => ({ currency, amount: cents(amount) })).filter((m) => m.amount !== 0);
}

/** "12,50", "€12.50", "1 234,56", "1,234.56" → a positive number, or undefined. */
export function parseAmount(input: unknown): number | undefined {
  let s = String(input ?? "").replace(/[^\d.,]/g, "");
  if (!/\d/.test(s)) return undefined;
  const dot = s.lastIndexOf("."), comma = s.lastIndexOf(",");
  if (dot >= 0 && comma >= 0) {
    // Both: the last one is the decimal separator.
    const dec = dot > comma ? "." : ",";
    s = s.replace(dec === "." ? /,/g : /\./g, "").replace(",", ".");
  } else if (dot >= 0 || comma >= 0) {
    const sep = dot >= 0 ? "." : ",";
    const parts = s.split(sep);
    // "1,234" and "1.234.567" are thousands; "12,5" and "4.50" are decimals.
    const thousands = parts.length > 2 || (parts[1].length === 3 && /^\d{1,3}$/.test(parts[0]) && parts[0] !== "0");
    s = thousands ? parts.join("") : `${parts.slice(0, -1).join("")}.${parts.at(-1)}`;
  }
  const n = cents(Number(s));
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

// ---------------------------------------------------------------------------
// People

export const fullName = (u: { first_name?: string | null; last_name?: string | null } | null | undefined) =>
  [u?.first_name, u?.last_name].filter(Boolean).join(" ").trim() || "Someone";

// ---------------------------------------------------------------------------
// Friends

export type Direction = "owed" | "owe" | "mixed" | "settled";

export interface FriendBalance {
  id: number;
  name: string;
  email?: string;
  /** Positive: they owe you. */
  total: Money[];
  /** Per group, by name ("Non-group expenses" for direct ones). */
  groups: { id: number; name: string; balance: Money[] }[];
  direction: Direction;
  updated?: string;
}

export function directionOf(total: Money[]): Direction {
  if (!total.length) return "settled";
  if (total.every((m) => m.amount > 0)) return "owed";
  if (total.every((m) => m.amount < 0)) return "owe";
  return "mixed";
}

export function friendBalance(f: SwFriend, groupNames: Map<number, string>): FriendBalance {
  const total = balancesOf(f.balance);
  return {
    id: f.id,
    name: fullName(f),
    email: f.email ?? undefined,
    total,
    groups: (f.groups ?? [])
      .map((g) => ({
        id: g.group_id,
        name: g.group_id === 0 ? "Non-group expenses" : groupNames.get(g.group_id) ?? `Group ${g.group_id}`,
        balance: balancesOf(g.balance),
      }))
      .filter((g) => g.balance.length),
    direction: directionOf(total),
    updated: f.updated_at,
  };
}

/** "owes you €12.50", "you owe €5.00", "owes you €3.00 · you owe US$2.00", "settled up". */
export function balanceSentence(total: Money[], who = "owes you"): string {
  if (!total.length) return "settled up";
  const owed = total.filter((m) => m.amount > 0), owe = total.filter((m) => m.amount < 0);
  return [
    owed.length ? `${who} ${moneyList(owed)}` : "",
    owe.length ? `you owe ${moneyList(owe)}` : "",
  ].filter(Boolean).join(" · ");
}

/** Biggest debts first: what people owe you, then what you owe, then the settled. */
export function sortFriends(list: FriendBalance[]): FriendBalance[] {
  const rank: Record<Direction, number> = { owed: 0, mixed: 1, owe: 2, settled: 3 };
  const size = (f: FriendBalance) => f.total.reduce((s, m) => s + Math.abs(m.amount), 0);
  return [...list].sort((a, b) =>
    rank[a.direction] - rank[b.direction] || size(b) - size(a) || a.name.localeCompare(b.name)
  );
}

/** What people owe you and what you owe, by currency. */
export function totals(list: FriendBalance[]): { owed: Money[]; owe: Money[] } {
  const all = list.flatMap((f) => f.total);
  return {
    owed: sumByCurrency(all.filter((m) => m.amount > 0)),
    owe: sumByCurrency(all.filter((m) => m.amount < 0)),
  };
}

/** A friendly nudge to paste in a chat. */
export function reminderText(f: FriendBalance): string {
  const owed = f.total.filter((m) => m.amount > 0);
  if (!owed.length) return "";
  return `Hi ${f.name.split(" ")[0]}! Splitwise says you owe me ${
    moneyList(owed)
  }. You can settle up on Splitwise whenever it suits you. Thanks!`;
}

// ---------------------------------------------------------------------------
// Groups

export interface GroupBalance {
  id: number;
  name: string;
  type?: string;
  /** Your balance in the group; positive: you get back. */
  mine: Money[];
  /** Debts involving you, as sentences: "Ada owes you €12.50". */
  yourDebts: { text: string; amount: number; currency: string }[];
  /** Every debt, for the preview. */
  debts: string[];
  members: { id: number; name: string; balance: Money[] }[];
  direction: Direction;
  updated?: string;
}

export function groupBalance(g: SwGroup, me: number): GroupBalance {
  const name = (id: number) => id === me ? "You" : fullName(g.members.find((m) => m.id === id));
  const debts = (g.simplify_by_default === false ? g.original_debts : g.simplified_debts) ?? g.simplified_debts ?? [];
  const mine = balancesOf(g.members.find((m) => m.id === me)?.balance);
  const mineDebts = debts
    .filter((d) => d.from === me || d.to === me)
    .map((d) => {
      const amount = cents(Number(d.amount));
      return d.to === me
        ? { text: `${name(d.from)} owes you ${money(amount, d.currency_code)}`, amount, currency: d.currency_code }
        : {
          text: `You owe ${name(d.to)} ${money(amount, d.currency_code)}`,
          amount: -amount,
          currency: d.currency_code,
        };
    });
  return {
    id: g.id,
    name: g.name,
    type: g.group_type && g.group_type !== "other" ? g.group_type : undefined,
    mine,
    yourDebts: mineDebts,
    debts: debts.map((d) =>
      `${name(d.from)} ${d.from === me ? "owe" : "owes"} ${d.to === me ? "you" : name(d.to)} ${
        money(Number(d.amount), d.currency_code)
      }`
    ),
    members: g.members.map((m) => ({ id: m.id, name: name(m.id), balance: balancesOf(m.balance) })),
    direction: directionOf(mine),
    updated: g.updated_at,
  };
}

/** Real groups (not the "Non-group expenses" bucket), unsettled first, then the latest activity. */
export function sortGroups(list: GroupBalance[]): GroupBalance[] {
  return list.filter((g) => g.id !== 0).sort((a, b) =>
    Number(a.direction === "settled") - Number(b.direction === "settled") ||
    (b.updated ?? "").localeCompare(a.updated ?? "") || a.name.localeCompare(b.name)
  );
}

// ---------------------------------------------------------------------------
// Expenses

export interface Expense {
  id: number;
  description: string;
  payment: boolean;
  cost: number;
  currency: string;
  date: string;
  groupId?: number;
  category?: string;
  notes?: string;
  createdBy?: string;
  /** Who paid, "You" for you. */
  paidBy: string[];
  /** Your share of it: positive you lent, negative you borrowed, 0 not involved. */
  net: number;
  involved: boolean;
  shares: { name: string; paid: number; owed: number }[];
}

export function fromExpense(e: SwExpense, me: number): Expense | undefined {
  if (e.deleted_at) return undefined;
  const nameOf = (u: SwExpense["users"][number]) => u.user_id === me ? "You" : fullName(u.user);
  const mine = e.users.find((u) => u.user_id === me);
  const shares = e.users.map((u) => ({
    name: nameOf(u),
    paid: cents(Number(u.paid_share)),
    owed: cents(Number(u.owed_share)),
  }));
  return {
    id: e.id,
    description: e.description?.trim() || (e.payment ? "Payment" : "Expense"),
    payment: e.payment,
    cost: cents(Number(e.cost)),
    currency: e.currency_code,
    date: e.date,
    groupId: e.group_id || undefined,
    category: e.category?.name && e.category.name !== "General" ? e.category.name : undefined,
    notes: e.details?.trim() || undefined,
    createdBy: e.created_by ? (e.created_by.id === me ? "You" : fullName(e.created_by)) : undefined,
    paidBy: shares.filter((s) => s.paid > 0).map((s) => s.name),
    net: mine ? cents(Number(mine.net_balance)) : 0,
    involved: Boolean(mine && (Number(mine.paid_share) || Number(mine.owed_share))),
    shares,
  };
}

/** "you lent €20.00", "you borrowed €20.00", "not involved". */
export function shareLabel(e: Expense): { text: string; color?: "green" | "red" } {
  if (!e.involved || e.net === 0) return { text: e.involved ? "settled" : "not involved" };
  if (e.payment) {
    return e.net > 0
      ? { text: `you paid ${money(e.net, e.currency)}`, color: "green" }
      : { text: `you received ${money(-e.net, e.currency)}`, color: "red" };
  }
  return e.net > 0
    ? { text: `you lent ${money(e.net, e.currency)}`, color: "green" }
    : { text: `you borrowed ${money(-e.net, e.currency)}`, color: "red" };
}

/** "Ada paid €40.00", "Ada paid Bob €20.00" for a payment. */
export function paidSentence(e: Expense): string {
  if (e.payment) {
    const from = e.shares.find((s) => s.paid > 0)?.name ?? "Someone";
    const to = e.shares.find((s) => s.owed > 0)?.name ?? "someone";
    return `${from} paid ${to === "You" ? "you" : to} ${money(e.cost, e.currency)}`;
  }
  const who = e.paidBy.length > 1 ? `${e.paidBy.length} people` : e.paidBy[0] ?? "Someone";
  return `${who} paid ${money(e.cost, e.currency)}`;
}

const DAY = 86_400_000;
const localDay = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** "Today", "Yesterday", "Monday 26 October", "12 March 2025". */
export function dayTitle(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const key = localDay(d);
  if (key === localDay(now)) return "Today";
  if (key === localDay(new Date(now.getTime() - DAY))) return "Yesterday";
  const days = (now.getTime() - d.getTime()) / DAY;
  const month = d.toLocaleString("en-GB", { month: "long" });
  if (days < 7 && days > 0) return `${d.toLocaleString("en-GB", { weekday: "long" })} ${d.getDate()} ${month}`;
  return d.getFullYear() === now.getFullYear()
    ? `${d.getDate()} ${month}`
    : `${d.getDate()} ${month} ${d.getFullYear()}`;
}

export const isoDay = (d: Date) => localDay(d);

/** "", "today", "yesterday", "hier", "2026-10-29", "29/10", "29/10/2026" → YYYY-MM-DD. */
export function parseDate(input: string, now = new Date()): string | undefined {
  const s = input.trim().toLowerCase();
  if (!s || s === "today" || s === "aujourd'hui") return localDay(now);
  if (s === "yesterday" || s === "hier") return localDay(new Date(now.getTime() - DAY));
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  let y: number, mo: number, d: number;
  if (m) [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  else {
    m = /^(\d{1,2})[/.](\d{1,2})(?:[/.](\d{2,4}))?$/.exec(s);
    if (!m) return undefined;
    d = Number(m[1]);
    mo = Number(m[2]);
    y = m[3] ? Number(m[3].length === 2 ? `20${m[3]}` : m[3]) : now.getFullYear();
  }
  const date = new Date(y, mo - 1, d);
  if (date.getFullYear() !== y || date.getMonth() !== mo - 1 || date.getDate() !== d) return undefined;
  return localDay(date);
}

// ---------------------------------------------------------------------------
// New expense

/** `total` split in `n` shares to the cent; the first ones take the leftover cents. */
export function equalShares(total: number, n: number): number[] {
  const c = Math.round(total * 100);
  const base = Math.floor(c / n), extra = c - base * n;
  return Array.from({ length: n }, (_, i) => (base + (i < extra ? 1 : 0)) / 100);
}

export interface NewExpense {
  cost: number;
  currency: string;
  description: string;
  date: string;
  notes?: string;
  with: { kind: "group"; id: number } | { kind: "friend"; id: number };
}

/**
 * The body of POST /create_expense. A group: `split_equally` lets Splitwise
 * share it among the members, you as the payer. A friend: the two shares,
 * spelled out (the API splits equally only within a group).
 */
export function expenseBody(e: NewExpense, me: number): Record<string, string | number | boolean> {
  const base = {
    cost: e.cost.toFixed(2),
    currency_code: e.currency,
    description: e.description,
    date: `${e.date}T12:00:00Z`,
    ...(e.notes ? { details: e.notes } : {}),
  };
  if (e.with.kind === "group") return { ...base, group_id: e.with.id, split_equally: true };
  const [mine, theirs] = equalShares(e.cost, 2);
  return {
    ...base,
    group_id: 0,
    users__0__user_id: me,
    users__0__paid_share: e.cost.toFixed(2),
    users__0__owed_share: mine.toFixed(2),
    users__1__user_id: e.with.id,
    users__1__paid_share: "0.00",
    users__1__owed_share: theirs.toFixed(2),
  };
}

/** Form values → a new expense, or the sentence saying what's wrong. */
export function readExpense(values: Record<string, string | boolean>, now = new Date()): NewExpense | string {
  const cost = parseAmount(values.cost);
  if (!cost) return "Type an amount, like 12.50";
  const description = String(values.description ?? "").trim();
  if (!description) return "Type what it was for";
  const date = parseDate(String(values.date ?? ""), now);
  if (!date) return "Type the date as 2026-10-29 or 29/10";
  const m = /^([gf]):(\d+)$/.exec(String(values.with ?? ""));
  if (!m) return "Pick whom you shared it with";
  const currency = String(values.currency ?? "").trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) return "Pick a currency";
  return {
    cost,
    currency,
    description,
    date,
    notes: String(values.notes ?? "").trim() || undefined,
    with: { kind: m[1] === "g" ? "group" : "friend", id: Number(m[2]) },
  };
}

export const COMMON_CURRENCIES = ["EUR", "USD", "GBP", "CHF", "CAD", "AUD", "JPY", "SEK", "NOK", "DKK", "PLN", "INR"];

// ---------------------------------------------------------------------------
// Links

export const friendUrl = (id: number) => `${WEB}/#/friends/${id}`;
export const groupUrl = (id: number) => `${WEB}/#/groups/${id}`;
export const dashboardUrl = `${WEB}/#/dashboard`;
export const expenseUrl = (e: Expense) => e.groupId ? groupUrl(e.groupId) : `${WEB}/#/all`;

// ---------------------------------------------------------------------------
// Setup

export function setupItem(e: AuthError): Item {
  return {
    id: "setup",
    title: e.message,
    subtitle: "A personal API key from Splitwise",
    icon: { source: Icons.key, tint: "orange" },
    detail: {
      markdown: [
        `## ${e.message}`,
        "",
        "1. Open **secure.splitwise.com/apps** (Enter opens it) and choose **Register your application**.",
        "2. Any name and homepage will do (e.g. *Backslash*, `https://example.com`).",
        "3. On the app's page, copy the **API key** under *Your personal API key*.",
        "4. Paste it in **Settings → Extensions → Splitwise → Configure → Splitwise API key**.",
        "",
        "The key acts as you: keep it to yourself. It is stored in the system keyring.",
      ].join("\n"),
    },
    actions: [open(`${WEB}/apps`, "Open Splitwise Apps", { icon: Icons.key })],
  };
}
