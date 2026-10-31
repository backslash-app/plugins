import { Icons, list } from "@backslash/api";
import { expenses, overview } from "../api.ts";
import { AuthError, keyOf, setupItem } from "../lib.ts";
import { expenseItem } from "../views.ts";

export default list({
  placeholder: "Filter expenses by description, person, group or category…",
  status: (items) => items[0]?.id === "setup" ? "Not connected" : `${items.length} recent`,
  empty: {
    title: "No expense yet",
    description: "Add one with Add Splitwise Expense.",
    icon: Icons.history,
  },
  async items({ preferences, signal }) {
    let key: string;
    try {
      key = keyOf(preferences);
    } catch (e) {
      if (e instanceof AuthError) return [setupItem(e)];
      throw e;
    }
    try {
      // Group names come with the groups; a failure there only hides them.
      const [r, o] = await Promise.all([expenses(key, signal), overview(key, signal).catch(() => undefined)]);
      const groups = new Map((o?.groups ?? []).map((g) => [g.id, g.name]));
      return r.list.map((e) => expenseItem(key, e, groups));
    } catch (e) {
      if (e instanceof AuthError) return [setupItem(e)];
      throw e;
    }
  },
});
