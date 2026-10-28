import { run } from "@backslash/api";
import { humanize, parseDuration } from "../lib.ts";
import { current, start, stop } from "../caffeine.ts";

export default run(async ({ preferences }) => {
  if (await current()) {
    await stop();
    return "Caffeine off";
  }
  const seconds = parseDuration(String(preferences.duration ?? ""));
  await start(seconds);
  return seconds ? `Awake for ${humanize(seconds)}` : "Awake until turned off";
});
