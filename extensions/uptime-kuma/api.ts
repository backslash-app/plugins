// Uptime Kuma (/metrics with an API key, public status pages) and the Better Stack Uptime API.

import { Icons, type Item, open } from "@backslash/api";
import {
  type BetterStackMonitor,
  fromBetterStack,
  kumaFromMetrics,
  mergeStatusPages,
  type Monitor,
  parseHeartbeats,
  parsePrometheus,
  parseSlugs,
  parseStatusPage,
  type StatusPage,
} from "./lib.ts";

/**
 * As declared in `[permissions] net` (kept equal by a test): Better Stack's
 * API, and an Uptime Kuma on this computer, the local network or Tailscale.
 */
export const HOSTS = [
  "uptime.betterstack.com",
  "localhost",
  "127.0.0.1",
  "*.local",
  "*.lan",
  "*.home.arpa",
  "*.ts.net",
  "10.0.0.0/8",
  "172.16.0.0/12",
  "192.168.0.0/16",
  "100.64.0.0/10",
];

export const BETTERSTACK = "https://uptime.betterstack.com";

function ipv4(host: string): number | undefined {
  const parts = host.split(".");
  if (parts.length !== 4 || parts.some((p) => !/^\d{1,3}$/.test(p) || Number(p) > 255)) return undefined;
  return parts.reduce((n, p) => n * 256 + Number(p), 0);
}

/** Whether Deno's `--allow-net` with {@link HOSTS} lets us reach `host`. */
export function isAllowedHost(host: string, patterns = HOSTS): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, "");
  return patterns.some((p) => {
    if (p.startsWith("*.")) return h.endsWith(p.slice(1)) || h === p.slice(2);
    const cidr = /^([\d.]+)\/(\d+)$/.exec(p);
    if (cidr) {
      const ip = ipv4(h), net = ipv4(cidr[1]);
      if (ip === undefined || net === undefined) return false;
      const bits = Number(cidr[2]);
      const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
      return ((ip & mask) >>> 0) === ((net & mask) >>> 0);
    }
    return h === p;
  });
}

/** `kuma.lan:3001/` → `http://kuma.lan:3001`. */
export function normalizeUrl(input: unknown): string {
  let url = String(input ?? "").trim();
  if (!url) return "";
  if (!/^https?:\/\//i.test(url)) url = `http://${url}`;
  return url.replace(/\/+$/, "").replace(/\/(dashboard|metrics|status\/[\w-]+)$/, "");
}

export class SetupError extends Error {}

export interface Config {
  kuma: string;
  apiKey: string;
  slugs: string[];
  betterstack: string;
}

export function config(p: Record<string, unknown>): Config {
  const c = {
    kuma: normalizeUrl(p.url),
    apiKey: String(p.apiKey ?? "").trim(),
    slugs: parseSlugs(p.slugs),
    betterstack: String(p.betterstackToken ?? "").trim(),
  };
  if (c.kuma) {
    let host: string;
    try {
      host = new URL(c.kuma).hostname;
    } catch {
      throw new SetupError(`“${p.url}” is not an address`);
    }
    if (!isAllowedHost(host)) throw new SetupError(`${host} is outside the networks this extension may reach`);
  }
  if (!c.betterstack && !(c.kuma && (c.apiKey || c.slugs.length))) {
    throw new SetupError(
      c.kuma ? "Add an Uptime Kuma API key or a status page" : "Connect Uptime Kuma or Better Stack",
    );
  }
  return c;
}

const message = (e: unknown) => e instanceof Error ? e.message : String(e);

async function get(service: string, url: string, headers: Record<string, string>, signal?: AbortSignal) {
  let res: Response;
  try {
    res = await fetch(url, { headers, signal });
  } catch (e) {
    if (signal?.aborted) throw e;
    if (e instanceof Deno.errors.NotCapable || e instanceof Deno.errors.PermissionDenied) {
      throw new SetupError(`${new URL(url).host} is outside the networks this extension may reach`);
    }
    throw new Error(`Can't reach ${service} at ${new URL(url).host}: ${message(e)}`);
  }
  return res;
}

// ---------------------------------------------------------------------------
// Uptime Kuma

async function metrics(c: Config, signal?: AbortSignal): Promise<Monitor[]> {
  const res = await get("Uptime Kuma", `${c.kuma}/metrics`, {
    // API keys are the password of HTTP basic auth, with any user name.
    Authorization: `Basic ${btoa(`:${c.apiKey}`)}`,
  }, signal);
  if (res.status === 401 || res.status === 403) {
    throw new SetupError("Uptime Kuma refused the API key: check it in Settings (Settings → API Keys in Kuma)");
  }
  if (!res.ok) throw new Error(`Uptime Kuma answered ${res.status} for /metrics`);
  return kumaFromMetrics(parsePrometheus(await res.text()));
}

async function statusPage(c: Config, slug: string, signal?: AbortSignal) {
  const [page, beats] = await Promise.all([
    get("Uptime Kuma", `${c.kuma}/api/status-page/${slug}`, {}, signal),
    get("Uptime Kuma", `${c.kuma}/api/status-page/heartbeat/${slug}`, {}, signal),
  ]);
  if (page.status === 404) throw new Error(`Uptime Kuma has no status page “${slug}”`);
  if (!page.ok || !beats.ok) {
    throw new Error(`Uptime Kuma answered ${page.ok ? beats.status : page.status} for ${slug}`);
  }
  return { page: parseStatusPage(slug, await page.json()), ...parseHeartbeats(await beats.json()) };
}

export interface KumaResult {
  monitors: Monitor[];
  pages: StatusPage[];
  errors: string[];
}

export async function kuma(c: Config, signal?: AbortSignal): Promise<KumaResult> {
  if (!c.kuma) return { monitors: [], pages: [], errors: [] };
  const errors: string[] = [];
  const [fromMetrics, pages] = await Promise.all([
    c.apiKey ? metrics(c, signal) : Promise.resolve([]),
    Promise.all(c.slugs.map((s) =>
      statusPage(c, s, signal).catch((e) => {
        if (e instanceof SetupError) throw e;
        errors.push(message(e));
        return undefined;
      })
    )),
  ]);
  const ok = pages.filter((p) => !!p);
  return { monitors: mergeStatusPages(fromMetrics, ok), pages: ok.map((p) => p.page), errors };
}

// ---------------------------------------------------------------------------
// Better Stack

export async function betterstack<T = any>(
  c: Config,
  path: string,
  options: { method?: string; body?: unknown; signal?: AbortSignal } = {},
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path.startsWith("http") ? path : `${BETTERSTACK}/api/v2${path}`, {
      method: options.method ?? "GET",
      signal: options.signal,
      headers: {
        Authorization: `Bearer ${c.betterstack}`,
        ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
  } catch (e) {
    if (options.signal?.aborted) throw e;
    throw new Error(`Can't reach Better Stack: ${message(e)}`);
  }
  if (res.status === 401 || res.status === 403) {
    throw new SetupError("Better Stack refused the API token: check it in Settings");
  }
  if (res.status === 429) throw new Error("Better Stack rate limit reached: try again in a minute");
  const text = await res.text();
  if (!res.ok) {
    let detail = text.slice(0, 200);
    try {
      const j = JSON.parse(text);
      detail = j.errors ? JSON.stringify(j.errors) : j.error ?? detail;
    } catch {
      // Plain text.
    }
    throw new Error(`Better Stack answered ${res.status}${detail ? `: ${detail}` : ""}`);
  }
  return (text ? JSON.parse(text) : undefined) as T;
}

/** Every monitor, following the pages (50 per page). */
export async function betterstackMonitors(c: Config, signal?: AbortSignal): Promise<Monitor[]> {
  if (!c.betterstack) return [];
  const out: Monitor[] = [];
  let next: string | null = "/monitors?per_page=100";
  for (let i = 0; next && i < 10; i++) {
    const page: { data: BetterStackMonitor[]; pagination?: { next?: string | null } } = await betterstack(c, next, {
      signal,
    });
    out.push(...page.data.map(fromBetterStack));
    next = page.pagination?.next ?? null;
  }
  return out;
}

export async function setPaused(c: Config, id: string, paused: boolean): Promise<void> {
  await betterstack(c, `/monitors/${id}`, { method: "PATCH", body: { paused } });
}

// ---------------------------------------------------------------------------

export function setupItem(error: SetupError): Item {
  return {
    id: "setup",
    title: error.message,
    subtitle: "Settings → Extensions → Uptime Kuma → Configure",
    icon: { source: Icons.activity, tint: "orange" },
    detail: {
      markdown: [
        "## Connect your monitors",
        "",
        "**Uptime Kuma** (on this computer, your network or Tailscale):",
        "",
        "- its address, like `http://kuma.lan:3001`;",
        "- an **API key** (Kuma → Settings → API Keys) to read every monitor from `/metrics`;",
        "- and/or the **slugs of status pages** (`/status/<slug>`) for the uptime and heartbeat history.",
        "",
        "**Better Stack Uptime**: an API token from **Integrations → API** (Uptime API token).",
      ].join("\n"),
    },
    actions: [
      open("https://github.com/louislam/uptime-kuma/wiki/API-Keys", "Kuma API Keys Help", { icon: Icons.key }),
      open("https://betterstack.com/docs/uptime/api/getting-started-with-uptime-api/", "Better Stack API Token", {
        icon: Icons.key,
      }),
    ],
  };
}
