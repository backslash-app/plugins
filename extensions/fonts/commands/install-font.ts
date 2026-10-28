import type { Context } from "@backslash/api";
import { installForm } from "../install.ts";

// A path typed before opening the command fills the form, e.g. "Install Font ~/Downloads/Inter.ttf".
export default (ctx: Context) => installForm(ctx.query.trim(), true);
