import type { Context } from "@backslash/api";
import { cleanHost } from "../lib.ts";
import { whoisView } from "../ui.ts";

export default (ctx: Context<{ domain?: string }>) => {
  const text = String(ctx.args.domain ?? "").trim() || ctx.query.trim();
  const host = cleanHost(text);
  if (!host) throw new Error(`“${text}” isn't a domain name or an IP address`);
  return whoisView(host, ctx as Context);
};
