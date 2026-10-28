// Pi-hole v6 (session from an app password) and AdGuard Home (basic auth), behind one interface.

import { Icons, type Item, open, storage } from "@backslash/api";
import {
  adminUrl,
  agOverview,
  type AgStats,
  type AgStatus,
  type Kind,
  normalizeUrl,
  type Overview,
  type PiBlocking,
  piOverview,
  type PiSummary,
  type PiTopDomains,
  type PiVersion,
  TITLES,
  withRule,
} from "./lib.ts";

/**
 * Where a Pi-hole or AdGuard Home usually lives, as declared in `[permissions] net`
 * (kept equal by a test): its own name (`pi.hole`), local names, private networks
 * and Tailscale. A server on a public domain is out of reach.
 */
export const HOSTS = [
  "localhost",
  "127.0.0.1",
  "pi.hole",
  "*.local",
  "*.lan",
  "*.home",
  "*.home.arpa",
  "*.internal",
  "*.ts.net",
  "10.0.0.0/8",
  "172.16.0.0/12",
  "192.168.0.0/16",
  "100.64.0.0/10",
];

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

export type SetupKind = "url" | "password" | "host" | "down" | "unknown" | "tls";

export class SetupError extends Error {
  constructor(message: string, readonly kind: SetupKind, readonly base?: string, readonly server?: Kind) {
    super(message);
  }
}

export interface Backend {
  kind: Kind;
  base: string;
  admin: string;
  overview(signal?: AbortSignal): Promise<Overview>;
  /** `seconds` 0 pauses until resumed. */
  pause(seconds: number): Promise<void>;
  resume(): Promise<void>;
  addDomain(domain: string, list: "allow" | "deny", comment?: string): Promise<void>;
}

interface Prefs {
  url?: string;
  kind?: string;
  username?: string;
  password?: string;
}

const errorText = (e: unknown) => {
  let text = "";
  for (let x: unknown = e, i = 0; x && i < 5; x = (x as { cause?: unknown }).cause, i++) text += ` ${x}`;
  return text;
};

async function request(
  base: string,
  path: string,
  init: RequestInit & { signal?: AbortSignal },
  server?: Kind,
): Promise<Response> {
  try {
    return await fetch(`${base}${path}`, init);
  } catch (e) {
    if (init.signal?.aborted) throw e;
    if (e instanceof Deno.errors.NotCapable || e instanceof Deno.errors.PermissionDenied) {
      throw new SetupError(`${new URL(base).hostname} is outside the networks this extension may reach`, "host", base);
    }
    if (/certificate|UnknownIssuer|NotValidForName/i.test(errorText(e))) {
      throw new SetupError("The server's HTTPS certificate is self-signed", "tls", base, server);
    }
    throw new SetupError(
      `Can't reach ${server ? TITLES[server] : "the server"} at ${new URL(base).host}`,
      "down",
      base,
      server,
    );
  }
}

async function failure(res: Response, what: string): Promise<never> {
  let detail = "";
  try {
    const text = (await res.text()).trim();
    try {
      const body = JSON.parse(text);
      detail = body?.error?.message ?? body?.message ?? "";
      if (body?.error?.hint) detail += ` (${body.error.hint})`;
    } catch {
      detail = text.slice(0, 200);
    }
  } catch {
    // No body.
  }
  throw new Error(`${what} answered ${res.status}${detail ? `: ${detail}` : ""}`);
}

// ---------------------------------------------------------------------------
// Pi-hole v6

interface Session {
  base: string;
  sid: string | null;
  /** Unix ms; Pi-hole extends the session on each request. */
  expires: number;
  /** Seconds a session lives after its last use (-1 without a password). */
  validity: number;
}

const expiry = (validity: number) => Date.now() + (validity > 0 ? validity - 30 : 86_400) * 1000;

const SESSION_KEY = "pihole-session";

function pihole(base: string, password: string): Backend {
  let session: Session | undefined;

  async function login(): Promise<Session> {
    const res = await request(base, "/api/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    }, "pihole");
    if (res.status === 401) {
      await storage.delete(SESSION_KEY).catch(() => {});
      throw new SetupError(
        password ? "Pi-hole rejected the password" : "Pi-hole needs a password",
        "password",
        base,
        "pihole",
      );
    }
    if (res.status === 429) throw new Error("Pi-hole: too many sign-ins, try again in a minute");
    if (!res.ok) await failure(res, "Pi-hole");
    const body = await res.json() as { session: { valid: boolean; sid: string | null; validity: number } };
    if (!body.session?.valid) throw new SetupError("Pi-hole rejected the password", "password", base, "pihole");
    const validity = body.session.validity;
    const s: Session = { base, sid: body.session.sid, expires: expiry(validity), validity };
    await storage.set(SESSION_KEY, s as any).catch(() => {});
    return s;
  }

  let pending: Promise<Session> | undefined;

  /** One sign-in for the parallel requests of a refresh. */
  function current(): Promise<Session> {
    if (session && session.expires > Date.now()) return Promise.resolve(session);
    pending ??= (async () => {
      const saved = await storage.get<any>(SESSION_KEY).catch(() => undefined) as Session | undefined;
      // Sessions are few (16 by default): reuse the saved one rather than signing in each time.
      session = saved && saved.base === base && saved.expires > Date.now() ? saved : await login();
      return session;
    })().finally(() => pending = undefined);
    return pending;
  }

  async function api<T>(path: string, init: { method?: string; body?: unknown; signal?: AbortSignal } = {}) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const s = await current();
      const res = await request(base, `/api${path}`, {
        method: init.method ?? "GET",
        signal: init.signal,
        headers: {
          ...(s.sid ? { "X-FTL-SID": s.sid } : {}),
          ...(init.body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
      }, "pihole");
      if (res.status === 401 && attempt === 0) {
        // Expired or revoked: the parallel requests share the new sign-in.
        if (session === s) {
          session = undefined;
          await storage.delete(SESSION_KEY).catch(() => {});
        }
        continue;
      }
      if (res.status === 404 && path.startsWith("/stats")) {
        throw new SetupError("This Pi-hole has no v6 API (update it, or set the kind to adguard)", "unknown", base);
      }
      if (!res.ok) await failure(res, "Pi-hole");
      if (session) session.expires = expiry(session.validity);
      const text = await res.text();
      return (text ? JSON.parse(text) : undefined) as T;
    }
    throw new SetupError("Pi-hole rejected the session", "password", base, "pihole");
  }

  return {
    kind: "pihole",
    base,
    admin: adminUrl(base, "pihole"),
    async overview(signal) {
      const [summary, blocking, blocked, allowed, version] = await Promise.all([
        api<PiSummary>("/stats/summary", { signal }),
        api<PiBlocking>("/dns/blocking", { signal }),
        api<PiTopDomains>("/stats/top_domains?blocked=true&count=10", { signal }),
        api<PiTopDomains>("/stats/top_domains?count=10", { signal }),
        api<PiVersion>("/info/version", { signal }).catch(() => undefined),
      ]);
      return piOverview(summary, blocking, blocked, allowed, version);
    },
    async pause(seconds) {
      await api("/dns/blocking", { method: "POST", body: { blocking: false, timer: seconds || null } });
    },
    async resume() {
      await api("/dns/blocking", { method: "POST", body: { blocking: true, timer: null } });
    },
    async addDomain(domain, list, comment) {
      await api(`/domains/${list}/exact`, {
        method: "POST",
        body: { domain, comment: comment || "Added from Backslash", enabled: true },
      });
    },
  };
}

// ---------------------------------------------------------------------------
// AdGuard Home

function adguard(base: string, username: string, password: string): Backend {
  const auth: Record<string, string> = username || password
    ? { Authorization: `Basic ${btoa(String.fromCharCode(...new TextEncoder().encode(`${username}:${password}`)))}` }
    : {};

  async function api<T>(path: string, init: { method?: string; body?: unknown; signal?: AbortSignal } = {}) {
    const res = await request(base, `/control${path}`, {
      method: init.method ?? "GET",
      signal: init.signal,
      headers: init.body === undefined ? auth : { ...auth, "Content-Type": "application/json" },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    }, "adguard");
    if (res.status === 401 || res.status === 403) {
      throw new SetupError(
        username ? "AdGuard Home rejected the user name or password" : "AdGuard Home needs a user name and password",
        "password",
        base,
        "adguard",
      );
    }
    if (!res.ok) await failure(res, "AdGuard Home");
    const text = await res.text();
    try {
      return (text ? JSON.parse(text) : undefined) as T;
    } catch {
      return undefined as T; // "OK"
    }
  }

  return {
    kind: "adguard",
    base,
    admin: adminUrl(base, "adguard"),
    async overview(signal) {
      const [status, stats] = await Promise.all([
        api<AgStatus>("/status", { signal }),
        api<AgStats>("/stats", { signal }),
      ]);
      return agOverview(status, stats);
    },
    async pause(seconds) {
      await api("/protection", {
        method: "POST",
        body: seconds ? { enabled: false, duration: seconds * 1000 } : { enabled: false },
      });
    },
    async resume() {
      await api("/protection", { method: "POST", body: { enabled: true } });
    },
    async addDomain(domain, list) {
      const status = await api<{ user_rules?: string[] }>("/filtering/status");
      await api("/filtering/set_rules", {
        method: "POST",
        body: { rules: withRule(status.user_rules ?? [], domain, list) },
      });
    },
  };
}

// ---------------------------------------------------------------------------
// Which one

/** Pi-hole v6 answers `/api/auth` with JSON, AdGuard Home has `/control/status`. */
async function detect(base: string, signal?: AbortSignal): Promise<Kind> {
  const saved = await storage.get<Record<string, string>>("kinds").catch(() => undefined);
  if (saved?.[base] === "pihole" || saved?.[base] === "adguard") return saved[base] as Kind;
  let kind: Kind | undefined;
  const pi = await request(base, "/api/auth", { signal });
  if (pi.headers.get("content-type")?.includes("json")) {
    const body = await pi.json().catch(() => undefined);
    if (body && ("session" in body || "error" in body)) kind = "pihole";
  } else await pi.body?.cancel();
  if (!kind) {
    const ag = await request(base, "/control/status", { signal });
    await ag.body?.cancel();
    if (ag.status === 200 || ag.status === 401 || ag.status === 403) kind = "adguard";
  }
  if (!kind) {
    throw new SetupError(
      `No Pi-hole v6 or AdGuard Home at ${new URL(base).host}`,
      "unknown",
      base,
    );
  }
  await storage.set("kinds", { ...(saved ?? {}), [base]: kind }).catch(() => {});
  return kind;
}

export async function backend(preferences: Record<string, unknown>, signal?: AbortSignal): Promise<Backend> {
  const p = preferences as Prefs;
  const base = normalizeUrl(p.url);
  if (!base) throw new SetupError("Add the address of your Pi-hole or AdGuard Home", "url");
  let host: string;
  try {
    host = new URL(base).hostname;
  } catch {
    throw new SetupError(`“${p.url}” is not an address`, "url");
  }
  if (!isAllowedHost(host)) throw new SetupError(`${host} is outside the networks this extension may reach`, "host");
  const wanted = String(p.kind ?? "").trim().toLowerCase().replace(/[\s-]/g, "");
  const kind: Kind = wanted === "pihole" || wanted === "adguard"
    ? wanted
    : wanted === "adguardhome"
    ? "adguard"
    : await detect(base, signal);
  const password = String(p.password ?? "");
  return kind === "pihole" ? pihole(base, password) : adguard(base, String(p.username ?? "").trim(), password);
}

// ---------------------------------------------------------------------------
// Setup

const CONFIGURE = "**Settings → Extensions → Pi-hole & AdGuard Home → Configure**";

export function setupItems(error: SetupError): Item[] {
  const base = error.base;
  const markdown: Record<SetupKind, string[]> = {
    url: [
      "## Connect your DNS blocker",
      "",
      `Set its address in ${CONFIGURE}: \`http://pi.hole\`, \`http://192.168.1.2\` or \`http://adguard.lan:3000\`.`,
      "",
      "- **Pi-hole v6**: Settings → Web interface / API → **Configure app password**, and paste it as the password.",
      "- **AdGuard Home**: the user name and password you sign in with.",
    ],
    password: error.server === "adguard"
      ? [
        "## Sign in to AdGuard Home",
        "",
        `Enter the user name and password of the AdGuard Home web interface in ${CONFIGURE}.`,
      ]
      : [
        "## Pi-hole app password",
        "",
        "In the Pi-hole web interface, open **Settings → Web interface / API**, switch to **Expert** mode and click **Configure app password**.",
        "",
        `Copy the password shown and paste it in ${CONFIGURE}. It only gives API access, and you can revoke it there.`,
      ],
    host: [
      "## Address not reachable from Backslash",
      "",
      "Extensions declare the hosts they may reach. This one covers `pi.hole`, local names (`*.local`, `*.lan`, `*.home`, `*.home.arpa`, `*.internal`), private networks (`192.168.x.x`, `10.x.x.x`, `172.16–31.x.x`) and Tailscale (`100.64.x.x`, `*.ts.net`).",
      "",
      `Use the server's local IP address in ${CONFIGURE}.`,
    ],
    down: [
      "## The server doesn't answer",
      "",
      `Check that it is on, and that its web interface opens at \`${base ?? "…"}\`. The address is in ${CONFIGURE}.`,
    ],
    unknown: [
      "## Not recognized",
      "",
      "Backslash speaks the API of **Pi-hole v6** and **AdGuard Home**. Pi-hole 5 and older have another API: update with `pihole -up`.",
      "",
      `If the server is right, set the kind (\`pihole\` or \`adguard\`) in ${CONFIGURE}.`,
    ],
    tls: [
      "## Self-signed HTTPS certificate",
      "",
      "Backslash can't skip certificate checks. Use the plain HTTP address on your local network, e.g. `http://pi.hole` (Pi-hole serves both), or install a certificate from a public authority.",
    ],
  };
  const icons: Record<SetupKind, string> = {
    url: Icons.shield,
    password: Icons.key,
    host: Icons.globe,
    down: Icons.server,
    unknown: Icons.question,
    tls: Icons.lock,
  };
  const subtitles: Record<SetupKind, string> = {
    url: "Address and password",
    password: error.server === "adguard" ? "User name and password" : "Create an app password in Pi-hole",
    host: "Use a local or Tailscale address",
    down: "Is the server on, and the address right?",
    unknown: "Pi-hole v6 or AdGuard Home",
    tls: "Use the http:// address",
  };
  const actions = [];
  if (base && error.kind !== "host") {
    actions.push(open(error.server ? adminUrl(base, error.server) : base, "Open Web Interface", { icon: Icons.globe }));
  }
  if (error.kind === "password" && error.server !== "adguard") {
    actions.push(
      open("https://docs.pi-hole.net/api/auth/", "App Password Documentation", { icon: Icons.book, section: "Help" }),
    );
  }
  return [{
    id: "setup",
    title: error.message,
    subtitle: subtitles[error.kind],
    icon: { source: icons[error.kind], tint: "orange" },
    detail: { markdown: markdown[error.kind].join("\n") },
    actions,
  }];
}
