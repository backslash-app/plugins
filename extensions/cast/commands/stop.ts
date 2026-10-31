import { run } from "@backslash/api";
import { pickDevice, stop } from "../system.ts";

export default run(async () => {
  const d = await pickDevice();
  await stop(d);
  return `Stopped ${d.name}`;
});
