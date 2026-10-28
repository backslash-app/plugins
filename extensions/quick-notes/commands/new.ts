import type { Context } from "@backslash/api";
import { titleFromText } from "../lib.ts";
import { noteForm, notesDir } from "../notes.ts";

// Text typed before opening the command becomes the title.
export default (ctx: Context) =>
  noteForm(notesDir(ctx), { title: ctx.query ? titleFromText(ctx.query) : "", standalone: true });
