import { run } from "@backslash/api";
import { nowPlaying, togglePause } from "../player.ts";
import { serversFrom } from "../views.ts";

export default run(async ({ preferences }) => {
  const current = await nowPlaying(serversFrom(preferences).abs);
  if (!current) return "Nothing is playing";
  const paused = await togglePause();
  if (paused === undefined) throw new Error("mpv didn't answer");
  return `${paused ? "Paused" : "Playing"}: ${current.entry?.title ?? current.playing.title}`;
});
