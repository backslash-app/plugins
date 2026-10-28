import { run } from "@backslash/api";
import { songLine } from "../lib.ts";
import { type Prefs, run as mpd, snapshot } from "../music.ts";

export default run(async ({ preferences }) => {
  const now = await mpd(preferences as Prefs, async (m) => {
    await m.command("next");
    return await snapshot(m);
  });
  return now.current ? songLine(now.current) : "End of the queue";
});
