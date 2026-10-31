import { run } from "@backslash/api";
import { showFullUi } from "../system.ts";

export default run(async () => {
  await showFullUi();
  return "Opening Waydroid…";
});
