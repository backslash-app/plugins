import type { Context } from "@backslash/api";
import { promptForm } from "../views.ts";

/** What was typed after the command name becomes the prompt. */
export default (ctx: Context) => promptForm(ctx.preferences, { prompt: ctx.query });
