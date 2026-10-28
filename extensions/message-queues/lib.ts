// RabbitMQ, NATS and Kafka (rpk) payloads, the hosts this extension may reach, and formatting. Pure, tested in lib_test.ts.

import type { Color } from "@backslash/api";

// ---------------------------------------------------------------------------
// Hosts

/**
 * Where a broker usually lives, as declared in `[permissions] net` (kept equal
 * by a test): local names, private networks and Tailscale. Extensions declare
 * their hosts statically, so a public domain is out of reach.
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

/** `rabbit.lan` → `http://rabbit.lan:15672`; a path or fragment (`/#/queues`) is dropped. */
export function normalizeUrl(input: unknown, defaultPort: number): string {
  let text = String(input ?? "").trim();
  if (!text) return "";
  if (!/^[a-z]+:\/\//i.test(text)) text = `http://${text}`;
  try {
    const url = new URL(text);
    if (!url.port && url.protocol === "http:" && !/^[a-z]+:\/\//i.test(String(input).trim())) {
      url.port = String(defaultPort);
    }
    return `${url.protocol}//${url.host}`;
  } catch {
    return "";
  }
}

/** `localhost:9092, kafka.lan:9092` → `localhost:9092,kafka.lan:9092`. */
export const normalizeBrokers = (input: unknown) =>
  String(input ?? "").split(/[\s,]+/).map((b) => b.trim().replace(/^[a-z]+:\/\//i, "")).filter(Boolean).join(",");

// ---------------------------------------------------------------------------
// Formatting

/** 1234 → "1.2k", 2500000 → "2.5M". */
export function compact(n: number): string {
  const a = Math.abs(n);
  if (a >= 1e9) return `${(n / 1e9).toFixed(a >= 1e10 ? 0 : 1)}G`;
  if (a >= 1e6) return `${(n / 1e6).toFixed(a >= 1e7 ? 0 : 1)}M`;
  if (a >= 1e3) return `${(n / 1e3).toFixed(a >= 1e4 ? 0 : 1)}k`;
  return String(Math.round(n));
}

export function bytes(n: number): string {
  if (!n) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / 1024 ** i).toFixed(i ? 1 : 0)} ${units[i]}`;
}

/** 0.04 → "0.04/s", 12.34 → "12/s", 0 → "0/s". */
export function rate(r: number | undefined): string {
  const v = Number(r) || 0;
  if (v === 0) return "0/s";
  if (v < 1) return `${v.toFixed(2)}/s`;
  if (v < 10) return `${v.toFixed(1)}/s`;
  return `${compact(v)}/s`;
}

/** Nanoseconds (NATS max_age) → "7d", "1h 30m"; 0 → "unlimited". */
export function nanos(ns: number): string {
  const s = Math.round((Number(ns) || 0) / 1e9);
  if (!s) return "unlimited";
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  if (d) return h ? `${d}d ${h}h` : `${d}d`;
  if (h) return m ? `${h}h ${m}m` : `${h}h`;
  return m ? `${m}m` : `${s}s`;
}

/** "3 min ago", "2 days ago"; empty for missing or zero dates. */
export function ago(iso: string | undefined, now = Date.now()): string {
  const t = Date.parse(iso ?? "");
  if (Number.isNaN(t) || t <= 0) return "";
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  const d = Math.floor(s / 86400);
  return d === 1 ? "yesterday" : `${d} days ago`;
}

/** Gray when empty, blue for some, orange past `warn`, red past `alert`. */
export function backlogColor(n: number, warn = 1000, alert = 100000): Color {
  if (n <= 0) return "gray";
  if (n >= alert) return "red";
  if (n >= warn) return "orange";
  return "blue";
}

// ---------------------------------------------------------------------------
// RabbitMQ management API

export interface RabbitQueue {
  name: string;
  vhost: string;
  /** classic, quorum or stream. */
  type: string;
  /** running, idle, flow, crashed, down… */
  state: string;
  messages: number;
  ready: number;
  unacked: number;
  consumers: number;
  /** 0..1, or undefined when the broker doesn't compute it. */
  utilisation?: number;
  memory: number;
  durable: boolean;
  autoDelete: boolean;
  exclusive: boolean;
  node: string;
  policy: string;
  idleSince: string;
  publishRate: number;
  deliverRate: number;
  ackRate: number;
  redeliverRate: number;
  arguments: Record<string, unknown>;
}

type Raw = Record<string, any>;

const num = (v: unknown) => Number(v) || 0;

export function parseRabbitQueues(json: string): RabbitQueue[] {
  const raw = JSON.parse(json || "[]");
  const items: Raw[] = Array.isArray(raw) ? raw : Array.isArray(raw?.items) ? raw.items : [];
  return items.map((q) => {
    const stats = (q.message_stats ?? {}) as Raw;
    return {
      name: String(q.name ?? ""),
      vhost: String(q.vhost ?? "/"),
      type: String(q.type ?? "classic"),
      state: String(q.state ?? (q.idle_since ? "idle" : "running")),
      messages: num(q.messages),
      ready: num(q.messages_ready),
      unacked: num(q.messages_unacknowledged),
      consumers: num(q.consumers),
      utilisation: typeof q.consumer_utilisation === "number"
        ? q.consumer_utilisation
        : typeof q.consumer_capacity === "number"
        ? q.consumer_capacity
        : undefined,
      memory: num(q.memory),
      durable: q.durable === true,
      autoDelete: q.auto_delete === true,
      exclusive: q.exclusive === true,
      node: String(q.node ?? q.leader ?? ""),
      policy: String(q.policy ?? q.effective_policy_definition?.name ?? ""),
      idleSince: String(q.idle_since ?? ""),
      publishRate: num(stats.publish_details?.rate),
      deliverRate: num(stats.deliver_get_details?.rate),
      ackRate: num(stats.ack_details?.rate),
      redeliverRate: num(stats.redeliver_details?.rate),
      arguments: (q.arguments ?? {}) as Record<string, unknown>,
    };
  }).sort((a, b) => a.vhost.localeCompare(b.vhost) || b.messages - a.messages || a.name.localeCompare(b.name));
}

export interface RabbitOverview {
  version: string;
  erlang: string;
  cluster: string;
  node: string;
  messages: number;
  ready: number;
  unacked: number;
  publishRate: number;
  deliverRate: number;
  connections: number;
  channels: number;
  queues: number;
  consumers: number;
  exchanges: number;
}

export function parseRabbitOverview(json: string): RabbitOverview {
  const o = JSON.parse(json || "{}") as Raw;
  const totals = (o.queue_totals ?? {}) as Raw, objects = (o.object_totals ?? {}) as Raw;
  const stats = (o.message_stats ?? {}) as Raw;
  return {
    version: String(o.rabbitmq_version ?? ""),
    erlang: String(o.erlang_version ?? ""),
    cluster: String(o.cluster_name ?? ""),
    node: String(o.node ?? ""),
    messages: num(totals.messages),
    ready: num(totals.messages_ready),
    unacked: num(totals.messages_unacknowledged),
    publishRate: num(stats.publish_details?.rate),
    deliverRate: num(stats.deliver_get_details?.rate),
    connections: num(objects.connections),
    channels: num(objects.channels),
    queues: num(objects.queues),
    consumers: num(objects.consumers),
    exchanges: num(objects.exchanges),
  };
}

/** `/api/queues/%2F/orders` and its management UI page. */
export const rabbitQueuePath = (q: { vhost: string; name: string }) =>
  `/api/queues/${encodeURIComponent(q.vhost)}/${encodeURIComponent(q.name)}`;
export const rabbitQueueUi = (base: string, q: { vhost: string; name: string }) =>
  `${base}/#/queues/${encodeURIComponent(q.vhost)}/${encodeURIComponent(q.name)}`;

export function rabbitStateColor(state: string): Color {
  if (state === "running" || state === "idle") return "green";
  if (state === "flow") return "orange";
  return "red";
}

export interface PeekedMessage {
  exchange: string;
  routingKey: string;
  redelivered: boolean;
  contentType: string;
  bytes: number;
  payload: string;
  base64: boolean;
  headers: Record<string, unknown>;
}

/** `POST /api/queues/{vhost}/{name}/get` → the messages, in order. */
export function parsePeek(json: string): PeekedMessage[] {
  const raw = JSON.parse(json || "[]");
  return (Array.isArray(raw) ? raw : []).map((m: Raw) => ({
    exchange: String(m.exchange ?? ""),
    routingKey: String(m.routing_key ?? ""),
    redelivered: m.redelivered === true,
    contentType: String(m.properties?.content_type ?? ""),
    bytes: num(m.payload_bytes),
    payload: String(m.payload ?? ""),
    base64: m.payload_encoding === "base64",
    headers: (m.properties?.headers ?? {}) as Record<string, unknown>,
  }));
}

/** A payload for the detail view: JSON pretty-printed, the rest as it is. */
export function prettyPayload(payload: string): { text: string; lang: string } {
  const t = payload.trim();
  if (/^[[{]/.test(t)) {
    try {
      return { text: JSON.stringify(JSON.parse(t), null, 2), lang: "json" };
    } catch {
      // Not JSON after all.
    }
  }
  return { text: payload, lang: "" };
}

// ---------------------------------------------------------------------------
// NATS monitoring endpoints

export interface NatsServer {
  id: string;
  name: string;
  version: string;
  uptime: string;
  connections: number;
  totalConnections: number;
  subscriptions: number;
  slowConsumers: number;
  inMsgs: number;
  outMsgs: number;
  inBytes: number;
  outBytes: number;
  mem: number;
  cpu: number;
  cluster: string;
  jetstream: boolean;
  jsMemory: number;
  jsStorage: number;
}

export function parseVarz(json: string): NatsServer {
  const v = JSON.parse(json || "{}") as Raw;
  return {
    id: String(v.server_id ?? ""),
    name: String(v.server_name ?? v.server_id ?? ""),
    version: String(v.version ?? ""),
    uptime: String(v.uptime ?? ""),
    connections: num(v.connections),
    totalConnections: num(v.total_connections),
    subscriptions: num(v.subscriptions),
    slowConsumers: num(v.slow_consumers),
    inMsgs: num(v.in_msgs),
    outMsgs: num(v.out_msgs),
    inBytes: num(v.in_bytes),
    outBytes: num(v.out_bytes),
    mem: num(v.mem),
    cpu: num(v.cpu),
    cluster: String(v.cluster?.name ?? ""),
    jetstream: !!v.jetstream?.config,
    jsMemory: num(v.jetstream?.stats?.memory),
    jsStorage: num(v.jetstream?.stats?.storage),
  };
}

export interface NatsConnection {
  cid: number;
  name: string;
  ip: string;
  port: number;
  lang: string;
  version: string;
  uptime: string;
  idle: string;
  rtt: string;
  subscriptions: number;
  pendingBytes: number;
  inMsgs: number;
  outMsgs: number;
  account: string;
  user: string;
}

export function parseConnz(json: string): { total: number; connections: NatsConnection[] } {
  const c = JSON.parse(json || "{}") as Raw;
  const connections = ((c.connections ?? []) as Raw[]).map((x) => ({
    cid: num(x.cid),
    name: String(x.name ?? ""),
    ip: String(x.ip ?? ""),
    port: num(x.port),
    lang: String(x.lang ?? ""),
    version: String(x.version ?? ""),
    uptime: String(x.uptime ?? ""),
    idle: String(x.idle ?? ""),
    rtt: String(x.rtt ?? ""),
    subscriptions: num(x.subscriptions),
    pendingBytes: num(x.pending_bytes),
    inMsgs: num(x.in_msgs),
    outMsgs: num(x.out_msgs),
    account: String(x.account ?? ""),
    user: String(x.authorized_user ?? ""),
  }));
  return { total: num(c.total ?? c.num_connections), connections };
}

export interface NatsConsumer {
  stream: string;
  name: string;
  durable: boolean;
  /** Messages not yet delivered. */
  pending: number;
  ackPending: number;
  redelivered: number;
  waiting: number;
  ackPolicy: string;
  filter: string;
  lastActive: string;
}

export interface NatsStream {
  account: string;
  name: string;
  subjects: string[];
  messages: number;
  bytes: number;
  consumerCount: number;
  firstTs: string;
  lastTs: string;
  storage: string;
  retention: string;
  replicas: number;
  maxAge: number;
  created: string;
  consumers: NatsConsumer[];
}

/** `/jsz?accounts=true&streams=true&consumers=true&config=true`. */
export function parseJsz(json: string): NatsStream[] {
  const j = JSON.parse(json || "{}") as Raw;
  const streams: NatsStream[] = [];
  for (const account of (j.account_details ?? []) as Raw[]) {
    for (const s of (account.stream_detail ?? []) as Raw[]) {
      const cfg = (s.config ?? {}) as Raw, st = (s.state ?? {}) as Raw;
      streams.push({
        account: String(account.name ?? account.id ?? ""),
        name: String(s.name ?? cfg.name ?? ""),
        subjects: (cfg.subjects ?? []).map(String),
        messages: num(st.messages),
        bytes: num(st.bytes),
        consumerCount: num(st.consumer_count ?? (s.consumer_detail ?? []).length),
        firstTs: String(st.first_ts ?? ""),
        lastTs: String(st.last_ts ?? ""),
        storage: String(cfg.storage ?? ""),
        retention: String(cfg.retention ?? ""),
        replicas: num(cfg.num_replicas) || 1,
        maxAge: num(cfg.max_age),
        created: String(s.created ?? ""),
        consumers: ((s.consumer_detail ?? []) as Raw[]).map((c) => ({
          stream: String(c.stream_name ?? s.name ?? ""),
          name: String(c.name ?? ""),
          durable: !!(c.config?.durable_name),
          pending: num(c.num_pending),
          ackPending: num(c.num_ack_pending),
          redelivered: num(c.num_redelivered),
          waiting: num(c.num_waiting),
          ackPolicy: String(c.config?.ack_policy ?? ""),
          filter: String(c.config?.filter_subject ?? (c.config?.filter_subjects ?? []).join(", ") ?? ""),
          lastActive: String(c.delivered?.last_active ?? ""),
        })),
      });
    }
  }
  return streams.sort((a, b) => a.name.localeCompare(b.name));
}

// ---------------------------------------------------------------------------
// Kafka through rpk (`--format json`)

export interface Topic {
  name: string;
  partitions: number;
  replicas: number;
}

/** `rpk topic list --format json`. */
export function parseTopics(json: string): Topic[] {
  const raw = JSON.parse(json || "[]");
  return (Array.isArray(raw) ? raw : []).map((t: Raw) => ({
    name: String(t.name ?? ""),
    partitions: num(t.partitions),
    replicas: num(t.replicas),
  })).filter((t) => t.name).sort((a, b) => a.name.localeCompare(b.name));
}

/** `rpk group list --format json` → group names. */
export function parseGroupList(json: string): { group: string; state: string }[] {
  const raw = JSON.parse(json || "[]");
  return (Array.isArray(raw) ? raw : []).map((g: Raw) => ({
    group: String(g.group ?? ""),
    state: String(g.state ?? ""),
  }))
    .filter((g) => g.group);
}

export interface GroupPartition {
  topic: string;
  partition: number;
  current: number;
  end: number;
  lag: number;
  member: string;
  client: string;
  host: string;
}

export interface ConsumerGroup {
  group: string;
  state: string;
  members: number;
  totalLag: number;
  balancer: string;
  coordinator: number;
  partitions: GroupPartition[];
}

/** `rpk group describe <groups…> --format json`: one object, or a list of them. */
export function parseGroupDescribe(json: string): ConsumerGroup[] {
  const raw = JSON.parse(json || "[]");
  const list: Raw[] = Array.isArray(raw) ? raw : raw && typeof raw === "object" ? [raw] : [];
  return list.map((g) => ({
    group: String(g.group_name ?? g.group ?? ""),
    state: String(g.state ?? ""),
    members: num(g.members),
    totalLag: num(g.total_lag),
    balancer: String(g.balancer ?? ""),
    coordinator: num(g.coordinator_node ?? g.coordinator),
    partitions: ((g.partitions ?? []) as Raw[]).map((p) => ({
      topic: String(p.topic ?? ""),
      partition: num(p.partition),
      current: Number(p.current_offset ?? -1),
      end: num(p.log_end_offset),
      lag: num(p.lag),
      member: String(p.member_id ?? ""),
      client: String(p.client_id ?? ""),
      host: String(p.host ?? "").replace(/^\//, ""),
    })),
  })).filter((g) => g.group).sort((a, b) => b.totalLag - a.totalLag || a.group.localeCompare(b.group));
}

/** Lag summed by topic, the largest first. */
export function lagByTopic(g: ConsumerGroup): { topic: string; lag: number; partitions: number }[] {
  const by = new Map<string, { lag: number; partitions: number }>();
  for (const p of g.partitions) {
    const t = by.get(p.topic) ?? { lag: 0, partitions: 0 };
    t.lag += p.lag;
    t.partitions++;
    by.set(p.topic, t);
  }
  return [...by.entries()].map(([topic, v]) => ({ topic, ...v })).sort((a, b) => b.lag - a.lag);
}

export function groupStateColor(state: string): Color {
  switch (state) {
    case "Stable":
      return "green";
    case "Empty":
      return "gray";
    case "PreparingRebalance":
    case "CompletingRebalance":
      return "orange";
    case "Dead":
      return "red";
    default:
      return "gray";
  }
}

/** rpk's stderr → what went wrong, in a sentence. */
export function rpkError(stderr: string): string {
  const t = stderr.trim();
  if (/unknown flag: --format/.test(t)) return "This rpk is too old for JSON output: update it to 23.1 or newer";
  if (/connection refused|dial tcp|no such host|i\/o timeout|unable to dial/i.test(t)) {
    return "rpk can't reach the Kafka brokers: check the brokers in Settings, or your rpk profile";
  }
  if (/SASL|authentication|TOPIC_AUTHORIZATION_FAILED|GROUP_AUTHORIZATION_FAILED|not authorized/i.test(t)) {
    return "The Kafka cluster refused rpk: set SASL credentials in your rpk profile";
  }
  return t.split("\n").find((l) => l.trim())?.replace(/^(unable to [^:]+: )/, "")?.slice(0, 300) || "rpk failed";
}
