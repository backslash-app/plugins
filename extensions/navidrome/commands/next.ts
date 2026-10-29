import { run } from "@backslash/api";
import { next, nowPlaying } from "../player.ts";
import { serversFrom } from "../views.ts";

export default run(async ({ preferences }) => {
  const abs = serversFrom(preferences).abs;
  const current = await nowPlaying(abs);
  if (!current) return "Nothing is playing";
  if (!await next(current.playing)) throw new Error("mpv didn't answer");
  if (current.playing.source === "abs") return "Next chapter";
  await new Promise((r) => setTimeout(r, 500));
  const now = await nowPlaying(abs);
  return now ? `Playing ${now.entry?.title ?? now.playing.title}` : "End of the queue";
});
