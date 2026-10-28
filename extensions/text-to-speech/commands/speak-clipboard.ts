import { clipboard, run } from "@backslash/api";
import { type Prefs } from "../system.ts";
import { say } from "../ui.ts";

// Hides the launcher and reads the clipboard aloud in the background.
export default run(async ({ preferences }) => {
  const text = await clipboard.read();
  if (!text.trim()) throw new Error("The clipboard has no text");
  return await say(text, preferences as Prefs);
});
