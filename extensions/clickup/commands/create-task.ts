import { type Context, detail } from "@backslash/api";
import { session } from "../api.ts";
import { AuthError, setupItem } from "../lib.ts";
import { taskForm } from "../views.ts";

// Text typed before opening the command becomes the task name.
export default async (ctx: Context) => {
  try {
    return await taskForm(await session(ctx.preferences), { name: ctx.query.trim(), standalone: true });
  } catch (e) {
    if (!(e instanceof AuthError)) throw e;
    const setup = setupItem(e);
    return detail({ title: "Connect ClickUp", markdown: setup.detail!.markdown!, actions: setup.actions });
  }
};
