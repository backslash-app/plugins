import {
  action,
  type Context,
  copy,
  Icons,
  type Item,
  list,
  meta,
  open,
  toast,
  updateCommandMetadata,
} from "@backslash/api";
import { holdings, live, marketsOf, setHoldings, stale } from "../api.ts";
import { amount, change24h, changeColor, coinUrl, logo, money, percent, signedMoney, valuePortfolio } from "../lib.ts";
import { coinIcon, coinMetadata, coinPicker, holdingForm, settings } from "../views.ts";

let summary = "";

export default (ctx: Context) => {
  const s = settings(ctx.preferences);
  const add = action("Add Holding…", () => coinPicker(s), { icon: Icons.plus, shortcut: "<Ctrl>n" });
  return list({
    placeholder: "Filter holdings…",
    empty: {
      title: "No holdings yet",
      description: "Press Ctrl+N to add a coin and the amount you hold. Amounts stay on this computer.",
      icon: Icons.coin,
    },
    actions: [add],
    status: () => summary,
    items: ({ signal }) =>
      live(async (): Promise<Item[]> => {
        const held = await holdings();
        if (!held.length) {
          summary = "";
          updateCommandMetadata({ subtitle: null }).catch(() => {});
          return [];
        }
        const markets = await marketsOf(held.map((h) => h.id), s.currency, s.apiKey, signal);
        const { rows, total, change } = valuePortfolio(held, markets);
        const pct = total - change ? (change / (total - change)) * 100 : 0;
        summary = `Total ${money(total, s.currency)} · ${signedMoney(change, s.currency)} (${percent(pct)}) in 24 h${
          stale ? " · CoinGecko is rate limiting, saved prices" : ""
        }`;
        updateCommandMetadata({ subtitle: `Total ${money(total, s.currency)}` }).catch(() => {});

        return rows.map(({ holding: h, market: m, value, change: diff, share }) => {
          const symbol = h.symbol.toUpperCase();
          const c24 = m ? change24h(m) : undefined;
          return {
            id: h.id,
            title: h.name,
            subtitle: `${amount(h.amount)} ${symbol}`,
            icon: coinIcon({ image: m?.image ?? h.image }),
            keywords: [h.symbol, h.id],
            accessories: [
              { text: `${Math.round(share * 100)} %`, tooltip: "Share of the portfolio" },
              ...(m
                ? [{
                  text: percent(c24),
                  color: changeColor(c24),
                  icon: { source: (c24 ?? 0) >= 0 ? Icons.chartUp : Icons.chartDown, tint: changeColor(c24) },
                  tooltip: "24 h change",
                }]
                : []),
              { text: money(value, s.currency), tooltip: m ? `at ${money(m.current_price, s.currency)}` : "No price" },
            ],
            detail: {
              image: logo(m?.image ?? h.image, "large"),
              stats: [
                { label: "Value", value: money(value, s.currency) },
                { label: "24 h", value: signedMoney(diff, s.currency), color: changeColor(diff) },
                { label: "Share", value: `${Math.round(share * 100)} %` },
              ],
              metadata: [
                meta.text("Amount", `${amount(h.amount)} ${symbol}`, { icon: Icons.coin }),
                ...(m ? [meta.text("Price", money(m.current_price, s.currency))] : []),
                meta.progress("Of portfolio", share),
                meta.separator(),
                ...(m ? coinMetadata(m, s.currency) : [meta.link("CoinGecko", h.id, coinUrl(h.id))]),
              ],
            },
            actions: [
              action("Edit Amount…", () => holdingForm(h, h), { icon: Icons.text }),
              open(coinUrl(h.id), "Open on CoinGecko"),
              add,
              copy(money(value, s.currency), "Copy Value", { section: "Copy", shortcut: "<Ctrl><Shift>c" }),
              copy(String(h.amount), "Copy Amount", { section: "Copy" }),
              action("Remove Holding", async () => {
                await setHoldings((await holdings()).filter((x) => x.id !== h.id));
                await toast(`${h.name} removed from the portfolio`, { style: "success" });
              }, {
                icon: Icons.trash,
                destructive: true,
                confirm: `Remove ${h.name} from the portfolio?`,
                section: "Danger",
                shortcut: "<Ctrl>Delete",
              }),
            ],
          };
        });
      }, signal),
  });
};
