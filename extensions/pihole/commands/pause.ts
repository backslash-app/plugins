import { run, updateCommandMetadata } from "@backslash/api";
import { backend } from "../api.ts";
import { pauseSeconds, pauseText, TITLES } from "../lib.ts";

export default run<{ duration?: string }>(async ({ args, preferences }) => {
  const seconds = pauseSeconds(args.duration);
  const b = await backend(preferences);
  await b.pause(seconds);
  updateCommandMetadata({ subtitle: null }).catch(() => {});
  return `${TITLES[b.kind]}: blocking paused ${pauseText(seconds)}`;
});
