import { type Context, list } from "@backslash/api";
import { AuthError, keyOf, setupItem } from "../lib.ts";
import { expenseForm } from "../views.ts";

// "Add Splitwise Expense 42 dinner": the form, filled in, with the last friend or group picked.
export default async (ctx: Context<{ amount?: string; description?: string }>) => {
  try {
    const key = keyOf(ctx.preferences);
    return await expenseForm(key, {
      amount: String(ctx.args.amount ?? ""),
      description: String(ctx.args.description ?? "").trim(),
    });
  } catch (e) {
    if (e instanceof AuthError) return list({ items: [setupItem(e)] });
    throw e;
  }
};
