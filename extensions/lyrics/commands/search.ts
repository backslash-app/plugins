import type { Context } from "@backslash/api";
import { searchList } from "../views.ts";

export default (ctx: Context) => searchList(String(ctx.preferences.player ?? "").trim());
