import { run } from "@backslash/api";
import { nowPlaying, togglePause } from "../player.ts";

export default run(async () => {
  const current = await nowPlaying();
  if (!current) return "No podcast is playing";
  const paused = await togglePause();
  if (paused === undefined) throw new Error("mpv didn't answer");
  return `${paused ? "Paused" : "Playing"}: ${current.playing.episode.title}`;
});
