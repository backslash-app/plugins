import type { Context } from "@backslash/api";
import { pickPair } from "../lib.ts";
import { compareForm, contextOf, diffView, type Prefs, readClipboard, readHistory, readSelection } from "../views.ts";

// The clipboard against the selected text; else the last two copies; else a form to fill in.
export default async (ctx: Context) => {
  const context = contextOf(ctx.preferences as Prefs);
  const [clip, selection, history] = await Promise.all([readClipboard(), readSelection(), readHistory()]);
  const pair = pickPair(clip, selection, history);
  if (!pair) return compareForm({ left: clip, right: selection === clip ? "" : selection, context });
  return diffView({ ...pair, options: {}, context });
};
