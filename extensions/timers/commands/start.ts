import { run } from "@backslash/api";
import { humanize, parseDuration } from "../lib.ts";
import { start } from "../timers.ts";

export default run<{ duration: string; name?: string }>(async ({ args }) => {
  const seconds = parseDuration(args.duration);
  if (!seconds) throw new Error(`“${args.duration}” is not a duration: try 25m, 1h30 or 90s`);
  const name = args.name?.trim() || `${humanize(seconds)} timer`;
  await start(seconds, name);
  return `${name}: started`;
});
