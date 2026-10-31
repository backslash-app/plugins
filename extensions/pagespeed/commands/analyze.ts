import type { Context } from "@backslash/api";
import { options, testSite } from "../api.ts";
import { normalizeUrl } from "../lib.ts";
import { resultView } from "../views.ts";

/** Runs both strategies, then shows the mobile result (Ctrl+K → Show Desktop). */
export default async ({ args, preferences, signal }: Context<{ url?: string }>) => {
  const target = normalizeUrl(String(args.url ?? ""));
  if ("error" in target) throw new Error(target.error);
  const o = options(preferences, signal);
  const { site, errors } = await testSite(target.url, o);
  return resultView(site, "mobile", { ...o, signal: undefined }, errors);
};
