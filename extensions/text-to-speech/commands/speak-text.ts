import { run } from "@backslash/api";
import { type Prefs } from "../system.ts";
import { say } from "../ui.ts";

// "Speak Text  Hello world": read at once, no view.
export default run<{ text?: string }>(async ({ args, preferences }) => {
  const text = String(args.text ?? "");
  if (!text.trim()) throw new Error("Type the text after the command");
  return await say(text, preferences as Prefs);
});
