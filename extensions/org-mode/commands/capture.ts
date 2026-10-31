import { run } from "@backslash/api";
import { capture, config } from "../org.ts";

// "Capture to Org  Call Bob :phone:" → "* TODO Call Bob :phone:" at the end of inbox.org.
export default run<{ text: string }>(async (ctx) => {
  const text = String(ctx.args.text ?? ctx.query ?? "").trim();
  if (!text) throw new Error("Type what to capture after the command");
  return await capture(config(ctx), text);
});
