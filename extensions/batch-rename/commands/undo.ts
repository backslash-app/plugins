import { run } from "@backslash/api";
import { lastBatch } from "../system.ts";
import { undo } from "../ui.ts";

// Gives the files of the last batch their old names back.
export default run(async () => {
  const batch = await lastBatch();
  if (!batch) throw new Error("Nothing to undo: no rename was made with Batch Rename");
  return await undo(batch);
});
