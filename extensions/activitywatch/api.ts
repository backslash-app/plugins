// The local ActivityWatch server's REST API.

import {
  baseUrl,
  buildQuery,
  type Category,
  connectionError,
  hostnames,
  parseBuckets,
  parseCategories,
  parseStartOfDay,
  parseUsage,
  type PeriodId,
  periods,
  pickSources,
  type Sources,
  timeperiod,
  type Usage,
} from "./lib.ts";

export class Setup extends Error {}

async function call<T>(base: string, path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${base}/api/0${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", ...(init.headers ?? {}) },
    });
  } catch (e) {
    if ((e as Error).name === "AbortError" || (e as Error).name === "TimeoutError") throw e;
    throw new Setup(connectionError(base, e));
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const message = (() => {
      try {
        return (JSON.parse(text) as { message?: string }).message;
      } catch {
        return text.slice(0, 200);
      }
    })();
    throw Object.assign(new Error(`ActivityWatch answered ${res.status}${message ? `: ${message}` : ""}`), {
      status: res.status,
    });
  }
  return await res.json() as T;
}

/** A setting the web UI keeps on the server, or undefined (older servers keep them in the browser). */
async function setting(base: string, key: string, signal?: AbortSignal): Promise<unknown> {
  try {
    return await call<unknown>(base, `/settings/${key}`, { signal });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    if (e instanceof Setup) throw e;
    return undefined;
  }
}

export interface Report {
  base: string;
  sources: Sources;
  categories: Category[];
  dayOffset: number;
  usage: Record<PeriodId, Usage>;
  now: Date;
}

const PERIOD_IDS: PeriodId[] = ["today", "yesterdaySoFar", "yesterday", "week", "lastWeekSoFar"];

export async function report(prefs: Record<string, unknown>, signal?: AbortSignal): Promise<Report> {
  const base = baseUrl(prefs.url);
  const [buckets, classes, startOfDay] = await Promise.all([
    call<unknown>(base, "/buckets/", { signal }).then(parseBuckets),
    setting(base, "classes", signal),
    setting(base, "startOfDay", signal),
  ]);
  const host = String(prefs.hostname ?? "").trim();
  const sources = pickSources(buckets, host);
  if (!sources) {
    const known = hostnames(buckets);
    throw new Setup(
      host && known.length
        ? `No window watcher for “${host}”: ActivityWatch knows ${known.join(", ")}`
        : "No window activity yet: is aw-watcher-window (or aw-awatcher on Wayland) running?",
    );
  }
  const categories = parseCategories(classes);
  const dayOffset = parseStartOfDay(startOfDay);
  const now = new Date();
  const spans = periods(now, dayOffset);
  const query = buildQuery(sources, categories);
  const results = await call<unknown[]>(base, "/query/", {
    method: "POST",
    signal,
    body: JSON.stringify({ timeperiods: PERIOD_IDS.map((p) => timeperiod(spans[p])), query: [query] }),
  });
  const usage = Object.fromEntries(PERIOD_IDS.map((p, i) => [p, parseUsage(results?.[i])])) as Record<
    PeriodId,
    Usage
  >;
  return { base, sources, categories, dayOffset, usage, now };
}

/** The hostname to open the web UI on, without querying everything. */
export async function hostFor(prefs: Record<string, unknown>): Promise<{ base: string; host?: string }> {
  const base = baseUrl(prefs.url);
  const buckets = parseBuckets(await call<unknown>(base, "/buckets/", { signal: AbortSignal.timeout(5000) }));
  return { base, host: pickSources(buckets, String(prefs.hostname ?? ""))?.hostname };
}
