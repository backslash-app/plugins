import { run } from "@backslash/api";
import { type Prefs, selection } from "../system.ts";
import { say } from "../ui.ts";

// The text selected with the mouse (primary selection), read aloud.
export default run(async ({ preferences }) => {
  const text = await selection();
  if (!text.trim()) throw new Error("No text is selected (needs wl-clipboard on Wayland, xclip or xsel on X11)");
  return await say(text, preferences as Prefs);
});
