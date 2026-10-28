import { run } from "@backslash/api";
import { songLine } from "../lib.ts";
import { playPause, type Prefs, run as mpd } from "../music.ts";

export default run(async ({ preferences }) => {
  const before = await mpd(preferences as Prefs, playPause);
  const song = before.current ? songLine(before.current) : "";
  return `${before.status.state === "play" ? "Paused" : "Playing"}${song ? ` · ${song}` : ""}`;
});
