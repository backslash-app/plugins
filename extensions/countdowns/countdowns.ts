// Countdowns kept in the extension's storage, and their launcher items.

import {
  type Action,
  action,
  close,
  copy,
  field,
  form,
  type FormSpec,
  Icons,
  type Item,
  meta,
  pop,
  storage,
  toast,
  updateCommandMetadata,
} from "@backslash/api";
import {
  breakdown,
  calendarDays,
  type Color,
  COLORS,
  type Countdown,
  eventDate,
  formatDate,
  newId,
  nextOccurrence,
  ordinal,
  parseDateInput,
  parseTimeInput,
  pinnedSubtitle,
  progress,
  sectionOf,
  timeLeft,
  yearsAt,
} from "./lib.ts";

export async function loadAll(): Promise<Countdown[]> {
  const all = (await storage.get("countdowns").catch(() => undefined)) as Countdown[] | undefined;
  return Array.isArray(all) ? all.filter((c) => c && typeof c.date === "string" && typeof c.title === "string") : [];
}

async function saveAll(all: Countdown[]) {
  await storage.set("countdowns", all as unknown as Parameters<typeof storage.set>[1]);
  notifyChanged();
}

export async function pinnedId(): Promise<string | undefined> {
  const id = await storage.get("pinned").catch(() => undefined);
  return typeof id === "string" ? id : undefined;
}

/** Shows the pinned countdown under the command in the root search, or clears it. */
export async function syncSubtitle(all?: Countdown[], pinned?: string) {
  const list = all ?? await loadAll();
  const id = pinned ?? await pinnedId();
  const c = list.find((x) => x.id === id);
  await updateCommandMetadata({ subtitle: c ? pinnedSubtitle(c, new Date()) : null }).catch(() => {});
}

export async function setPinned(id: string | undefined) {
  if (id) await storage.set("pinned", id);
  else await storage.delete("pinned");
  await syncSubtitle(undefined, id ?? "");
  notifyChanged();
}

export async function upsert(c: Countdown) {
  const all = await loadAll();
  const i = all.findIndex((x) => x.id === c.id);
  if (i >= 0) all[i] = c;
  else all.push(c);
  await saveAll(all);
  await syncSubtitle(all);
}

export async function remove(c: Countdown) {
  await saveAll((await loadAll()).filter((x) => x.id !== c.id));
  if ((await pinnedId()) === c.id) await setPinned(undefined);
}

// --- Live reload -------------------------------------------------------------

const changes = new EventTarget();
export const notifyChanged = () => changes.dispatchEvent(new Event("change"));

/** Yields `load()` after each change and every minute (the labels move), until `signal` aborts. */
export async function* live<T>(load: () => Promise<T>, signal: AbortSignal): AsyncGenerator<T> {
  while (!signal.aborted) {
    yield await load();
    await new Promise<void>((resolve) => {
      const done = () => {
        clearTimeout(timer);
        changes.removeEventListener("change", done);
        signal.removeEventListener("abort", done);
        resolve();
      };
      const timer = setTimeout(done, 60_000 - (Date.now() % 60_000) + 50);
      changes.addEventListener("change", done);
      signal.addEventListener("abort", done);
    });
  }
}

// --- Form --------------------------------------------------------------------

const COLOR_NAMES = COLORS.map((c) => ({ value: c, title: c[0].toUpperCase() + c.slice(1) }));

export function countdownForm(
  o: { countdown?: Countdown; title?: string; date?: string; yearly?: boolean; standalone?: boolean } = {},
): FormSpec {
  const c = o.countdown;
  return form({
    title: c ? `Edit “${c.title}”` : "New Countdown",
    submitTitle: c ? "Save Countdown" : "Add Countdown",
    fields: [
      field.text("title", "Title", {
        required: true,
        placeholder: "Vacation, Mom's birthday…",
        value: c?.title ?? o.title ?? "",
      }),
      field.text("date", "Date", {
        required: true,
        placeholder: "2026-12-24, Dec 24, 24 December 2027",
        value: c?.date ?? o.date ?? "",
      }),
      field.text("time", "Time", { placeholder: "Optional: 18:30, 6pm", value: c?.time ?? "" }),
      field.checkbox("yearly", "Repeats every year (birthdays, anniversaries)", {
        value: c?.yearly ?? o.yearly ?? false,
      }),
      field.dropdown("color", "Color", COLOR_NAMES, { value: c?.color ?? "blue" }),
    ],
    async submit(values) {
      const now = new Date();
      const title = String(values.title ?? "").trim();
      if (!title) throw new Error("Give the countdown a title");
      const date = parseDateInput(String(values.date ?? ""), now);
      if (!date) throw new Error(`“${values.date}” is not a date (2026-12-24, Dec 24, 24 December 2027)`);
      const time = parseTimeInput(String(values.time ?? ""));
      const color = (COLORS as string[]).includes(String(values.color)) ? values.color as Color : "blue";
      const next: Countdown = {
        id: c?.id ?? newId(),
        title,
        date,
        ...(time ? { time } : {}),
        ...(values.yearly === true ? { yearly: true } : {}),
        color,
        created: c?.created ?? now.getTime(),
      };
      await upsert(next);
      const left = timeLeft(next, now);
      await toast(c ? "Countdown saved" : `${title} ${left.label}`, { style: "success" });
      return o.standalone ? close(`${title} ${left.label}`) : pop();
    },
  });
}

// --- Items -------------------------------------------------------------------

export function countdownItem(c: Countdown, now: Date, pinned: boolean): Item {
  const at = nextOccurrence(c, now);
  const left = timeLeft(c, now);
  const color: Color = left.past ? "gray" : c.color ?? "blue";
  const years = yearsAt(c, now);
  const ratio = progress(c, now);
  const hours = Math.round(left.ms / 3_600_000);
  const actions: Action[] = [
    action(pinned ? "Unpin from Root Search" : "Pin to Root Search", async () => {
      await setPinned(pinned ? undefined : c.id);
      await toast(pinned ? "Unpinned" : `“${pinnedSubtitle(c, new Date())}” shows in the root search`, {
        style: "success",
      });
    }, { icon: Icons.pin, shortcut: "<Ctrl><Shift>p" }),
    action("Edit Countdown", () => countdownForm({ countdown: c }), { icon: Icons.text, shortcut: "<Ctrl>e" }),
    action("New Countdown", () => countdownForm(), { icon: Icons.plus, shortcut: "<Ctrl>n" }),
    copy(pinnedSubtitle(c, now), "Copy Time Left", { shortcut: "<Ctrl><Shift>c", section: "Copy" }),
    copy(`${c.title}: ${formatDate(c, at, now)}`, "Copy Date", { section: "Copy" }),
    action("Delete Countdown", async () => {
      await remove(c);
      await toast(`Deleted “${c.title}”`, { style: "success" });
    }, {
      icon: Icons.trash,
      destructive: true,
      confirm: `Delete “${c.title}”?`,
      section: "Danger",
      shortcut: "<Ctrl>Delete",
    }),
  ];
  const stats = left.past ? [{ label: "days ago", value: -left.days, color: "gray" as const }] : [
    {
      label: left.days === 0 && c.time ? "hours left" : "days left",
      value: left.days === 0 && c.time ? Math.max(0, hours) : left.days,
      color,
    },
    ...(left.days >= 14 ? [{ label: "weeks", value: Math.floor(left.days / 7) }] : []),
    ...(left.days > 0 && left.days < 14 ? [{ label: "hours", value: hours }] : []),
    { label: "elapsed", value: `${Math.round(ratio * 100)} %` },
  ];
  return {
    id: c.id,
    title: c.title,
    subtitle: formatDate(c, at, now),
    icon: pinned
      ? { source: Icons.pin, tint: color }
      : { source: left.past ? Icons.done : Icons.hourglass, tint: color },
    section: sectionOf(c, now),
    keywords: [c.date, ...(c.yearly ? ["yearly", "birthday", "anniversary"] : [])],
    accessories: [
      ...(c.yearly ? [{ icon: Icons.repeat, tooltip: years ? `${ordinal(years)} time` : "Every year" }] : []),
      { text: left.label, color: left.past ? undefined : left.days < 7 ? color : undefined },
    ],
    detail: {
      stats,
      metadata: [
        meta.text("Date", formatDate(c, at, now, { year: true }), { icon: Icons.calendar, color }),
        ...(left.past ? [] : [
          meta.text("Time left", left.days === 0 ? left.label.replace(/^in /, "") : breakdown(now, at), {
            icon: Icons.hourglass,
          }),
        ]),
        ...(c.yearly
          ? [
            meta.text("Repeats", years ? `Every year · ${ordinal(years)} this time` : "Every year", {
              icon: Icons.repeat,
            }),
          ]
          : []),
        ...(c.yearly && calendarDays(eventDate(c), now) > 0
          ? [meta.text("First", eventDate(c).toLocaleDateString("en", { dateStyle: "medium" }))]
          : []),
        meta.progress(c.yearly ? "Since the last one" : "Since added", ratio),
        meta.separator(),
        meta.text("Added", new Date(c.created).toLocaleDateString("en", { dateStyle: "medium" }), { icon: Icons.plus }),
        ...(pinned ? [meta.text("Pinned", "Shown in the root search", { icon: Icons.pin, color: "yellow" })] : []),
      ],
    },
    actions,
  };
}

export function suggestionItems(now: Date): Item[] {
  const ny = { title: `New Year ${now.getFullYear() + 1}`, date: `${now.getFullYear() + 1}-01-01` };
  const nyLeft = calendarDays(now, new Date(now.getFullYear() + 1, 0, 1));
  return [
    {
      id: "suggest-new-year",
      title: ny.title,
      subtitle: `Jan 1 · in ${nyLeft} days`,
      icon: { source: Icons.sparkle, tint: "yellow" },
      section: "Suggestions",
      actions: [
        action("Add Countdown", async () => {
          await upsert({ id: newId(), title: ny.title, date: ny.date, color: "yellow", created: Date.now() });
          await toast(`${ny.title} in ${nyLeft} days`, { style: "success" });
        }, { icon: Icons.plus }),
      ],
    },
    {
      id: "suggest-birthday",
      title: "A Birthday…",
      subtitle: "Repeats every year and counts the years",
      icon: { source: Icons.heart, tint: "pink" },
      section: "Suggestions",
      actions: [action("New Birthday", () => countdownForm({ yearly: true }), { icon: Icons.plus })],
    },
    {
      id: "suggest-new",
      title: "New Countdown…",
      subtitle: "A vacation, a launch, a deadline",
      icon: { source: Icons.plus, tint: "blue" },
      section: "Suggestions",
      actions: [action("New Countdown", () => countdownForm(), { icon: Icons.plus })],
    },
  ];
}
