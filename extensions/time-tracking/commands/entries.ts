import {
  type Action,
  action,
  copy,
  Icons,
  type Item,
  list,
  open,
  refresh,
  updateCommandMetadata,
} from "@backslash/api";
import { type Backend, backendOf } from "../api.ts";
import {
  clockTime,
  type Day,
  dayTitle,
  type Entry,
  formatClock,
  formatDuration,
  groupByDay,
  seconds,
  startOfDay,
  startOfWeek,
  summaryText,
  tintOf,
  totalToday,
} from "../lib.ts";
import {
  copyEntry,
  deleteAction,
  entryDetail,
  entryMarkdownLine,
  guarded,
  resumeAction,
  stopAction,
} from "../views.ts";

let status = "";

function entryItem(b: Backend, e: Entry, day: Day | undefined, days: Day[], now: number): Item {
  const running = !e.stop;
  const s = seconds(e, now);
  const actions: Action[] = [
    running ? stopAction(b, e) : resumeAction(b, e),
    copyEntry(e),
    ...(day ? [copy(summaryText([day], now), "Copy Day Summary", { shortcut: "<Ctrl>d", section: "Copy" })] : []),
    copy(summaryText(days, now), "Copy Summary", { shortcut: "<Ctrl><Shift>s", section: "Copy" }),
    deleteAction(b, e),
    ...(b.webUrl ? [open(b.webUrl, `Open ${b.name}`, { shortcut: "<Ctrl>o", section: b.name })] : []),
    action("Reload", () => refresh(), { icon: Icons.refresh, shortcut: "<Ctrl>r", section: b.name }),
  ];
  return {
    id: e.id,
    title: e.description || "(no description)",
    subtitle: e.project ? e.project.name : undefined,
    icon: running ? { source: Icons.timer, tint: "green" } : { source: Icons.dot, tint: tintOf(e.project?.color) },
    section: running ? "Running" : day ? `${dayTitle(day.key, new Date(now))} · ${formatDuration(day.seconds)}` : "",
    keywords: [...e.tags, e.project?.client ?? ""].filter(Boolean),
    accessories: [
      ...e.tags.filter((t) => t !== e.description && t !== e.project?.name).slice(0, 2).map((t) => ({ tag: t })),
      ...(e.billable ? [{ icon: { source: Icons.coin, tint: "green" as const }, tooltip: "Billable" }] : []),
      { text: `${clockTime(e.start)}–${e.stop ? clockTime(e.stop) : "now"}` },
      running
        ? { tag: formatClock(s), color: "green" as const, tooltip: "Running" }
        : { tag: formatDuration(s), tooltip: "Duration" },
    ],
    detail: {
      ...entryDetail(b, e, now),
      markdown: day && !running
        ? `### ${dayTitle(day.key, new Date(now))} · ${formatDuration(day.seconds)}\n\n${
          day.entries.map((x) => entryMarkdownLine(x, now)).join("\n")
        }`
        : undefined,
    },
    actions,
  };
}

export default list({
  placeholder: "Filter entries by description, project, tag…",
  filter: {
    options: [{ value: "today", title: "Today" }, { value: "week", title: "This Week" }],
    default: "today",
  },
  empty: {
    title: "Nothing tracked yet",
    description: "Start a timer with Start Time Tracking",
    icon: Icons.timer,
  },
  status: (items) => items[0]?.id === "setup" ? "Not connected" : status,
  items: ({ preferences, filter, signal }) =>
    guarded(async () => {
      status = "";
      const b = await backendOf(preferences);
      const now = Date.now();
      const since = filter === "week" ? startOfWeek(new Date(now)) : startOfDay(new Date(now));
      const entries = await b.entries(since, signal);
      const days = groupByDay(entries, now);
      const today = totalToday(entries, now);
      const total = days.reduce((n, d) => n + d.seconds, 0);
      status = [
        b.name,
        `Today ${formatDuration(today)}`,
        ...(filter === "week" ? [`Week ${formatDuration(total)}`] : []),
        `${entries.length} entr${entries.length === 1 ? "y" : "ies"}`,
      ].join(" · ");
      updateCommandMetadata({ subtitle: `Today ${formatDuration(today)}` }).catch(() => {});
      const running = entries.filter((e) => !e.stop);
      return [
        ...running.map((e) => entryItem(b, e, undefined, days, now)),
        ...days.flatMap((d) => d.entries.filter((e) => e.stop).map((e) => entryItem(b, e, d, days, now))),
      ];
    }),
});
