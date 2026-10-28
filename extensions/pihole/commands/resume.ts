import { run } from "@backslash/api";
import { backend } from "../api.ts";
import { TITLES } from "../lib.ts";

export default run(async ({ preferences }) => {
  const b = await backend(preferences);
  await b.resume();
  return `${TITLES[b.kind]}: blocking resumed`;
});
