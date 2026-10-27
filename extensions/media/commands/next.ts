import { run } from "@backslash/api";
import { call, current } from "../mpris.ts";

export default run(async () => {
  const p = await current();
  await call(p, "Next");
});
