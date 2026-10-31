import { run } from "@backslash/api";
import { addTask } from "../tw.ts";

// "Add Taskwarrior Task  Call Bob project:Work due:fri +phone": Taskwarrior reads the attributes.
export default run<{ task: string }>(async (ctx) => {
  const input = String(ctx.args.task ?? ctx.query ?? "").trim();
  if (!input) throw new Error("Type the task after the command, e.g. “Buy milk project:Home due:tomorrow”");
  return await addTask(input);
});
