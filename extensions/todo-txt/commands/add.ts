import { run } from "@backslash/api";
import { normalizeNewTask, parseTask, relativeDay, tildify } from "../lib.ts";
import { changeLine, HOME, locate, prefs, today } from "../todo.ts";

// "Add Todo.txt Task  (A) Call Bob +Work @phone due:fri": appended at once.
export default run<{ task: string }>(async (ctx) => {
  const input = String(ctx.args.task ?? ctx.query ?? "").trim();
  if (!input) throw new Error("Type the task after the command");
  const files = await locate(ctx);
  const line = normalizeNewTask(input, today(), prefs(ctx).addCreated);
  await changeLine(files, undefined, [line]);
  const t = parseTask(line);
  const due = t.due ? `, due ${relativeDay(t.due, today())}` : "";
  return `Added to ${tildify(files.todo, HOME)}${due}`;
});
