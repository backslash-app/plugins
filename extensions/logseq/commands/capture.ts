import { run } from "@backslash/api";
import { capture } from "../graph.ts";

// "Capture to Logseq  Call the bank" → a block at the end of today's journal.
export default run<{ text: string }>(async (ctx) => {
  const text = String(ctx.args.text ?? ctx.query ?? "").trim();
  if (!text) throw new Error("Type the block after the command");
  return await capture(ctx, text);
});
