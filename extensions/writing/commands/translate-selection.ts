import type { Context } from "@backslash/api";
import { translateFrom } from "../translate.ts";

// Paste replaces the selection in the app it came from.
export default (ctx: Context) => translateFrom(ctx, "selection");
