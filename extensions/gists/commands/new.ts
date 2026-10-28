import { type Context, detail, Icons, open } from "@backslash/api";
import { AuthError, setupItems, token } from "../api.ts";
import { createForm } from "../gists.ts";

export default async (ctx: Context) => {
  try {
    return await createForm(await token(ctx.preferences), { standalone: true });
  } catch (e) {
    if (!(e instanceof AuthError)) throw e;
    const [setup] = setupItems(e);
    return detail({
      title: "Connect GitHub",
      markdown: setup.detail?.markdown ?? e.message,
      actions: [
        ...(setup.actions ?? []),
        open("https://cli.github.com/", "Get the GitHub CLI", { icon: Icons.terminal }),
      ],
    });
  }
};
