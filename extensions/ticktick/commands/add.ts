import { run } from "@backslash/api";
import { client, everything } from "../api.ts";
import { AuthError } from "../lib.ts";
import { createTask } from "../views.ts";

export default run<{ task: string }>(async (ctx) => {
  const text = String(ctx.args.task ?? "").trim();
  if (!text) throw new Error("Type the task after the command");
  try {
    const api = await client(ctx.preferences);
    const { projects } = await everything(api);
    const { summary } = await createTask(api, projects, text);
    return summary;
  } catch (e) {
    if (e instanceof AuthError) throw new Error(`${e.message}: open TickTick Tasks to connect`);
    throw e;
  }
});
