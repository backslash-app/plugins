import { run } from "@backslash/api";
import { statusText } from "../lib.ts";
import { control, pickDevice, status } from "../system.ts";

export default run(async () => {
  const d = await pickDevice();
  await control(d, "play_toggle");
  const st = await status(d);
  return st ? `${d.name}: ${statusText(st)}` : d.name;
});
