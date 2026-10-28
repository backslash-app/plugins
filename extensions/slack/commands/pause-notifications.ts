import { run } from "@backslash/api";
import { snooze, tokenOf } from "../api.ts";
import { AuthError, clock, snoozeMinutes } from "../lib.ts";

export default run<{ duration: string }>(async (ctx) => {
  let token: string;
  try {
    token = tokenOf(ctx);
  } catch (e) {
    if (e instanceof AuthError) throw new Error(`${e.message}: open Set Slack Status to see how`);
    throw e;
  }
  const end = await snooze(token, snoozeMinutes(String(ctx.args.duration ?? "1 hour")));
  return `Slack notifications paused until ${clock(end)}`;
});
