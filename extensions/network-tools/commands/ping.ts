import type { Context } from "@backslash/api";
import { cleanHost } from "../lib.ts";
import { pingView } from "../ui.ts";

export default (ctx: Context<{ host?: string }>) => {
  const text = String(ctx.args.host ?? "").trim() || ctx.query.trim() || "1.1.1.1";
  const host = cleanHost(text);
  if (!host) throw new Error(`“${text}” isn't a host name or an IP address`);
  return pingView(host, ctx as Context);
};
