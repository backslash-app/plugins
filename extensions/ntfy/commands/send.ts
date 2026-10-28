import { run } from "@backslash/api";
import { config, defaultTarget, send } from "../api.ts";
import { soleUrl } from "../lib.ts";

export default run<{ message: string }>(async ({ args, preferences }) => {
  const message = String(args.message ?? "").trim();
  if (!message) throw new Error("Type the message after the command");
  const c = config(preferences);
  const where = await send(c, defaultTarget(c), { message, click: soleUrl(message) });
  return `Sent to ${where}`;
});
