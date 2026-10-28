import { run, updateCommandMetadata } from "@backslash/api";
import { backendOf, SetupError } from "../api.ts";
import { entryLabel, formatDuration, seconds, startOfDay, totalToday } from "../lib.ts";

export default run(async ({ preferences }) => {
  let b;
  try {
    b = await backendOf(preferences);
  } catch (e) {
    if (e instanceof SetupError) throw new Error(`${e.message}: open Time Entries to see how`);
    throw e;
  }
  const running = await b.current();
  if (!running) return "No timer is running";
  await b.stop(running);
  const today = await b.entries(startOfDay(new Date())).then((list) => totalToday(list)).catch(() => undefined);
  if (today !== undefined) updateCommandMetadata({ subtitle: `Today ${formatDuration(today)}` }).catch(() => {});
  return `Stopped ${entryLabel(running)} after ${formatDuration(seconds(running))}${
    today !== undefined ? ` · today ${formatDuration(today)}` : ""
  }`;
});
