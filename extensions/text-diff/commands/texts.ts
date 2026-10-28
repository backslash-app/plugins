import type { Context } from "@backslash/api";
import { compareForm, contextOf, type Prefs, readClipboard, readSelection } from "../views.ts";

// Two text areas, filled with the clipboard and the selected text.
export default async (ctx: Context) => {
  const [clip, selection] = await Promise.all([readClipboard(), readSelection()]);
  return compareForm({
    left: clip,
    right: selection === clip ? "" : selection,
    context: contextOf(ctx.preferences as Prefs),
  });
};
