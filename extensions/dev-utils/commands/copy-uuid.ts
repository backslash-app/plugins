import { clipboard, run } from "@backslash/api";
import { uuidV4 } from "../lib.ts";

export default run(async () => {
  const uuid = uuidV4();
  await clipboard.write(uuid);
  return `Copied ${uuid}`;
});
