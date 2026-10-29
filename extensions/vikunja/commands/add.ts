import { run } from "@backslash/api";
import { client, quickAdd, SetupError } from "../api.ts";

export default run<{ task: string }>(async ({ args, preferences }) => {
  try {
    const { summary } = await quickAdd(client(preferences), String(args.task ?? ""), preferences);
    return summary;
  } catch (e) {
    if (e instanceof SetupError) throw new Error(`${e.message}: open Vikunja Tasks to see how`);
    throw e;
  }
});
