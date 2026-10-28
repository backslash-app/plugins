import { action, type Context, detail, Icons, meta, open, refresh, updateCommandMetadata } from "@backslash/api";
import { account, AuthError, KEYS_URL, type Page, setupItems, stripe } from "../api.ts";
import { type Balance, balanceStats, modeLine, type Payout, payoutsMarkdown, sumByCurrency } from "../lib.ts";

export default async (ctx: Context) => {
  let a;
  try {
    a = account(ctx.preferences);
  } catch (e) {
    if (!(e instanceof AuthError)) throw e;
    return detail({
      title: "Stripe Balance",
      markdown: setupItems(e)[0].detail!.markdown!,
      actions: [open(KEYS_URL, "Create Restricted Key", { icon: Icons.key })],
    });
  }
  const [balance, payouts] = await Promise.all([
    stripe<Balance>(a, "/balance", { signal: ctx.signal }),
    stripe<Page<Payout>>(a, "/payouts", { params: { limit: 8 }, signal: ctx.signal }).catch((e) => e as Error),
  ]);
  updateCommandMetadata({ subtitle: `${sumByCurrency(balance.available)} available` }).catch(() => {});
  const next = payouts instanceof Error
    ? undefined
    : payouts.data.find((p) => p.status === "pending" || p.status === "in_transit");
  return detail({
    title: "Stripe Balance",
    stats: balanceStats(balance),
    markdown: payouts instanceof Error ? `Payouts can't be read: ${payouts.message}` : payoutsMarkdown(payouts.data),
    metadata: [
      ...balance.available.map((m) =>
        meta.text(`Available ${m.currency.toUpperCase()}`, sumByCurrency([m]), { icon: Icons.coin, color: "green" })
      ),
      ...balance.pending.map((m) =>
        meta.text(`Pending ${m.currency.toUpperCase()}`, sumByCurrency([m]), { icon: Icons.hourglass })
      ),
      ...(next
        ? [
          meta.text(
            "Next payout",
            `${sumByCurrency([next])} on ${
              new Date(next.arrival_date * 1000).toLocaleDateString("en-GB", { day: "numeric", month: "short" })
            }`,
            { icon: Icons.calendar },
          ),
        ]
        : []),
      meta.separator(),
      modeLine(a),
    ],
    status: a.mode === "test" ? "Test mode" : "Live",
    actions: [
      open(
        a.mode === "test"
          ? "https://dashboard.stripe.com/test/balance/overview"
          : "https://dashboard.stripe.com/balance/overview",
        "Open Balance in Dashboard",
      ),
      open(
        a.mode === "test" ? "https://dashboard.stripe.com/test/payouts" : "https://dashboard.stripe.com/payouts",
        "Open Payouts",
        { icon: Icons.download },
      ),
      action("Refresh", () => refresh(), { icon: Icons.refresh, shortcut: "<Ctrl>r" }),
    ],
  });
};
