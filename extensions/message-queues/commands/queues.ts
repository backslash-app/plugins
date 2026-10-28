import {
  type Accessory,
  action,
  close,
  copy,
  detail,
  Icons,
  type Item,
  list,
  meta,
  open,
  refresh,
  toast,
  updateCommandMetadata,
} from "@backslash/api";
import { type Config, config, configured, gather, nats, type Prefs, rabbit, rpk, setupItem } from "../api.ts";
import {
  ago,
  backlogColor,
  bytes,
  compact,
  nanos,
  type NatsServer,
  type NatsStream,
  parseConnz,
  parseJsz,
  parsePeek,
  parseRabbitOverview,
  parseRabbitQueues,
  parseTopics,
  parseVarz,
  prettyPayload,
  type RabbitOverview,
  type RabbitQueue,
  rabbitQueuePath,
  rabbitQueueUi,
  rabbitStateColor,
  rate,
  type Topic,
} from "../lib.ts";
import { holdOpen, runInTerminal, shellLine } from "../terminal.ts";

const fence = (text: string, lang = "") => `\`\`\`${lang}\n${text.replace(/```/g, "ʼʼʼ")}\n\`\`\``;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** Messages waiting in RabbitMQ (ready) and JetStream (pending), for the root search subtitle. */
const waiting = { rabbitmq: 0, nats: 0 };

// ---------------------------------------------------------------------------
// RabbitMQ

function rabbitOverviewItem(c: NonNullable<Config["rabbit"]>, o: RabbitOverview): Item {
  return {
    id: "rabbit:overview",
    title: o.cluster || "RabbitMQ",
    subtitle: `RabbitMQ ${o.version}`,
    icon: { source: Icons.server, tint: "orange" },
    section: "RabbitMQ",
    keywords: ["rabbitmq", "overview", "cluster"],
    accessories: [
      { tag: `${compact(o.messages)} messages`, color: backlogColor(o.messages, 10000, 1000000) },
      { text: `↑${rate(o.publishRate)} ↓${rate(o.deliverRate)}` },
    ],
    detail: {
      stats: [
        { label: "Ready", value: compact(o.ready) },
        { label: "Unacked", value: compact(o.unacked) },
        { label: "Consumers", value: o.consumers },
      ],
      metadata: [
        meta.text("Version", `RabbitMQ ${o.version}${o.erlang ? `, Erlang ${o.erlang}` : ""}`, { icon: Icons.info }),
        meta.text("Node", o.node || "—", { icon: Icons.server }),
        meta.text("Publish", rate(o.publishRate), { icon: Icons.arrowUp }),
        meta.text("Deliver", rate(o.deliverRate), { icon: Icons.arrowDown }),
        meta.separator(),
        meta.text("Queues", String(o.queues)),
        meta.text("Exchanges", String(o.exchanges)),
        meta.text("Connections", String(o.connections)),
        meta.text("Channels", String(o.channels)),
      ],
    },
    actions: [
      open(c.base, "Open Management UI", { icon: Icons.globe }),
      open(`${c.base}/#/connections`, "Open Connections", { icon: Icons.plug }),
      action("Refresh", () => refresh(), { icon: Icons.refresh, shortcut: "<Ctrl>r" }),
    ],
  };
}

function peekView(c: NonNullable<Config["rabbit"]>, q: RabbitQueue) {
  return detail({
    title: `${q.name}: first messages`,
    markdown: async ({ signal }) => {
      const out = await rabbit(c, `${rabbitQueuePath(q)}/get`, {
        method: "POST",
        body: { count: 5, ackmode: "ack_requeue_true", encoding: "auto", truncate: 20000 },
        signal,
      });
      const messages = parsePeek(out);
      if (!messages.length) return "_The queue has no ready message._";
      return [
        "_Fetched and put back (requeued): they are now marked redelivered._",
        ...messages.map((m, i) => {
          const body = m.base64 ? { text: m.payload, lang: "" } : prettyPayload(m.payload);
          const headers = Object.keys(m.headers).length ? `\n\nHeaders: \`${JSON.stringify(m.headers)}\`` : "";
          return [
            `## ${i + 1}. ${m.routingKey || "(no routing key)"}`,
            "",
            `Exchange \`${m.exchange || "(default)"}\` · ${bytes(m.bytes)}${
              m.contentType ? ` · ${m.contentType}` : ""
            }${m.base64 ? " · base64" : ""}${m.redelivered ? " · redelivered" : ""}${headers}`,
            "",
            fence(body.text, body.lang),
          ].join("\n");
        }),
      ].join("\n\n");
    },
    actions: [open(rabbitQueueUi(c.base, q), "Open in Management UI")],
  });
}

function rabbitQueueItem(c: NonNullable<Config["rabbit"]>, q: RabbitQueue, vhosts: number): Item {
  const stuck = q.messages > 0 && q.consumers === 0;
  const accessories: Accessory[] = [];
  if (q.unacked) accessories.push({ tag: `${compact(q.unacked)} unacked`, color: "purple" });
  accessories.push({
    tag: `${compact(q.ready)} ready`,
    color: backlogColor(q.ready),
    tooltip: `${q.ready} ready, ${q.unacked} unacknowledged`,
  });
  accessories.push(
    stuck ? { tag: "No consumer", color: "red" } : { text: plural(q.consumers, "consumer"), icon: Icons.person },
  );
  if (q.publishRate || q.deliverRate) accessories.push({ text: `↑${rate(q.publishRate)} ↓${rate(q.deliverRate)}` });
  const args = Object.entries(q.arguments);
  return {
    id: `rabbit:${q.vhost}:${q.name}`,
    title: q.name,
    subtitle: q.type !== "classic" ? q.type : undefined,
    icon: { source: Icons.inbox, tint: q.state === "running" || q.state === "idle" ? "orange" : "red" },
    section: vhosts > 1 ? `RabbitMQ · ${q.vhost}` : "RabbitMQ",
    keywords: ["rabbitmq", "queue", q.vhost, q.type, q.state],
    accessories,
    detail: {
      stats: [
        { label: "Ready", value: compact(q.ready), color: backlogColor(q.ready) },
        { label: "Unacked", value: compact(q.unacked), color: q.unacked ? "purple" : undefined },
        { label: "Consumers", value: q.consumers, color: stuck ? "red" : undefined },
      ],
      metadata: [
        meta.text("Queue", q.name, { icon: Icons.inbox }),
        meta.text("Virtual host", q.vhost),
        meta.text("Type", q.type),
        meta.text("State", q.state, { icon: Icons.dot, color: rabbitStateColor(q.state) }),
        ...(q.utilisation !== undefined ? [meta.progress("Consumer utilisation", q.utilisation)] : []),
        meta.separator(),
        meta.text("Publish", rate(q.publishRate), { icon: Icons.arrowUp }),
        meta.text("Deliver / get", rate(q.deliverRate), { icon: Icons.arrowDown }),
        meta.text("Acknowledge", rate(q.ackRate), { icon: Icons.check }),
        ...(q.redeliverRate ? [meta.text("Redeliver", rate(q.redeliverRate), { icon: Icons.repeat })] : []),
        meta.separator(),
        meta.tags("Features", [
          ...(q.durable ? ["durable"] : ["transient"]),
          ...(q.autoDelete ? ["auto-delete"] : []),
          ...(q.exclusive ? ["exclusive"] : []),
        ]),
        ...(q.policy ? [meta.text("Policy", q.policy)] : []),
        ...(q.node ? [meta.text("Node", q.node, { icon: Icons.server })] : []),
        ...(q.memory ? [meta.text("Memory", bytes(q.memory))] : []),
        ...(q.idleSince ? [meta.text("Idle since", q.idleSince)] : []),
        ...args.map(([k, v]) => meta.text(k, typeof v === "string" ? v : JSON.stringify(v))),
      ],
    },
    actions: [
      open(rabbitQueueUi(c.base, q), "Open in Management UI", { icon: Icons.globe }),
      action("Peek Messages", () => peekView(c, q), { icon: Icons.eye, shortcut: "<Ctrl>p" }),
      action("Purge Queue", async () => {
        await rabbit(c, `${rabbitQueuePath(q)}/contents`, { method: "DELETE" });
        await toast(`Purged ${q.name}`, { style: "success", message: `${q.ready} ready messages deleted` });
        return refresh();
      }, {
        icon: Icons.trash,
        destructive: true,
        confirm: `Delete the ${q.ready} ready messages of ${q.name}? This can't be undone.`,
        shortcut: "<Ctrl><Shift>Delete",
      }),
      copy(q.name, "Copy Queue Name", { section: "Copy", shortcut: "<Ctrl>." }),
      copy(`${c.base}${rabbitQueuePath(q)}`, "Copy API URL", { section: "Copy" }),
      action("Refresh", () => refresh(), { icon: Icons.refresh, shortcut: "<Ctrl>r" }),
    ],
  };
}

async function rabbitItems(c: NonNullable<Config["rabbit"]>, signal: AbortSignal): Promise<Item[]> {
  const [overview, queues] = await Promise.all([
    rabbit(c, "/api/overview", { signal }).then(parseRabbitOverview),
    rabbit(c, "/api/queues", { signal }).then(parseRabbitQueues),
  ]);
  waiting.rabbitmq = overview.ready;
  const vhosts = new Set(queues.map((q) => q.vhost)).size;
  return [rabbitOverviewItem(c, overview), ...queues.map((q) => rabbitQueueItem(c, q, vhosts))];
}

// ---------------------------------------------------------------------------
// NATS

function connectionsView(c: NonNullable<Config["nats"]>) {
  return list({
    title: "NATS connections",
    placeholder: "Filter connections by name, IP, language…",
    empty: { title: "No client connected", icon: Icons.plug },
    status: (items) => plural(items.length, "connection"),
    items: async ({ signal }) => {
      const { connections } = parseConnz(await nats(c, "/connz?sort=msgs_from&limit=500", signal));
      return connections.map((x) => ({
        id: `cid:${x.cid}`,
        title: x.name || `Connection ${x.cid}`,
        subtitle: `${x.ip}:${x.port}`,
        icon: { source: Icons.plug, tint: x.pendingBytes ? "orange" : "teal" },
        keywords: [x.lang, x.ip, x.account, x.user].filter(Boolean),
        accessories: [
          ...(x.lang ? [{ tag: `${x.lang} ${x.version}`.trim(), color: "gray" as const }] : []),
          { text: `↑${compact(x.inMsgs)} ↓${compact(x.outMsgs)}` },
          { text: x.uptime, icon: Icons.clock },
        ],
        detail: {
          metadata: [
            meta.text("Client ID", String(x.cid)),
            meta.text("Address", `${x.ip}:${x.port}`, { icon: Icons.globe }),
            ...(x.account ? [meta.text("Account", x.account)] : []),
            ...(x.user ? [meta.text("User", x.user, { icon: Icons.person })] : []),
            meta.text("Uptime", x.uptime, { icon: Icons.clock }),
            meta.text("Idle", x.idle || "—"),
            ...(x.rtt ? [meta.text("Round trip", x.rtt)] : []),
            meta.text("Subscriptions", String(x.subscriptions)),
            meta.text("Messages in / out", `${compact(x.inMsgs)} / ${compact(x.outMsgs)}`),
            ...(x.pendingBytes ? [meta.text("Pending", bytes(x.pendingBytes), { color: "orange" })] : []),
          ],
        },
        actions: [
          open(`${c.base}/connz?cid=${x.cid}&subs=detail`, "Open in Monitoring"),
          copy(`${x.ip}:${x.port}`, "Copy Address", { section: "Copy" }),
        ],
      }));
    },
  });
}

function natsServerItem(c: NonNullable<Config["nats"]>, s: NatsServer): Item {
  return {
    id: "nats:server",
    title: s.name || "NATS",
    subtitle: `NATS ${s.version}${s.cluster ? ` · cluster ${s.cluster}` : ""}`,
    icon: { source: Icons.server, tint: "teal" },
    section: "NATS",
    keywords: ["nats", "server", "varz"],
    accessories: [
      ...(s.slowConsumers ? [{ tag: `${s.slowConsumers} slow`, color: "orange" as const }] : []),
      { tag: plural(s.connections, "connection"), color: "teal" },
      { text: s.uptime, icon: Icons.clock },
    ],
    detail: {
      stats: [
        { label: "Connections", value: s.connections },
        { label: "Subscriptions", value: compact(s.subscriptions) },
        { label: "Slow consumers", value: s.slowConsumers, color: s.slowConsumers ? "orange" : undefined },
      ],
      metadata: [
        meta.text("Server", s.name, { icon: Icons.server }),
        meta.text("Version", s.version),
        meta.text("Uptime", s.uptime, { icon: Icons.clock }),
        meta.text("Messages in / out", `${compact(s.inMsgs)} / ${compact(s.outMsgs)}`),
        meta.text("Bytes in / out", `${bytes(s.inBytes)} / ${bytes(s.outBytes)}`),
        meta.text("Memory", bytes(s.mem), { icon: Icons.cpu }),
        meta.text("CPU", `${s.cpu.toFixed(1)} %`),
        meta.text(
          "JetStream",
          s.jetstream ? `On (${bytes(s.jsStorage)} stored, ${bytes(s.jsMemory)} in memory)` : "Off",
        ),
        meta.text("Connections since start", compact(s.totalConnections)),
      ],
    },
    actions: [
      action("Show Connections", () => connectionsView(c), { icon: Icons.plug }),
      open(`${c.base}/varz`, "Open Monitoring", { icon: Icons.globe, shortcut: "<Ctrl>o" }),
      action("Refresh", () => refresh(), { icon: Icons.refresh, shortcut: "<Ctrl>r" }),
    ],
  };
}

function natsStreamItem(c: NonNullable<Config["nats"]>, s: NatsStream): Item {
  const pending = s.consumers.reduce((n, x) => n + x.pending, 0);
  return {
    id: `nats:${s.account}:${s.name}`,
    title: s.name,
    subtitle: s.subjects.join(", ") || undefined,
    icon: { source: Icons.layers, tint: "teal" },
    section: "NATS JetStream",
    keywords: ["nats", "jetstream", "stream", ...s.subjects, s.account],
    accessories: [
      ...(pending ? [{ tag: `${compact(pending)} pending`, color: backlogColor(pending) }] : []),
      { tag: `${compact(s.messages)} msgs`, color: "teal" },
      { text: bytes(s.bytes) },
      { text: plural(s.consumerCount, "consumer"), icon: Icons.person },
    ],
    detail: {
      stats: [
        { label: "Messages", value: compact(s.messages) },
        { label: "Size", value: bytes(s.bytes) },
        { label: "Consumers", value: s.consumerCount },
      ],
      metadata: [
        meta.text("Stream", s.name, { icon: Icons.layers }),
        ...(s.subjects.length ? [meta.tags("Subjects", s.subjects)] : []),
        meta.text("Account", s.account || "—"),
        meta.text("Storage", `${s.storage || "?"}, ${plural(s.replicas, "replica")}`),
        meta.text("Retention", s.retention || "—"),
        meta.text("Max age", nanos(s.maxAge)),
        ...(s.lastTs ? [meta.text("Last message", ago(s.lastTs) || s.lastTs, { icon: Icons.clock })] : []),
        ...(s.consumers.length
          ? [
            meta.separator(),
            ...s.consumers.map((x) =>
              meta.text(x.name, `${compact(x.pending)} pending, ${compact(x.ackPending)} unacked`, {
                icon: Icons.person,
                color: x.pending ? backlogColor(x.pending) : undefined,
              })
            ),
          ]
          : []),
      ],
    },
    actions: [
      open(`${c.base}/jsz?accounts=true&streams=true&consumers=true&config=true`, "Open in Monitoring", {
        icon: Icons.globe,
      }),
      copy(`nats stream info ${shellLine([s.name])}`, "Copy nats stream info Command", { icon: Icons.terminal }),
      copy(s.name, "Copy Stream Name", { section: "Copy", shortcut: "<Ctrl>." }),
      ...(s.subjects.length ? [copy(s.subjects.join(" "), "Copy Subjects", { section: "Copy" })] : []),
    ],
  };
}

async function natsItems(c: NonNullable<Config["nats"]>, signal: AbortSignal): Promise<Item[]> {
  const [server, streams] = await Promise.all([
    nats(c, "/varz", signal).then(parseVarz),
    nats(c, "/jsz?accounts=true&streams=true&consumers=true&config=true", signal).then(parseJsz),
  ]);
  waiting.nats = streams.reduce((n, s) => n + s.consumers.reduce((m, x) => m + x.pending, 0), 0);
  return [natsServerItem(c, server), ...streams.map((s) => natsStreamItem(c, s))];
}

// ---------------------------------------------------------------------------
// Kafka

function topicItem(c: Config, k: NonNullable<Config["kafka"]>, t: Topic): Item {
  const consume = (args: string[]) => ["rpk", "topic", "consume", t.name, ...args, ...k.flags];
  const terminal = (title: string, argv: string[], o: { icon?: string; shortcut?: string } = {}) =>
    action(title, () => close(`Opened in ${runInTerminal(holdOpen(argv), c.terminal)}`), {
      icon: o.icon ?? Icons.terminal,
      shortcut: o.shortcut,
    });
  return {
    id: `kafka:${t.name}`,
    title: t.name,
    icon: { source: Icons.activity, tint: "blue" },
    section: "Kafka",
    keywords: ["kafka", "redpanda", "topic"],
    accessories: [
      { tag: plural(t.partitions, "partition"), color: "blue" },
      { text: `×${t.replicas}`, tooltip: `${t.replicas} replicas` },
    ],
    detail: {
      metadata: [
        meta.text("Topic", t.name, { icon: Icons.activity }),
        meta.text("Partitions", String(t.partitions)),
        meta.text("Replication factor", String(t.replicas)),
        meta.text("Brokers", k.brokers || "rpk profile", { icon: Icons.server }),
      ],
    },
    actions: [
      action("Describe Partitions", () =>
        detail({
          title: t.name,
          markdown: async ({ signal }) => fence(await rpk(k, ["topic", "describe", t.name, "-p"], signal)),
          actions: c.console ? [open(`${c.console}/topics/${encodeURIComponent(t.name)}`, "Open in Console")] : [],
        }), { icon: Icons.info }),
      terminal("Consume Last 10 Messages", consume(["--offset=-10", "-n", "10"]), {
        icon: Icons.download,
        shortcut: "<Ctrl>l",
      }),
      terminal("Tail New Messages", consume(["--offset=end"]), { icon: Icons.play, shortcut: "<Ctrl>t" }),
      ...(c.console ? [open(`${c.console}/topics/${encodeURIComponent(t.name)}`, "Open in Console")] : []),
      copy(t.name, "Copy Topic Name", { section: "Copy", shortcut: "<Ctrl>." }),
      copy(shellLine(consume(["-n", "10"])), "Copy rpk consume Command", { section: "Copy" }),
    ],
  };
}

async function kafkaItems(c: Config, k: NonNullable<Config["kafka"]>, signal: AbortSignal): Promise<Item[]> {
  const topics = parseTopics(await rpk(k, ["topic", "list", "--format", "json"], signal));
  return topics.map((t) => topicItem(c, k, t));
}

// ---------------------------------------------------------------------------
// The command

export default list({
  placeholder: "Filter queues, streams and topics…",
  filter: {
    options: [
      { value: "all", title: "All" },
      { value: "rabbitmq", title: "RabbitMQ" },
      { value: "nats", title: "NATS" },
      { value: "kafka", title: "Kafka" },
    ],
  },
  empty: { title: "No queue here", description: "The broker has no queue, stream or topic yet.", icon: Icons.inbox },
  status: (items) => {
    const queues = items.filter((i) => /^(rabbit|nats|kafka):/.test(i.id ?? "") && !/:(overview|server)$/.test(i.id!));
    return items[0]?.id === "setup" ? "Not configured" : plural(queues.length, "queue");
  },
  items: async function* ({ preferences, signal, filter }) {
    const c = config(preferences as Prefs);
    const wanted = !filter || filter === "all" ? configured(c) : configured(c).filter((b) => b === filter);
    if (!configured(c).length) {
      yield [setupItem()];
      return;
    }
    if (!wanted.length) {
      yield [{
        ...setupItem(),
        title: `${filter === "kafka" ? "Kafka" : filter === "nats" ? "NATS" : "RabbitMQ"} is not set up`,
      }];
      return;
    }
    const loaders = wanted.map((b) =>
      b === "rabbitmq"
        ? () => rabbitItems(c.rabbit!, signal)
        : b === "nats"
        ? () => natsItems(c.nats!, signal)
        : () => kafkaItems(c, c.kafka!, signal)
    );
    waiting.rabbitmq = waiting.nats = 0;
    yield* gather(loaders);
    if (!filter || filter === "all") {
      const total = waiting.rabbitmq + waiting.nats;
      updateCommandMetadata({ subtitle: total ? `${compact(total)} waiting` : null }).catch(() => {});
    }
  },
});
