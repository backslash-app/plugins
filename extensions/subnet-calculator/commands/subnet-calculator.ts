import { type Action, copy, Icons, type Item, list, meta, type Metadata } from "@backslash/api";
import {
  base,
  binary,
  cidr,
  contains,
  EXAMPLES,
  expandIPv6,
  type Family,
  formatAddress,
  formatCount,
  hex,
  hostRange,
  ipv4Class,
  last,
  maskOf,
  neighbor,
  type Network,
  parseQuery,
  plural,
  prefixForHosts,
  ptrName,
  reverseZones,
  scopeOf,
  size,
  type Span,
  split,
  SPLIT_LIMIT,
  summarize,
  supernet,
  usableHosts,
  WIDTH,
  withPrefix,
} from "../lib.ts";

const SYNTAX = [
  "## What you can type",
  "",
  "| Type | To get |",
  "|---|---|",
  "| `192.168.1.0/24`, `10.0.0.5/22`, `2001:db8::/48` | The network: range, hosts, masks, binary |",
  "| `10.0.0.5 255.255.252.0`, `10.0.0.5/0.0.3.255` | The same with a netmask or wildcard |",
  "| `8.8.8.8`, `fe80::1` | What an address is, and the networks around it |",
  "| `10.0.0.0/16 split 24` | Every /24 inside |",
  "| `10.0.0.0/16 into 6` | Enough subnets for 6 (here 8 × /19) |",
  "| `10.0.0.5 in 10.0.0.0/8` | Whether it is inside |",
  "| `10.0.0.0/24 10.0.1.0/24`, `10.0.0.1-10.0.0.20` | The fewest CIDRs covering them |",
  "| `500 hosts` | The smallest subnet that fits |",
  "| `/27`, `255.255.255.224` | What a prefix length means |",
].join("\n");

const v = (n: Network, value: bigint) => formatAddress(value, n.family);
/** Every address, network and broadcast included. */
const span = (n: Network) => base(n) === last(n) ? v(n, base(n)) : `${v(n, base(n))} – ${v(n, last(n))}`;
/** The usable hosts. */
const range = (n: Network) => {
  const h = hostRange(n);
  return h.first === h.last ? v(n, h.first) : `${v(n, h.first)} – ${v(n, h.last)}`;
};

function scopeTag(n: Network) {
  const s = scopeOf(n);
  return { tag: s.label, color: s.color };
}

function value(id: string, label: string, text: string, section: string, extra: Action[] = []): Item {
  return {
    id,
    title: text,
    subtitle: label,
    icon: { source: Icons.copy, tint: "gray" },
    section,
    detail: { markdown: `## ${label}\n\n\`${text}\`` },
    actions: [copy(text, `Copy ${label}`), ...extra],
  };
}

function bitsBlock(n: Network): string {
  if (n.family === 6) {
    return [
      "```",
      `Expanded  ${expandIPv6(base(n))}`,
      `Last      ${expandIPv6(last(n))}`,
      `Mask      ${expandIPv6(maskOf(n.prefix, 6))}`,
      "```",
    ].join("\n");
  }
  const rows: [string, bigint][] = [
    ["Address  ", n.address],
    ["Netmask  ", maskOf(n.prefix, 4)],
    ["Network  ", base(n)],
    ["Broadcast", last(n)],
  ];
  if (n.address === base(n)) rows.shift();
  return ["```", ...rows.map(([l, x]) => `${l} ${binary(x, 4)}`), "```"].join("\n");
}

function networkMetadata(n: Network): Metadata[] {
  const h = hostRange(n);
  const scope = scopeOf(n);
  const zones = reverseZones(n, 4);
  const lines: Metadata[] = [
    meta.tags("Scope", [{ text: scope.label, color: scope.color }]),
    meta.text("Kind", scope.name + (scope.rfc ? ` (${scope.rfc})` : "")),
    meta.separator(),
    meta.text("Network", v(n, base(n))),
  ];
  if (n.family === 4) {
    lines.push(
      meta.text("Broadcast", v(n, last(n))),
      meta.text("Netmask", v(n, maskOf(n.prefix, 4))),
      meta.text("Wildcard", v(n, 0xffffffffn ^ maskOf(n.prefix, 4))),
      meta.text("Class", ipv4Class(base(n)).name),
    );
  } else {
    lines.push(meta.text("Last address", v(n, last(n))));
    if (n.prefix <= 64) lines.push(meta.text("/64 subnets", formatCount(1n << BigInt(64 - n.prefix))));
  }
  lines.push(
    meta.text("Usable range", range(n)),
    meta.text("Usable hosts", formatCount(h.count)),
    meta.text("Addresses", formatCount(size(n))),
    meta.separator(),
    meta.text(
      zones.total === 1 ? "Reverse zone" : "Reverse zones",
      zones.zones.join(", ") + (zones.total > zones.zones.length ? `… (${zones.total})` : ""),
    ),
  );
  return lines;
}

function summaryItem(n: Network, section: string): Item {
  const h = hostRange(n);
  const text = cidr(n);
  return {
    id: `net:${text}`,
    title: text,
    subtitle: `${plural(h.count, n.family === 6 && n.prefix < 128 ? "address" : "usable host")} · ${range(n)}`,
    icon: { source: Icons.layers, tint: "blue" },
    section,
    accessories: [scopeTag(n)],
    detail: {
      stats: [
        { label: n.family === 4 ? "Usable hosts" : "Addresses", value: formatCount(h.count) },
        { label: "Prefix", value: `/${n.prefix}` },
        ...(n.family === 4 ? [{ label: "Netmask", value: v(n, maskOf(n.prefix, 4)) }] : []),
      ],
      markdown: bitsBlock(n),
      metadata: networkMetadata(n),
    },
    actions: [
      copy(text, "Copy CIDR"),
      copy(range(n), "Copy Host Range", { shortcut: "<Ctrl><Shift>c" }),
      copy(report(n), "Copy Summary", { icon: Icons.text, shortcut: "<Ctrl><Shift>e" }),
    ],
  };
}

/** Plain text of the main values, to paste in a ticket or a config comment. */
export function report(n: Network): string {
  const h = hostRange(n);
  const lines = [`Network:      ${cidr(n)}`];
  if (n.family === 4) {
    lines.push(
      `Netmask:      ${v(n, maskOf(n.prefix, 4))}`,
      `Wildcard:     ${v(n, 0xffffffffn ^ maskOf(n.prefix, 4))}`,
      `Broadcast:    ${v(n, last(n))}`,
    );
  } else lines.push(`Last address: ${v(n, last(n))}`);
  lines.push(`Host range:   ${range(n)}`, `Usable hosts: ${formatCount(h.count)}`, `Scope:        ${scopeOf(n).name}`);
  return lines.join("\n");
}

function relatedItems(n: Network): Item[] {
  const items: Item[] = [];
  const add = (id: string, net: Network | undefined, label: string) => {
    if (!net) return;
    items.push({
      id: `related:${id}`,
      title: cidr(net),
      subtitle: `${label} · ${range(net)}`,
      icon: { source: Icons.arrowRight, tint: "teal" },
      section: "Nearby Networks",
      accessories: [{ text: plural(hostRange(net).count, net.family === 4 ? "host" : "address") }],
      detail: { markdown: bitsBlock(net), metadata: networkMetadata(net) },
      actions: [copy(cidr(net), "Copy CIDR"), copy(range(net), "Copy Host Range")],
    });
  };
  add("prev", neighbor(n, -1), "Previous");
  add("next", neighbor(n, 1), "Next");
  if (n.prefix > 0) add("parent", withPrefix(n, n.prefix - 1), "Parent");
  if (n.prefix < WIDTH[n.family]) {
    for (const [i, half] of split(n, n.prefix + 1).subnets.entries()) add(`half${i}`, half, `Half ${i + 1}`);
  }
  return items;
}

function networkItems(n: Network): Item[] {
  const h = hostRange(n);
  const items: Item[] = [summaryItem(n, n.address === base(n) ? "Network" : `${v(n, n.address)} is in`)];
  const s = "Values";
  if (n.family === 4) {
    items.push(
      ...(n.prefix === 32
        ? [value("host", "Host", v(n, h.first), s)]
        : n.prefix === 31
        ? [value("first", "First host", v(n, h.first), s), value("last", "Last host", v(n, h.last), s)]
        : [
          value("network", "Network address", v(n, base(n)), s),
          value("broadcast", "Broadcast", v(n, last(n)), s),
          value("first", "First host", v(n, h.first), s),
          value("last", "Last host", v(n, h.last), s),
        ]),
      value("netmask", "Netmask", v(n, maskOf(n.prefix, 4)), s),
      value("wildcard", "Wildcard mask", v(n, 0xffffffffn ^ maskOf(n.prefix, 4)), s),
    );
  } else {
    items.push(
      value("network", "Network address", v(n, base(n)), s),
      value("last", "Last address", v(n, last(n)), s),
      value("expanded", "Expanded", expandIPv6(base(n)) + `/${n.prefix}`, s),
    );
  }
  return [...items, ...relatedItems(n)];
}

function addressItems(n: Network): Item[] {
  const scope = scopeOf(n);
  const text = v(n, n.address);
  const facts: [string, string][] = n.family === 4
    ? [
      ["Integer", n.address.toString()],
      ["Hexadecimal", hex(n.address, 4)],
      ["Binary", binary(n.address, 4)],
      ["Reverse DNS", ptrName(n.address, 4)],
    ]
    : [
      ["Expanded", expandIPv6(n.address)],
      ["Reverse DNS", ptrName(n.address, 6)],
    ];
  const items: Item[] = [{
    id: "address",
    title: text,
    subtitle: scope.name,
    icon: { source: scope.label === "Public" ? Icons.globe : Icons.home, tint: scope.color },
    section: `IPv${n.family} address`,
    accessories: [{ tag: scope.label, color: scope.color }],
    detail: {
      markdown: [`## ${text}`, "", `${scope.name}${scope.rfc ? ` (${scope.rfc})` : ""}.`].join("\n"),
      metadata: [
        meta.tags("Scope", [{ text: scope.label, color: scope.color }]),
        ...(n.family === 4 ? [meta.text("Class", ipv4Class(n.address).name)] : []),
        meta.separator(),
        ...facts.map(([l, x]) => meta.text(l, x)),
      ],
    },
    actions: [copy(text, "Copy Address"), copy(ptrName(n.address, n.family), "Copy PTR Name")],
  }];
  for (const [label, x] of facts) items.push(value(`fact:${label}`, label, x, "Values"));
  const prefixes = n.family === 4 ? [24, 16, 8] : [64, 56, 48, 32];
  for (const p of prefixes) {
    const net = withPrefix(n, p);
    items.push({ ...summaryItem({ ...net, address: n.address }, "Networks containing it"), id: `in:${p}` });
  }
  return items;
}

function splitItems(n: Network, prefix: number): Item[] {
  const { subnets, total } = split(n, prefix);
  const shown = subnets.map(cidr).join("\n");
  const header: Item = {
    id: "split",
    title: `${cidr(withPrefix(n, n.prefix))} → ${formatCount(total)} × /${prefix}`,
    subtitle: `${plural(usableHosts(prefix, n.family), n.family === 4 ? "usable host" : "address")} each`,
    icon: { source: Icons.layers, tint: "blue" },
    section: "Split",
    accessories: total > BigInt(subnets.length) ? [{ text: `first ${subnets.length} shown` }] : [],
    detail: {
      stats: [
        { label: "Subnets", value: formatCount(total) },
        { label: "Each", value: `/${prefix}` },
        { label: n.family === 4 ? "Hosts each" : "Addresses each", value: formatCount(usableHosts(prefix, n.family)) },
      ],
      markdown: ["```", shown, total > BigInt(subnets.length) ? "…" : "", "```"].filter(Boolean).join("\n"),
    },
    actions: [copy(shown, total > BigInt(subnets.length) ? `Copy First ${subnets.length}` : "Copy All Subnets")],
  };
  return [
    header,
    ...subnets.map((s, i): Item => ({
      id: `sub:${cidr(s)}`,
      title: cidr(s),
      subtitle: range(s),
      icon: { source: Icons.hash, tint: "gray" },
      section: `Subnets${total > BigInt(subnets.length) ? ` · first ${SPLIT_LIMIT} of ${formatCount(total)}` : ""}`,
      accessories: [{ text: `#${i + 1}` }],
      detail: { markdown: bitsBlock(s), metadata: networkMetadata(s) },
      actions: [
        copy(cidr(s), "Copy CIDR"),
        copy(range(s), "Copy Host Range"),
        copy(shown, "Copy All Subnets", { shortcut: "<Ctrl><Shift>c" }),
      ],
    })),
  ];
}

function containsItems(needle: Network, haystack: Network): Item[] {
  const yes = contains(haystack, needle);
  const what = needle.bare ? v(needle, needle.address) : cidr(needle);
  const where = cidr(haystack);
  const sentence = `${what} is ${yes ? "" : "not "}in ${where}`;
  const items: Item[] = [{
    id: "verdict",
    title: yes ? `Yes: ${sentence}` : `No: ${sentence}`,
    subtitle: `${where} spans ${span(haystack)}`,
    icon: { source: yes ? Icons.check : Icons.cross, tint: yes ? "green" : "red" },
    section: "Answer",
    accessories: [{ tag: yes ? "Inside" : "Outside", color: yes ? "green" : "red" }],
    detail: {
      markdown: [`## ${sentence}`, "", `${where}: ${v(haystack, base(haystack))} to ${v(haystack, last(haystack))}.`]
        .join("\n"),
      metadata: networkMetadata(haystack),
    },
    actions: [copy(sentence, "Copy Answer")],
  }];
  if (!yes) {
    const both = supernet(needle, haystack);
    items.push({
      ...summaryItem(both, "Smallest network holding both"),
      id: "supernet",
      icon: { source: Icons.layers, tint: "orange" },
    });
  }
  items.push(summaryItem(withPrefix(haystack, haystack.prefix), "Network"));
  return items;
}

function summarizeItems(spans: Span[], inputs: string[]): Item[] {
  const nets = summarize(spans);
  const all = nets.map(cidr).join("\n");
  const total = nets.reduce((t, n) => t + size(n), 0n);
  return [
    {
      id: "summary",
      title: `${plural(nets.length, "CIDR block")} for ${plural(inputs.length, "input")}`,
      subtitle: `${plural(total, "address")} in all`,
      icon: { source: Icons.filter, tint: "blue" },
      section: "Summary",
      detail: {
        stats: [{ label: "Inputs", value: inputs.length }, { label: "Blocks", value: nets.length }, {
          label: "Addresses",
          value: formatCount(total),
        }],
        markdown: ["```", all, "```"].join("\n"),
      },
      actions: [copy(all, "Copy All Blocks"), copy(nets.map(cidr).join(", "), "Copy Comma-Separated")],
    },
    ...nets.map((n): Item => ({
      id: `block:${cidr(n)}`,
      title: cidr(n),
      subtitle: span(n),
      icon: { source: Icons.hash, tint: "gray" },
      section: "Blocks",
      accessories: [{ text: plural(size(n), "address") }, scopeTag(n)],
      detail: { markdown: bitsBlock(n), metadata: networkMetadata(n) },
      actions: [copy(cidr(n), "Copy CIDR"), copy(all, "Copy All Blocks", { shortcut: "<Ctrl><Shift>c" })],
    })),
  ];
}

function prefixItem(prefix: number, family: Family, section: string, note?: string): Item {
  const mask = formatAddress(maskOf(prefix, family), family);
  const hosts = usableHosts(prefix, family);
  const title = family === 4 ? `/${prefix} · ${mask}` : `/${prefix} (IPv6)`;
  return {
    id: `prefix:${family}:${prefix}`,
    title,
    subtitle: note ??
      (family === 4
        ? `${plural(hosts, "usable host")} · ${plural(size({ family, prefix }), "address")}`
        : prefix <= 64
        ? `${plural(1n << BigInt(64 - prefix), "/64 subnet")}`
        : plural(hosts, "address")),
    icon: { source: Icons.hash, tint: family === 4 ? "blue" : "purple" },
    section,
    accessories: family === 4 && prefix > 0
      ? [{ text: `wildcard ${formatAddress(0xffffffffn ^ maskOf(prefix, 4), 4)}` }]
      : [],
    detail: {
      stats: [
        { label: "Prefix", value: `/${prefix}` },
        { label: family === 4 ? "Usable hosts" : "Addresses", value: formatCount(hosts) },
      ],
      markdown: family === 4 ? ["```", `Netmask ${binary(maskOf(prefix, 4), 4)}`, "```"].join("\n") : undefined,
      metadata: [
        meta.text("Netmask", mask),
        ...(family === 4 ? [meta.text("Wildcard", formatAddress(0xffffffffn ^ maskOf(prefix, 4), 4))] : []),
        meta.text("Addresses", formatCount(size({ family, prefix }))),
        meta.text(family === 4 ? "Usable hosts" : "Usable", formatCount(hosts)),
      ],
    },
    actions: [
      copy(family === 4 ? mask : `/${prefix}`, family === 4 ? "Copy Netmask" : "Copy Prefix"),
      copy(`/${prefix}`, "Copy Prefix"),
    ],
  };
}

function prefixItems(prefix: number, family?: Family): Item[] {
  const items: Item[] = [];
  for (const f of [4, 6] as Family[]) {
    if ((family && family !== f) || prefix > WIDTH[f]) continue;
    items.push(prefixItem(prefix, f, `IPv${f}`));
    if (f === 4) {
      for (const p of [prefix - 1, prefix + 1]) if (p >= 0 && p <= 32) items.push(prefixItem(p, 4, "Next to it"));
    }
  }
  return items;
}

function hostsItems(hosts: bigint): Item[] {
  const p = prefixForHosts(hosts);
  const items = [prefixItem(p, 4, `Smallest IPv4 subnet for ${plural(hosts, "host")}`)];
  if (hosts === 2n) {
    items.push(prefixItem(31, 4, "Point-to-point", "2 hosts with no network or broadcast address (RFC 3021)"));
  }
  if (p > 0) items.push(prefixItem(p - 1, 4, "With room to grow"));
  items.push(prefixItem(64, 6, "IPv6", "Every IPv6 LAN is a /64, whatever its size"));
  return items;
}

function exampleItems(): Item[] {
  return EXAMPLES.map((e) => ({
    id: `example:${e.query}`,
    title: e.query,
    subtitle: e.title,
    icon: { source: Icons.lightbulb, tint: "yellow" },
    section: "Examples: type one",
    detail: { markdown: SYNTAX },
    actions: [copy(e.query, "Copy Example")],
  }));
}

export default list({
  placeholder: "192.168.1.0/24 · 10.0.0.5 255.255.252.0 · 2001:db8::/48 · /16 split 24 · 500 hosts",
  empty: { title: "Nothing to show", icon: Icons.layers },
  status: (items) => {
    const first = items[0];
    if (!first) return "";
    if (first.id === "error") return "Not an address or network";
    if (first.id?.startsWith("example:")) return "IPv4 · IPv6 · CIDR · netmasks";
    return String(first.subtitle ?? "");
  },
  search(query) {
    const q = parseQuery(query);
    try {
      switch (q.kind) {
        case "empty":
          return exampleItems();
        case "network":
          return q.network.bare ? addressItems(q.network) : networkItems(q.network);
        case "prefix":
          return prefixItems(q.prefix, q.family);
        case "hosts":
          return hostsItems(q.hosts);
        case "split":
          return splitItems(q.network, q.prefix);
        case "contains":
          return containsItems(q.needle, q.haystack);
        case "summarize":
          return summarizeItems(q.spans, q.inputs);
        case "error":
          throw new Error(q.message);
      }
    } catch (e) {
      return [{
        id: "error",
        title: (e as Error).message,
        subtitle: "Not an address or network",
        icon: { source: Icons.alert, tint: "red" },
        detail: { markdown: SYNTAX },
        actions: [copy(query, "Copy Input")],
      }, ...exampleItems()];
    }
  },
});
