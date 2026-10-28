import { action, type Context, Icons, list, refresh } from "@backslash/api";
import { connect, noteForm, OfflineError, setupItems, TokenError } from "../joplin.ts";

export default async (ctx: Context) => {
  try {
    return await noteForm(await connect(ctx, ctx.signal), { title: ctx.query.trim(), standalone: true });
  } catch (e) {
    if (!(e instanceof OfflineError || e instanceof TokenError)) throw e;
    return list({
      items: setupItems(e),
      actions: [action("Try Again", () => refresh(), { icon: Icons.refresh, shortcut: "<Ctrl>r" })],
    });
  }
};
