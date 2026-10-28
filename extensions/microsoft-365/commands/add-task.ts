import { run } from "@backslash/api";
import { client } from "../api.ts";
import { AuthError } from "../lib.ts";
import { createTask, loadLists } from "../todo.ts";

// "Add To Do Task  Call Bob tomorrow !high #Work": added at once, no form.
export default run<{ task: string }>(async (ctx) => {
  const text = String(ctx.args.task ?? "").trim();
  if (!text) throw new Error("Type the task after the command");
  try {
    const api = await client(ctx.preferences);
    return await createTask(api, await loadLists(api, ctx.signal), { text });
  } catch (e) {
    if (e instanceof AuthError) throw new Error(`${e.message}: open Microsoft To Do to set it up`);
    throw e;
  }
});
