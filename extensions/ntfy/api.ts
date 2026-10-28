// ntfy and Gotify HTTP APIs, with the server and tokens of the preferences.

import { Icons, type Item, open } from "@backslash/api";
import {
  fromGotify,
  fromNtfy,
  gotifyBody,
  type GotifyMessage,
  normalizeServer,
  type Notification,
  ntfyAuth,
  parseNdjson,
  publishBody,
  sinceParam,
} from "./lib.ts";

/**
 * Where the servers may be, as declared in `[permissions] net` (kept equal by
 * a test): ntfy.sh, and a self-hosted ntfy or Gotify on this computer, the
 * local network or Tailscale.
 */
export const HOSTS = [
  "ntfy.sh",
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

export class SetupError extends Error {}

export interface Config {
  ntfy: string;
  token: string;
  topic: string;
  since: string;
  gotify: string;
  appToken: string;
  clientToken: string;
}

export function config(p: Record<string, unknown>): Config {
  const c = {
    ntfy: normalizeServer(p.server, "https://ntfy.sh"),
    token: String(p.token ?? "").trim(),
    topic: String(p.topic ?? "").trim(),
    since: sinceParam(p.since),
    gotify: normalizeServer(p.gotifyUrl),
    appToken: String(p.gotifyAppToken ?? "").trim(),
    clientToken: String(p.gotifyClientToken ?? "").trim(),
  };
  for (const url of [c.ntfy, c.gotify].filter(Boolean)) {
    let host: string;
    try {
      host = new URL(url).hostname;
    } catch {
      throw new SetupError(`“${url}” is not a server address`);
    }
    if (!isAllowedHost(host)) {
      throw new SetupError(`${host} is outside the networks this extension may reach (ntfy.sh, LAN, Tailscale)`);
    }
  }
  return c;
}

const errorText = (e: unknown) => e instanceof Error ? e.message : String(e);

async function call(
  service: "ntfy" | "Gotify",
  url: string,
  init: RequestInit & { signal?: AbortSignal },
): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (e) {
    if (init.signal?.aborted) throw e;
    if (e instanceof Deno.errors.NotCapable || e instanceof Deno.errors.PermissionDenied) {
      throw new SetupError(`${new URL(url).host} is outside the networks this extension may reach`);
    }
    throw new Error(`Can't reach ${service} at ${new URL(url).host}: ${errorText(e)}`);
  }
  if (res.ok) return res;
  const text = (await res.text()).trim();
  let detail = text.slice(0, 200);
  try {
    const j = JSON.parse(text);
    detail = j.error ?? j.errorDescription ?? detail;
  } catch {
    // Plain text.
  }
  if (res.status === 401 || res.status === 403) {
    throw new SetupError(
      service === "ntfy"
        ? `ntfy refused access${detail ? ` (${detail})` : ""}: check the access token in Settings`
        : `Gotify refused the token${detail ? ` (${detail})` : ""}: check it in Settings`,
    );
  }
  if (res.status === 429) throw new Error(`${service} rate limit reached: try again in a minute`);
  throw new Error(`${service} answered ${res.status}${detail ? `: ${detail}` : ""}`);
}

// ---------------------------------------------------------------------------
// ntfy

const ntfyHeaders = (c: Config): Record<string, string> => {
  const auth = ntfyAuth(c.token);
  return auth ? { Authorization: auth } : {};
};

export async function poll(c: Config, topics: string[], signal?: AbortSignal): Promise<Notification[]> {
  if (!topics.length) return [];
  const url = `${c.ntfy}/${topics.map(encodeURIComponent).join(",")}/json?poll=1&since=${c.since}`;
  const res = await call("ntfy", url, { headers: ntfyHeaders(c), signal });
  return parseNdjson(await res.text()).map(fromNtfy);
}

export interface Outgoing {
  message: string;
  title?: string;
  priority?: number;
  tags?: string[];
  click?: string;
}

export async function publishNtfy(c: Config, topic: string, m: Outgoing): Promise<void> {
  await call("ntfy", c.ntfy, {
    method: "POST",
    headers: { ...ntfyHeaders(c), "Content-Type": "application/json" },
    body: JSON.stringify(publishBody({ topic, ...m })),
  });
}

// ---------------------------------------------------------------------------
// Gotify

export async function gotifyMessages(c: Config, signal?: AbortSignal): Promise<Notification[]> {
  if (!c.gotify || !c.clientToken) return [];
  const headers = { "X-Gotify-Key": c.clientToken };
  const [messages, apps] = await Promise.all([
    call("Gotify", `${c.gotify}/message?limit=100`, { headers, signal }).then((r) => r.json()) as Promise<
      { messages: GotifyMessage[] }
    >,
    call("Gotify", `${c.gotify}/application`, { headers, signal }).then((r) => r.json()).catch(() => []) as Promise<
      { id: number; name: string }[]
    >,
  ]);
  const names = Object.fromEntries(apps.map((a) => [a.id, a.name]));
  return messages.messages.map((m) => fromGotify(m, names));
}

export async function publishGotify(c: Config, m: Outgoing): Promise<void> {
  if (!c.gotify || !c.appToken) throw new SetupError("Add the Gotify server and an application token in Settings");
  await call("Gotify", `${c.gotify}/message`, {
    method: "POST",
    headers: { "X-Gotify-Key": c.appToken, "Content-Type": "application/json" },
    body: JSON.stringify(gotifyBody(m)),
  });
}

export async function deleteGotify(c: Config, id: number): Promise<void> {
  await call("Gotify", `${c.gotify}/message/${id}`, { method: "DELETE", headers: { "X-Gotify-Key": c.clientToken } });
}

// ---------------------------------------------------------------------------
// Where to send

export type Target = { kind: "ntfy"; topic: string } | { kind: "gotify" };

/** The default topic, else Gotify when it can send. */
export function defaultTarget(c: Config): Target {
  if (c.topic) return { kind: "ntfy", topic: c.topic };
  if (c.gotify && c.appToken) return { kind: "gotify" };
  throw new SetupError("Set a default ntfy topic (or a Gotify server and app token) in Settings");
}

export async function send(c: Config, target: Target, m: Outgoing): Promise<string> {
  if (target.kind === "gotify") {
    await publishGotify(c, m);
    return "Gotify";
  }
  await publishNtfy(c, target.topic, m);
  return `${new URL(c.ntfy).host}/${target.topic}`;
}

// ---------------------------------------------------------------------------

export function setupItem(error: SetupError): Item {
  return {
    id: "setup",
    title: error.message,
    subtitle: "Settings → Extensions → ntfy → Configure",
    icon: { source: Icons.bell, tint: "orange" },
    detail: {
      markdown: [
        "## Connect ntfy or Gotify",
        "",
        "- **ntfy**: the server is `https://ntfy.sh` unless you host your own (on your network or Tailscale).",
        "  Pick a **default topic**: a hard-to-guess name like `alerts-k3j9x`, and subscribe to it in the ntfy phone app.",
        "  Protected topics need an **access token** (`tk_…`, from ntfy's Account page) or `user:password`.",
        "- **Gotify**: its address, a **client token** (Clients tab) to read messages, and an",
        "  **application token** (Apps tab) to send them.",
      ].join("\n"),
    },
    actions: [
      open("https://docs.ntfy.sh/subscribe/phone/", "ntfy Phone App", { icon: Icons.external }),
      open("https://gotify.net/docs/", "Gotify Docs", { icon: Icons.external }),
    ],
  };
}
