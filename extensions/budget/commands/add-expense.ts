import { action, type Context, Icons, list } from "@backslash/api";
import { type Backend, backends, SetupError, setupItem } from "../api.ts";
import { PROVIDER_NAMES } from "../lib.ts";
import { expenseFormFor } from "../views.ts";

// One server: the form at once. Both: pick where the expense goes first.
export default async (ctx: Context<{ amount?: string; description?: string }>) => {
  const initial = { amount: String(ctx.args.amount ?? ""), description: String(ctx.args.description ?? "").trim() };
  let servers: Backend[];
  try {
    servers = backends(ctx.preferences);
  } catch (e) {
    if (e instanceof SetupError) return list({ items: [setupItem(e)] });
    throw e;
  }
  if (servers.length === 1) {
    try {
      return await expenseFormFor(servers[0], undefined, initial);
    } catch (e) {
      if (e instanceof SetupError) return list({ items: [setupItem(e)] });
      throw e;
    }
  }
  return list({
    title: "Add Expense to…",
    items: servers.map((b) => ({
      id: b.provider,
      title: PROVIDER_NAMES[b.provider],
      subtitle: new URL(b.base).host,
      icon: { source: Icons.plus, tint: b.provider === "firefly" ? "orange" as const : "purple" as const },
      actions: [
        action(`Add to ${PROVIDER_NAMES[b.provider]}`, () => expenseFormFor(b, undefined, initial), {
          icon: Icons.plus,
        }),
      ],
    })),
  });
};
