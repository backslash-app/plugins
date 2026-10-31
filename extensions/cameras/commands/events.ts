import type { Context } from "@backslash/api";
import { server } from "../api.ts";
import { eventsList } from "../views.ts";

export default (ctx: Context) => eventsList(() => server(ctx.preferences));
