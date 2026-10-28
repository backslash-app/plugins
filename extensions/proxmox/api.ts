// Proxmox VE API with an API token, trusting the cluster's own CA when given.

import { copy, Icons, type Item, open } from "@backslash/api";
import {
  authHeader,
  expandHome,
  isCertificateError,
  isTokenId,
  normalizePem,
  normalizeUrl,
  TOKEN_DOCS,
} from "./lib.ts";

/**
 * Where a Proxmox server usually lives, as declared in `[permissions] net`
 * (kept equal by a test): local names, private networks and Tailscale.
 * Extensions declare their hosts statically, so a public domain is out of reach.
 */
export const HOSTS = [
  "localhost",
  "127.0.0.1",
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

export type SetupKind = "url" | "token" | "host" | "cert" | "down" | "permission";

export class SetupError extends Error {
  constructor(message: string, readonly kind: SetupKind, readonly base?: string) {
    super(message);
  }
}

export interface Server {
  base: string;
  auth: string;
  client?: Deno.HttpClient;
  /** Where the CA came from, for the error messages. */
  ca?: string;
}

const HOME = (() => {
  try {
    return Deno.env.get("HOME");
  } catch {
    return undefined;
  }
})();

/** The folder `[permissions] read` covers for a CA file. */
export const CA_DIR = "~/.config/proxmox";
export const DEFAULT_CA = `${CA_DIR}/pve-root-ca.pem`;

/** The CA preference: pasted PEM text, or a file in ~/.config/proxmox. */
async function caCertificate(pref: unknown): Promise<{ pem?: string; source?: string }> {
  const value = String(pref ?? "").trim() || DEFAULT_CA;
  if (value.includes("BEGIN CERTIFICATE")) {
    const pem = normalizePem(value);
    if (!pem) throw new SetupError("The pasted CA certificate is not a PEM certificate", "cert");
    return { pem, source: "the pasted certificate" };
  }
  const path = expandHome(value, HOME);
  let text: string;
  try {
    text = await Deno.readTextFile(path);
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) {
      if (value === DEFAULT_CA) return {};
      throw new SetupError(`CA file ${value} not found`, "cert");
    }
    if (e instanceof Deno.errors.NotCapable || e instanceof Deno.errors.PermissionDenied) {
      throw new SetupError(`Put the CA file in ${CA_DIR}/ (Backslash may only read there)`, "cert");
    }
    throw e;
  }
  const pem = normalizePem(text);
  if (!pem) throw new SetupError(`${value} is not a PEM certificate`, "cert");
  return { pem, source: value };
}

/** A fetch error with its causes: the certificate problem is in `cause`. */
export function errorText(e: unknown): string {
  const parts: string[] = [];
  for (let x: unknown = e, i = 0; x && i < 5; x = (x as { cause?: unknown }).cause, i++) {
    parts.push(x instanceof Error ? x.message : String(x));
  }
  return parts.join(": ");
}

let cached: { key: string; server: Server } | undefined;

export async function server(preferences: Record<string, unknown>): Promise<Server> {
  const base = normalizeUrl(preferences.url);
  if (!base) throw new SetupError("Add the address of your Proxmox server", "url");
  let host: string;
  try {
    host = new URL(base).hostname;
  } catch {
    throw new SetupError(`“${preferences.url}” is not an address`, "url");
  }
  if (!isAllowedHost(host)) throw new SetupError(`${host} is outside the networks this extension may reach`, "host");
  const tokenId = String(preferences.tokenId ?? "").trim();
  const secret = String(preferences.tokenSecret ?? "").trim();
  if (!tokenId || !secret) throw new SetupError("Add an API token", "token", base);
  if (!isTokenId(tokenId)) {
    throw new SetupError(`“${tokenId}” is not a token ID like root@pam!backslash`, "token", base);
  }
  const key = JSON.stringify([base, tokenId, secret, preferences.caFile ?? ""]);
  if (cached?.key === key) return cached.server;
  const ca = await caCertificate(preferences.caFile);
  const s: Server = {
    base,
    auth: authHeader(tokenId, secret),
    client: ca.pem ? Deno.createHttpClient({ caCerts: [ca.pem] }) : undefined,
    ca: ca.source,
  };
  cached = { key, server: s };
  return s;
}

export async function pve<T>(
  s: Server,
  path: string,
  options: { method?: string; body?: Record<string, string | number>; signal?: AbortSignal } = {},
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${s.base}/api2/json${path}`, {
      method: options.method ?? "GET",
      signal: options.signal,
      client: s.client,
      headers: {
        Authorization: s.auth,
        ...(options.body ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
      },
      body: options.body
        ? new URLSearchParams(Object.entries(options.body).map(([k, v]) => [k, String(v)])).toString()
        : undefined,
    });
  } catch (e) {
    if (options.signal?.aborted) throw e;
    const message = errorText(e);
    if (e instanceof Deno.errors.NotCapable || e instanceof Deno.errors.PermissionDenied) {
      throw new SetupError(`${new URL(s.base).hostname} is outside the networks this extension may reach`, "host");
    }
    if (isCertificateError(message)) {
      throw new SetupError(
        s.ca ? `The server's certificate isn't signed by ${s.ca}` : "The server's certificate is self-signed",
        "cert",
        s.base,
      );
    }
    throw new SetupError(`Can't reach Proxmox at ${new URL(s.base).host}`, "down", s.base);
  }
  if (res.status === 401) throw new SetupError("Proxmox rejected the API token", "token", s.base);
  if (res.status === 403) {
    const text = (await res.text()).trim();
    throw new SetupError(
      `Permission denied${text ? `: ${text.replace(/^\{.*"message":"?|"?\}$/g, "").slice(0, 160)}` : ""}`,
      "permission",
      s.base,
    );
  }
  if (!res.ok) {
    // Proxmox puts the reason in the status text ("595 No route to host"), errors in `errors`.
    let detail = res.statusText;
    try {
      const body = await res.json();
      if (body?.errors) detail = Object.entries(body.errors).map(([k, v]) => `${k}: ${v}`).join(", ");
      else if (body?.message) detail = String(body.message).trim();
    } catch {
      // Not JSON.
    }
    throw new Error(`Proxmox answered ${res.status}${detail ? `: ${detail}` : ""}`);
  }
  return (await res.json()).data as T;
}

// ---------------------------------------------------------------------------
// Setup

const CONFIGURE = "**Settings → Extensions → Proxmox → Configure**";

export function setupItems(error: SetupError): Item[] {
  const base = error.base;
  const guide: Record<SetupKind, { subtitle: string; icon: string; markdown: string[] }> = {
    url: {
      subtitle: "Address, API token and CA certificate",
      icon: Icons.server,
      markdown: [
        "## Connect Proxmox VE",
        "",
        `1. In ${CONFIGURE}, set the address of a node, e.g. \`https://pve.local:8006\` or \`https://192.168.1.10:8006\`.`,
        "2. Create an API token (see below) and paste its ID and secret.",
        "3. Proxmox uses its own certificate authority: give Backslash its CA (see below).",
      ],
    },
    token: {
      subtitle: "Datacenter → Permissions → API Tokens → Add",
      icon: Icons.key,
      markdown: [
        "## Create an API token",
        "",
        "In the web UI, **Datacenter → Permissions → API Tokens → Add**: user `root@pam` (or your own), token ID `backslash`.",
        "",
        "- Keep **Privilege Separation** checked and give the token the role **PVEVMUser** plus **PVEAuditor** on `/` (Datacenter → Permissions → Add → API Token Permission), or uncheck it to inherit the user's rights.",
        "- Paste the token ID (`root@pam!backslash`) and the secret shown once in " + CONFIGURE + ".",
      ],
    },
    host: {
      subtitle: "Use a local, private or Tailscale address",
      icon: Icons.globe,
      markdown: [
        "## Address not reachable from Backslash",
        "",
        "Extensions declare the hosts they may reach. This one covers local names (`*.local`, `*.lan`, `*.home`, `*.home.arpa`, `*.internal`), private networks (`192.168.x.x`, `10.x.x.x`, `172.16–31.x.x`) and Tailscale (`100.64.x.x`, `*.ts.net`).",
        "",
        `Use the node's local IP address in ${CONFIGURE}.`,
      ],
    },
    cert: {
      subtitle: "Give Backslash the cluster's CA certificate",
      icon: Icons.lock,
      markdown: [
        "## Trust your Proxmox certificate",
        "",
        "Proxmox signs its HTTPS certificate with a CA of its own, which Backslash can't skip. Copy the CA once:",
        "",
        "```",
        "mkdir -p ~/.config/proxmox",
        "scp root@pve.local:/etc/pve/pve-root-ca.pem ~/.config/proxmox/",
        "```",
        "",
        `Or paste the content of \`/etc/pve/pve-root-ca.pem\` in the **CA certificate** field of ${CONFIGURE}.`,
        "",
        "Connect with the node's name or an IP address listed in its certificate. With a Let's Encrypt certificate (Datacenter → ACME), nothing is needed.",
      ],
    },
    down: {
      subtitle: "Is the server on, and the address right?",
      icon: Icons.server,
      markdown: [
        "## Proxmox doesn't answer",
        "",
        `Check that the node is running and that its web UI opens at \`${
          base ?? "https://…:8006"
        }\`. The address is in ${CONFIGURE}.`,
      ],
    },
    permission: {
      subtitle: "Give the API token more rights",
      icon: Icons.shield,
      markdown: [
        "## Missing permissions",
        "",
        "Listing needs **VM.Audit** and **Sys.Audit**; starting and stopping needs **VM.PowerMgmt**; snapshots need **VM.Snapshot**.",
        "",
        "Give the token the roles **PVEAuditor** and **PVEVMUser** on `/` in **Datacenter → Permissions → Add → API Token Permission** (**PVEVMAdmin** for snapshots).",
      ],
    },
  };
  const g = guide[error.kind];
  const actions = [];
  if (base && error.kind !== "host") actions.push(open(base, "Open Proxmox Web UI", { icon: Icons.globe }));
  if (error.kind === "token" || error.kind === "url" || error.kind === "permission") {
    actions.push(open(TOKEN_DOCS, "API Token Documentation", { icon: Icons.book, section: "Help" }));
  }
  if (error.kind === "cert") {
    actions.push(
      copy(
        "mkdir -p ~/.config/proxmox && scp root@pve.local:/etc/pve/pve-root-ca.pem ~/.config/proxmox/",
        "Copy Commands",
        { section: "Copy" },
      ),
    );
  }
  return [{
    id: "setup",
    title: error.message,
    subtitle: g.subtitle,
    icon: { source: g.icon, tint: "orange" },
    detail: { markdown: g.markdown.join("\n") },
    actions,
  }];
}

export async function guarded(load: () => Promise<Item[]>): Promise<Item[]> {
  try {
    return await load();
  } catch (e) {
    if (e instanceof SetupError) return setupItems(e);
    throw e;
  }
}
