import { run } from "@backslash/api";
import { humanize, parseDuration } from "../lib.ts";
import { start } from "../caffeine.ts";

export default run<{ duration: string }>(async ({ args }) => {
  const seconds = parseDuration(args.duration);
  if (!seconds) throw new Error(`“${args.duration}” is not a duration: try 45m, 1h30 or 3h`);
  await start(seconds);
  return `Awake for ${humanize(seconds)}`;
});
