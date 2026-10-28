import {
  action,
  close,
  type Context,
  Icons,
  menuBar,
  type MenuBarItem,
  open,
  updateCommandMetadata,
} from "@backslash/api";
import { type Backend, backendOf, SetupError, startTimer } from "../api.ts";
import {
  clockTime,
  type Entry,
  entryLabel,
  formatDuration,
  recentEntries,
  seconds,
  startOfDay,
  totalToday,
} from "../lib.ts";

/** One request per refresh: today's entries, the running one included. */
async function load(preferences: Record<string, unknown>): Promise<{ b?: Backend; entries: Entry[]; error?: string }> {
  try {
    const b = await backendOf(preferences);
    return { b, entries: await b.entries(startOfDay(new Date())) };
  } catch (e) {
    return { entries: [], error: e instanceof SetupError ? e.message : (e as Error).message };
  }
}

const short = (text: string, n = 24) => text.length > n ? `${text.slice(0, n - 1)}…` : text;

export default async ({ preferences }: Context) => {
  const { b, entries, error } = await load(preferences);
  const running = entries.find((e) => !e.stop);
  const today = totalToday(entries);
  if (b) updateCommandMetadata({ subtitle: `Today ${formatDuration(today)}` }).catch(() => {});
  const items: MenuBarItem[] = [];
  if (error || !b) {
    items.push({ title: error ?? "Not connected", icon: Icons.alert, enabled: false });
    items.push({ title: "Settings → Extensions → Time Tracking", icon: Icons.settings, enabled: false });
  } else {
    if (running) {
      items.push({
        id: "running",
        title: entryLabel(running),
        subtitle: `Since ${clockTime(running.start)}`,
        icon: Icons.timer,
        section: "Running",
        enabled: false,
      });
      items.push({
        id: "stop",
        title: "Stop Timer",
        icon: Icons.stop,
        section: "Running",
        action: action("Stop Timer", async () => {
          await b.stop(running);
          return close(`Stopped ${entryLabel(running)} after ${formatDuration(seconds(running))}`);
        }),
      });
    } else {
      items.push({ id: "idle", title: "No timer running", icon: Icons.pause, enabled: false, section: "Running" });
    }
    items.push({
      id: "today",
      title: `Today: ${formatDuration(today)}`,
      icon: Icons.clock,
      enabled: false,
      section: "Today",
    });
    for (const e of recentEntries(entries.filter((x) => x.stop), 5)) {
      items.push({
        id: `resume:${e.description}:${e.project?.id ?? ""}`,
        title: short(entryLabel(e), 48),
        icon: Icons.play,
        section: "Continue",
        action: action("Continue", async () => {
          await startTimer(b, e, true);
          return close(`Started ${entryLabel(e)}`);
        }),
      });
    }
    if (b.webUrl) items.push({ id: "web", title: `Open ${b.name}`, icon: Icons.external, action: open(b.webUrl) });
  }
  return menuBar({
    // The start time stays true between refreshes, unlike an elapsed time.
    title: running
      ? `${short(running.description || running.project?.name || "Timer")} · ${clockTime(running.start)}`
      : "",
    icon: running ? { source: Icons.timer, tint: "green" } : Icons.timer,
    tooltip: running
      ? `${entryLabel(running)}: started at ${clockTime(running.start)} · today ${formatDuration(today)}`
      : error ?? `No timer running · today ${formatDuration(today)}`,
    items,
  });
};
