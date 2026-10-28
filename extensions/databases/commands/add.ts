import type { Context } from "@backslash/api";
import { connectionForm } from "../db.ts";

// Text typed before opening the command becomes the name.
export default (ctx: Context) =>
  connectionForm({ connection: undefined, standalone: true, name: ctx.query.trim() || undefined });
