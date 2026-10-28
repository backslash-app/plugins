// Coolify API v1 (Bearer token) and Dokploy API (x-api-key), each optional.

import { Icons, type Item, open, storage } from "@backslash/api";
import {
  coolifyEnvironments,
  type Deployment,
  domainUrl,
  normalizeUrl,
  parseCoolifyDeployments,
  parseCoolifyResources,
  parseDokployDeployments,
  parseDokployProjects,
  type Platform,
  PLATFORM_NAMES,
  type Resource,
} from "./lib.ts";

export interface Prefs {
  coolifyUrl?: string;
  coolifyToken?: string;
  dokployUrl?: string;
  dokployKey?: string;
}

export interface Instance {
  platform: Platform;
  base: string;
  secret: string;
}

export function instances(p: Prefs): Instance[] {
  const list: Instance[] = [];
  const coolify = normalizeUrl(p.coolifyUrl), token = String(p.coolifyToken ?? "").trim();
  if (coolify && token) list.push({ platform: "coolify", base: coolify, secret: token });
  const dokploy = normalizeUrl(p.dokployUrl), key = String(p.dokployKey ?? "").trim();
  if (dokploy && key) list.push({ platform: "dokploy", base: dokploy, secret: key });
  return list;
}

/** What is half set up (an address without its token, or the reverse), to say so. */
export function incomplete(p: Prefs): string[] {
  const out: string[] = [];
  if (!!normalizeUrl(p.coolifyUrl) !== !!String(p.coolifyToken ?? "").trim()) out.push("Coolify");
  if (!!normalizeUrl(p.dokployUrl) !== !!String(p.dokployKey ?? "").trim()) out.push("Dokploy");
  return out;
}

export class PlatformError extends Error {
  constructor(readonly platform: Platform, message: string, readonly base: string) {
    super(message);
  }
}

async function call(
  i: Instance,
  url: string,
  init: { method: string; body?: unknown; signal?: AbortSignal },
): Promise<Response> {
  const name = PLATFORM_NAMES[i.platform];
  try {
    return await fetch(url, {
      method: init.method,
      signal: init.signal,
      headers: {
        Accept: "application/json",
        ...(i.platform === "coolify" ? { Authorization: `Bearer ${i.secret}` } : { "x-api-key": i.secret }),
        ...(init.body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
  } catch (e) {
    if (init.signal?.aborted) throw e;
    throw new PlatformError(i.platform, `Can't reach ${name} at ${new URL(i.base).host}`, i.base);
  }
}

async function check(i: Instance, res: Response): Promise<string> {
  const name = PLATFORM_NAMES[i.platform];
  const text = await res.text();
  if (res.status === 401) {
    throw new PlatformError(
      i.platform,
      i.platform === "coolify"
        ? "Coolify refused the API token: check it in Settings (Keys & Tokens → API tokens)"
        : "Dokploy refused the API key: check it in Settings (Profile → API/CLI)",
      i.base,
    );
  }
  let message = "";
  try {
    const body = JSON.parse(text);
    message = String(body.message ?? body.error?.message ?? body.error ?? "");
  } catch {
    // Not JSON: an HTML error page or a proxy.
  }
  if (res.status === 403) {
    throw new PlatformError(
      i.platform,
      `${name} refused it${message ? `: ${message}` : ""}. The token needs read and deploy permissions`,
      i.base,
    );
  }
  if (!res.ok) {
    if (res.status === 404 && /<html/i.test(text)) {
      throw new PlatformError(i.platform, `No ${name} API at ${i.base}: check the address`, i.base);
    }
    throw new Error(`${name} answered ${res.status}${message ? `: ${message}` : ""}`);
  }
  if (/^\s*</.test(text)) {
    throw new PlatformError(
      i.platform,
      `${i.base} answered with a web page, not the ${name} API: check the address`,
      i.base,
    );
  }
  return text;
}

/** Coolify `/api/v1/…`. Actions are POST since v4.0.0-beta.4xx and GET before: a 405 retries with GET. */
export async function coolify(
  i: Instance,
  path: string,
  o: { method?: string; signal?: AbortSignal } = {},
): Promise<string> {
  const url = `${i.base}/api/v1${path}`;
  let res = await call(i, url, { method: o.method ?? "GET", signal: o.signal });
  if (res.status === 405 && o.method === "POST") {
    await res.body?.cancel();
    res = await call(i, url, { method: "GET", signal: o.signal });
  }
  return await check(i, res);
}

/** Dokploy `/api/<procedure>`: queries with GET parameters, mutations with a JSON body. */
export async function dokploy(
  i: Instance,
  procedure: string,
  input: Record<string, string> = {},
  o: { mutation?: boolean; signal?: AbortSignal } = {},
): Promise<string> {
  const query = o.mutation || !Object.keys(input).length ? "" : `?${new URLSearchParams(input)}`;
  const res = await call(i, `${i.base}/api/${procedure}${query}`, {
    method: o.mutation ? "POST" : "GET",
    body: o.mutation ? input : undefined,
    signal: o.signal,
  });
  return await check(i, res);
}

// ---------------------------------------------------------------------------
// Loading

const ENV_CACHE = "coolify-environments";

/** Coolify's projects with their environments, to build UI links; slow to change, so cached. */
async function environments(i: Instance, signal?: AbortSignal) {
  const key = `${ENV_CACHE}:${i.base}`;
  const load = async () => {
    const projects = JSON.parse(await coolify(i, "/projects", { signal })) as Record<string, any>[];
    const detailed = await Promise.all(
      projects.map(async (p) => JSON.parse(await coolify(i, `/projects/${p.uuid}`, { signal }))),
    );
    await storage.set(key, detailed).catch(() => {});
    return detailed;
  };
  const cached = await storage.get(key).catch(() => undefined) as Record<string, any>[] | undefined;
  if (cached) {
    // Refresh in the background for next time.
    load().catch(() => {});
    return coolifyEnvironments(cached);
  }
  return coolifyEnvironments(await load());
}

export async function resources(i: Instance, signal?: AbortSignal): Promise<Resource[]> {
  if (i.platform === "coolify") {
    const [json, envs] = await Promise.all([coolify(i, "/resources", { signal }), environments(i, signal)]);
    return parseCoolifyResources(json, i.base, envs);
  }
  const projects = await dokploy(i, "project.all", {}, { signal });
  const list = parseDokployProjects(projects, i.base);
  // The newest Dokploy leaves domains out of project.all: fetch them for the resources without.
  await Promise.all(
    list.filter((r) => !r.urls.length).map(async (r) => {
      try {
        const procedure = r.kind === "compose" ? "domain.byComposeId" : "domain.byApplicationId";
        const input: Record<string, string> = r.kind === "compose" ? { composeId: r.id } : { applicationId: r.id };
        const domains = JSON.parse(await dokploy(i, procedure, input, { signal })) as Record<string, any>[];
        r.urls = domains.map(domainUrl);
      } catch {
        // Domains are a nicety.
      }
    }),
  );
  return list;
}

/** Deployments of an application (Coolify) or an application or compose stack (Dokploy). */
export async function deployments(i: Instance, r: Resource, take = 10, signal?: AbortSignal): Promise<Deployment[]> {
  if (i.platform === "coolify") {
    if (r.kind !== "application") return [];
    const json = await coolify(i, `/deployments/applications/${r.id}?skip=0&take=${take}`, { signal });
    return parseCoolifyDeployments(json, i.base, r.ui);
  }
  const json = r.kind === "compose"
    ? await dokploy(i, "deployment.allByCompose", { composeId: r.id }, { signal })
    : await dokploy(i, "deployment.all", { applicationId: r.id }, { signal });
  return parseDokployDeployments(json, r.ui).slice(0, take);
}

// ---------------------------------------------------------------------------
// Actions

export type Verb = "deploy" | "restart" | "stop" | "start";

const COOLIFY_PATHS: Record<string, string> = {
  application: "applications",
  service: "services",
  database: "databases",
};

/** Runs an action; returns what the platform answered, for the toast. */
export async function act(i: Instance, r: Resource, verb: Verb): Promise<string> {
  if (i.platform === "coolify") {
    if (verb === "deploy") {
      const out = JSON.parse(await coolify(i, `/deploy?uuid=${r.id}&force=false`, { method: "POST" }));
      return String(out.deployments?.[0]?.message ?? out.message ?? "Deployment queued");
    }
    const out = JSON.parse(await coolify(i, `/${COOLIFY_PATHS[r.kind]}/${r.id}/${verb}`, { method: "POST" }));
    return String(out.message ?? "Request queued");
  }
  const app = r.kind === "application";
  const idInput: Record<string, string> = app ? { applicationId: r.id } : { composeId: r.id };
  const prefix = app ? "application" : "compose";
  if (verb === "restart") {
    if (app) {
      // Reload restarts the container without a rebuild; it needs the app's Docker name.
      const one = JSON.parse(await dokploy(i, "application.one", idInput));
      await dokploy(i, "application.reload", { ...idInput, appName: String(one.appName) }, { mutation: true });
    } else {
      await dokploy(i, "compose.stop", idInput, { mutation: true });
      await dokploy(i, "compose.start", idInput, { mutation: true });
    }
    return "Restarting";
  }
  await dokploy(i, `${prefix}.${verb}`, idInput, { mutation: true });
  return verb === "deploy" ? "Deployment queued" : verb === "stop" ? "Stopping" : "Starting";
}

// ---------------------------------------------------------------------------
// Setup

export function setupItem(half: string[]): Item {
  return {
    id: "setup",
    title: half.length ? `${half.join(" and ")}: add both the address and the token` : "Connect Coolify or Dokploy",
    subtitle: "Instance address and API token, in the extension's settings",
    icon: { source: Icons.key, tint: "orange" },
    detail: {
      markdown: [
        "## Connect your instances",
        "",
        "In **Settings → Extensions → Coolify → Configure**, fill in either or both:",
        "",
        "**Coolify**: the address of your instance (e.g. `https://coolify.example.com`, or `https://app.coolify.io`",
        "for Coolify Cloud) and an API token from **Keys & Tokens → API tokens** with the `read` and `deploy`",
        "permissions. Enable the API in **Settings → Advanced** if it is off.",
        "",
        "**Dokploy**: the address of your panel and an API key from **Profile → API/CLI → Generate**.",
      ].join("\n"),
    },
    actions: [
      open("https://coolify.io/docs/api-reference/authorization", "Coolify API Tokens", { icon: Icons.book }),
      open("https://docs.dokploy.com/docs/api", "Dokploy API Keys", { icon: Icons.book }),
    ],
  };
}

export function platformErrorItem(e: PlatformError): Item {
  return {
    id: `error:${e.platform}`,
    title: e.message,
    subtitle: PLATFORM_NAMES[e.platform],
    icon: { source: Icons.alert, tint: "orange" },
    section: PLATFORM_NAMES[e.platform],
    actions: [open(e.base, `Open ${PLATFORM_NAMES[e.platform]}`, { icon: Icons.globe })],
  };
}
