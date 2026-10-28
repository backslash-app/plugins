import type { Context } from "@backslash/api";
import { addForm } from "../views.ts";

export default (ctx: Context<{ trigger?: string }>) =>
  addForm(ctx.preferences, { trigger: String(ctx.args.trigger ?? "").trim() || undefined });
