import type { Context } from "@backslash/api";
import type { Prefs } from "../system.ts";
import { queryForm } from "../views.ts";

// Text typed before opening the command becomes the SQL.
export default (ctx: Context) =>
  queryForm({ sql: ctx.query.trim() || undefined, after: "close" }, ctx.preferences as Prefs);
