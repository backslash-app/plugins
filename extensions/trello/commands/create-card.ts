import { type Context, detail } from "@backslash/api";
import { account, AuthError, setupItem } from "../lib.ts";
import { cardForm } from "../views.ts";

// Text typed before opening the command becomes the title.
export default async (ctx: Context) => {
  try {
    return await cardForm(account(ctx.preferences), {}, { standalone: true, title: ctx.query.trim() });
  } catch (e) {
    if (!(e instanceof AuthError)) throw e;
    const setup = setupItem(e, ctx.preferences);
    return detail({ title: "Connect Trello", markdown: setup.detail!.markdown!, actions: setup.actions });
  }
};
