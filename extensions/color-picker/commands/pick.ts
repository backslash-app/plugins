import { run } from "@backslash/api";
import { pickerInstall } from "../lib.ts";
import { family, Missing, pick, session } from "../system.ts";

// Hides the launcher right away; the color lands in the clipboard and in
// Color History.
export default run(async ({ preferences }) => {
  try {
    await pick({ upper: !!preferences.uppercase });
  } catch (e) {
    if (!(e instanceof Missing)) throw e;
    throw new Error(`${e.message}. Install one: ${pickerInstall(session(), (await family()) ?? "debian")}`);
  }
});
