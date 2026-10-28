import type { Context } from "@backslash/api";
import { translateFrom } from "../translate.ts";

export default (ctx: Context) => translateFrom(ctx, "clipboard");
