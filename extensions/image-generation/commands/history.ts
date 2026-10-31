import type { Context } from "@backslash/api";
import { gallery } from "../views.ts";

export default (ctx: Context) => gallery(ctx.preferences);
