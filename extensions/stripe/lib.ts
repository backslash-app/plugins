// Stripe objects as launcher items: payments, customers, subscriptions, balance. Formatting is pure and tested.

import {
  type Accessory,
  type Action,
  action,
  type Color,
  copy,
  field,
  form,
  Icons,
  type Item,
  meta,
  type Metadata,
  open,
  pop,
  refresh,
  type Stat,
  toast,
} from "@backslash/api";
import { type Account, dashboard, type Page, stripe } from "./api.ts";

// ---------------------------------------------------------------------------
// Shapes (the fields used here)

export interface Card {
  brand?: string;
  last4?: string;
  exp_month?: number;
  exp_year?: number;
  country?: string | null;
  funding?: string;
  wallet?: { type?: string } | null;
}

export interface BalanceTransaction {
  id: string;
  amount: number;
  fee: number;
  net: number;
  currency: string;
}

export interface Charge {
  id: string;
  amount: number;
  amount_refunded: number;
  refunded: boolean;
  disputed?: boolean;
  paid?: boolean;
  status?: string;
  receipt_url?: string | null;
  failure_message?: string | null;
  outcome?: { risk_level?: string; risk_score?: number; seller_message?: string; network_status?: string } | null;
  payment_method_details?: { type: string; card?: Card } | null;
  billing_details?:
    | { name?: string | null; email?: string | null; address?: { country?: string | null } | null }
    | null;
  balance_transaction?: string | BalanceTransaction | null;
}

export interface Customer {
  id: string;
  object?: "customer";
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  description?: string | null;
  created: number;
  currency?: string | null;
  balance?: number;
  delinquent?: boolean | null;
  address?: { country?: string | null; city?: string | null } | null;
  deleted?: boolean;
  metadata?: Record<string, string>;
}

export interface PaymentIntent {
  id: string;
  amount: number;
  amount_received?: number;
  currency: string;
  status: string;
  created: number;
  description?: string | null;
  receipt_email?: string | null;
  statement_descriptor?: string | null;
  customer?: string | Customer | null;
  latest_charge?: string | Charge | null;
  last_payment_error?: { message?: string; code?: string; decline_code?: string } | null;
  cancellation_reason?: string | null;
  payment_method_types?: string[];
  metadata?: Record<string, string>;
  livemode?: boolean;
}

export interface Price {
  id: string;
  unit_amount?: number | null;
  currency: string;
  nickname?: string | null;
  product: string | { id: string; name: string };
  recurring?: { interval: "day" | "week" | "month" | "year"; interval_count: number } | null;
}

export interface Subscription {
  id: string;
  status: string;
  customer: string | Customer;
  created: number;
  currency?: string;
  current_period_end?: number;
  cancel_at_period_end?: boolean;
  cancel_at?: number | null;
  canceled_at?: number | null;
  trial_end?: number | null;
  items: { data: { id: string; quantity?: number; price: Price; current_period_end?: number }[] };
  metadata?: Record<string, string>;
}

export interface Money {
  amount: number;
  currency: string;
}

export interface Balance {
  available: Money[];
  pending: Money[];
  instant_available?: Money[];
  livemode?: boolean;
}

export interface Payout {
  id: string;
  amount: number;
  currency: string;
  arrival_date: number;
  created: number;
  status: string;
  method?: string;
  description?: string | null;
}

// ---------------------------------------------------------------------------
// Formatting

/** Currencies without minor units (amounts are whole). */
const ZERO_DECIMAL = new Set([
  "bif",
  "clp",
  "djf",
  "gnf",
  "jpy",
  "kmf",
  "krw",
  "mga",
  "pyg",
  "rwf",
  "ugx",
  "vnd",
  "vuv",
  "xaf",
  "xof",
  "xpf",
]);

/** `money(4200, "eur")` → "€42.00"; `money(500, "jpy")` → "¥500". */
export function money(amount: number, currency: string): string {
  const cur = currency.toLowerCase();
  const value = ZERO_DECIMAL.has(cur) ? amount : amount / 100;
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: cur.toUpperCase() }).format(value);
  } catch {
    return `${value.toFixed(2)} ${cur.toUpperCase()}`;
  }
}

/** Amounts grouped by currency: "€1,204.00 + $80.00". */
export function sumByCurrency(rows: Money[]): string {
  const totals = new Map<string, number>();
  for (const r of rows) totals.set(r.currency, (totals.get(r.currency) ?? 0) + r.amount);
  if (!totals.size) return money(0, "usd");
  return [...totals].sort((a, b) => b[1] - a[1]).map(([c, a]) => money(a, c)).join(" + ");
}

export const date = (unix: number | null | undefined) =>
  unix ? new Date(unix * 1000).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—";

export const dateTime = (unix: number) =>
  new Date(unix * 1000).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/** "just now", "5m", "3h", "2d", "25 Oct". */
export function since(unix: number, now = Date.now()): string {
  const s = Math.round(now / 1000 - unix);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)}d`;
  return new Date(unix * 1000).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

export function humanize(s: string): string {
  const t = String(s ?? "").replace(/_/g, " ");
  return t.charAt(0).toUpperCase() + t.slice(1);
}

const BRANDS: Record<string, string> = {
  visa: "Visa",
  mastercard: "Mastercard",
  amex: "Amex",
  discover: "Discover",
  jcb: "JCB",
  diners: "Diners",
  unionpay: "UnionPay",
  cartes_bancaires: "Cartes Bancaires",
};

const METHODS: Record<string, string> = {
  sepa_debit: "SEPA Debit",
  us_bank_account: "ACH",
  link: "Link",
  paypal: "PayPal",
  ideal: "iDEAL",
  bancontact: "Bancontact",
  klarna: "Klarna",
  afterpay_clearpay: "Afterpay",
  apple_pay: "Apple Pay",
  google_pay: "Google Pay",
};

/** "Visa •••• 4242", "Apple Pay · Visa •••• 4242", "SEPA Debit". */
export function paymentMethodText(charge: Charge | undefined): string | undefined {
  const d = charge?.payment_method_details;
  if (!d) return undefined;
  if (d.type === "card" && d.card) {
    const brand = BRANDS[d.card.brand ?? ""] ?? humanize(d.card.brand ?? "Card");
    const wallet = d.card.wallet?.type ? `${METHODS[d.card.wallet.type] ?? humanize(d.card.wallet.type)} · ` : "";
    return `${wallet}${brand} •••• ${d.card.last4 ?? "????"}`;
  }
  return METHODS[d.type] ?? humanize(d.type);
}

export const asCharge = (c: PaymentIntent["latest_charge"]) => (c && typeof c === "object" ? c : undefined);
export const asCustomer = (c: PaymentIntent["customer"]) => (c && typeof c === "object" && !c.deleted ? c : undefined);
const idOf = (x: string | { id: string } | null | undefined) => (typeof x === "string" ? x : x?.id);

export interface Look {
  label: string;
  color: Color;
  icon: string;
}

export function paymentLook(pi: PaymentIntent): Look {
  const charge = asCharge(pi.latest_charge);
  if (pi.status === "succeeded") {
    if (charge?.disputed) return { label: "Disputed", color: "red", icon: Icons.alert };
    if (charge?.refunded) return { label: "Refunded", color: "gray", icon: Icons.history };
    if (charge?.amount_refunded) return { label: "Partially refunded", color: "yellow", icon: Icons.history };
    return { label: "Succeeded", color: "green", icon: Icons.done };
  }
  switch (pi.status) {
    case "requires_payment_method":
      return pi.last_payment_error
        ? { label: "Failed", color: "red", icon: Icons.canceled }
        : { label: "Incomplete", color: "gray", icon: Icons.todo };
    case "requires_action":
      return { label: "Requires action", color: "yellow", icon: Icons.inProgress };
    case "requires_capture":
      return { label: "Uncaptured", color: "blue", icon: Icons.inReview };
    case "processing":
      return { label: "Processing", color: "blue", icon: Icons.inProgress };
    case "canceled":
      return { label: "Canceled", color: "gray", icon: Icons.canceled };
    default:
      return { label: "Incomplete", color: "gray", icon: Icons.todo };
  }
}

/** Which filter chip a payment belongs to. */
export function paymentGroup(pi: PaymentIntent): "succeeded" | "failed" | "refunded" | "other" {
  const look = paymentLook(pi).label;
  if (look === "Succeeded" || look === "Disputed") return "succeeded";
  if (look === "Refunded" || look === "Partially refunded") return "refunded";
  if (look === "Failed") return "failed";
  return "other";
}

const riskColor = (level?: string): Color | undefined =>
  level === "highest" ? "red" : level === "elevated" ? "orange" : level === "normal" ? "green" : undefined;

export const modeTag = (a: Pick<Account, "mode">): Accessory =>
  a.mode === "test" ? { tag: "Test", color: "orange" } : { tag: "Live", color: "green" };

export const modeLine = (a: Account): Metadata =>
  meta.text("Mode", `${a.mode === "test" ? "Test" : "Live"} · ${a.restricted ? "restricted key" : "secret key"}`, {
    icon: { source: a.restricted ? Icons.lock : Icons.key, tint: a.mode === "test" ? "orange" : "green" },
    color: a.mode === "test" ? "orange" : "green",
  });

/** What a succeeded payment brought in, refunds deducted. */
export const received = (pi: PaymentIntent): Money => ({
  amount: (pi.amount_received ?? pi.amount) - (asCharge(pi.latest_charge)?.amount_refunded ?? 0),
  currency: pi.currency,
});

/** "12 payments · €420.00 received · Test mode". */
export function paymentsStatus(shown: PaymentIntent[], a: Account): string {
  const ok = shown.filter((p) => p.status === "succeeded");
  return `${shown.length} payment${shown.length === 1 ? "" : "s"}${
    ok.length ? ` · ${sumByCurrency(ok.map(received))} received` : ""
  } · ${a.mode === "test" ? "Test mode" : "Live"}`;
}

/** The payments command's root subtitle: "€420.00 today" (succeeded since local midnight). */
export function todaySubtitle(payments: PaymentIntent[], now = new Date()): string | null {
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() / 1000;
  const today = payments.filter((p) => p.status === "succeeded" && p.created >= midnight);
  if (!today.length) return null;
  return `${sumByCurrency(today.map(received))} today`;
}

// ---------------------------------------------------------------------------
// Payments

function refundForm(a: Account, pi: PaymentIntent, charge: Charge) {
  const left = charge.amount - charge.amount_refunded;
  const zero = ZERO_DECIMAL.has(pi.currency);
  return form({
    title: `Refund ${money(pi.amount, pi.currency)}`,
    submitTitle: a.mode === "live" ? "Refund (real money)" : "Refund",
    fields: [
      field.text("amount", `Amount (${pi.currency.toUpperCase()})`, {
        value: zero ? String(left) : (left / 100).toFixed(2),
        required: true,
      }),
      field.dropdown("reason", "Reason", [
        { value: "requested_by_customer", title: "Requested by customer" },
        { value: "duplicate", title: "Duplicate" },
        { value: "fraudulent", title: "Fraudulent" },
      ]),
    ],
    async submit(values) {
      const amount = parseAmount(String(values.amount ?? ""), pi.currency);
      if (amount <= 0 || amount > left) {
        throw new Error(`Refund between ${money(1, pi.currency)} and ${money(left, pi.currency)}`);
      }
      await stripe(a, "/refunds", {
        method: "POST",
        params: { payment_intent: pi.id, amount, reason: values.reason || undefined },
        idempotencyKey: `backslash-${pi.id}-${amount}-${charge.amount_refunded}`,
      });
      await toast(`Refunded ${money(amount, pi.currency)}`, { style: "success" });
      return pop();
    },
  });
}

/** "12.50" → 1250 (minor units); whole numbers for zero-decimal currencies. */
export function parseAmount(text: string, currency: string): number {
  const clean = text.trim().replace(/[^\d.,-]/g, "").replace(",", ".");
  const n = Number(clean);
  if (!clean || !Number.isFinite(n)) throw new Error(`“${text}” is not an amount`);
  return ZERO_DECIMAL.has(currency.toLowerCase()) ? Math.round(n) : Math.round(n * 100);
}

export function paymentItem(pi: PaymentIntent, a: Account, now = Date.now()): Item {
  const charge = asCharge(pi.latest_charge);
  const customer = asCustomer(pi.customer);
  const look = paymentLook(pi);
  const method = paymentMethodText(charge);
  const email = customer?.email ?? charge?.billing_details?.email ?? pi.receipt_email ?? undefined;
  const who = customer?.name || charge?.billing_details?.name || email;
  const bt = charge?.balance_transaction && typeof charge.balance_transaction === "object"
    ? charge.balance_transaction
    : undefined;
  const card = charge?.payment_method_details?.card;
  const url = dashboard(a, `payments/${pi.id}`);
  const refundable = pi.status === "succeeded" && charge && !charge.refunded && charge.amount_refunded < charge.amount;
  const customerId = idOf(pi.customer);

  const stats: Stat[] = [
    { label: "Amount", value: money(pi.amount, pi.currency) },
    ...(bt
      ? [{ label: "Net", value: money(bt.net, bt.currency) }, { label: "Fee", value: money(bt.fee, bt.currency) }]
      : []),
    ...(!bt ? [{ label: "Status", value: look.label, color: look.color }] : []),
  ];
  const metadata: Metadata[] = [
    meta.text("Status", look.label, { icon: { source: look.icon, tint: look.color }, color: look.color }),
    ...(charge?.amount_refunded
      ? [meta.text("Refunded", money(charge.amount_refunded, pi.currency), { icon: Icons.history })]
      : []),
    ...(pi.last_payment_error?.message
      ? [
        meta.text(
          "Declined",
          pi.last_payment_error.decline_code
            ? humanize(pi.last_payment_error.decline_code)
            : pi.last_payment_error.message,
          {
            icon: Icons.alert,
            color: "red",
          },
        ),
      ]
      : []),
    meta.text("Date", dateTime(pi.created), { icon: Icons.calendar }),
    ...(who ? [meta.person("Customer", who)] : []),
    ...(email && email !== who ? [meta.text("Email", email, { icon: Icons.mail })] : []),
    meta.separator(),
    ...(method ? [meta.text("Payment method", method, { icon: Icons.coin })] : []),
    ...(card?.exp_month ? [meta.text("Expires", `${String(card.exp_month).padStart(2, "0")}/${card.exp_year}`)] : []),
    ...(card?.country ? [meta.text("Card country", card.country)] : []),
    ...(charge?.outcome?.risk_level
      ? [
        meta.text(
          "Risk",
          `${humanize(charge.outcome.risk_level)}${
            charge.outcome.risk_score !== undefined ? ` (${charge.outcome.risk_score})` : ""
          }`,
          {
            icon: Icons.shield,
            color: riskColor(charge.outcome.risk_level),
          },
        ),
      ]
      : []),
    ...(pi.statement_descriptor ? [meta.text("Statement", pi.statement_descriptor)] : []),
    ...(charge?.receipt_url && charge.paid !== false ? [meta.link("Receipt", "View receipt", charge.receipt_url)] : []),
    meta.text("ID", pi.id, { icon: Icons.hash }),
    modeLine(a),
  ];
  const detailMd = [
    pi.description ? `**${pi.description}**` : "",
    pi.last_payment_error?.message ? `> ${pi.last_payment_error.message}` : "",
    charge?.outcome?.seller_message && look.color !== "green" ? charge.outcome.seller_message : "",
  ].filter(Boolean).join("\n\n");

  const actions: Action[] = [
    open(url, "Open in Dashboard"),
    copy(pi.id, "Copy Payment ID", { shortcut: "<Ctrl><Shift>c", section: "Copy" }),
    ...(charge ? [copy(charge.id, "Copy Charge ID", { section: "Copy" })] : []),
    ...(customerId ? [copy(customerId, "Copy Customer ID", { section: "Copy" })] : []),
    ...(email ? [copy(email, "Copy Email", { section: "Copy" })] : []),
    copy(money(pi.amount, pi.currency), "Copy Amount", { section: "Copy" }),
    ...(customerId
      ? [open(dashboard(a, `customers/${customerId}`), "Open Customer", { icon: Icons.person, shortcut: "<Ctrl>o" })]
      : []),
    ...(charge?.receipt_url && charge.paid !== false
      ? [open(charge.receipt_url, "Open Receipt", { icon: Icons.file })]
      : []),
    ...(refundable
      ? [
        action("Refund in Full", async () => {
          const amount = charge!.amount - charge!.amount_refunded;
          await stripe(a, "/refunds", {
            method: "POST",
            params: { payment_intent: pi.id, amount },
            idempotencyKey: `backslash-${pi.id}-${amount}-${charge!.amount_refunded}`,
          });
          await toast(`Refunded ${money(amount, pi.currency)}`, { style: "success" });
          return refresh();
        }, {
          icon: Icons.history,
          destructive: true,
          confirm: `Refund ${money(charge!.amount - charge!.amount_refunded, pi.currency)}${who ? ` to ${who}` : ""}${
            a.mode === "live" ? " (real money, can't be undone)" : ""
          }?`,
          section: "Danger",
        }),
        action("Partial Refund…", () => refundForm(a, pi, charge!), { icon: Icons.history, section: "Danger" }),
      ]
      : []),
  ];
  return {
    id: pi.id,
    title: money(pi.amount, pi.currency),
    subtitle: pi.description || who || undefined,
    icon: { source: look.icon, tint: look.color },
    keywords: [pi.id, email ?? "", who ?? "", charge?.id ?? "", look.label, card?.last4 ?? "", pi.currency],
    accessories: [
      ...(look.label !== "Succeeded" ? [{ tag: look.label, color: look.color }] : []),
      ...(method ? [{ text: method, tooltip: "Payment method" }] : []),
      { text: since(pi.created, now), tooltip: dateTime(pi.created) },
    ],
    detail: { stats, markdown: detailMd || undefined, metadata },
    actions,
  };
}

// ---------------------------------------------------------------------------
// Customers

export function customerItem(c: Customer, a: Account, extra: Action[] = [], now = Date.now()): Item {
  const url = dashboard(a, `customers/${c.id}`);
  const title = c.name || c.email || c.id;
  return {
    id: c.id,
    title,
    subtitle: c.name && c.email ? c.email : c.description ?? undefined,
    icon: { source: Icons.person, tint: c.delinquent ? "red" : "blue" },
    keywords: [c.id, c.email ?? "", c.phone ?? "", c.description ?? ""],
    accessories: [
      ...(c.delinquent ? [{ tag: "Delinquent", color: "red" as const }] : []),
      ...(c.balance
        ? [{
          text: c.balance > 0
            ? `owes ${money(c.balance, c.currency ?? "usd")}`
            : `${money(-c.balance, c.currency ?? "usd")} credit`,
          color: c.balance > 0 ? "orange" as const : "green" as const,
        }]
        : []),
      ...(c.address?.country ? [{ text: c.address.country }] : []),
      { text: since(c.created, now), tooltip: `Created ${date(c.created)}` },
    ],
    detail: {
      markdown: c.description ? c.description : undefined,
      metadata: [
        ...(c.name ? [meta.person("Name", c.name)] : []),
        ...(c.email ? [meta.text("Email", c.email, { icon: Icons.mail })] : []),
        ...(c.phone ? [meta.text("Phone", c.phone)] : []),
        ...(c.address?.country
          ? [
            meta.text("Country", [c.address.city, c.address.country].filter(Boolean).join(", "), { icon: Icons.globe }),
          ]
          : []),
        ...(c.currency ? [meta.text("Currency", c.currency.toUpperCase(), { icon: Icons.coin })] : []),
        ...(c.balance
          ? [meta.text(c.balance < 0 ? "Credit" : "Owes", money(Math.abs(c.balance), c.currency ?? "usd"), {
            color: c.balance < 0 ? "green" : "orange",
          })]
          : []),
        ...(c.delinquent ? [meta.text("Delinquent", "Last invoice unpaid", { icon: Icons.alert, color: "red" })] : []),
        meta.text("Customer since", date(c.created), { icon: Icons.calendar }),
        ...Object.entries(c.metadata ?? {}).slice(0, 4).map(([k, v]) => meta.text(k, v, { icon: Icons.tag })),
        meta.separator(),
        meta.text("ID", c.id, { icon: Icons.hash }),
        modeLine(a),
      ],
    },
    actions: [
      open(url, "Open in Dashboard"),
      ...extra,
      copy(c.id, "Copy Customer ID", { shortcut: "<Ctrl><Shift>c", section: "Copy" }),
      ...(c.email ? [copy(c.email, "Copy Email", { shortcut: "<Ctrl>period", section: "Copy" })] : []),
      ...(c.email ? [open(`mailto:${c.email}`, "Send Email", { icon: Icons.mail })] : []),
    ],
  };
}

/** Stripe Search API: names and emails containing the words; a `cus_` id is fetched directly. */
export function customerQuery(text: string): string {
  const q = text.trim().replace(/["\\]/g, "");
  return `name~"${q}" OR email~"${q}"`;
}

// ---------------------------------------------------------------------------
// Subscriptions

export function interval(p: Price): string {
  const r = p.recurring;
  if (!r) return "";
  const short = { day: "day", week: "wk", month: "mo", year: "yr" }[r.interval];
  return r.interval_count === 1 ? `/${short}` : ` every ${r.interval_count} ${r.interval}s`;
}

/** Total per period: "€12.00/mo", "$240.00/yr". Mixed intervals show the first. */
export function subscriptionAmount(s: Subscription): string {
  const items = s.items.data;
  if (!items.length) return "";
  const first = items[0].price;
  const total = items
    .filter((i) => i.price.currency === first.currency && i.price.recurring?.interval === first.recurring?.interval)
    .reduce((sum, i) => sum + (i.price.unit_amount ?? 0) * (i.quantity ?? 1), 0);
  return `${money(total, first.currency)}${interval(first)}`;
}

/** The period end moved from the subscription to its items in API version 2025-03-31. */
export const periodEnd = (s: Subscription) =>
  s.current_period_end ?? s.items.data.map((i) => i.current_period_end).filter((x): x is number => !!x).sort()[0];

export function subscriptionLook(s: Subscription): Look {
  if (s.status === "active" && s.cancel_at_period_end) {
    return { label: "Canceling", color: "orange", icon: Icons.inReview };
  }
  switch (s.status) {
    case "active":
      return { label: "Active", color: "green", icon: Icons.done };
    case "trialing":
      return { label: "Trial", color: "blue", icon: Icons.inProgress };
    case "past_due":
      return { label: "Past due", color: "red", icon: Icons.alert };
    case "unpaid":
      return { label: "Unpaid", color: "red", icon: Icons.alert };
    case "paused":
      return { label: "Paused", color: "gray", icon: Icons.pause };
    case "canceled":
      return { label: "Canceled", color: "gray", icon: Icons.canceled };
    case "incomplete":
    case "incomplete_expired":
      return { label: humanize(s.status), color: "gray", icon: Icons.todo };
    default:
      return { label: humanize(s.status), color: "gray", icon: Icons.todo };
  }
}

/** "Renews 3 Nov 2026", "Ends 3 Nov 2026", "Trial ends …", "Canceled 2 Oct 2026". */
export function renewal(s: Subscription): string {
  const end = periodEnd(s);
  if (s.status === "canceled") return `Canceled ${date(s.canceled_at)}`;
  if (s.status === "trialing" && s.trial_end) return `Trial ends ${date(s.trial_end)}`;
  if (s.cancel_at_period_end || s.cancel_at) return `Ends ${date(s.cancel_at ?? end)}`;
  return end ? `Renews ${date(end)}` : "";
}

export const productName = (p: Price, products: Map<string, string>) =>
  (typeof p.product === "object" ? p.product.name : products.get(p.product)) ?? p.nickname ?? "Subscription";

/** Product names, which can't be expanded from a subscription list (too deep). */
export async function productNames(
  a: Account,
  subs: Subscription[],
  signal?: AbortSignal,
): Promise<Map<string, string>> {
  const ids = [
    ...new Set(
      subs.flatMap((s) => s.items.data.map((i) => i.price.product)).filter((p): p is string => typeof p === "string"),
    ),
  ];
  const names = new Map<string, string>();
  for (let i = 0; i < ids.length; i += 100) {
    const page = await stripe<Page<{ id: string; name: string }>>(a, "/products", {
      params: { ids: ids.slice(i, i + 100), limit: 100 },
      signal,
    }).catch(() => undefined);
    for (const p of page?.data ?? []) names.set(p.id, p.name);
  }
  return names;
}

export function subscriptionItem(s: Subscription, a: Account, products: Map<string, string>, now = Date.now()): Item {
  const customer = typeof s.customer === "object" && !s.customer.deleted ? s.customer : undefined;
  const customerId = idOf(s.customer)!;
  const look = subscriptionLook(s);
  const names = [...new Set(s.items.data.map((i) => productName(i.price, products)))];
  const amount = subscriptionAmount(s);
  const end = periodEnd(s);
  const daysLeft = end ? Math.ceil((end * 1000 - now) / 86_400_000) : undefined;
  return {
    id: s.id,
    title: customer?.name || customer?.email || customerId,
    subtitle: names.join(", "),
    icon: { source: look.icon, tint: look.color },
    keywords: [s.id, customerId, customer?.email ?? "", ...names, look.label],
    accessories: [
      ...(look.label !== "Active" ? [{ tag: look.label, color: look.color }] : []),
      ...(amount ? [{ text: amount }] : []),
      ...(s.status !== "canceled" && daysLeft !== undefined && daysLeft >= 0
        ? [{ text: daysLeft === 0 ? "today" : `${daysLeft}d`, icon: Icons.calendar, tooltip: renewal(s) }]
        : []),
    ],
    detail: {
      stats: [
        { label: "Amount", value: amount || "—" },
        { label: "Status", value: look.label, color: look.color },
        ...(end && s.status !== "canceled"
          ? [{
            label: s.cancel_at_period_end ? "Ends" : s.status === "trialing" ? "Trial ends" : "Renews",
            value: date(s.status === "trialing" && s.trial_end ? s.trial_end : end),
          }]
          : []),
      ],
      metadata: [
        ...(customer?.name ? [meta.person("Customer", customer.name)] : []),
        ...(customer?.email ? [meta.text("Email", customer.email, { icon: Icons.mail })] : []),
        ...s.items.data.map((i) =>
          meta.text(
            productName(i.price, products),
            `${money(i.price.unit_amount ?? 0, i.price.currency)}${interval(i.price)}${
              (i.quantity ?? 1) > 1 ? ` × ${i.quantity}` : ""
            }`,
            { icon: Icons.package },
          )
        ),
        meta.separator(),
        ...(renewal(s) ? [meta.text("Billing", renewal(s), { icon: Icons.calendar })] : []),
        meta.text("Started", date(s.created), { icon: Icons.clock }),
        meta.text("ID", s.id, { icon: Icons.hash }),
        modeLine(a),
      ],
    },
    actions: [
      open(dashboard(a, `subscriptions/${s.id}`), "Open in Dashboard"),
      open(dashboard(a, `customers/${customerId}`), "Open Customer", { icon: Icons.person, shortcut: "<Ctrl>o" }),
      copy(s.id, "Copy Subscription ID", { shortcut: "<Ctrl><Shift>c", section: "Copy" }),
      copy(customerId, "Copy Customer ID", { section: "Copy" }),
      ...(customer?.email ? [copy(customer.email, "Copy Email", { section: "Copy" })] : []),
    ],
  };
}

/** Monthly recurring revenue of active subscriptions, by currency. */
export function mrr(subs: Subscription[]): Money[] {
  const perMonth = { day: 30, week: 52 / 12, month: 1, year: 1 / 12 };
  return subs.filter((s) => s.status === "active" || s.status === "past_due").flatMap((s) =>
    s.items.data.filter((i) => i.price.recurring).map((i) => ({
      amount: Math.round(
        ((i.price.unit_amount ?? 0) * (i.quantity ?? 1) * perMonth[i.price.recurring!.interval]) /
          i.price.recurring!.interval_count,
      ),
      currency: i.price.currency,
    }))
  );
}

// ---------------------------------------------------------------------------
// Balance

export function balanceStats(b: Balance): Stat[] {
  return [
    { label: "Available", value: sumByCurrency(b.available), color: "green" },
    { label: "Pending", value: sumByCurrency(b.pending) },
    ...(b.instant_available?.some((m) => m.amount)
      ? [{ label: "Instant payout", value: sumByCurrency(b.instant_available) }]
      : []),
  ];
}

export function payoutsMarkdown(payouts: Payout[]): string {
  if (!payouts.length) return "No payout yet.";
  return [
    "### Recent payouts",
    "",
    "| Arrives | Amount | Status |",
    "|---|---:|---|",
    ...payouts.map((p) =>
      `| ${date(p.arrival_date)} | ${money(p.amount, p.currency)} | ${
        humanize(p.status.replace("in_transit", "in transit"))
      } |`
    ),
  ].join("\n");
}
