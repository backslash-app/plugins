import { list, updateCommandMetadata } from "@backslash/api";
import { account, guarded, type Page, stripe } from "../api.ts";
import { mrr, productNames, type Subscription, subscriptionItem, sumByCurrency } from "../lib.ts";

const LIVE = ["active", "trialing", "past_due", "unpaid", "paused"];
let status = "";

export default list({
  placeholder: "Filter subscriptions by customer, product, status…",
  filter: {
    options: [
      { value: "active", title: "Active" },
      { value: "canceled", title: "Canceled" },
      { value: "all", title: "All" },
    ],
  },
  empty: {
    title: "No subscription here",
    description: "Subscriptions you create in Stripe show up here",
    icon: "bs-repeat",
  },
  status: (items) => (items[0]?.id === "setup" ? "Not connected" : status),
  items: ({ preferences, filter, signal }) =>
    guarded(async () => {
      const a = account(preferences);
      const page = await stripe<Page<Subscription>>(a, "/subscriptions", {
        params: { status: "all", limit: 100, expand: ["data.customer"] },
        signal,
      });
      const products = await productNames(a, page.data, signal);
      const live = page.data.filter((s) => LIVE.includes(s.status));
      const shown = filter === "canceled"
        ? page.data.filter((s) => s.status === "canceled" || s.status === "incomplete_expired")
        : filter === "all"
        ? page.data
        : live;
      const active = page.data.filter((s) => s.status === "active").length;
      const revenue = mrr(page.data);
      status = `${shown.length} shown · ${active} active${revenue.length ? ` · MRR ${sumByCurrency(revenue)}` : ""}${
        page.has_more ? " · latest 100" : ""
      } · ${a.mode === "test" ? "Test mode" : "Live"}`;
      updateCommandMetadata({ subtitle: active ? `${active} active` : null }).catch(() => {});
      const order = (s: Subscription) => ["past_due", "unpaid"].includes(s.status) ? 0 : s.cancel_at_period_end ? 1 : 2;
      return [...shown].sort((x, y) => order(x) - order(y)).map((s) => ({
        ...subscriptionItem(s, a, products),
        section: ["past_due", "unpaid"].includes(s.status)
          ? "Needs Attention"
          : s.status === "canceled"
          ? "Canceled"
          : "Subscriptions",
      }));
    }),
});
