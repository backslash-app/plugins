import { run, toast } from "@backslash/api";
import { installCopied } from "../system.ts";

// The APK files copied in the file manager, installed in Waydroid (its session starts first if needed).
export default run(async () => {
  await toast("Installing in Waydroid…");
  return await installCopied();
});
