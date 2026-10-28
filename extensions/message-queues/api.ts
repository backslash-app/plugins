// Talking to RabbitMQ (management API), NATS (monitoring endpoints) and Kafka (rpk), each optional.

import { action, copy, Icons, type Item, open, refresh } from "@backslash/api";
import { isAllowedHost, normalizeBrokers, normalizeUrl, rpkError } from "./lib.ts";

export interface Prefs {
  rabbitUrl?: string;
  rabbitUser?: string;
  rabbitPassword?: string;
  natsUrl?: string;
  kafkaBrokers?: string;
  rpkProfile?: boolean;
  consoleUrl?: string;
  terminal?: string;
}

export type Backend = "rabbitmq" | "nats" | "kafka";

export const BACKEND_NAMES: Record<Backend, string> = { rabbitmq: "RabbitMQ", nats: "NATS", kafka: "Kafka" };

/** What the user's sources are, from the preferences. */
export interface Config {
  rabbit?: { base: string; auth: string };
  nats?: { base: string };
  /** `-X brokers=…` for rpk, or [] to use its current profile. */
  kafka?: { flags: string[]; brokers: string };
  /** Redpanda Console or another Kafka UI, for the links. */
  console?: string;
  terminal?: string;
}

export function config(p: Prefs): Config {
  const c: Config = { terminal: String(p.terminal ?? "").trim() || undefined };
  const rabbit = normalizeUrl(p.rabbitUrl, 15672);
  if (rabbit) {
    const user = String(p.rabbitUser ?? "").trim() || "guest";
    const password = String(p.rabbitPassword ?? "") || (user === "guest" ? "guest" : "");
    c.rabbit = { base: rabbit, auth: `Basic ${btoa(`${user}:${password}`)}` };
  }
  const nats = normalizeUrl(p.natsUrl, 8222);
  if (nats) c.nats = { base: nats };
  const brokers = normalizeBrokers(p.kafkaBrokers);
  if (brokers) c.kafka = { flags: ["-X", `brokers=${brokers}`], brokers };
  else if (p.rpkProfile) c.kafka = { flags: [], brokers: "" };
  const consoleUrl = String(p.consoleUrl ?? "").trim().replace(/\/+$/, "");
  if (/^https?:\/\//.test(consoleUrl)) c.console = consoleUrl;
  return c;
}

export const configured = (c: Config): Backend[] =>
  [c.rabbit && "rabbitmq", c.nats && "nats", c.kafka && "kafka"].filter(Boolean) as Backend[];

/** A failure of one source, shown as a row while the others still load. */
export class SourceError extends Error {
  constructor(readonly backend: Backend, message: string, readonly detail = "", readonly link?: string) {
    super(message);
  }
}

async function request(
  backend: Backend,
  url: string,
  init: RequestInit & { signal?: AbortSignal },
): Promise<Response> {
  const host = new URL(url).hostname;
  if (!isAllowedHost(host)) {
    throw new SourceError(
      backend,
      `${host} is outside the networks this extension may reach: use a local, private or Tailscale address`,
    );
  }
  try {
    return await fetch(url, init);
  } catch (e) {
    if (init.signal?.aborted) throw e;
    throw new SourceError(backend, `Can't reach ${BACKEND_NAMES[backend]} at ${new URL(url).host}`, String(e), url);
  }
}

/** RabbitMQ management API (`/api/…`), JSON in and out. */
export async function rabbit(
  c: NonNullable<Config["rabbit"]>,
  path: string,
  o: { method?: string; body?: unknown; signal?: AbortSignal } = {},
): Promise<string> {
  const res = await request("rabbitmq", `${c.base}${path}`, {
    method: o.method ?? "GET",
    signal: o.signal,
    headers: {
      Authorization: c.auth,
      ...(o.body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: o.body === undefined ? undefined : JSON.stringify(o.body),
  });
  const text = await res.text();
  if (res.status === 401) {
    throw new SourceError(
      "rabbitmq",
      "RabbitMQ refused the user name or password: check them in Settings (guest only works from localhost)",
      text,
      c.base,
    );
  }
  if (res.status === 403) {
    throw new SourceError(
      "rabbitmq",
      "This RabbitMQ user may not do that: give it the monitoring or management tag",
      text,
      c.base,
    );
  }
  if (res.status === 404 && path.startsWith("/api/overview")) {
    throw new SourceError(
      "rabbitmq",
      "No management API there: enable it with rabbitmq-plugins enable rabbitmq_management (port 15672)",
      text,
      c.base,
    );
  }
  if (!res.ok) {
    let reason = "";
    try {
      reason = JSON.parse(text).reason ?? "";
    } catch {
      // Not JSON.
    }
    throw new SourceError("rabbitmq", `RabbitMQ answered ${res.status}${reason ? `: ${reason}` : ""}`, text, c.base);
  }
  return text;
}

/** A NATS monitoring endpoint (`/varz`, `/connz`, `/jsz`). */
export async function nats(c: NonNullable<Config["nats"]>, path: string, signal?: AbortSignal): Promise<string> {
  const res = await request("nats", `${c.base}${path}`, { signal });
  const text = await res.text();
  if (!res.ok) {
    throw new SourceError(
      "nats",
      res.status === 404
        ? "No NATS monitoring endpoint there: start nats-server with -m 8222 (http_port)"
        : `NATS answered ${res.status}`,
      text,
      c.base,
    );
  }
  if (path.startsWith("/jsz") && /jetstream not enabled/i.test(text)) return "{}";
  return text;
}

/** Runs rpk with the brokers of the preferences; a failure becomes a {@link SourceError}. */
export async function rpk(c: NonNullable<Config["kafka"]>, args: string[], signal?: AbortSignal): Promise<string> {
  let out: Deno.CommandOutput;
  try {
    out = await new Deno.Command("rpk", {
      args: [...args, ...c.flags],
      stdin: "null",
      stdout: "piped",
      stderr: "piped",
      signal,
    }).output();
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) {
      throw new SourceError(
        "kafka",
        "rpk is not installed: install it to see Kafka and Redpanda topics",
        "",
        "https://docs.redpanda.com/current/get-started/rpk-install/",
      );
    }
    throw e;
  }
  const text = (b: Uint8Array) => new TextDecoder().decode(b).trim();
  if (!out.success) {
    const stderr = text(out.stderr) || text(out.stdout);
    throw new SourceError("kafka", rpkError(stderr), stderr);
  }
  return text(out.stdout);
}

// ---------------------------------------------------------------------------
// Setup and error rows

const CONFIGURE = "**Settings → Extensions → Message Queues → Configure**";

export function setupItem(): Item {
  return {
    id: "setup",
    title: "Connect a message broker",
    subtitle: "RabbitMQ, NATS or Kafka (through rpk)",
    icon: { source: Icons.plug, tint: "orange" },
    detail: {
      markdown: [
        "## Connect your brokers",
        "",
        `In ${CONFIGURE}, fill in any of:`,
        "",
        "- **RabbitMQ URL**: the management plugin, e.g. `http://localhost:15672`, with a user tagged",
        "  `monitoring` (or `management`).",
        "- **NATS monitoring URL**: nats-server started with `-m 8222`, e.g. `http://nats.lan:8222`.",
        "- **Kafka brokers**: e.g. `localhost:9092`, read with [rpk](https://docs.redpanda.com/current/get-started/rpk-install/)",
        "  (works with Redpanda and Apache Kafka). Or check **Use rpk profile** to use your `rpk profile`.",
        "",
        "Servers must be on your machine, your local network or Tailscale.",
      ].join("\n"),
    },
    actions: [
      open("https://www.rabbitmq.com/docs/management", "RabbitMQ Management Plugin", { icon: Icons.book }),
      open("https://docs.nats.io/running-a-nats-service/nats_admin/monitoring", "NATS Monitoring", {
        icon: Icons.book,
      }),
      open("https://docs.redpanda.com/current/get-started/rpk-install/", "Install rpk", { icon: Icons.download }),
    ],
  };
}

export function errorItem(e: unknown): Item {
  if (!(e instanceof SourceError)) throw e;
  const name = BACKEND_NAMES[e.backend];
  return {
    id: `error:${e.backend}`,
    title: e.message,
    subtitle: name,
    icon: { source: Icons.alert, tint: "orange" },
    section: name,
    detail: {
      markdown: [`## ${name}`, "", e.message, ...(e.detail ? ["", "```", e.detail.slice(0, 1200), "```"] : [])].join(
        "\n",
      ),
    },
    actions: [
      action("Retry", () => refresh(), { icon: Icons.refresh, shortcut: "<Ctrl>r" }),
      ...(e.link ? [open(e.link, e.link.startsWith("https://docs") ? "Open Install Guide" : `Open ${name}`)] : []),
      copy(e.detail || e.message, "Copy Error", { section: "Copy" }),
    ],
  };
}

/** Runs each source's loader in parallel; a failing source becomes an error row. */
export async function* gather(loaders: (() => Promise<Item[]>)[]): AsyncIterable<Item[]> {
  const results: Item[][] = loaders.map(() => []);
  let pending = loaders.length;
  const done: Promise<number>[] = loaders.map((load, i) =>
    load().then((items) => {
      results[i] = items;
      return i;
    }, (e) => {
      results[i] = [errorItem(e)];
      return i;
    })
  );
  const waiting = new Map(done.map((p, i) => [i, p]));
  while (pending > 0) {
    const i = await Promise.race(waiting.values());
    waiting.delete(i);
    pending--;
    yield results.flat();
  }
}
