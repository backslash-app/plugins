import { openExternal, run } from "@backslash/api";
import { hostFor } from "../api.ts";
import { activityUrl, baseUrl, dayStart } from "../lib.ts";

export default run(async ({ preferences }) => {
  let target = baseUrl(preferences.url);
  try {
    const { base, host } = await hostFor(preferences);
    if (host) target = activityUrl(base, host, "day", dayStart(new Date()));
  } catch {
    // Not running: the browser says so, and the URL is still the right one once it starts.
  }
  await openExternal(target);
});
