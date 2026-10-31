// Mailpit's (/api/v1) and MailHog's (/api/v1, /api/v2) APIs, on this computer,
// in a dev container or VM, or on the local network.

import { Icons, type Item, open } from "@backslash/api";
import {
  fromMailHog,
  fromMailpitMessage,
  fromMailpitSummary,
  type Kind,
  type MailHogItem,
  type MailpitMessage,
  type MailpitSummary,
  type Message,
  parseMime,
  type Summary,
} from "./lib.ts";

/** As declared in `[permissions] net` (kept equal by a test). */
export const HOSTS = [
  "localhost",
  "127.0.0.1",
  "*.localhost",
  "*.local",
  "*.lan",
  "*.home.arpa",
  "*.internal",
  "*.test",
  "*.ddev.site",
  "*.lndo.site",
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

/** `localhost:8025/#` → `http://localhost:8025`; a path prefix (`--webroot`) is kept. */
export function normalizeUrl(input: unknown): string {
  let url = String(input ?? "").trim() || "http://localhost:8025";
  if (!/^https?:\/\//i.test(url)) url = `http://${url}`;
  return url.replace(/#.*$/, "").replace(/\/+$/, "").replace(/\/(api(\/v\d)?|view\/[^/]+)$/, "");
}

export class SetupError extends Error {}

export interface Config {
  url: string;
  auth?: string;
  /** Set in the preferences, or found by asking. */
  kind?: Kind;
}

export function config(p: Record<string, unknown>): Config {
  const url = normalizeUrl(p.address);
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    throw new SetupError(`“${p.address}” is not an address: fix it in Settings`);
  }
  if (!isAllowedHost(host)) {
    throw new SetupError(`${host} is outside the networks this extension may reach`);
  }
  const user = String(p.username ?? "").trim();
  const kind = String(p.kind ?? "").trim().toLowerCase();
  return {
    url,
    auth: user
      ? `Basic ${btoa(String.fromCharCode(...new TextEncoder().encode(`${user}:${String(p.password ?? "")}`)))}`
      : undefined,
    kind: kind === "mailpit" || kind === "mailhog" ? kind : undefined,
  };
}

/** Why a request failed, from the cause Deno attaches to "fetch failed". */
const message = (e: unknown): string => {
  const cause = (e as { cause?: unknown })?.cause;
  const text = `${e instanceof Error ? e.message : String(e)} ${cause instanceof Error ? cause.message : ""}`;
  if (/Connection refused|ECONNREFUSED/i.test(text)) return "nothing answers there";
  if (/dns error|failed to lookup|not known|ENOTFOUND/i.test(text)) return "the name doesn't resolve";
  if (/certificate|UnknownIssuer|tls handshake|ssl/i.test(text)) {
    return "its TLS certificate isn't trusted by this computer";
  }
  if (/timed out|timeout/i.test(text)) return "it doesn't answer in time";
  return text.replace(/^fetch failed\s*/, "").trim() || "unknown error";
};

class NotFound extends Error {}

async function call(
  c: Config,
  path: string,
  o: { method?: string; body?: unknown; signal?: AbortSignal } = {},
): Promise<string> {
  let res: Response;
  try {
    res = await fetch(`${c.url}${path}`, {
      method: o.method ?? "GET",
      signal: o.signal,
      headers: {
        ...(c.auth ? { Authorization: c.auth } : {}),
        ...(o.body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: o.body === undefined ? undefined : JSON.stringify(o.body),
    });
  } catch (e) {
    if (o.signal?.aborted) throw e;
    const host = new URL(c.url).host;
    if (e instanceof Deno.errors.NotCapable || e instanceof Deno.errors.PermissionDenied) {
      throw new SetupError(`${host} is outside the networks this extension may reach`);
    }
    if (message(e) === "nothing answers there") {
      throw new SetupError(`Nothing answers on ${host}: start Mailpit or MailHog, or fix the address in Settings`);
    }
    if (message(e).includes("certificate")) {
      throw new SetupError(`${host}'s certificate isn't trusted: use its http:// address`);
    }
    throw new SetupError(`Can't reach ${host}: ${message(e)}`);
  }
  const text = await res.text();
  if (res.status === 401 || res.status === 403) {
    throw new SetupError(
      c.auth
        ? "The mail catcher refused the user or password"
        : "The mail catcher asks for a user and password: add them in Settings",
    );
  }
  if (res.status === 404) throw new NotFound(`${path} not found`);
  if (!res.ok) {
    throw new Error(`The mail catcher answered ${res.status}${text.trim() ? `: ${text.trim().slice(0, 160)}` : ""}`);
  }
  return text;
}

const json = async <T>(c: Config, path: string, o: { signal?: AbortSignal } = {}) =>
  JSON.parse(await call(c, path, o)) as T;

/** Mailpit has /api/v1/info; MailHog answers /api/v2/messages. */
export async function detect(c: Config, signal?: AbortSignal): Promise<Kind> {
  if (c.kind) return c.kind;
  try {
    await call(c, "/api/v1/info", { signal });
    return (c.kind = "mailpit");
  } catch (e) {
    if (!(e instanceof NotFound)) throw e;
  }
  try {
    await call(c, "/api/v2/messages?limit=1", { signal });
    return (c.kind = "mailhog");
  } catch (e) {
    if (e instanceof NotFound) {
      throw new SetupError(
        `${new URL(c.url).host} is neither Mailpit nor MailHog: check the address (web UI port, 8025)`,
      );
    }
    throw e;
  }
}

export interface Inbox {
  kind: Kind;
  messages: Summary[];
  total: number;
  unread: number;
  /** MailHog sends whole messages with the list. */
  full: Map<string, Message>;
}

export async function inbox(c: Config, signal?: AbortSignal, limit = 50): Promise<Inbox> {
  const kind = await detect(c, signal);
  if (kind === "mailpit") {
    const r = await json<{ total: number; unread: number; messages: MailpitSummary[] }>(
      c,
      `/api/v1/messages?limit=${limit}`,
      { signal },
    );
    return { kind, messages: r.messages.map(fromMailpitSummary), total: r.total, unread: r.unread, full: new Map() };
  }
  const r = await json<{ total: number; items: MailHogItem[] }>(c, `/api/v2/messages?limit=${limit}`, { signal });
  const full = new Map(r.items.map((i) => [i.ID, fromMailHog(i)]));
  return { kind, messages: [...full.values()], total: r.total, unread: 0, full };
}

/** A Mailpit message whole, which marks it read. */
export async function readMessage(c: Config, id: string): Promise<Message> {
  return fromMailpitMessage(await json<MailpitMessage>(c, `/api/v1/message/${encodeURIComponent(id)}`));
}

/** A Mailpit message from its source, for the codes and links of the list (it stays unread). */
export async function peekMessage(c: Config, s: Summary, signal?: AbortSignal): Promise<Message> {
  const mime = parseMime(await call(c, `/api/v1/message/${encodeURIComponent(s.id)}/raw`, { signal }));
  return { ...s, text: mime.text, html: mime.html, files: mime.attachments };
}

export async function deleteMessage(c: Config, kind: Kind, id: string): Promise<void> {
  if (kind === "mailpit") await call(c, "/api/v1/messages", { method: "DELETE", body: { IDs: [id] } });
  else await call(c, `/api/v1/messages/${encodeURIComponent(id)}`, { method: "DELETE" });
}

/** Both Mailpit and MailHog empty the inbox on DELETE /api/v1/messages. */
export async function deleteAll(c: Config): Promise<void> {
  await call(c, "/api/v1/messages", { method: "DELETE" });
}

/** Mailpit only. Without ids, every message. */
export async function markRead(c: Config, read: boolean, ids?: string[]): Promise<void> {
  await call(c, "/api/v1/messages", { method: "PUT", body: ids ? { IDs: ids, Read: read } : { Read: read } });
}

export const webUrl = (c: Config, kind: Kind, id?: string) =>
  kind === "mailpit" && id ? `${c.url}/view/${encodeURIComponent(id)}` : c.url;

/** Mailpit renders a message's HTML at /view/<id>.html. */
export const htmlUrl = (c: Config, id: string) => `${c.url}/view/${encodeURIComponent(id)}.html`;

export const partUrl = (c: Config, id: string, part: string) =>
  `${c.url}/api/v1/message/${encodeURIComponent(id)}/part/${encodeURIComponent(part)}`;

// ---------------------------------------------------------------------------

export function setupItem(error: SetupError): Item {
  return {
    id: "setup",
    title: error.message,
    subtitle: "Settings → Extensions → Mail Catcher → Configure",
    icon: { source: Icons.alert, tint: "orange" },
    detail: {
      markdown: [
        "## Catch your app's mail",
        "",
        "Run **Mailpit** (or MailHog) and point your app's SMTP at it, port 1025:",
        "",
        "```sh",
        "docker run -d --name mailpit -p 8025:8025 -p 1025:1025 axllent/mailpit",
        "```",
        "",
        "Its web interface, on port **8025**, is the address this extension reads (default `http://localhost:8025`).",
        "DDEV, Lando and Laravel Sail ship one: use its address, like `http://myapp.ddev.site:8025`.",
      ].join("\n"),
    },
    actions: [
      open("https://mailpit.axllent.org/docs/install/", "Install Mailpit"),
      open("http://localhost:8025", "Open localhost:8025", { icon: Icons.globe }),
    ],
  };
}
