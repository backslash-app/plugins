import { assert, assertEquals, assertStringIncludes, assertThrows } from "@std/assert";
import { account, AuthError, dashboard, encode, guarded, permissionHint } from "./api.ts";
import {
  balanceStats,
  type Charge,
  customerItem,
  customerQuery,
  money,
  mrr,
  parseAmount,
  paymentGroup,
  type PaymentIntent,
  paymentItem,
  paymentLook,
  paymentMethodText,
  paymentsStatus,
  payoutsMarkdown,
  periodEnd,
  renewal,
  type Subscription,
  subscriptionAmount,
  subscriptionItem,
  subscriptionLook,
  sumByCurrency,
  todaySubtitle,
} from "./lib.ts";

const NOW = Date.parse("2026-10-28T12:00:00Z");
const T = NOW / 1000;
const test = account({ secretKey: "rk_test_51Pq2xYZabc" });
const live = account({ secretKey: "sk_live_51Pq2xYZabc" });

// Shaped like GET /v1/payment_intents?expand[]=data.latest_charge.balance_transaction&expand[]=data.customer.
const charge: Charge = {
  id: "ch_3Q1",
  amount: 4900,
  amount_refunded: 0,
  refunded: false,
  paid: true,
  receipt_url: "https://pay.stripe.com/receipts/payment/abc",
  outcome: { risk_level: "normal", risk_score: 12, seller_message: "Payment complete." },
  payment_method_details: {
    type: "card",
    card: { brand: "visa", last4: "4242", exp_month: 4, exp_year: 2028, country: "FR", wallet: null },
  },
  billing_details: { name: null, email: null },
  balance_transaction: { id: "txn_1", amount: 4900, fee: 99, net: 4801, currency: "eur" },
};
const paid: PaymentIntent = {
  id: "pi_3Q1",
  amount: 4900,
  amount_received: 4900,
  currency: "eur",
  status: "succeeded",
  created: T - 600,
  description: "Pro plan — October",
  customer: { id: "cus_Q1", name: "Camille Durand", email: "camille@example.fr", created: T - 86400 * 40 },
  latest_charge: charge,
};
const failed: PaymentIntent = {
  id: "pi_3Q3",
  amount: 2500,
  currency: "eur",
  status: "requires_payment_method",
  created: T - 90_000,
  receipt_email: "lea@example.org",
  latest_charge: { ...charge, id: "ch_3Q3", paid: false, payment_method_details: { type: "sepa_debit" } },
  last_payment_error: {
    message: "Your card has insufficient funds.",
    code: "card_declined",
    decline_code: "insufficient_funds",
  },
};

Deno.test("keys and modes", () => {
  assertEquals(test, { key: "rk_test_51Pq2xYZabc", mode: "test", restricted: true });
  assertEquals(live.mode, "live");
  assertThrows(() => account({}), AuthError, "Add a Stripe API key");
  assertThrows(() => account({ secretKey: "pk_live_123" }), AuthError, "publishable");
  assertThrows(() => account({ secretKey: "hello" }), AuthError);
  assertEquals(dashboard(test, "payments/pi_1"), "https://dashboard.stripe.com/test/payments/pi_1");
  assertEquals(dashboard(live, "/customers/cus_1"), "https://dashboard.stripe.com/customers/cus_1");
});

Deno.test("requests", () => {
  assertEquals(
    encode({ limit: 10, expand: ["data.customer"], metadata: { order: "42" }, skip: undefined }).join("&"),
    "limit=10&expand%5B%5D=data.customer&metadata%5Border%5D=42",
  );
  assertEquals(
    permissionHint("Having the 'rak_payment_intent_read' permission would allow this request to continue."),
    "Your restricted key needs “Payment Intent: Read”",
  );
  assertEquals(permissionHint("Something else"), undefined);
  assertEquals(customerQuery(' acme "corp" '), 'name~"acme corp" OR email~"acme corp"');
});

Deno.test("money", () => {
  assertEquals(money(4900, "eur"), "€49.00");
  assertEquals(money(50000, "jpy"), "¥50,000");
  assertEquals(money(129900, "usd"), "$1,299.00");
  assertEquals(
    sumByCurrency([{ amount: 100, currency: "eur" }, { amount: 5000, currency: "usd" }, {
      amount: 200,
      currency: "eur",
    }]),
    "$50.00 + €3.00",
  );
  assertEquals(parseAmount("12,50", "eur"), 1250);
  assertEquals(parseAmount("500", "jpy"), 500);
  assertThrows(() => parseAmount("abc", "eur"));
});

Deno.test("payments", () => {
  assertEquals(paymentLook(paid).label, "Succeeded");
  assertEquals(paymentLook(failed).label, "Failed");
  assertEquals(paymentGroup(failed), "failed");
  const partial = { ...paid, latest_charge: { ...charge, amount_refunded: 1000 } };
  assertEquals(paymentLook(partial).label, "Partially refunded");
  assertEquals(
    paymentGroup({ ...paid, latest_charge: { ...charge, refunded: true, amount_refunded: 4900 } }),
    "refunded",
  );
  assertEquals(paymentLook({ ...paid, status: "requires_action" }).label, "Requires action");
  assertEquals(paymentMethodText(charge), "Visa •••• 4242");
  assertEquals(
    paymentMethodText({
      ...charge,
      payment_method_details: { type: "card", card: { brand: "amex", last4: "0005", wallet: { type: "apple_pay" } } },
    }),
    "Apple Pay · Amex •••• 0005",
  );
  assertEquals(paymentMethodText(asFailedCharge()), "SEPA Debit");
  assertEquals(paymentsStatus([paid, partial, failed], test), "3 payments · €88.00 received · Test mode");
  assertEquals(todaySubtitle([paid, failed], new Date(NOW)), "€49.00 today");
  assertEquals(todaySubtitle([failed], new Date(NOW)), null);
});

function asFailedCharge() {
  return failed.latest_charge as Charge;
}

Deno.test("payment item", () => {
  const item = paymentItem(paid, live, NOW);
  assertEquals(item.title, "€49.00");
  assertEquals(item.subtitle, "Pro plan — October");
  assertEquals(item.detail?.stats?.map((s) => s.value), ["€49.00", "€48.01", "€0.99"]);
  assert(item.detail?.metadata?.some((m) => m.label === "Risk" && m.value === "Normal (12)"));
  const titles = item.actions!.map((a) => a.title);
  assertEquals(titles[0], "Open in Dashboard");
  const refund = item.actions!.find((a) => a.title === "Refund in Full")!;
  assertStringIncludes(refund.confirm!, "real money");
  assertEquals(refund.destructive, true);
  assertEquals((item.actions![0] as { target: string }).target, "https://dashboard.stripe.com/payments/pi_3Q1");
  const bad = paymentItem(failed, test, NOW);
  assert(!bad.actions!.some((a) => a.title.startsWith("Refund")), "nothing to refund");
  assert(!bad.actions!.some((a) => a.title === "Open Receipt"));
  assertStringIncludes(bad.detail!.markdown!, "insufficient funds");
  assertEquals(bad.subtitle, "lea@example.org");
});

const sub = (o: Partial<Subscription>): Subscription => ({
  id: "sub_1",
  status: "active",
  customer: { id: "cus_1", name: "Acme Corp", email: "billing@acme.test", created: T },
  created: T - 86400 * 100,
  current_period_end: T + 86400 * 6,
  items: {
    data: [{
      id: "si_1",
      quantity: 12,
      price: {
        id: "price_seat",
        product: "prod_team",
        unit_amount: 1500,
        currency: "usd",
        recurring: { interval: "month", interval_count: 1 },
      },
    }],
  },
  ...o,
});

Deno.test("subscriptions", () => {
  const s = sub({});
  assertEquals(subscriptionAmount(s), "$180.00/mo");
  assertEquals(subscriptionLook(s).label, "Active");
  assertEquals(subscriptionLook(sub({ cancel_at_period_end: true })).label, "Canceling");
  assertEquals(subscriptionLook(sub({ status: "past_due" })).color, "red");
  assertEquals(renewal(s), "Renews 3 Nov 2026");
  assertEquals(renewal(sub({ cancel_at_period_end: true })), "Ends 3 Nov 2026");
  assertEquals(renewal(sub({ status: "trialing", trial_end: T + 86400 * 9 })), "Trial ends 6 Nov 2026");
  // API 2025-03-31 and later: the period end is on the items.
  const basil = sub({ current_period_end: undefined });
  basil.items.data[0].current_period_end = T + 86400;
  assertEquals(periodEnd(basil), T + 86400);
  assertEquals(mrr([s, sub({ status: "canceled" })]), [{ amount: 18000, currency: "usd" }]);
  const yearly = sub({});
  yearly.items.data[0].price = {
    ...yearly.items.data[0].price,
    unit_amount: 12000,
    recurring: { interval: "year", interval_count: 1 },
  };
  yearly.items.data[0].quantity = 1;
  assertEquals(mrr([yearly]), [{ amount: 1000, currency: "usd" }]);
  const item = subscriptionItem(s, test, new Map([["prod_team", "Team seats"]]), NOW);
  assertEquals(item.title, "Acme Corp");
  assertEquals(item.subtitle, "Team seats");
  assertEquals(item.accessories?.map((a) => a.text), ["$180.00/mo", "6d"]);
  assertEquals(
    (item.actions![0] as { target: string }).target,
    "https://dashboard.stripe.com/test/subscriptions/sub_1",
  );
});

Deno.test("customers and balance", () => {
  const item = customerItem(
    {
      id: "cus_R9",
      name: "Acme Corp",
      email: "billing@acme.test",
      created: T - 86400,
      balance: 1500,
      currency: "usd",
      delinquent: true,
    },
    test,
    [],
    NOW,
  );
  assertEquals(item.subtitle, "billing@acme.test");
  assertEquals(item.accessories?.[0], { tag: "Delinquent", color: "red" });
  assertEquals(item.accessories?.[1].text, "owes $15.00");
  assertEquals(
    balanceStats({ available: [{ amount: 123456, currency: "eur" }], pending: [{ amount: 4900, currency: "eur" }] })
      .map((s) => s.value),
    ["€1,234.56", "€49.00"],
  );
  assertStringIncludes(
    payoutsMarkdown([{
      id: "po_1",
      amount: 98000,
      currency: "eur",
      arrival_date: T,
      created: T,
      status: "in_transit",
    }]),
    "| 28 Oct 2026 | €980.00 | In transit |",
  );
});

Deno.test("missing key shows the connect row", async () => {
  const items = await guarded(() => Promise.resolve(account({ secretKey: "" })) as never);
  assertEquals(items[0].id, "setup");
  assertStringIncludes(items[0].detail!.markdown!, "Refunds: Write");
});
