import type { Context } from "@backslash/api";
import { token } from "../api.ts";
import { dnsView } from "../views.ts";

// Records of every zone the token sees, grouped by zone.
export default (ctx: Context) => dnsView(() => token(ctx.preferences));
