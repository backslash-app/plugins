import { type Context, list, updateCommandMetadata } from "@backslash/api";
import { account, guarded, type Page, stripe } from "../api.ts";
import { paymentGroup, type PaymentIntent, paymentItem, paymentsStatus, todaySubtitle } from "../lib.ts";

const LIMIT = 100;
let status = "";

/** "Today", "Yesterday", "Monday 26 October". */
function day(unix: number, now = new Date()): string {
  const d = new Date(unix * 1000);
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (d.getTime() >= midnight) return "Today";
  if (d.getTime() >= midnight - 86_400_000) return "Yesterday";
  return d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
}

export default (_ctx: Context) =>
  list({
    placeholder: "Filter payments by customer, email, amount, card…",
    filter: {
      options: [
        { value: "all", title: "All" },
        { value: "succeeded", title: "Succeeded" },
        { value: "failed", title: "Failed" },
        { value: "refunded", title: "Refunded" },
      ],
    },
    empty: { title: "No payment here", description: "Nothing matches among the latest 100 payments", icon: "bs-coin" },
    status: (items) => (items[0]?.id === "setup" ? "Not connected" : status),
    items: ({ preferences, filter, signal }) =>
      guarded(async () => {
        const a = account(preferences);
        const page = await stripe<Page<PaymentIntent>>(a, "/payment_intents", {
          params: { limit: LIMIT, expand: ["data.latest_charge.balance_transaction", "data.customer"] },
          signal,
        });
        updateCommandMetadata({ subtitle: todaySubtitle(page.data) }).catch(() => {});
        const shown = filter && filter !== "all" ? page.data.filter((p) => paymentGroup(p) === filter) : page.data;
        status = paymentsStatus(shown, a);
        return shown.map((pi) => ({ ...paymentItem(pi, a), section: day(pi.created) }));
      }),
  });
