import type { Context } from "@backslash/api";
import { normalizeModelName } from "../lib.ts";
import { pullForm, pullView } from "../ollama.ts";

// "Pull Ollama Model  qwen3:8b" streams the download; without a name, asks for one.
export default (ctx: Context<{ model?: string }>) => {
  const name = String(ctx.args.model ?? ctx.query ?? "").trim();
  return name ? pullView(normalizeModelName(name)) : pullForm();
};
