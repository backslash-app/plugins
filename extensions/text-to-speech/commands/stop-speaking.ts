import { run, updateCommandMetadata } from "@backslash/api";
import { speaking, stop } from "../system.ts";

export default run(async () => {
  const busy = await speaking();
  await stop();
  updateCommandMetadata({ subtitle: null }).catch(() => {});
  return busy ? "Stopped" : "Nothing was being read";
});
