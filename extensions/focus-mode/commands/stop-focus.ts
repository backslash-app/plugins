import { run } from "@backslash/api";
import { humanize } from "../lib.ts";
import { stop } from "../system.ts";

export default run(async (ctx) => {
  const { session, warnings } = await stop(ctx);
  if (!session) return "No focus session is running";
  const spent = humanize((Date.now() - session.started) / 1000);
  return `Focus session ended after ${spent}${warnings.length ? ` · ${warnings[0]}` : ""}`;
});
