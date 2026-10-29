import { run, toast, updateCommandMetadata } from "@backslash/api";
import { clockTime } from "../lib.ts";
import { optionsOf, start } from "../system.ts";

export default run<{ minutes?: number }>(async (ctx) => {
  const { session, warnings } = await start(ctx, optionsOf(ctx, ctx.args.minutes));
  if (warnings.length) await toast(warnings[0], { style: "failure" }).catch(() => {});
  await updateCommandMetadata({ subtitle: `Focusing until ${clockTime(session.ends)}` }).catch(() => {});
  return `Focus until ${clockTime(session.ends)}${warnings.length ? ` · ${warnings[0]}` : ""}`;
});
