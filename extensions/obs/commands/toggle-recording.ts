import { run } from "@backslash/api";
import { basename } from "../lib.ts";
import { once, toggleRecording } from "../system.ts";

export default run(async (ctx) => {
  const res = await once(ctx, toggleRecording);
  return res.active ? "Recording started" : `Recording saved${res.path ? `: ${basename(res.path)}` : ""}`;
});
