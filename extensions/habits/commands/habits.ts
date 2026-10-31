import { action, type Context, Icons, type Item, list, toast, updateCommandMetadata } from "@backslash/api";
import { credentials, tasks } from "../api.ts";
import { pullHabitica, sortHabits, todaySummary } from "../lib.ts";
import { habitForm, habitItem, importView, loadHabits, saveHabits, today } from "../habits.ts";

let footer = "";

export default (ctx: Context) => {
  let habiticaOn = false;
  try {
    habiticaOn = !!credentials(ctx.preferences);
  } catch { /* a wrong user id is reported when syncing */ }
  const query = ctx.query.trim();
  return list({
    placeholder: "Filter habits…",
    filter: { options: [{ value: "active", title: "Active" }, { value: "archived", title: "Archived" }] },
    empty: {
      title: "No habit yet",
      description: "Press Ctrl+N to start one: read, exercise, drink water…",
      icon: Icons.repeat,
    },
    status: () => footer,
    actions: [
      action(query ? `New Habit “${query}”` : "New Habit", () => habitForm({ name: query }), {
        icon: Icons.plus,
        shortcut: "<Ctrl>n",
      }),
      ...(habiticaOn ? [action("Import from Habitica", () => importView(ctx), { icon: Icons.download })] : []),
    ],
    async *items({ filter, signal }): AsyncGenerator<Item[]> {
      const day = today();
      const show = (habits: Awaited<ReturnType<typeof loadHabits>>) => {
        const shown = habits.filter((h) => filter === "archived" ? h.archived : !h.archived);
        footer = todaySummary(habits, day) ?? `${shown.length} habit${shown.length === 1 ? "" : "s"}`;
        updateCommandMetadata({ subtitle: todaySummary(habits, day) ?? null }).catch(() => {});
        return sortHabits(shown, day).map((h) => habitItem(ctx, h, habits, { habiticaOn }));
      };
      let habits = await loadHabits();
      yield show(habits);
      // Then the dailies checked on Habitica today, for the linked habits.
      if (!habiticaOn || !habits.some((h) => h.habitica)) return;
      try {
        const c = credentials(ctx.preferences)!;
        const pulled = pullHabitica(await loadHabits(), await tasks(c, signal), day);
        if (pulled.changed) {
          habits = pulled.habits;
          await saveHabits(habits);
          yield show(habits);
        }
      } catch (e) {
        if (!signal.aborted) await toast("Habitica sync failed", { style: "failure", message: (e as Error).message });
      }
    },
  });
};
