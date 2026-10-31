import { type Context } from "@backslash/api";
import { commodityFor, journal, transactions } from "../engine.ts";
import { isoDay, type Styles } from "../lib.ts";
import { addForm } from "../views.ts";

// The accounts of the last year fill the dropdowns, most recent journals stay fast.
export default async (ctx: Context) => {
  const j = await journal(ctx);
  const styles: Styles = new Map();
  const since = new Date();
  since.setFullYear(since.getFullYear() - 1);
  const txns = await transactions(j, styles, isoDay(since), ctx.signal);
  const accounts = [...new Set(txns.flatMap((t) => t.postings.map((p) => p.account)))];
  return addForm(j, styles, { accounts, commodity: commodityFor(j, txns), standalone: true });
};
