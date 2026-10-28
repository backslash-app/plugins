import {
  action,
  close,
  type Color,
  field,
  form,
  Icons,
  type Item,
  list,
  meta,
  refresh,
  toast,
  updateCommandMetadata,
} from "@backslash/api";
import { countdown, humanize, parseDuration } from "../lib.ts";
import { running, start, stop, type Timer } from "../timers.ts";

const PRESETS: [string, number, Color, string][] = [
  ["Pomodoro", 25 * 60, "red", "Focus for 25 minutes, then take a short break"],
  ["Short Break", 5 * 60, "teal", "Five minutes away from the screen"],
  ["Long Break", 15 * 60, "blue", "After four pomodoros"],
  ["Tea", 4 * 60, "green", "Black tea: 3 to 5 minutes"],
  ["Pasta", 10 * 60, "yellow", "Most dried pasta: 9 to 11 minutes"],
  ["One Hour", 60 * 60, "gray", "A full hour"],
];

const startAction = (title: string, seconds: number, name: string) =>
  action(title, async () => {
    await start(seconds, name);
    return close(`${name}: ${humanize(seconds)}`);
  }, { icon: Icons.play });

const custom = form({
  title: "New Timer",
  submitTitle: "Start",
  fields: [
    field.text("duration", "Duration", { placeholder: "25m, 1h30, 90s, 10:00", required: true }),
    field.text("name", "Name", { placeholder: "Optional" }),
  ],
  async submit(values) {
    const seconds = parseDuration(String(values.duration));
    if (!seconds) {
      await toast("Not a duration: try 25m, 1h30 or 90s", { style: "failure" });
      return;
    }
    const name = String(values.name ?? "").trim() || `${humanize(seconds)} timer`;
    await start(seconds, name);
    return close(`${name}: started`);
  },
});

const newTimer = action("New Timer…", () => custom, { icon: Icons.plus, shortcut: "<Ctrl>n" });

const clockTime = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

function runningItem(t: Timer): Item {
  const left = Math.max(0, (t.ends - Date.now()) / 1000);
  const started = t.ends - t.seconds * 1000;
  const soon = left < 60;
  return {
    id: t.unit,
    title: t.name,
    subtitle: `rings at ${clockTime(t.ends)}`,
    icon: { source: Icons.timer, tint: soon ? "orange" : "blue" },
    section: "Running",
    accessories: [{ tag: countdown(left), color: soon ? "orange" : "blue" }],
    detail: {
      stats: [
        { label: "left", value: countdown(left), color: soon ? "orange" : "blue" },
        { label: "rings at", value: clockTime(t.ends) },
      ],
      metadata: [
        meta.progress("Elapsed", 1 - left / t.seconds),
        meta.text("Duration", humanize(t.seconds), { icon: Icons.timer }),
        meta.text("Started", clockTime(started), { icon: Icons.clock }),
        meta.text("Rings", "With a notification and a sound, even if Backslash is closed", { icon: Icons.bell }),
      ],
    },
    actions: [
      action("Stop Timer", async () => {
        await stop(t);
        return refresh();
      }, { icon: Icons.stop, destructive: true, shortcut: "<Ctrl>k" }),
      action("Restart", async () => {
        await stop(t);
        await start(t.seconds, t.name);
        return refresh();
      }, { icon: Icons.refresh, shortcut: "<Ctrl>r" }),
    ],
  };
}

const presets = (): Item[] =>
  PRESETS.map(([name, seconds, color, about]) => ({
    id: `preset:${name}`,
    title: name,
    subtitle: humanize(seconds),
    icon: { source: name.includes("Break") || name === "One Hour" ? Icons.clock : Icons.timer, tint: color },
    section: "Start",
    detail: {
      stats: [{ label: "duration", value: humanize(seconds) }],
      markdown: about,
      metadata: [meta.text("Rings at", clockTime(Date.now() + seconds * 1000), { icon: Icons.bell })],
    },
    actions: [startAction(`Start ${humanize(seconds)}`, seconds, name)],
  }));

export default list({
  placeholder: "Timers…",
  empty: { title: "No timer", icon: "bs-timer" },
  status: (items) => {
    const n = items.filter((i) => i.section === "Running").length;
    return n ? `${n} running` : "Type a duration to start a timer";
  },
  actions: [newTimer],
  // Live countdown: refreshed every second while open.
  async *items({ signal }) {
    let lastCount: string | null | undefined;
    while (!signal.aborted) {
      const timers = await running();
      const count = timers.length ? `${timers.length} running` : null;
      if (count !== lastCount) {
        lastCount = count;
        updateCommandMetadata({ subtitle: count }).catch(() => {});
      }
      yield [...timers.map(runningItem), ...presets(), {
        id: "custom",
        title: "Custom Timer…",
        subtitle: "Any duration: 25m, 1h30, 90s",
        icon: { source: Icons.plus, tint: "gray" },
        section: "Start",
        actions: [action("New Timer…", () => custom, { icon: Icons.plus })],
      }];
      await new Promise((r) => setTimeout(r, 1000));
    }
  },
});
