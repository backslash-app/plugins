import { run } from "@backslash/api";
import { findHabit } from "../lib.ts";
import { loadHabits, toggle } from "../habits.ts";

// "Check In Habit  read": the habit whose name matches best is checked in for today.
export default run<{ habit: string }>(async (ctx) => {
  const name = String(ctx.args.habit ?? ctx.query ?? "").trim();
  const habits = await loadHabits();
  if (!habits.length) throw new Error("No habit yet: add one with Add Habit");
  const h = findHabit(habits, name);
  if (!h) {
    throw new Error(`No habit matches “${name}”: ${habits.filter((x) => !x.archived).map((x) => x.name).join(", ")}`);
  }
  return await toggle(ctx, h.id);
});
