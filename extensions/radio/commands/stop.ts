import { run } from "@backslash/api";
import { nowPlaying, stop } from "../player.ts";

export default run(async () => {
  const current = await nowPlaying();
  await stop();
  return current ? `${current.station.name.trim()} stopped` : "Nothing was playing";
});
