import { action, close, field, form, type Item, list, refresh, toast } from "@backslash/api";
import { countdown, humanize, parseDuration } from "../lib.ts";
import { running, start, stop, type Timer } from "../timers.ts";

const PRESETS: [string, number, string][] = [
  ["Pomodoro", 25 * 60, "🍅"],
  ["Short Break", 5 * 60, "☕"],
  ["Long Break", 15 * 60, "🛋️"],
  ["Tea", 4 * 60, "🫖"],
  ["Pasta", 10 * 60, "🍝"],
  ["One Hour", 60 * 60, "⏳"],
];

const startAction = (title: string, seconds: number, name: string) =>
  action(title, async () => {
    await start(seconds, name);
    return close(`${name}: ${humanize(seconds)}`);
  }, { icon: "media-playback-start" });

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

const newTimer = action("New Timer…", () => custom, { icon: "list-add", shortcut: "<Ctrl>n" });

function runningItem(t: Timer): Item {
  const left = (t.ends - Date.now()) / 1000;
  const at = new Date(t.ends).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return {
    id: t.unit,
    title: t.name,
    subtitle: `${humanize(t.seconds)} · rings at ${at}`,
    icon: "⏱️",
    section: "Running",
    accessories: [{ tag: countdown(left), color: left < 60 ? "orange" : "blue" }],
    actions: [
      action("Stop Timer", async () => {
        await stop(t);
        return refresh();
      }, { icon: "media-playback-stop", destructive: true }),
      action("Restart", async () => {
        await stop(t);
        await start(t.seconds, t.name);
        return refresh();
      }, { icon: "view-refresh" }),
    ],
  };
}

const presets: Item[] = PRESETS.map(([name, seconds, icon]) => ({
  id: `preset:${name}`,
  title: name,
  subtitle: humanize(seconds),
  icon,
  section: "Start",
  actions: [startAction(`Start ${humanize(seconds)}`, seconds, name)],
}));

export default list({
  placeholder: "Timers…",
  actions: [newTimer],
  // Live countdown: refreshed every second while open.
  async *items({ signal }) {
    while (!signal.aborted) {
      const timers = await running();
      yield [...timers.map(runningItem), ...presets, {
        id: "custom",
        title: "Custom Timer…",
        subtitle: "Any duration: 25m, 1h30, 90s",
        icon: "list-add",
        section: "Start",
        actions: [action("New Timer…", () => custom, { icon: "list-add" })],
      }];
      await new Promise((r) => setTimeout(r, 1000));
    }
  },
});
