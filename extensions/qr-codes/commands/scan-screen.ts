import { run } from "@backslash/api";
import { capturePackages, installCommand } from "../lib.ts";
import { family, MissingTool, scanScreen, session } from "../system.ts";

// Hides the launcher right away; the background job selects, decodes and notifies.
export default run(async ({ preferences }) => {
  try {
    await scanScreen({ openLinks: !!(preferences as { openLinks?: boolean }).openLinks });
  } catch (e) {
    if (!(e instanceof MissingTool)) throw e;
    const fam = await family();
    const packages = e.packages.length ? e.packages : capturePackages(session());
    throw new Error(`${e.message}. Install it: ${fam ? installCommand(packages, fam) : packages.join(", ")}`);
  }
});
