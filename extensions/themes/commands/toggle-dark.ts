import { run } from "@backslash/api";
import { isDark, load, setDark } from "../system.ts";

export default run(async () => {
  const state = await load();
  return await setDark(state, !isDark(state));
});
