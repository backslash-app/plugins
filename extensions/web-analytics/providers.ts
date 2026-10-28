// The three analytics APIs. Each turns the preferences into sites, and a site and period into Stats.

import {
  hogQueries,
  hogRows,
  normalizeBase,
  type Period,
  PLAUSIBLE_METRICS,
  plausibleAggregate,
  plausibleRange,
  type PlausibleResponse,
  plausibleRows,
  posthogBase,
  type ProviderId,
  range,
  type Site,
  splitList,
  type Stats,
  umamiActive,
  umamiAggregate,
  umamiRows,
  type UmamiStats,
  umamiWebsites,
} from "./lib.ts";

type Prefs = Record<string, unknown>;

/** A provider whose credentials are missing or rejected: shown as a row saying what to fix. */
export class SetupError extends Error {
  constructor(readonly provider: ProviderId, message: string) {
    super(message);
  }
}

export interface Provider {
  id: ProviderId;
  configured(p: Prefs): boolean;
  sites(p: Prefs, signal: AbortSignal): Promise<Site[]>;
  stats(p: Prefs, site: Site, period: Period, signal: AbortSignal, limit?: number): Promise<Stats>;
}

const str = (v: unknown) => String(v ?? "").trim();

async function request<T>(
  provider: ProviderId,
  url: string,
  init: RequestInit & { signal: AbortSignal },
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.any([init.signal, AbortSignal.timeout(20_000)]) });
  } catch (e) {
    if (init.signal.aborted) throw e;
    throw new Error(`${new URL(url).host} can't be reached`);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    let detail = "";
    try {
      const j = JSON.parse(text);
      detail = String(j.error?.message ?? j.error ?? j.detail ?? j.message ?? "");
    } catch {
      detail = text.length < 120 ? text.trim() : "";
    }
    if (res.status === 401 || res.status === 403) {
      const name = provider === "posthog" ? "PostHog" : provider === "umami" ? "Umami" : "Plausible";
      throw new SetupError(
        provider,
        `${name} rejected the credentials${detail ? ` (${detail.replace(/\.$/, "")})` : ""}`,
      );
    }
    throw new Error(`${new URL(url).host} answered ${res.status}${detail ? `: ${detail}` : ""}`);
  }
  return await res.json() as T;
}

// ---------------------------------------------------------------------------
// Plausible

export const plausible: Provider = {
  id: "plausible",
  configured: (p) => Boolean(str(p.plausibleKey) || str(p.plausibleSites)),
  sites(p) {
    const key = str(p.plausibleKey);
    const ids = splitList(p.plausibleSites);
    if (!key) return Promise.reject(new SetupError("plausible", "Add your Plausible API key"));
    if (!ids.length) return Promise.reject(new SetupError("plausible", "List your Plausible site domains"));
    const base = normalizeBase(str(p.plausibleHost) || "plausible.io");
    return Promise.resolve(
      ids.map((id) => ({ provider: "plausible", id, name: id, url: `${base}/${encodeURIComponent(id)}` })),
    );
  },
  async stats(p, site, period, signal, limit = 10) {
    const base = normalizeBase(str(p.plausibleHost) || "plausible.io");
    const r = range(period);
    const query = (body: Record<string, unknown>) =>
      request<PlausibleResponse>("plausible", `${base}/api/v2/query`, {
        method: "POST",
        signal,
        headers: { Authorization: `Bearer ${str(p.plausibleKey)}`, "Content-Type": "application/json" },
        body: JSON.stringify({ site_id: site.id, date_range: plausibleRange(r), ...body }),
      });
    const breakdown = (dimension: string) =>
      query({
        metrics: ["visitors"],
        dimensions: [dimension],
        order_by: [["visitors", "desc"]],
        pagination: { limit },
      });
    const [agg, prev, pages, sources, realtime] = await Promise.all([
      query({ metrics: PLAUSIBLE_METRICS }),
      r.previous
        ? request<PlausibleResponse>("plausible", `${base}/api/v2/query`, {
          method: "POST",
          signal,
          headers: { Authorization: `Bearer ${str(p.plausibleKey)}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            site_id: site.id,
            date_range: plausibleRange(r.previous, false),
            metrics: ["visitors", "pageviews"],
          }),
        }).catch(() => undefined)
        : undefined,
      breakdown("event:page"),
      breakdown("visit:source"),
      request<number>("plausible", `${base}/api/v1/stats/realtime/visitors?site_id=${encodeURIComponent(site.id)}`, {
        signal,
        headers: { Authorization: `Bearer ${str(p.plausibleKey)}` },
      }).catch(() => undefined),
    ]);
    const before = prev?.results[0]?.metrics;
    return {
      ...plausibleAggregate(agg),
      ...(before ? { previous: { visitors: Number(before[0] ?? 0), pageviews: Number(before[1] ?? 0) } } : {}),
      ...(typeof realtime === "number" ? { realtime } : {}),
      pages: plausibleRows(pages),
      sources: plausibleRows(sources).map((s) => ({ ...s, label: s.label === "Direct / None" ? "Direct" : s.label })),
    };
  },
};

// ---------------------------------------------------------------------------
// Umami: Umami Cloud with an API key, or a self-hosted instance with a login

const tokens = new Map<string, Promise<string>>();

async function umamiAuth(
  p: Prefs,
): Promise<{ base: string; headers: Record<string, string>; app: string }> {
  const url = str(p.umamiUrl);
  if (!url) {
    const key = str(p.umamiApiKey);
    if (!key) throw new SetupError("umami", "Add your Umami Cloud API key, or your instance's URL and login");
    return {
      base: "https://api.umami.is/v1",
      headers: { "x-umami-api-key": key, Accept: "application/json" },
      app: "https://cloud.umami.is",
    };
  }
  const base = normalizeBase(url);
  const username = str(p.umamiUsername);
  const password = str(p.umamiPassword);
  if (!username || !password) throw new SetupError("umami", "Add the username and password of your Umami instance");
  const cacheKey = `${base}\n${username}`;
  if (!tokens.has(cacheKey)) {
    tokens.set(
      cacheKey,
      // Shared by every view of the command: not tied to the signal of the one that started it.
      request<{ token: string }>("umami", `${base}/api/auth/login`, {
        method: "POST",
        signal: AbortSignal.timeout(20_000),
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      }).then((r) => r.token),
    );
    tokens.get(cacheKey)!.catch(() => tokens.delete(cacheKey));
  }
  return {
    base: `${base}/api`,
    headers: { Authorization: `Bearer ${await tokens.get(cacheKey)}`, Accept: "application/json" },
    app: base,
  };
}

/** Umami 3 renamed the `url` metric to `path`. */
const metricTypes = new Map<string, "url" | "path">();

export const umami: Provider = {
  id: "umami",
  configured: (p) => Boolean(str(p.umamiApiKey) || str(p.umamiUrl)),
  async sites(p, signal) {
    const auth = await umamiAuth(p);
    const wanted = splitList(p.umamiSites);
    const body = await request<unknown>("umami", `${auth.base}/websites?pageSize=100`, {
      signal,
      headers: auth.headers,
    });
    return umamiWebsites(body)
      .filter((w) => !wanted.length || wanted.includes(w.id) || wanted.includes(w.domain ?? ""))
      .map((w) => ({ provider: "umami", id: w.id, name: w.domain || w.name, url: `${auth.app}/websites/${w.id}` }));
  },
  async stats(p, site, period, signal, limit = 10) {
    const auth = await umamiAuth(p);
    const r = range(period);
    const window = (w: { start: Date; end: Date }) => `startAt=${w.start.getTime()}&endAt=${w.end.getTime()}`;
    const get = <T>(path: string) =>
      request<T>("umami", `${auth.base}/websites/${site.id}${path}`, { signal, headers: auth.headers });
    const metrics = async (type: "url" | "referrer") => {
      if (type === "referrer") {
        return get<{ x: string; y: number }[]>(`/metrics?${window(r)}&type=referrer&limit=${limit}`);
      }
      const known = metricTypes.get(auth.base);
      const tries: ("url" | "path")[] = known ? [known] : ["url", "path"];
      for (const t of tries) {
        try {
          const rows = await get<{ x: string; y: number }[]>(`/metrics?${window(r)}&type=${t}&limit=${limit}`);
          metricTypes.set(auth.base, t);
          return rows;
        } catch (e) {
          if (t === tries.at(-1) || e instanceof SetupError) throw e;
        }
      }
      return [];
    };
    const [stats, prev, pages, sources, active] = await Promise.all([
      get<UmamiStats>(`/stats?${window(r)}`),
      r.previous ? get<UmamiStats>(`/stats?${window(r.previous)}`).catch(() => undefined) : undefined,
      metrics("url"),
      metrics("referrer"),
      get<unknown>("/active").catch(() => undefined),
    ]);
    const before = prev ? umamiAggregate(prev) : undefined;
    const now = umamiActive(active);
    return {
      ...umamiAggregate(stats),
      ...(before ? { previous: { visitors: before.visitors, pageviews: before.pageviews } } : {}),
      ...(now !== undefined ? { realtime: now } : {}),
      pages: umamiRows(pages),
      sources: umamiRows(sources, "Direct"),
    };
  },
};

// ---------------------------------------------------------------------------
// PostHog

const projectNames = new Map<string, string>();

export const posthog: Provider = {
  id: "posthog",
  configured: (p) => Boolean(str(p.posthogKey)),
  async sites(p, signal) {
    const base = posthogBase(p.posthogHost);
    const headers = { Authorization: `Bearer ${str(p.posthogKey)}` };
    const ids = splitList(p.posthogProjects);
    const projects = ids.length
      ? await Promise.all(
        ids.map((id) =>
          request<{ id: number; name: string }>("posthog", `${base}/api/projects/${encodeURIComponent(id)}/`, {
            signal,
            headers,
          })
            .catch((e) => {
              if (e instanceof SetupError) throw e;
              return { id: Number(id), name: `Project ${id}` };
            })
        ),
      )
      : (await request<{ results: { id: number; name: string }[] }>("posthog", `${base}/api/projects/`, {
        signal,
        headers,
      })).results;
    return projects.map((pr) => {
      projectNames.set(String(pr.id), pr.name);
      return { provider: "posthog", id: String(pr.id), name: pr.name, url: `${base}/project/${pr.id}/web` };
    });
  },
  async stats(p, site, period, signal, limit = 10) {
    const base = posthogBase(p.posthogHost);
    const queries = hogQueries(range(period), limit);
    const run = (query: string) =>
      request<{ results: unknown[][] }>("posthog", `${base}/api/projects/${site.id}/query/`, {
        method: "POST",
        signal,
        headers: { Authorization: `Bearer ${str(p.posthogKey)}`, "Content-Type": "application/json" },
        body: JSON.stringify({ query: { kind: "HogQLQuery", query } }),
      }).then((r) => r.results);
    const [agg, sessions, pages, sources, realtime, previous] = await Promise.all([
      run(queries.aggregate),
      run(queries.sessions).catch(() => undefined),
      run(queries.pages),
      run(queries.sources),
      run(queries.realtime).catch(() => undefined),
      queries.previous ? run(queries.previous).catch(() => undefined) : undefined,
    ]);
    const [visitors, pageviews, visits] = (agg[0] ?? []).map(Number);
    const [avgDuration, bounce] = (sessions?.[0] ?? []).map((v) => (v === null ? undefined : Number(v)));
    return {
      visitors: visitors ?? 0,
      pageviews: pageviews ?? 0,
      visits,
      ...(bounce !== undefined && Number.isFinite(bounce) ? { bounceRate: bounce } : {}),
      ...(avgDuration !== undefined && Number.isFinite(avgDuration) ? { duration: avgDuration } : {}),
      ...(previous?.[0]
        ? { previous: { visitors: Number(previous[0][0] ?? 0), pageviews: Number(previous[0][1] ?? 0) } }
        : {}),
      ...(realtime?.[0] ? { realtime: Number(realtime[0][0] ?? 0) } : {}),
      pages: hogRows(pages),
      sources: hogRows(sources, "Direct"),
    };
  },
};

export const PROVIDER_LIST: Provider[] = [plausible, umami, posthog];
