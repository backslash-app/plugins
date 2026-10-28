// The four CI APIs: authentication, loading recent runs, rerun and cancel.

import {
  type BuildkiteBuild,
  type CirclePipeline,
  type CircleWorkflow,
  flattenJobs,
  fromBuildkite,
  fromCircle,
  fromJenkins,
  fromWoodpecker,
  type JenkinsJob,
  jenkinsTree,
  normalizeUrl,
  parseOrgs,
  type Provider,
  PROVIDER_NAMES,
  PROVIDERS,
  type Run,
  type WoodpeckerFeed,
  type WoodpeckerRepo,
} from "./lib.ts";

export interface Prefs {
  circleciToken?: string;
  circleciOrgs?: string;
  buildkiteToken?: string;
  woodpeckerUrl?: string;
  woodpeckerToken?: string;
  jenkinsUrl?: string;
  jenkinsUser?: string;
  jenkinsToken?: string;
}

export interface Account {
  provider: Provider;
  base: string;
  headers: Record<string, string>;
  orgs: string[];
}

export const TOKEN_PAGES: Record<Provider, string> = {
  circleci: "https://app.circleci.com/settings/user/tokens",
  buildkite: "https://buildkite.com/user/api-access-tokens",
  woodpecker: "https://woodpecker-ci.org/docs/usage/api",
  jenkins: "https://www.jenkins.io/doc/book/using/remote-access-api/",
};

export class SetupError extends Error {
  constructor(readonly provider: Provider, message: string) {
    super(message);
  }
}

const trim = (v: unknown) => String(v ?? "").trim();

/** The CI systems that are configured; a half-filled one is an error to show. */
export function accounts(prefs: Prefs): (Account | SetupError)[] {
  const out: (Account | SetupError)[] = [];
  const circle = trim(prefs.circleciToken);
  if (circle) {
    out.push({
      provider: "circleci",
      base: "https://circleci.com/api/v2",
      headers: { "Circle-Token": circle },
      orgs: parseOrgs(prefs.circleciOrgs),
    });
  }
  const bk = trim(prefs.buildkiteToken);
  if (bk) {
    out.push({
      provider: "buildkite",
      base: "https://api.buildkite.com/v2",
      headers: { Authorization: `Bearer ${bk}` },
      orgs: [],
    });
  }
  const wpUrl = trim(prefs.woodpeckerUrl), wpToken = trim(prefs.woodpeckerToken);
  if (wpUrl || wpToken) {
    if (!wpUrl || !wpToken) {
      out.push(new SetupError("woodpecker", `Add the Woodpecker ${wpUrl ? "token" : "address"} in Settings`));
    } else {
      out.push(...withBase("woodpecker", wpUrl, { Authorization: `Bearer ${wpToken}` }));
    }
  }
  const jUrl = trim(prefs.jenkinsUrl), jUser = trim(prefs.jenkinsUser), jToken = trim(prefs.jenkinsToken);
  if (jUrl || jUser || jToken) {
    if (!jUrl || !jUser || !jToken) {
      out.push(new SetupError("jenkins", "Add the Jenkins address, user and API token in Settings"));
    } else {
      out.push(...withBase("jenkins", jUrl, { Authorization: `Basic ${btoa(`${jUser}:${jToken}`)}` }));
    }
  }
  return out.sort((a, b) => PROVIDERS.indexOf(a.provider) - PROVIDERS.indexOf(b.provider));
}

function withBase(provider: Provider, url: string, headers: Record<string, string>): (Account | SetupError)[] {
  try {
    return [{ provider, base: normalizeUrl(url), headers, orgs: [] }];
  } catch {
    return [new SetupError(provider, `“${url}” is not a web address: fix the ${PROVIDER_NAMES[provider]} address`)];
  }
}

async function call<T>(
  a: Account,
  url: string,
  o: { method?: string; body?: unknown; signal?: AbortSignal; raw?: boolean } = {},
): Promise<T> {
  const name = PROVIDER_NAMES[a.provider];
  let res: Response;
  try {
    res = await fetch(url, {
      method: o.method ?? "GET",
      headers: {
        ...a.headers,
        Accept: "application/json",
        ...(o.body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: o.body === undefined ? undefined : JSON.stringify(o.body),
      signal: o.signal,
    });
  } catch (e) {
    if (o.signal?.aborted) throw e;
    throw new Error(`Can't reach ${name} at ${new URL(url).host}`);
  }
  const text = await res.text();
  if (res.status === 401) throw new SetupError(a.provider, `${name} refused the token: check it in Settings`);
  let body: Record<string, unknown> | undefined;
  try {
    body = text ? JSON.parse(text) : undefined;
  } catch {
    body = undefined;
  }
  if (!res.ok) {
    const msg = String(body?.message ?? body?.error ?? "").trim();
    if (res.status === 403) {
      throw new Error(`${name} denied it${msg ? `: ${msg}` : ""}. The token may lack the permission`);
    }
    const err = new Error(`${name} answered ${res.status}${msg ? `: ${msg}` : ""}`) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  if (o.raw) return text as T;
  if (text && body === undefined) {
    throw new SetupError(a.provider, `${new URL(url).host} answered with a web page, not the ${name} API`);
  }
  return body as T;
}

// --- Loading ------------------------------------------------------------------------------

const PER_ORG = 20;

async function circleci(a: Account, signal: AbortSignal): Promise<Run[]> {
  let orgs = a.orgs;
  if (!orgs.length) {
    const collabs = await call<{ slug: string }[]>(a, `${a.base}/me/collaborations`, { signal });
    orgs = collabs.map((c) => c.slug).filter(Boolean).slice(0, 5);
  }
  if (!orgs.length) throw new Error("CircleCI: you belong to no organization; set one in Settings");
  const pipelines = (await Promise.all(
    orgs.map((org) =>
      call<{ items: CirclePipeline[] }>(a, `${a.base}/pipeline?${new URLSearchParams({ "org-slug": org })}`, {
        signal,
      })
        .then((r) => r.items.slice(0, PER_ORG))
    ),
  )).flat();
  return await Promise.all(pipelines.map(async (p) => {
    const workflows = await call<{ items: CircleWorkflow[] }>(a, `${a.base}/pipeline/${p.id}/workflow`, { signal })
      .then((r) => r.items, (e) => {
        if (signal.aborted) throw e;
        return [];
      });
    return fromCircle(p, workflows);
  }));
}

async function buildkite(a: Account, signal: AbortSignal): Promise<Run[]> {
  const builds = await call<BuildkiteBuild[]>(a, `${a.base}/builds?per_page=40&exclude_jobs=true`, { signal });
  return builds.map(fromBuildkite);
}

async function woodpecker(a: Account, signal: AbortSignal): Promise<Run[]> {
  const [feed, repos] = await Promise.all([
    call<WoodpeckerFeed[] | null>(a, `${a.base}/api/user/feed`, { signal }),
    call<WoodpeckerRepo[] | null>(a, `${a.base}/api/user/repos`, { signal }).catch((e) => {
      if (signal.aborted) throw e;
      return [];
    }),
  ]);
  const names = new Map((repos ?? []).map((r) => [r.id, r.full_name]));
  return (feed ?? []).slice(0, 50).flatMap((f) => fromWoodpecker(f, a.base, names) ?? []);
}

async function jenkins(a: Account, signal: AbortSignal): Promise<Run[]> {
  const root = await call<{ jobs?: JenkinsJob[] }>(
    a,
    `${a.base}/api/json?${new URLSearchParams({ tree: jenkinsTree() })}`,
    { signal },
  );
  return flattenJobs(root.jobs ?? []).flatMap((j) => fromJenkins(j) ?? [])
    .sort((x, y) => (y.created ?? 0) - (x.created ?? 0)).slice(0, 50);
}

const LOADERS: Record<Provider, (a: Account, signal: AbortSignal) => Promise<Run[]>> = {
  circleci,
  buildkite,
  woodpecker,
  jenkins,
};

export const loadRuns = (a: Account, signal: AbortSignal) => LOADERS[a.provider](a, signal);

// --- Actions ------------------------------------------------------------------------------

const ids = (list?: string) => (list ?? "").split(",").filter(Boolean);

export async function rerun(a: Account, r: Run, onlyFailed: boolean): Promise<void> {
  switch (r.provider) {
    case "circleci": {
      const failed = ids(r.ref.failed);
      const targets = onlyFailed && failed.length ? failed : ids(r.ref.rerun);
      await Promise.all(targets.map((id) =>
        call(a, `${a.base}/workflow/${id}/rerun`, {
          method: "POST",
          body: onlyFailed && failed.includes(id) ? { from_failed: true } : {},
        })
      ));
      return;
    }
    case "buildkite":
      await call(a, `${a.base}/organizations/${r.ref.org}/pipelines/${r.ref.pipeline}/builds/${r.ref.number}/rebuild`, {
        method: "PUT",
      });
      return;
    case "woodpecker":
      await call(a, `${a.base}/api/repos/${r.ref.repo}/pipelines/${r.ref.number}`, { method: "POST" });
      return;
    case "jenkins":
      try {
        await call(a, `${r.ref.job}build?delay=0sec`, { method: "POST", raw: true });
      } catch (e) {
        // A parameterized job only starts through buildWithParameters (with its defaults).
        if ((e as { status?: number }).status !== 400) throw e;
        await call(a, `${r.ref.job}buildWithParameters?delay=0sec`, { method: "POST", raw: true });
      }
      return;
  }
}

export async function cancel(a: Account, r: Run): Promise<void> {
  switch (r.provider) {
    case "circleci":
      await Promise.all(ids(r.ref.cancel).map((id) => call(a, `${a.base}/workflow/${id}/cancel`, { method: "POST" })));
      return;
    case "buildkite":
      await call(a, `${a.base}/organizations/${r.ref.org}/pipelines/${r.ref.pipeline}/builds/${r.ref.number}/cancel`, {
        method: "PUT",
      });
      return;
    case "woodpecker":
      await call(a, `${a.base}/api/repos/${r.ref.repo}/pipelines/${r.ref.number}/cancel`, {
        method: "POST",
        raw: true,
      });
      return;
    case "jenkins":
      await call(a, `${r.ref.build}stop`, { method: "POST", raw: true });
      return;
  }
}
