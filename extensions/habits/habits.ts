// Habits in storage, and as launcher items.

import {
  type Action,
  action,
  close,
  type Context,
  copy,
  detail,
  field,
  form,
  type FormSpec,
  Icons,
  type Item,
  list,
  meta,
  open,
  pop,
  refresh,
  storage,
  submenu,
  toast,
  updateCommandMetadata,
} from "@backslash/api";
import { credentials, score, tasks } from "./api.ts";
import {
  addDays,
  applyInput,
  bestStreak,
  checkIn,
  completionRate,
  count,
  describeDays,
  describeFrequency,
  doneOn,
  type Habit,
  heatmap,
  isoDay,
  lastCheckIn,
  lastDays,
  parseDay,
  sanitize,
  scoreDirection,
  stateToday,
  streak,
  todaySummary,
  toggleToday,
  totalCheckIns,
  uncheck,
  weekCount,
  weekStart,
} from "./lib.ts";

const KEY = "habits";

export const today = () => isoDay(new Date());

export async function loadHabits(): Promise<Habit[]> {
  return sanitize(await storage.get(KEY));
}

export async function saveHabits(habits: Habit[]): Promise<void> {
  await storage.set(KEY, habits as unknown as Parameters<typeof storage.set>[1]);
  updateCommandMetadata({ subtitle: todaySummary(habits, today()) ?? null }).catch(() => {});
}

/** Changes one habit by id, reading storage again so nothing done meanwhile is lost. */
export async function updateHabit(id: string, change: (h: Habit) => Habit | undefined): Promise<Habit | undefined> {
  const habits = await loadHabits();
  const i = habits.findIndex((h) => h.id === id);
  if (i < 0) throw new Error("This habit was deleted meanwhile");
  const next = change(habits[i]);
  if (next) habits[i] = next;
  else habits.splice(i, 1);
  await saveHabits(habits);
  return next;
}

/** Tells Habitica about a check-in, when the habit is linked; a failure is reported, the check-in kept. */
export async function syncScore(ctx: Pick<Context, "preferences">, h: Habit, checked: boolean) {
  if (!h.habitica) return;
  const direction = scoreDirection(h.habitica, checked);
  if (!direction) return;
  try {
    const c = credentials(ctx.preferences);
    if (c) await score(c, h.habitica.id, direction);
  } catch (e) {
    await toast("Not sent to Habitica", { style: "failure", message: (e as Error).message });
  }
}

/** Checks in (or undoes) today; returns the message to show. */
export async function toggle(ctx: Pick<Context, "preferences">, id: string, day = today()): Promise<string> {
  let checked = false;
  const h = await updateHabit(id, (h) => {
    const r = toggleToday(h, day);
    checked = r.checked;
    return r.habit;
  });
  if (!h) return "";
  await syncScore(ctx, h, checked);
  const s = streak(h, today());
  if (!checked) return `Check-in removed: ${h.name}`;
  const left = h.frequency === "daily" && h.target > 1 && count(h, day) < h.target
    ? ` (${count(h, day)}/${h.target})`
    : "";
  return `${h.name}${left} ✓${s > 1 ? ` · ${s} ${h.frequency === "weekly" ? "weeks" : "days"} in a row` : ""}`;
}

// --- Forms -------------------------------------------------------------------

export function habitForm(o: { habit?: Habit; name?: string; standalone?: boolean } = {}): FormSpec {
  const h = o.habit;
  return form({
    title: h ? `Edit “${h.name}”` : "New Habit",
    submitTitle: h ? "Save Habit" : "Add Habit",
    fields: [
      field.text("name", "Habit", { required: true, value: h?.name ?? o.name ?? "", placeholder: "Read 20 minutes" }),
      field.dropdown("frequency", "Frequency", [
        { value: "daily", title: "Daily" },
        { value: "weekly", title: "Weekly" },
      ], { value: h?.frequency ?? "daily" }),
      field.text("days", "Days (daily)", {
        value: h?.days ? describeDays(h.days) : "",
        placeholder: "Every day, or mon-fri, weekends, mon wed fri",
      }),
      field.text("target", "Times a day (daily) or a week (weekly)", {
        value: h ? String(h.target) : "",
        placeholder: "1 a day, 3 a week",
      }),
    ],
    async submit(values) {
      const input = {
        name: String(values.name ?? ""),
        frequency: String(values.frequency ?? "daily"),
        days: String(values.days ?? ""),
        target: String(values.target ?? ""),
      };
      if (h) {
        await updateHabit(h.id, (old) => applyInput(input, today(), old));
        await toast("Habit saved", { style: "success" });
      } else {
        const habits = await loadHabits();
        const habit = applyInput(input, today());
        if (habits.some((x) => !x.archived && x.name.toLowerCase() === habit.name.toLowerCase())) {
          throw new Error(`You already track “${habit.name}”`);
        }
        await saveHabits([...habits, habit]);
        await toast(`Tracking “${habit.name}”`, { style: "success", message: describeFrequency(habit) });
      }
      return o.standalone ? close("Habit added") : pop();
    },
  });
}

// --- Habitica linking --------------------------------------------------------

function linkView(ctx: Context, h: Habit) {
  return list({
    title: `Link “${h.name}” to Habitica`,
    placeholder: "Pick the Habitica daily or habit…",
    empty: { title: "No daily or habit on Habitica", icon: Icons.link },
    async items({ signal }) {
      const c = credentials(ctx.preferences);
      if (!c) throw new Error("Set your Habitica user ID and API token in Settings → Extensions → Habits first");
      return (await tasks(c, signal)).map((t): Item => ({
        id: t.id,
        title: t.text,
        subtitle: t.type === "daily" ? "Daily" : "Habit",
        icon: t.type === "daily" ? Icons.calendar : Icons.repeat,
        accessories: t.streak ? [{ text: `${t.streak}`, icon: Icons.bolt, tooltip: "Habitica streak" }] : [],
        actions: [action("Link", async () => {
          await updateHabit(h.id, (x) => ({ ...x, habitica: { id: t.id, type: t.type, text: t.text } }));
          await toast("Linked to Habitica", { style: "success", message: t.text });
          return pop();
        }, { icon: Icons.link })],
      }));
    },
  });
}

export function importView(ctx: Context) {
  return list({
    title: "Import from Habitica",
    placeholder: "Dailies and habits not tracked here yet…",
    empty: { title: "Everything is already here", icon: Icons.check },
    async items({ signal }) {
      const c = credentials(ctx.preferences);
      if (!c) throw new Error("Set your Habitica user ID and API token in Settings → Extensions → Habits first");
      const linked = new Set((await loadHabits()).map((h) => h.habitica?.id).filter(Boolean));
      return (await tasks(c, signal)).filter((t) => !linked.has(t.id)).map((t): Item => ({
        id: t.id,
        title: t.text,
        subtitle: t.type === "daily" ? "Daily" : "Habit",
        icon: t.type === "daily" ? Icons.calendar : Icons.repeat,
        actions: [action("Import", async () => {
          const habit = applyInput({ name: t.text, frequency: "daily", days: "", target: "1" }, today());
          habit.habitica = { id: t.id, type: t.type, text: t.text };
          if (t.type === "daily" && t.completed) habit.checks[today()] = 1;
          await saveHabits([...(await loadHabits()), habit]);
          await toast(`Tracking “${t.text}”`, { style: "success" });
          return refresh();
        }, { icon: Icons.download })],
      }));
    },
  });
}

// --- Items -------------------------------------------------------------------

export function overview(habits: Habit[]) {
  const day = today();
  const open = habits.filter((h) => !h.archived);
  return detail({
    title: "All Habits",
    markdown: open.length
      ? open.map((h) => `### ${h.name.replace(/[#*_`]/g, "\\$&")}\n\n\`\`\`\n${heatmap(h, day)}\n\`\`\``).join("\n\n")
      : "_No habit yet._",
    actions: [copy(JSON.stringify(habits, null, 2), "Export as JSON")],
  });
}

function dayLabel(day: string, now: string): string {
  const diff = Math.round((parseDay(now).getTime() - parseDay(day).getTime()) / 86_400_000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  return parseDay(day).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });
}

export function habitItem(ctx: Context, h: Habit, all: Habit[], o: { habiticaOn: boolean }): Item {
  const day = today();
  const state = stateToday(h, day);
  const s = streak(h, day);
  const best = bestStreak(h, day);
  const unit = h.frequency === "weekly" ? "wk" : "d";
  const week = weekCount(h, weekStart(day));
  const n = count(h, day);
  const rate = completionRate(h, day);

  const toggleAction = (title: string, target = day) =>
    action(title, async () => {
      await toast(await toggle(ctx, h.id, target), { style: "success" });
      return refresh();
    }, { icon: doneOn(h, target) ? Icons.cross : Icons.check });

  const past: Action[] = [];
  for (let i = 1; i <= 7; i++) {
    const d = addDays(day, -i);
    if (d < h.created && !h.checks[d]) break;
    past.push(action(`${dayLabel(d, day)}${doneOn(h, d) ? " ✓" : ""}`, async () => {
      const done = doneOn(h, d);
      // Only today's check-ins are sent to Habitica: it scores tasks for the current day.
      await updateHabit(h.id, (x) => done ? uncheck(x, d) : checkIn(x, d));
      await toast(done ? `Unchecked ${dayLabel(d, day).toLowerCase()}` : `Checked ${dayLabel(d, day).toLowerCase()}`, {
        style: "success",
      });
      return refresh();
    }, { icon: doneOn(h, d) ? Icons.squareCheck : Icons.square }));
  }

  const first = h.archived
    ? action("Restore Habit", async () => {
      await updateHabit(h.id, (x) => ({ ...x, archived: false }));
      return refresh();
    }, { icon: Icons.refresh })
    : h.frequency === "daily" && h.target > 1 && n > 0 && n < h.target
    ? toggleAction(`Check In (${n + 1}/${h.target})`)
    : toggleAction(n > 0 ? "Undo Today's Check-In" : "Check In Today");

  const actions: Action[] = [
    first,
    ...(h.archived ? [] : [submenu("Check In Another Day", past, { icon: Icons.calendar, shortcut: "<Ctrl>d" })]),
    action("Edit Habit", () => habitForm({ habit: h }), { icon: Icons.text, shortcut: "<Ctrl>e" }),
    action("New Habit", () => habitForm(), { icon: Icons.plus, shortcut: "<Ctrl>n" }),
    action("All Heatmaps", () => overview(all), { icon: Icons.activity, shortcut: "<Ctrl>h" }),
  ];
  if (o.habiticaOn) {
    actions.push(
      h.habitica
        ? action("Unlink from Habitica", async () => {
          await updateHabit(h.id, (x) => {
            const { habitica: _, ...rest } = x;
            return rest;
          });
          return refresh();
        }, { icon: Icons.link, section: "Habitica" })
        : action("Link to Habitica…", () => linkView(ctx, h), { icon: Icons.link, section: "Habitica" }),
      open("https://habitica.com/", "Open Habitica", { section: "Habitica" }),
    );
  }
  actions.push(
    copy(JSON.stringify(h, null, 2), "Copy as JSON", { section: "Copy" }),
    ...(h.archived ? [] : [action("Archive Habit", async () => {
      await updateHabit(h.id, (x) => ({ ...x, archived: true }));
      await toast("Archived: its history is kept", { style: "success" });
      return refresh();
    }, { icon: Icons.archive, section: "Danger" })]),
    action("Delete Habit", async () => {
      await updateHabit(h.id, () => undefined);
      await toast("Habit deleted", { style: "success" });
      return refresh();
    }, {
      icon: Icons.trash,
      destructive: true,
      confirm: `Delete “${h.name}” and its ${totalCheckIns(h)} check-ins?`,
      shortcut: "<Ctrl>Delete",
      section: "Danger",
    }),
  );

  const last = lastCheckIn(h);
  return {
    id: h.id,
    title: h.name,
    subtitle: describeFrequency(h),
    icon: state === "done"
      ? { source: Icons.done, tint: "green" }
      : state === "rest"
      ? { source: Icons.moon, tint: "gray" }
      : n > 0
      ? { source: Icons.inProgress, tint: "yellow" }
      : Icons.todo,
    section: h.archived ? "Archived" : state === "todo" ? "To Do" : state === "done" ? "Done" : "Rest Day",
    keywords: [h.frequency, ...(h.habitica ? ["habitica"] : [])],
    accessories: [
      ...(h.frequency === "weekly"
        ? [{ tag: `${week}/${h.target} this week`, color: week >= h.target ? "green" as const : undefined }]
        : h.target > 1
        ? [{ tag: `${n}/${h.target}`, color: n >= h.target ? "green" as const : undefined }]
        : []),
      ...(h.habitica
        ? [{ icon: Icons.link, tooltip: `Linked to Habitica: ${h.habitica.text ?? h.habitica.type}` }]
        : []),
      { text: lastDays(h, day), tooltip: "The last 7 days" },
      ...(s > 0
        ? [{
          icon: Icons.bolt,
          text: `${s}${unit}`,
          color: s >= 7 ? "orange" as const : undefined,
          tooltip: "Current streak",
        }]
        : []),
    ],
    detail: {
      stats: [
        {
          label: "streak",
          value: `${s} ${h.frequency === "weekly" ? "wk" : "d"}`,
          color: s > 0 ? "orange" : undefined,
        },
        { label: "best", value: `${best} ${h.frequency === "weekly" ? "wk" : "d"}` },
        { label: "last 30 days", value: `${Math.round(rate * 100)} %`, color: rate >= 0.8 ? "green" : undefined },
      ],
      markdown: "```\n" + heatmap(h, day) + "\n```\n■ done · □ missed · ▪ partly · · not due",
      metadata: [
        meta.text("Frequency", describeFrequency(h), { icon: Icons.repeat }),
        meta.text(
          "Today",
          state === "done" ? "Done" : state === "rest" ? "Rest day" : n > 0 ? `${n}/${h.target}` : "To do",
          {
            icon: state === "done" ? Icons.done : Icons.todo,
            color: state === "done" ? "green" : undefined,
          },
        ),
        meta.text("Check-ins", totalCheckIns(h), { icon: Icons.check }),
        ...(last ? [meta.text("Last check-in", dayLabel(last, day), { icon: Icons.history })] : []),
        meta.text(
          "Since",
          parseDay(h.created).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" }),
          {
            icon: Icons.calendar,
          },
        ),
        ...(h.habitica ? [meta.text("Habitica", h.habitica.text ?? h.habitica.id, { icon: Icons.link })] : []),
      ],
    },
    actions,
  };
}
