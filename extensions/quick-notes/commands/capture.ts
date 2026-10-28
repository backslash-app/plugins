import { run } from "@backslash/api";
import { titleFromText } from "../lib.ts";
import { notesDir, saveNote } from "../notes.ts";

// "Capture Quick Note  Call the bank about the card": saved at once, no form.
export default run<{ text: string }>(async (ctx) => {
  const text = String(ctx.args.text ?? "").trim();
  if (!text) throw new Error("Type the note after the command");
  // The text is kept whole in the body, so copying the note gives it back.
  const file = await saveNote(notesDir(ctx), { title: titleFromText(text), body: text });
  return `Saved “${file.replace(/\.md$/, "")}”`;
});
