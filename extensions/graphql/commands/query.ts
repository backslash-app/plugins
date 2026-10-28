import type { Context } from "@backslash/api";
import { allEndpoints } from "../api.ts";
import { queryForm } from "../views.ts";

export default async (ctx: Context) => await queryForm(await allEndpoints(ctx.preferences));
