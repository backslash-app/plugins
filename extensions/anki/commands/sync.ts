import { run } from "@backslash/api";
import { OfflineError, sync } from "../anki.ts";

export default run(async (ctx) => {
  try {
    return await sync(ctx);
  } catch (e) {
    if (e instanceof OfflineError) throw new Error("Open Anki with the AnkiConnect add-on (code 2055492159) to sync");
    throw e;
  }
});
