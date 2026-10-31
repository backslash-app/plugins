// The PageSpeed Insights API v5, and the saved sites in the extension's storage.

import { storage } from "@backslash/api";
import { addRun, apiUrl, parseRun, psiError, type Run, type Site, STRATEGIES, type Strategy } from "./lib.ts";

type Json = Parameters<typeof storage.set>[1];

const SITES = "sites";

export async function loadSites(): Promise<Site[]> {
  const sites = await storage.get(SITES).catch(() => undefined);
  return Array.isArray(sites) ? sites as unknown as Site[] : [];
}

export async function saveSites(sites: Site[]): Promise<void> {
  await storage.set(SITES, sites as unknown as Json);
}

export interface Options {
  key?: string;
  locale?: string;
  signal?: AbortSignal;
}

export function options(preferences: Record<string, unknown>, signal?: AbortSignal): Options {
  return {
    key: String(preferences.apiKey ?? "").trim() || undefined,
    locale: String(preferences.locale ?? "").trim() || undefined,
    signal,
  };
}

/** One Lighthouse run on Google's servers: usually 10 to 40 seconds. */
export async function runPagespeed(url: string, strategy: Strategy, o: Options = {}): Promise<Run> {
  const timeout = AbortSignal.timeout(120_000);
  let res: Response;
  try {
    res = await fetch(apiUrl(url, strategy, o.key, o.locale), {
      headers: { Accept: "application/json" },
      signal: o.signal ? AbortSignal.any([o.signal, timeout]) : timeout,
    });
  } catch (e) {
    if (o.signal?.aborted) throw e;
    if (timeout.aborted) throw new Error("PageSpeed Insights took more than 2 minutes: try again");
    throw new Error(`Can't reach PageSpeed Insights: ${e instanceof Error ? e.message : e}`);
  }
  const json = await res.json().catch(() => undefined);
  if (!res.ok) throw new Error(psiError(res.status, json));
  const run = parseRun(json, strategy);
  if (!run) throw new Error("PageSpeed Insights sent no Lighthouse result");
  return run;
}

/**
 * Tests mobile and desktop at once and saves what worked to the site's
 * history. Fails only when both fail.
 */
export async function testSite(url: string, o: Options = {}): Promise<{ site: Site; errors: string[] }> {
  const results = await Promise.allSettled(STRATEGIES.map((s) => runPagespeed(url, s, o)));
  const runs = results.flatMap((r) => r.status === "fulfilled" ? [r.value] : []);
  const errors = [
    ...new Set(results.flatMap((r) => r.status === "rejected" ? [String(r.reason?.message ?? r.reason)] : [])),
  ];
  if (!runs.length) throw new Error(errors[0] ?? "PageSpeed Insights failed");
  let sites = await loadSites();
  for (const run of runs) sites = addRun(sites, url, run);
  await saveSites(sites);
  return { site: sites[0], errors };
}
