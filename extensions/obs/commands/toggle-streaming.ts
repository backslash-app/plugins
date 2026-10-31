import { run } from "@backslash/api";
import { once, toggleStreaming } from "../system.ts";

export default run(async (ctx) => {
  const live = await once(ctx, toggleStreaming);
  return live ? "Going live…" : "Stream ended";
});
