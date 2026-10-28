import {
  action,
  close,
  copy,
  Icons,
  type Item,
  list,
  meta,
  open,
  refresh,
  updateCommandMetadata,
} from "@backslash/api";
import { type Config, config, configured, gather, nats, type Prefs, rpk, setupItem } from "../api.ts";
import {
  ago,
  backlogColor,
  compact,
  type ConsumerGroup,
  groupStateColor,
  lagByTopic,
  type NatsConsumer,
  parseGroupDescribe,
  parseGroupList,
  parseJsz,
} from "../lib.ts";
import { holdOpen, runInTerminal, shellLine } from "../terminal.ts";

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** rpk describes several groups per call; a long command line is split. */
const CHUNK = 50;

/** Messages each row is behind by, for the Lagging chip and the root search subtitle. */
const lagOf = new WeakMap<Item, number>();
function withLag(item: Item, lag: number): Item {
  lagOf.set(item, lag);
  return item;
}

function groupItem(c: Config, k: NonNullable<Config["kafka"]>, g: ConsumerGroup): Item {
  const topics = lagByTopic(g);
  const describe = ["rpk", "group", "describe", g.group, ...k.flags];
  const table = [
    "| Topic | Partition | Committed | End | Lag | Client |",
    "| --- | ---: | ---: | ---: | ---: | --- |",
    ...g.partitions
      .sort((a, b) => b.lag - a.lag || a.topic.localeCompare(b.topic) || a.partition - b.partition)
      .slice(0, 60)
      .map((p) =>
        `| ${p.topic} | ${p.partition} | ${p.current < 0 ? "—" : p.current} | ${p.end} | ${p.lag} | ${
          p.client ? `${p.client}${p.host ? ` (${p.host})` : ""}` : "_none_"
        } |`
      ),
  ].join("\n");
  return withLag({
    id: `kafka:${g.group}`,
    title: g.group,
    subtitle: topics.map((t) => t.topic).join(", ") || undefined,
    icon: { source: Icons.person, tint: "blue" },
    section: "Kafka consumer groups",
    keywords: ["kafka", "group", g.state, ...topics.map((t) => t.topic)],
    accessories: [
      { tag: g.state || "Unknown", color: groupStateColor(g.state) },
      { tag: `lag ${compact(g.totalLag)}`, color: backlogColor(g.totalLag) },
      { text: plural(g.members, "member"), icon: Icons.person },
    ],
    detail: {
      stats: [
        { label: "Total lag", value: compact(g.totalLag), color: backlogColor(g.totalLag) },
        { label: "Members", value: g.members, color: g.members ? undefined : "orange" },
        { label: "Topics", value: topics.length },
      ],
      markdown: g.partitions.length ? table : "_No committed offsets._",
      metadata: [
        meta.text("Group", g.group, { icon: Icons.person }),
        meta.text("State", g.state || "—", { icon: Icons.dot, color: groupStateColor(g.state) }),
        ...(g.balancer ? [meta.text("Balancer", g.balancer)] : []),
        meta.text("Coordinator", `broker ${g.coordinator}`, { icon: Icons.server }),
        ...topics.map((t) => meta.text(t.topic, `lag ${t.lag} on ${plural(t.partitions, "partition")}`)),
      ],
    },
    actions: [
      action("Describe in Terminal", () => close(`Opened in ${runInTerminal(holdOpen(describe), c.terminal)}`), {
        icon: Icons.terminal,
      }),
      ...(c.console ? [open(`${c.console}/groups/${encodeURIComponent(g.group)}`, "Open in Console")] : []),
      action("Refresh", () => refresh(), { icon: Icons.refresh, shortcut: "<Ctrl>r" }),
      copy(g.group, "Copy Group Name", { section: "Copy", shortcut: "<Ctrl>." }),
      copy(shellLine(describe), "Copy rpk group describe Command", { section: "Copy" }),
    ],
  }, g.totalLag);
}

async function kafkaGroups(c: Config, k: NonNullable<Config["kafka"]>, signal: AbortSignal): Promise<Item[]> {
  const names = parseGroupList(await rpk(k, ["group", "list", "--format", "json"], signal)).map((g) => g.group);
  const chunks: string[][] = [];
  for (let i = 0; i < names.length; i += CHUNK) chunks.push(names.slice(i, i + CHUNK));
  const described = await Promise.all(
    chunks.map(async (chunk) =>
      parseGroupDescribe(await rpk(k, ["group", "describe", ...chunk, "--format", "json"], signal))
    ),
  );
  return described.flat().sort((a, b) => b.totalLag - a.totalLag).map((g) => groupItem(c, k, g));
}

function natsConsumerItem(n: NonNullable<Config["nats"]>, x: NatsConsumer, account: string): Item {
  const info = `nats consumer info ${shellLine([x.stream, x.name])}`;
  return withLag({
    id: `nats:${account}:${x.stream}:${x.name}`,
    title: x.name,
    subtitle: `${x.stream}${x.filter ? ` · ${x.filter}` : ""}`,
    icon: { source: Icons.person, tint: "teal" },
    section: "NATS JetStream consumers",
    keywords: ["nats", "jetstream", "consumer", x.stream, x.filter],
    accessories: [
      ...(x.redelivered ? [{ tag: `${compact(x.redelivered)} redelivered`, color: "orange" as const }] : []),
      ...(x.ackPending ? [{ tag: `${compact(x.ackPending)} unacked`, color: "purple" as const }] : []),
      { tag: `${compact(x.pending)} pending`, color: backlogColor(x.pending) },
      ...(x.lastActive ? [{ text: ago(x.lastActive), icon: Icons.clock }] : []),
    ],
    detail: {
      stats: [
        { label: "Pending", value: compact(x.pending), color: backlogColor(x.pending) },
        { label: "Ack pending", value: compact(x.ackPending) },
        { label: "Redelivered", value: compact(x.redelivered), color: x.redelivered ? "orange" : undefined },
      ],
      metadata: [
        meta.text("Consumer", x.name, { icon: Icons.person }),
        meta.text("Stream", x.stream, { icon: Icons.layers }),
        meta.text("Kind", x.durable ? "Durable" : "Ephemeral"),
        ...(x.filter ? [meta.text("Filter", x.filter)] : []),
        ...(x.ackPolicy ? [meta.text("Ack policy", x.ackPolicy)] : []),
        meta.text("Waiting pulls", String(x.waiting)),
        ...(x.lastActive ? [meta.text("Last delivery", ago(x.lastActive), { icon: Icons.clock })] : []),
      ],
    },
    actions: [
      open(`${n.base}/jsz?accounts=true&streams=true&consumers=true&config=true`, "Open in Monitoring"),
      action("Refresh", () => refresh(), { icon: Icons.refresh, shortcut: "<Ctrl>r" }),
      copy(info, "Copy nats consumer info Command", { icon: Icons.terminal, section: "Copy" }),
      copy(x.name, "Copy Consumer Name", { section: "Copy", shortcut: "<Ctrl>." }),
    ],
  }, x.pending);
}

async function natsConsumers(n: NonNullable<Config["nats"]>, signal: AbortSignal): Promise<Item[]> {
  const streams = parseJsz(await nats(n, "/jsz?accounts=true&streams=true&consumers=true&config=true", signal));
  return streams
    .flatMap((s) => s.consumers.map((x) => ({ x, account: s.account })))
    .sort((a, b) => b.x.pending - a.x.pending || a.x.name.localeCompare(b.x.name))
    .map(({ x, account }) => natsConsumerItem(n, x, account));
}

export default list({
  placeholder: "Filter consumer groups and consumers…",
  filter: {
    options: [
      { value: "all", title: "All" },
      { value: "lagging", title: "Lagging" },
      { value: "kafka", title: "Kafka" },
      { value: "nats", title: "NATS" },
    ],
  },
  empty: {
    title: "No consumer",
    description: "No Kafka consumer group or JetStream consumer (RabbitMQ consumers are in Message Queues).",
    icon: Icons.person,
  },
  status: (items) => items[0]?.id === "setup" ? "Not configured" : plural(items.length, "consumer"),
  items: async function* ({ preferences, signal, filter }) {
    const c = config(preferences as Prefs);
    const sources = configured(c).filter((b) => b !== "rabbitmq");
    if (!sources.length) {
      yield [{
        ...setupItem(),
        title: "Connect Kafka or NATS",
        subtitle: "Consumer lag comes from rpk (Kafka, Redpanda) or NATS JetStream",
      }];
      return;
    }
    const wanted = filter === "kafka" || filter === "nats" ? sources.filter((b) => b === filter) : sources;
    const loaders = wanted.map((b) =>
      b === "kafka" ? () => kafkaGroups(c, c.kafka!, signal) : () => natsConsumers(c.nats!, signal)
    );
    let last: Item[] = [];
    for await (const items of gather(loaders)) {
      last = items;
      yield filter === "lagging" ? items.filter((i) => !lagOf.has(i) || lagOf.get(i)! > 0) : items;
    }
    const lagging = last.filter((i) => (lagOf.get(i) ?? 0) > 0).length;
    if (filter !== "kafka" && filter !== "nats") {
      updateCommandMetadata({ subtitle: lagging ? `${lagging} lagging` : null }).catch(() => {});
    }
  },
});
