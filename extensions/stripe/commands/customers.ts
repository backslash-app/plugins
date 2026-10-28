import { action, type Context, Icons, list } from "@backslash/api";
import { type Account, account, guarded, type Page, stripe } from "../api.ts";
import {
  type Customer,
  customerItem,
  customerQuery,
  type PaymentIntent,
  paymentItem,
  productNames,
  type Subscription,
  subscriptionItem,
} from "../lib.ts";

function drillDown(a: Account, c: Customer) {
  const name = c.name || c.email || c.id;
  return [
    action("Show Payments", () =>
      list({
        title: `Payments of ${name}`,
        placeholder: `Filter ${name}'s payments…`,
        empty: { title: "No payment yet", icon: Icons.coin },
        items: ({ signal }) =>
          guarded(async () => {
            const page = await stripe<Page<PaymentIntent>>(a, "/payment_intents", {
              params: { customer: c.id, limit: 50, expand: ["data.latest_charge.balance_transaction"] },
              signal,
            });
            return page.data.map((pi) => paymentItem({ ...pi, customer: c }, a));
          }),
      }), { icon: Icons.coin, shortcut: "<Ctrl>p" }),
    action("Show Subscriptions", () =>
      list({
        title: `Subscriptions of ${name}`,
        empty: { title: "No subscription", icon: Icons.repeat },
        items: ({ signal }) =>
          guarded(async () => {
            const page = await stripe<Page<Subscription>>(a, "/subscriptions", {
              params: { customer: c.id, status: "all", limit: 50 },
              signal,
            });
            const products = await productNames(a, page.data, signal);
            return page.data.map((s) => subscriptionItem({ ...s, customer: c }, a, products));
          }),
      }), { icon: Icons.repeat, shortcut: "<Ctrl>s" }),
  ];
}

export default (_ctx: Context) =>
  list({
    placeholder: "Search customers by name, email or cus_ ID…",
    empty: { title: "No customer found", description: "Search matches names and emails", icon: "bs-user" },
    async search(query, { preferences, signal }) {
      return await guarded(async () => {
        const a = account(preferences);
        const q = query.trim();
        let customers: Customer[];
        if (/^cus_[A-Za-z0-9]+$/.test(q)) {
          customers = [await stripe<Customer>(a, `/customers/${q}`, { signal })].filter((c) => !c.deleted);
        } else if (q) {
          customers = (await stripe<Page<Customer>>(a, "/customers/search", {
            params: { query: customerQuery(q), limit: 30 },
            signal,
          })).data;
        } else {
          customers = (await stripe<Page<Customer>>(a, "/customers", { params: { limit: 30 }, signal })).data;
        }
        return customers.map((c) => ({
          ...customerItem(c, a, drillDown(a, c)),
          section: q ? "Results" : "Recent Customers",
        }));
      });
    },
  });
