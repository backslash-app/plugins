import { clipboard, type Context } from "@backslash/api";
import { looksLikeJson } from "../lib.ts";
import { explore } from "../views.ts";

// JSON typed after the command name is explored instead of the clipboard.
export default async (ctx: Context) => {
  if (looksLikeJson(ctx.query)) return explore(ctx.query, "Search text", ctx.query);
  return explore(await clipboard.read().catch(() => ""), "Clipboard");
};
