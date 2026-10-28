import { run } from "@backslash/api";
import { displayName } from "../lib.ts";
import { addSite } from "../monitor.ts";

// "Watch Website  example.com": added at once, checked the next time Uptime & SSL opens.
export default run<{ url: string }>(async ({ args }) => {
  const site = await addSite(String(args.url ?? ""));
  return `Watching ${displayName(site)}`;
});
