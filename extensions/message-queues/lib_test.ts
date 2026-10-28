import { assert, assertEquals } from "@std/assert";
import { parse } from "@std/toml";
import { config, configured } from "./api.ts";
import {
  ago,
  backlogColor,
  bytes,
  compact,
  groupStateColor,
  HOSTS,
  isAllowedHost,
  lagByTopic,
  nanos,
  normalizeBrokers,
  normalizeUrl,
  parseConnz,
  parseGroupDescribe,
  parseGroupList,
  parseJsz,
  parsePeek,
  parseRabbitOverview,
  parseRabbitQueues,
  parseTopics,
  parseVarz,
  prettyPayload,
  rabbitQueuePath,
  rabbitQueueUi,
  rate,
  rpkError,
} from "./lib.ts";
import { TERMINALS } from "./terminal.ts";

// GET /api/queues (RabbitMQ 3.13), trimmed.
const QUEUES = JSON.stringify([
  {
    name: "emails",
    vhost: "/",
    type: "classic",
    state: "running",
    messages: 1520,
    messages_ready: 1500,
    messages_unacknowledged: 20,
    consumers: 2,
    consumer_utilisation: 0.42,
    memory: 1048576,
    durable: true,
    auto_delete: false,
    exclusive: false,
    node: "rabbit@mq1",
    policy: "ha-all",
    arguments: { "x-queue-type": "classic", "x-dead-letter-exchange": "dlx" },
    message_stats: {
      publish: 120000,
      publish_details: { rate: 12.4 },
      deliver_get_details: { rate: 11.9 },
      ack_details: { rate: 11.8 },
      redeliver_details: { rate: 0.2 },
    },
  },
  {
    name: "orders.dlq",
    vhost: "/",
    type: "quorum",
    messages: 3,
    messages_ready: 3,
    messages_unacknowledged: 0,
    consumers: 0,
    durable: true,
    leader: "rabbit@mq2",
    idle_since: "2026-10-28T09:00:00.000+00:00",
  },
  { name: "events", vhost: "staging", type: "stream", state: "running", messages: 0, consumers: 1 },
]);

// GET /jsz?accounts=true&streams=true&consumers=true&config=true (nats-server 2.10).
const JSZ = JSON.stringify({
  server_id: "NCX",
  now: "2026-10-28T12:00:00Z",
  config: { max_memory: 1073741824, store_dir: "/data/jetstream" },
  memory: 0,
  storage: 2048000,
  streams: 2,
  consumers: 2,
  messages: 1250,
  bytes: 2048000,
  account_details: [{
    name: "$G",
    id: "$G",
    stream_detail: [
      {
        name: "ORDERS",
        created: "2026-10-01T10:00:00Z",
        config: {
          name: "ORDERS",
          subjects: ["orders.>"],
          retention: "workqueue",
          max_age: 604800000000000,
          storage: "file",
          num_replicas: 3,
        },
        state: {
          messages: 1200,
          bytes: 2000000,
          first_seq: 100,
          first_ts: "2026-10-21T10:00:00Z",
          last_seq: 1299,
          last_ts: "2026-10-28T11:57:00Z",
          consumer_count: 2,
        },
        consumer_detail: [
          {
            stream_name: "ORDERS",
            name: "billing",
            config: { durable_name: "billing", ack_policy: "explicit", filter_subject: "orders.paid" },
            delivered: { consumer_seq: 900, stream_seq: 1000, last_active: "2026-10-28T11:59:00Z" },
            num_ack_pending: 5,
            num_redelivered: 2,
            num_waiting: 1,
            num_pending: 299,
          },
          {
            stream_name: "ORDERS",
            name: "audit_eph",
            config: { ack_policy: "none" },
            num_ack_pending: 0,
            num_redelivered: 0,
            num_waiting: 0,
            num_pending: 0,
          },
        ],
      },
      { name: "EVENTS", config: { subjects: ["events.*"], storage: "memory" }, state: { messages: 50, bytes: 48000 } },
    ],
  }],
});

// `rpk group describe billing shipping --format json`
const GROUPS = JSON.stringify([
  {
    group_name: "shipping",
    coordinator_partition: "__consumer_offsets/3",
    state: "Empty",
    balancer: "",
    members: 0,
    coordinator_node: 0,
    total_lag: 0,
    partitions: [],
    members_details: [],
  },
  {
    group_name: "billing",
    coordinator_partition: "__consumer_offsets/7",
    state: "Stable",
    balancer: "range",
    members: 2,
    coordinator_node: 1,
    total_lag: 42,
    partitions: [
      {
        partition: 0,
        current_offset: 100,
        log_start_offset: 0,
        log_end_offset: 140,
        lag: 40,
        topic: "orders",
        member_id: "rdkafka-1",
        client_id: "billing-1",
        host: "/10.0.0.3",
      },
      { partition: 1, current_offset: 98, log_start_offset: 0, log_end_offset: 100, lag: 2, topic: "orders" },
      { partition: 0, current_offset: 10, log_start_offset: 0, log_end_offset: 10, lag: 0, topic: "refunds" },
    ],
    members_details: [],
  },
]);

Deno.test("hosts and programs match the manifest", async () => {
  const manifest = parse(await Deno.readTextFile(new URL("./backslash.toml", import.meta.url))) as {
    permissions: { net: string[]; run: string[] };
  };
  assertEquals(manifest.permissions.net, HOSTS);
  assertEquals(manifest.permissions.run, ["rpk", ...TERMINALS]);
  assert(isAllowedHost("rabbit.lan"));
  assert(isAllowedHost("192.168.1.20"));
  assert(isAllowedHost("100.100.1.2"));
  assert(isAllowedHost("nats.tail1234.ts.net"));
  assert(!isAllowedHost("mq.example.com"));
  assert(!isAllowedHost("172.32.0.1"));
});

Deno.test("addresses", () => {
  assertEquals(normalizeUrl("rabbit.lan", 15672), "http://rabbit.lan:15672");
  assertEquals(normalizeUrl("http://localhost:15672/#/queues", 15672), "http://localhost:15672");
  assertEquals(normalizeUrl("https://mq.home/", 15672), "https://mq.home");
  assertEquals(normalizeUrl("http://mq.home", 15672), "http://mq.home");
  assertEquals(normalizeUrl("10.0.0.5:8222", 8222), "http://10.0.0.5:8222");
  assertEquals(normalizeUrl("", 8222), "");
  assertEquals(normalizeBrokers(" localhost:9092,  kafka://kafka.lan:9092 "), "localhost:9092,kafka.lan:9092");
});

Deno.test("configured sources", () => {
  assertEquals(configured(config({})), []);
  const c = config({ rabbitUrl: "localhost", natsUrl: "nats.lan:8222", rpkProfile: true });
  assertEquals(configured(c), ["rabbitmq", "nats", "kafka"]);
  assertEquals(c.rabbit!.auth, `Basic ${btoa("guest:guest")}`);
  assertEquals(c.kafka!.flags, []);
  const k = config({ kafkaBrokers: "kafka.lan:9092", rabbitUrl: "mq.lan", rabbitUser: "ops", rabbitPassword: "pw" });
  assertEquals(k.kafka!.flags, ["-X", "brokers=kafka.lan:9092"]);
  assertEquals(k.rabbit!.auth, `Basic ${btoa("ops:pw")}`);
});

Deno.test("formatting", () => {
  assertEquals(compact(999), "999");
  assertEquals(compact(1520), "1.5k");
  assertEquals(compact(25000), "25k");
  assertEquals(compact(3_400_000), "3.4M");
  assertEquals(bytes(0), "0 B");
  assertEquals(bytes(2048000), "2.0 MB");
  assertEquals(rate(0), "0/s");
  assertEquals(rate(0.04), "0.04/s");
  assertEquals(rate(4.56), "4.6/s");
  assertEquals(rate(12.4), "12/s");
  assertEquals(nanos(604800000000000), "7d");
  assertEquals(nanos(5400e9), "1h 30m");
  assertEquals(nanos(0), "unlimited");
  assertEquals(backlogColor(0), "gray");
  assertEquals(backlogColor(5), "blue");
  assertEquals(backlogColor(5000), "orange");
  assertEquals(backlogColor(500000), "red");
  const now = Date.parse("2026-10-28T12:00:00Z");
  assertEquals(ago("2026-10-28T11:57:00Z", now), "3 min ago");
  assertEquals(ago("0001-01-01T00:00:00Z", now), "");
});

Deno.test("RabbitMQ queues", () => {
  const queues = parseRabbitQueues(QUEUES);
  assertEquals(queues.map((q) => `${q.vhost}/${q.name}`), ["//emails", "//orders.dlq", "staging/events"]);
  const emails = queues[0];
  assertEquals([emails.ready, emails.unacked, emails.consumers], [1500, 20, 2]);
  assertEquals(emails.publishRate, 12.4);
  assertEquals(emails.utilisation, 0.42);
  assertEquals(emails.arguments["x-dead-letter-exchange"], "dlx");
  const dlq = queues[1];
  assertEquals(dlq.type, "quorum");
  assertEquals(dlq.state, "idle");
  assertEquals(dlq.node, "rabbit@mq2");
  assertEquals(dlq.utilisation, undefined);
  // The paginated shape (?page=1).
  assertEquals(parseRabbitQueues(JSON.stringify({ items: [{ name: "a", vhost: "/" }], total_count: 1 })).length, 1);
  assertEquals(rabbitQueuePath(dlq), "/api/queues/%2F/orders.dlq");
  assertEquals(rabbitQueueUi("http://mq.lan:15672", queues[2]), "http://mq.lan:15672/#/queues/staging/events");
});

Deno.test("RabbitMQ overview", () => {
  const o = parseRabbitOverview(JSON.stringify({
    management_version: "3.13.7",
    rabbitmq_version: "3.13.7",
    erlang_version: "26.2.5",
    cluster_name: "rabbit@mq1",
    node: "rabbit@mq1",
    queue_totals: { messages: 1523, messages_ready: 1503, messages_unacknowledged: 20 },
    message_stats: { publish_details: { rate: 12.4 }, deliver_get_details: { rate: 11.9 } },
    object_totals: { channels: 4, connections: 3, consumers: 3, exchanges: 14, queues: 3 },
  }));
  assertEquals([o.messages, o.ready, o.unacked], [1523, 1503, 20]);
  assertEquals([o.connections, o.queues, o.exchanges], [3, 3, 14]);
  assertEquals(o.version, "3.13.7");
});

Deno.test("peeked messages", () => {
  const messages = parsePeek(JSON.stringify([
    {
      payload_bytes: 27,
      redelivered: true,
      exchange: "mail",
      routing_key: "emails",
      message_count: 1499,
      properties: { content_type: "application/json", headers: { attempt: 2 } },
      payload: '{"to":"ada@example.com"}',
      payload_encoding: "string",
    },
    { payload_bytes: 4, exchange: "", routing_key: "bin", properties: [], payload: "AAEC", payload_encoding: "base64" },
  ]));
  assertEquals(messages[0].routingKey, "emails");
  assertEquals(messages[0].headers, { attempt: 2 });
  assertEquals(messages[1].base64, true);
  assertEquals(prettyPayload('{"to":"ada@example.com"}'), { text: '{\n  "to": "ada@example.com"\n}', lang: "json" });
  assertEquals(prettyPayload("{not json"), { text: "{not json", lang: "" });
});

Deno.test("NATS server, connections and streams", () => {
  const s = parseVarz(JSON.stringify({
    server_id: "NCX",
    server_name: "nats-1",
    version: "2.10.22",
    uptime: "3d4h5m",
    connections: 12,
    total_connections: 340,
    subscriptions: 1500,
    slow_consumers: 1,
    in_msgs: 1e6,
    out_msgs: 2e6,
    in_bytes: 5e8,
    out_bytes: 9e8,
    mem: 52428800,
    cpu: 1.5,
    cluster: { name: "east" },
    jetstream: { config: { max_memory: 1 }, stats: { memory: 0, storage: 2048000 } },
  }));
  assertEquals([s.name, s.version, s.cluster, s.jetstream], ["nats-1", "2.10.22", "east", true]);
  assertEquals(s.slowConsumers, 1);
  assertEquals(parseVarz('{"server_id":"X"}').jetstream, false);

  const { total, connections } = parseConnz(JSON.stringify({
    num_connections: 1,
    total: 1,
    connections: [{
      cid: 7,
      ip: "10.0.0.9",
      port: 51000,
      name: "billing-worker",
      lang: "go",
      version: "1.37.0",
      uptime: "2h",
      idle: "1s",
      rtt: "350µs",
      subscriptions: 3,
      pending_bytes: 0,
      in_msgs: 10,
      out_msgs: 20,
    }],
  }));
  assertEquals(total, 1);
  assertEquals(connections[0].name, "billing-worker");

  const streams = parseJsz(JSZ);
  assertEquals(streams.map((x) => x.name), ["EVENTS", "ORDERS"]);
  const orders = streams[1];
  assertEquals(orders.subjects, ["orders.>"]);
  assertEquals([orders.messages, orders.replicas, orders.retention], [1200, 3, "workqueue"]);
  assertEquals(orders.consumers.map((x) => [x.name, x.pending, x.ackPending, x.durable]), [
    ["billing", 299, 5, true],
    ["audit_eph", 0, 0, false],
  ]);
  assertEquals(orders.consumers[0].filter, "orders.paid");
  assertEquals(streams[0].replicas, 1);
  assertEquals(parseJsz("{}"), []);
});

Deno.test("Kafka topics and groups from rpk", () => {
  assertEquals(
    parseTopics('[{"name":"orders","partitions":3,"replicas":1},{"name":"_schemas","partitions":1,"replicas":1}]'),
    [{ name: "_schemas", partitions: 1, replicas: 1 }, { name: "orders", partitions: 3, replicas: 1 }],
  );
  assertEquals(parseGroupList('[{"broker":0,"group":"billing","state":"Stable"},{"broker":1,"group":"shipping"}]'), [
    { group: "billing", state: "Stable" },
    { group: "shipping", state: "" },
  ]);
  const groups = parseGroupDescribe(GROUPS);
  assertEquals(groups.map((g) => [g.group, g.totalLag]), [["billing", 42], ["shipping", 0]]);
  assertEquals(groups[0].partitions[0].host, "10.0.0.3");
  assertEquals(lagByTopic(groups[0]), [
    { topic: "orders", lag: 42, partitions: 2 },
    { topic: "refunds", lag: 0, partitions: 1 },
  ]);
  // One group described alone may come as an object.
  assertEquals(parseGroupDescribe(JSON.stringify({ group_name: "solo", total_lag: 1 }))[0].group, "solo");
  assertEquals(groupStateColor("Stable"), "green");
  assertEquals(groupStateColor("PreparingRebalance"), "orange");
});

Deno.test("rpk errors", () => {
  assertEquals(
    rpkError("Error: unknown flag: --format"),
    "This rpk is too old for JSON output: update it to 23.1 or newer",
  );
  assert(
    rpkError("unable to list topics: unable to dial: dial tcp 127.0.0.1:9092: connect: connection refused")
      .startsWith("rpk can't reach"),
  );
  assert(rpkError("SASL authentication failed").includes("SASL"));
});
