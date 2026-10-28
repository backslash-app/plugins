import { run } from "@backslash/api";
import { capturePackages, installCommand } from "../lib.ts";
import { family, MissingTool, scanScreen, session } from "../system.ts";

// Hides the launcher right away; the background job selects, decodes and keeps
// the link (in the keyring) until Authenticator is opened again.
export default run(async () => {
  try {
    await scanScreen();
  } catch (e) {
    if (!(e instanceof MissingTool)) throw e;
    const fam = await family();
    const packages = e.packages.length ? e.packages : capturePackages(session());
    throw new Error(`${e.message}. Install it: ${fam ? installCommand(packages, fam) : packages.join(", ")}`);
  }
});
