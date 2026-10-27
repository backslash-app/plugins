import { run } from "@backslash/api";
import { dueSection, type Task, todoist } from "../lib.ts";

export default run<{ task: string }>(async ({ args, preferences }) => {
  const task = await todoist<Task>(preferences.token as string, "/tasks/quick", {
    method: "POST",
    body: { text: args.task.trim() },
  });
  const when = task.due ? ` · ${task.due.string || dueSection(task)}` : "";
  return `Added “${task.content}”${when}`;
});
