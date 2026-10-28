import { run } from "@backslash/api";
import { stop } from "../player.ts";

export default run(async () => {
  const was = await stop();
  return was ? `Stopped ${was.episode.title}, position saved` : "No podcast was playing";
});
