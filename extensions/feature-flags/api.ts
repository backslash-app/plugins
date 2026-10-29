// The four flag APIs: which ones are configured, loading flags, and toggling one in an environment.

import {
  environmentStates,
  type EnvState,
  type Flag,
  fromFlagsmith,
  fromGrowthBook,
  fromLaunchDarkly,
  fromUnleash,
  type FsEnvironment,
  type FsFeature,
  type FsFeatureState,
  type GbEnvironment,
  type GbFeature,
  type LdEnvironment,
  type LdFlag,
  ldTogglePatch,
  normalizeUrl,
  parseList,
  type Provider,
  PROVIDER_NAMES,
  PROVIDERS,
  results,
  type UnleashEnvironment,
  type UnleashFeature,
} from "./lib.ts";

export interface Prefs {
  launchdarklyToken?: string;
  launchdarklyProject?: string;
  unleashUrl?: string;
  unleashToken?: string;
  unleashProject?: string;
  flagsmithKey?: string;
  flagsmithProject?: string;
  flagsmithUrl?: string;
  growthbookKey?: string;
  growthbookUrl?: string;
}

export interface Account {
  provider: Provider;
  base: string;
  headers: Record<string, string>;
  projects: string[];
}

export const TOKEN_PAGES: Record<Provider, string> = {
  launchdarkly: "https://app.launchdarkly.com/settings/authorization",
  unleash: "https://docs.getunleash.io/reference/api-tokens-and-client-keys",
  flagsmith: "https://app.flagsmith.com/organisation-settings",
  growthbook: "https://app.growthbook.io/settings/keys",
};

export class SetupError extends Error {
  constructor(readonly provider: Provider, message: string) {
    super(message);
  }
}

const trim = (v: unknown) => String(v ?? "").trim();

function url(provider: Provider, input: string): string | SetupError {
  try {
    return normalizeUrl(input);
  } catch {
    return new SetupError(provider, `“${input}” is not a web address: fix the ${PROVIDER_NAMES[provider]} address`);
  }
}

/** The providers that are configured; a half-filled one is an error to show. */
export function accounts(p: Prefs): (Account | SetupError)[] {
  const out: (Account | SetupError)[] = [];
  const ld = trim(p.launchdarklyToken);
  if (ld) {
    out.push({
      provider: "launchdarkly",
      base: "https://app.launchdarkly.com/api/v2",
      headers: { Authorization: ld },
      projects: parseList(p.launchdarklyProject || "default"),
    });
  }
  const unUrl = trim(p.unleashUrl), unToken = trim(p.unleashToken);
  if (unUrl || unToken) {
    if (!unUrl || !unToken) {
      out.push(new SetupError("unleash", `Add the Unleash ${unUrl ? "token" : "address"} in Settings`));
    } else {
      const base = url("unleash", unUrl);
      out.push(
        base instanceof SetupError ? base : {
          provider: "unleash",
          base: base.replace(/\/api$/, ""),
          headers: { Authorization: unToken },
          projects: parseList(p.unleashProject || "default"),
        },
      );
    }
  }
  const fsKey = trim(p.flagsmithKey), fsProject = trim(p.flagsmithProject);
  if (fsKey || fsProject) {
    if (!fsKey || !fsProject) {
      out.push(
        new SetupError("flagsmith", `Add the Flagsmith ${fsKey ? "project ID" : "organisation API key"} in Settings`),
      );
    } else {
      const base = url("flagsmith", trim(p.flagsmithUrl) || "https://api.flagsmith.com/api/v1");
      out.push(
        base instanceof SetupError ? base : {
          provider: "flagsmith",
          base: /\/api\/v1$/.test(base) ? base : `${base}/api/v1`,
          headers: { Authorization: `Api-Key ${fsKey}` },
          projects: parseList(fsProject),
        },
      );
    }
  }
  const gbKey = trim(p.growthbookKey);
  if (gbKey) {
    const base = url("growthbook", trim(p.growthbookUrl) || "https://api.growthbook.io");
    out.push(
      base instanceof SetupError ? base : {
        provider: "growthbook",
        base: base.replace(/\/api\/v1$/, ""),
        headers: { Authorization: `Bearer ${gbKey}` },
        projects: [],
      },
    );
  }
  return out.sort((a, b) => PROVIDERS.indexOf(a.provider) - PROVIDERS.indexOf(b.provider));
}

async function call<T>(
  a: Account,
  path: string,
  o: { method?: string; body?: unknown; signal?: AbortSignal; contentType?: string } = {},
): Promise<T> {
  const name = PROVIDER_NAMES[a.provider];
  let res: Response;
  try {
    res = await fetch(`${a.base}${path}`, {
      method: o.method ?? "GET",
      signal: o.signal,
      headers: {
        ...a.headers,
        Accept: "application/json",
        ...(o.body === undefined ? {} : { "Content-Type": o.contentType ?? "application/json" }),
      },
      body: o.body === undefined ? undefined : JSON.stringify(o.body),
    });
  } catch (e) {
    if (o.signal?.aborted) throw e;
    throw new Error(`Can't reach ${name} at ${new URL(a.base).host}: ${(e as Error).message}`);
  }
  if (res.status === 401) throw new SetupError(a.provider, `${name} rejected the token`);
  const text = await res.text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : undefined;
  } catch {
    body = undefined;
  }
  if (!res.ok) {
    const b = body as
      | { message?: string; detail?: string; error?: string; details?: { message?: string }[] }
      | undefined;
    const why = b?.message || b?.detail || b?.error || b?.details?.[0]?.message || "";
    if (res.status === 403) throw new Error(`${name} refused it${why ? `: ${why}` : ""}. Check the token's role`);
    if (res.status === 404) {
      throw new Error(`${name}: not found${why ? ` (${why})` : ""}. Check the project in Settings`);
    }
    if (res.status === 429) throw new Error(`${name} is rate limiting: try again in a minute`);
    throw new Error(`${name} answered ${res.status}${why ? `: ${why}` : ""}`);
  }
  if (text && body === undefined) throw new Error(`${name} didn't answer with JSON: check the address`);
  return body as T;
}

// --- Loading ------------------------------------------------------------------------

async function launchdarkly(a: Account, signal: AbortSignal): Promise<Flag[]> {
  const lists = await Promise.all(a.projects.map(async (project) => {
    const p = encodeURIComponent(project);
    const [envs, flags] = await Promise.all([
      call<{ items: LdEnvironment[] }>(a, `/projects/${p}/environments?limit=50`, { signal }).then((r) => r.items)
        .catch(() => [] as LdEnvironment[]),
      call<{ items: LdFlag[] }>(a, `/flags/${p}?summary=0&limit=100&sort=name`, { signal }),
    ]);
    return flags.items.map((f) => fromLaunchDarkly(project, f, envs));
  }));
  return lists.flat();
}

async function unleash(a: Account, signal: AbortSignal): Promise<Flag[]> {
  const envs = await call<{ environments: UnleashEnvironment[] }>(a, "/api/admin/environments", { signal })
    .then((r) => r.environments).catch(() => [] as UnleashEnvironment[]);
  const lists = await Promise.all(a.projects.map(async (project) => {
    const r = await call<{ features: UnleashFeature[] }>(
      a,
      `/api/admin/projects/${encodeURIComponent(project)}/features`,
      { signal },
    );
    return r.features.map((f) => fromUnleash(a.base, project, f, envs));
  }));
  return lists.flat();
}

async function flagsmith(a: Account, signal: AbortSignal): Promise<Flag[]> {
  const lists = await Promise.all(a.projects.map(async (project) => {
    const [envs, features, tags] = await Promise.all([
      call<FsEnvironment[] | { results: FsEnvironment[] }>(a, `/environments/?project=${encodeURIComponent(project)}`, {
        signal,
      }).then(results),
      call<{ results: FsFeature[] }>(a, `/projects/${encodeURIComponent(project)}/features/?page_size=100`, { signal })
        .then(results),
      call<{ id: number; label: string }[] | { results: { id: number; label: string }[] }>(
        a,
        `/projects/${encodeURIComponent(project)}/tags/`,
        { signal },
      ).then(results).catch(() => []),
    ]);
    const states = await Promise.all(envs.map(async (env) => ({
      env,
      states: environmentStates(
        await call<{ results: FsFeatureState[] } | FsFeatureState[]>(
          a,
          `/environments/${encodeURIComponent(env.api_key)}/featurestates/?page_size=999`,
          { signal },
        ).then(results).catch(() => [] as FsFeatureState[]),
      ),
    })));
    const names = new Map(tags.map((t) => [t.id, t.label]));
    return features.map((f) => fromFlagsmith(a.base, project, f, states, names));
  }));
  return lists.flat();
}

async function growthbook(a: Account, signal: AbortSignal): Promise<Flag[]> {
  const envs = await call<{ environments: GbEnvironment[] }>(a, "/api/v1/environments", { signal })
    .then((r) => r.environments).catch(() => [] as GbEnvironment[]);
  const features: GbFeature[] = [];
  let offset = 0;
  for (let i = 0; i < 5; i++) {
    const r = await call<{ features: GbFeature[]; hasMore?: boolean; nextOffset?: number }>(
      a,
      `/api/v1/features?limit=100&offset=${offset}`,
      { signal },
    );
    features.push(...r.features);
    if (!r.hasMore || r.nextOffset === undefined) break;
    offset = r.nextOffset;
  }
  return features.map((f) => fromGrowthBook(a.base, f, envs));
}

export function loadFlags(a: Account, signal: AbortSignal): Promise<Flag[]> {
  switch (a.provider) {
    case "launchdarkly":
      return launchdarkly(a, signal);
    case "unleash":
      return unleash(a, signal);
    case "flagsmith":
      return flagsmith(a, signal);
    case "growthbook":
      return growthbook(a, signal);
  }
}

// --- Toggling -----------------------------------------------------------------------

/** Turns the flag on or off (the opposite of `env.on`) in one environment. */
export async function toggle(a: Account, f: Flag, env: EnvState): Promise<void> {
  const on = !env.on;
  switch (a.provider) {
    case "launchdarkly":
      await call(a, `/flags/${encodeURIComponent(f.project)}/${encodeURIComponent(f.key)}`, {
        method: "PATCH",
        body: { comment: "Toggled from Backslash", patch: ldTogglePatch(env.key, on) },
      });
      return;
    case "unleash":
      await call(
        a,
        `/api/admin/projects/${encodeURIComponent(f.project)}/features/${encodeURIComponent(f.key)}/environments/${
          encodeURIComponent(env.key)
        }/${on ? "on" : "off"}`,
        { method: "POST", body: {} },
      );
      return;
    case "flagsmith":
      if (env.ref === undefined) throw new Error(`No Flagsmith state for ${f.name} in ${env.name}`);
      await call(a, `/environments/${encodeURIComponent(env.key)}/featurestates/${env.ref}/`, {
        method: "PATCH",
        body: { enabled: on },
      });
      return;
    case "growthbook":
      await call(a, `/api/v1/features/${encodeURIComponent(f.key)}/toggle`, {
        method: "POST",
        body: { environments: { [env.key]: on }, reason: "Toggled from Backslash" },
      });
      return;
  }
}
