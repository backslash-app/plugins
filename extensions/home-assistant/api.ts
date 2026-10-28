// Home Assistant REST API with a long-lived access token, on the user's own server.

import { Icons, type Item, open } from "@backslash/api";

/**
 * Where Home Assistant usually lives, as declared in `[permissions] net`
 * (kept equal by a test). Extensions declare their hosts statically, so
 * instead of any website this is the local network (mDNS names, private
 * IPv4 ranges), Tailscale, Nabu Casa and DuckDNS.
 */
export const HOSTS = [
  "localhost",
  "127.0.0.1",
  "homeassistant",
  "homeassistant.local",
  "*.local",
  "*.lan",
  "*.home.arpa",
  "*.ui.nabu.casa",
  "*.duckdns.org",
  "*.ts.net",
  "10.0.0.0/8",
  "172.16.0.0/12",
  "192.168.0.0/16",
  "100.64.0.0/10",
];

export class AuthError extends Error {
  constructor(message: string, readonly base?: string, readonly kind: "token" | "url" | "host" = "token") {
    super(message);
  }
}

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

/** `homeassistant.local:8123/` → `http://homeassistant.local:8123`. */
export function normalizeUrl(input: unknown): string {
  let url = String(input ?? "").trim();
  if (!url) return "";
  if (!/^https?:\/\//i.test(url)) url = `http://${url}`;
  return url.replace(/\/+$/, "").replace(/\/api$/, "").replace(/\/lovelace.*$|\/config.*$|\/profile.*$/, "");
}

export interface Server {
  base: string;
  token: string;
}

export function server(preferences: Record<string, unknown>): Server {
  const base = normalizeUrl(preferences.url);
  const token = String(preferences.token ?? "").trim();
  if (!base) throw new AuthError("Add the address of your Home Assistant", undefined, "url");
  let host: string;
  try {
    host = new URL(base).hostname;
  } catch {
    throw new AuthError(`“${preferences.url}” is not an address`, undefined, "url");
  }
  if (!isAllowedHost(host)) {
    throw new AuthError(`${host} is outside the networks this extension may reach`, base, "host");
  }
  if (!token) throw new AuthError("Add a long-lived access token", base);
  return { base, token };
}

export const tokenUrl = (base: string) => `${base}/profile/security`;

export async function ha<T>(
  s: Server,
  path: string,
  options: { method?: string; body?: unknown; signal?: AbortSignal } = {},
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${s.base}/api${path}`, {
      method: options.method ?? "GET",
      signal: options.signal,
      headers: { Authorization: `Bearer ${s.token}`, "Content-Type": "application/json" },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
  } catch (e) {
    if (options.signal?.aborted) throw e;
    if (e instanceof Deno.errors.NotCapable || e instanceof Deno.errors.PermissionDenied) {
      throw new AuthError(`${new URL(s.base).host} is outside the networks this extension may reach`, s.base, "host");
    }
    throw new Error(`Can't reach Home Assistant at ${s.base}: ${e instanceof Error ? e.message : e}`);
  }
  if (res.status === 401) throw new AuthError("Home Assistant rejected the access token", s.base);
  if (!res.ok) {
    const text = (await res.text()).slice(0, 200);
    throw new Error(`Home Assistant answered ${res.status}${text ? `: ${text}` : ""}`);
  }
  return await res.json() as T;
}

export function setupItems(error: AuthError): Item[] {
  const base = error.base;
  const steps = error.kind === "host"
    ? [
      "## Address not reachable from Backslash",
      "",
      "Extensions declare the hosts they may reach. This one covers the usual places of a Home Assistant:",
      "",
      "- local names: `homeassistant.local`, `*.local`, `*.lan`, `*.home.arpa`, `localhost`",
      "- private networks: `192.168.x.x`, `10.x.x.x`, `172.16–31.x.x`, Tailscale `100.64.x.x` and `*.ts.net`",
      "- remote access: Nabu Casa (`*.ui.nabu.casa`) and DuckDNS (`*.duckdns.org`)",
      "",
      "Use one of those addresses (the local IP of the server works at home) in **Settings → Extensions → Home Assistant → Configure**.",
    ]
    : [
      "## Connect Home Assistant",
      "",
      "1. In **Settings → Extensions → Home Assistant → Configure**, set the address you open Home Assistant with,",
      "   e.g. `http://homeassistant.local:8123` or `https://xxxx.ui.nabu.casa`.",
      "2. In Home Assistant, open your **profile → Security → Long-lived access tokens → Create token**",
      `   ${base ? "(Enter opens it)" : ""}, and paste the token in the same settings.`,
    ];
  return [{
    id: "setup",
    title: error.message,
    subtitle: error.kind === "host"
      ? "Use a local, Tailscale or Nabu Casa address"
      : "Address and long-lived access token",
    icon: { source: error.kind === "host" ? Icons.globe : Icons.key, tint: "orange" },
    detail: { markdown: steps.join("\n") },
    actions: base && error.kind === "token"
      ? [open(tokenUrl(base), "Create Access Token", { icon: Icons.key })]
      : [open("https://www.home-assistant.io/docs/authentication/#your-account-profile", "How to Create a Token")],
  }];
}

export async function guarded(load: () => Promise<Item[]>): Promise<Item[]> {
  try {
    return await load();
  } catch (e) {
    if (e instanceof AuthError) return setupItems(e);
    throw e;
  }
}
