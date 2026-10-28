// Items and views shared by the commands.

import {
  action,
  type Color,
  type Context,
  copy,
  detail,
  Icons,
  type Item,
  list,
  type ListSpec,
  meta,
  type Metadata,
  open,
  refresh,
  storage,
  updateCommandMetadata,
} from "@backslash/api";
import {
  addressScope,
  countryName,
  daysUntil,
  defaultTypes,
  type DnsAnswer,
  formatBytes,
  formatSpeed,
  formatTtl,
  type Geo,
  installMarkdown,
  type Interface,
  isIP,
  isIPv4,
  jitter,
  latencyQuality,
  median,
  ms,
  percentile,
  place,
  rankInterfaces,
  type RecordType,
  shortDate,
  speedVerdict,
} from "./lib.ts";
import {
  family,
  geolocate,
  interfaces,
  lookup,
  Missing,
  ping,
  publicIps,
  type SpeedProgress,
  speedTest,
  whois,
} from "./system.ts";

export interface Prefs {
  resolver?: string;
  ipinfoToken?: string;
  pingCount?: number;
}

export const prefs = (ctx: Context) => ctx.preferences as Prefs;

/** An item explaining what to install, for the distribution in /etc/os-release. */
export async function missingItem(program: string, why: string, section?: string): Promise<Item> {
  const fam = await family();
  return {
    id: `missing:${program}`,
    title: `${program} is not installed`,
    subtitle: why,
    icon: { source: Icons.alert, tint: "orange" },
    section,
    detail: { markdown: installMarkdown(`${why} needs **${program}**. Install it, then try again.`, program, fam) },
    actions: [action("Check Again", () => refresh(), { icon: Icons.refresh })],
  };
}

const errorItem = (title: string, e: unknown, section?: string): Item => ({
  id: `error:${title}`,
  title,
  subtitle: (e as Error).message,
  icon: { source: Icons.alert, tint: "red" },
  section,
  detail: { markdown: `**${title}**\n\n\`${(e as Error).message}\`` },
  actions: [action("Try Again", () => refresh(), { icon: Icons.refresh })],
});

// ---------------------------------------------------------------------------
// Public IP

function geoMetadata(g: Geo | undefined): Metadata[] {
  if (!g) return [meta.text("Location", "Unknown", { icon: Icons.globe })];
  return [
    ...(place(g) ? [meta.text("Location", place(g), { icon: Icons.pin })] : []),
    ...(g.country ? [meta.text("Country", countryName(g.country) ?? g.country, { icon: Icons.flag })] : []),
    ...(g.org ? [meta.text("Provider", g.org, { icon: Icons.server })] : []),
    ...(g.asn ? [meta.link("ASN", g.asn, `https://bgp.he.net/${g.asn}`)] : []),
    ...(g.hostname ? [meta.text("Reverse DNS", g.hostname, { icon: Icons.tag })] : []),
    ...(g.timezone ? [meta.text("Time zone", g.timezone, { icon: Icons.clock })] : []),
    ...(g.postal ? [meta.text("Postal code", g.postal)] : []),
    ...(g.loc
      ? [meta.link(
        "Coordinates",
        `${g.loc.lat.toFixed(4)}, ${g.loc.lon.toFixed(4)}`,
        `https://www.openstreetmap.org/?mlat=${g.loc.lat}&mlon=${g.loc.lon}#map=10/${g.loc.lat}/${g.loc.lon}`,
      )]
      : []),
  ];
}

const geoText = (ip: string, g?: Geo) => [ip, g && place(g), g?.org, g?.asn].filter(Boolean).join(" · ");

/** An address and where it is. `label` is "IPv4", "IPv6" or the host it was looked up for. */
export function ipItem(ip: string, label: string, g: Geo | undefined, section: string, geoError?: string): Item {
  return {
    id: `ip:${ip}`,
    title: ip,
    subtitle: g ? [place(g), g.org].filter(Boolean).join(" · ") : geoError ? "Location unavailable" : undefined,
    icon: { source: Icons.globe, tint: isIPv4(ip) ? "blue" : "purple" },
    section,
    accessories: [{ tag: label }],
    detail: {
      markdown: geoError ? `Geolocation failed: \`${geoError}\`` : undefined,
      metadata: [
        meta.text("Address", ip, { icon: Icons.globe }),
        meta.text("Family", isIPv4(ip) ? "IPv4" : "IPv6"),
        meta.separator(),
        ...geoMetadata(g),
      ],
    },
    actions: [
      copy(ip, "Copy IP Address"),
      copy(geoText(ip, g), "Copy with Location", { section: "Copy" }),
      open(`https://ipinfo.io/${ip}`, "Open on ipinfo.io", { icon: Icons.external, section: "More" }),
    ],
  };
}

export async function publicIpItems(ctx: Context, section = "Public IP"): Promise<Item[]> {
  const ips = await publicIps(ctx.signal);
  if (!ips.v4 && !ips.v6) return [errorItem("No public IP: offline?", new Error(ips.error ?? "No answer"), section)];
  const token = prefs(ctx).ipinfoToken || undefined;
  const geo = async (ip?: string) => ip ? await geolocate(ip, token, ctx.signal).catch((e: Error) => e) : undefined;
  const [g4, g6] = await Promise.all([geo(ips.v4), geo(ips.v6)]);
  const items: Item[] = [];
  const add = (ip: string | undefined, label: string, g: Geo | Error | undefined) => {
    if (ip) {
      items.push(
        ipItem(ip, label, g instanceof Error ? undefined : g, section, g instanceof Error ? g.message : undefined),
      );
    }
  };
  add(ips.v4, "IPv4", g4);
  add(ips.v6, "IPv6", g6);
  if (!ips.v6) {
    items.push({
      id: "no-v6",
      title: "No IPv6",
      subtitle: "Your connection only reaches the internet over IPv4",
      icon: { source: Icons.globe, tint: "gray" },
      section,
    });
  }
  const main = ips.v4 ?? ips.v6!;
  const g = ips.v4 ? g4 : g6;
  updateCommandMetadata({ subtitle: g instanceof Error || !g ? main : `${main} · ${place(g)}` }).catch(() => {});
  return items;
}

// ---------------------------------------------------------------------------
// Interfaces

const KIND: Record<Interface["kind"], { icon: string; tint: Color; name: string }> = {
  ethernet: { icon: Icons.plug, tint: "blue", name: "Ethernet" },
  wifi: { icon: Icons.wifi, tint: "blue", name: "Wi-Fi" },
  vpn: { icon: Icons.vpn, tint: "purple", name: "VPN / tunnel" },
  bridge: { icon: Icons.layers, tint: "teal", name: "Bridge" },
  virtual: { icon: Icons.box, tint: "gray", name: "Virtual" },
  loopback: { icon: Icons.cycle, tint: "gray", name: "Loopback" },
  other: { icon: Icons.server, tint: "gray", name: "Interface" },
};

export function interfaceItem(i: Interface, section?: string): Item {
  const k = KIND[i.kind];
  const v4 = i.addresses.filter((a) => a.family === "inet");
  const v6 = i.addresses.filter((a) => a.family === "inet6");
  const main = v4[0] ?? v6.find((a) => a.scope === "global") ?? v6[0];
  return {
    id: `if:${i.name}`,
    title: i.name,
    subtitle: main ? `${main.address}/${main.prefix}` : i.up ? "No address" : "Down",
    icon: { source: k.icon, tint: i.up ? k.tint : "gray" },
    section: section ?? (i.up ? "Up" : "Down"),
    keywords: [...i.addresses.map((a) => a.address), k.name, i.mac ?? ""],
    accessories: [
      ...(i.isDefault ? [{ tag: "Default route", color: "green" as const }] : []),
      { text: k.name },
    ],
    detail: {
      stats: i.rx !== undefined
        ? [{ label: "Received", value: formatBytes(i.rx) }, { label: "Sent", value: formatBytes(i.tx ?? 0) }]
        : [],
      metadata: [
        meta.text("State", i.up ? "Up" : i.state, {
          icon: i.up ? Icons.check : Icons.cross,
          color: i.up ? "green" : "gray",
        }),
        meta.text("Type", k.name, { icon: k.icon }),
        ...v4.map((a) =>
          meta.text("IPv4", `${a.address}/${a.prefix}${addressScope(a.address) ? ` · ${addressScope(a.address)}` : ""}`)
        ),
        ...v6.map((a) => meta.text("IPv6", `${a.address}/${a.prefix} · ${a.scope}`)),
        ...(i.gateway ? [meta.text("Gateway", i.gateway, { icon: Icons.arrowRight })] : []),
        ...(i.mac ? [meta.text("MAC", i.mac, { icon: Icons.tag })] : []),
        meta.text("MTU", i.mtu),
      ],
    },
    actions: [
      ...(main ? [copy(main.address, "Copy Address")] : []),
      ...i.addresses.slice(1).map((a) => copy(a.address, `Copy ${a.address}`, { section: "Copy" })),
      ...(i.mac ? [copy(i.mac, "Copy MAC Address", { section: "Copy" })] : []),
      ...(i.gateway ? [copy(i.gateway, "Copy Gateway", { section: "Copy" })] : []),
      action("Refresh", () => refresh(), { icon: Icons.refresh, shortcut: "<Ctrl>r" }),
    ],
  };
}

export async function interfaceItems(section?: string, all = true): Promise<Item[]> {
  try {
    const list = rankInterfaces(await interfaces());
    return (all ? list : list.filter((i) => i.isDefault)).map((i) => interfaceItem(i, section));
  } catch (e) {
    if (e instanceof Missing) return [await missingItem("ip", "Listing interfaces", section)];
    return [errorItem("Can't list interfaces", e, section)];
  }
}

// ---------------------------------------------------------------------------
// DNS

const TYPE_TINT: Record<string, Color> = {
  A: "blue",
  AAAA: "purple",
  CNAME: "teal",
  MX: "orange",
  NS: "green",
  TXT: "gray",
  SOA: "gray",
  CAA: "pink",
  SRV: "yellow",
  PTR: "teal",
};

export function dnsItems(host: string, answers: (DnsAnswer & { via: string })[]): Item[] {
  const items = answers.flatMap((a) =>
    a.records.map((r, n): Item => ({
      id: `dns:${a.type}:${n}:${r.data}`,
      title: r.data || (a.type === "MX" ? "No mail accepted (null MX)" : "(empty)"),
      subtitle: r.name !== host ? r.name : undefined,
      icon: { source: Icons.hash, tint: TYPE_TINT[a.type] ?? "gray" },
      section: a.type,
      keywords: [a.type],
      accessories: [
        ...(r.priority !== undefined ? [{ text: `priority ${r.priority}` }] : []),
        { tag: a.type },
        { text: formatTtl(r.ttl), tooltip: "Time to live" },
      ],
      detail: {
        markdown: a.type === "TXT" ? `\`\`\`\n${r.data}\n\`\`\`` : undefined,
        metadata: [
          meta.text("Name", r.name, { icon: Icons.globe }),
          meta.tags("Type", [{ text: a.type, color: TYPE_TINT[a.type] }]),
          ...(a.type !== "TXT" ? [meta.text("Value", r.data)] : []),
          ...(r.priority !== undefined ? [meta.text("Priority", r.priority)] : []),
          meta.text("TTL", `${r.ttl} s (${formatTtl(r.ttl)})`, { icon: Icons.timer }),
          meta.separator(),
          meta.text("Resolver", a.via, { icon: Icons.server }),
        ],
      },
      actions: [
        copy(r.data, "Copy Value"),
        copy(
          answers.flatMap((x) =>
            x.records.map((y) =>
              `${y.name}\t${y.ttl}\tIN\t${x.type}\t${y.priority !== undefined ? `${y.priority} ` : ""}${y.data}`
            )
          ).join("\n"),
          "Copy All Records",
          { section: "Copy" },
        ),
        ...(["A", "AAAA"].includes(a.type)
          ? [action(`Ping ${r.data}`, (c) => pingView(r.data, c), { icon: Icons.activity, section: "Tools" })]
          : []),
        ...(["CNAME", "MX", "NS"].includes(a.type)
          ? [
            action(`Look Up ${r.data}`, (c) => dnsView(r.data, defaultTypes, c), {
              icon: Icons.search,
              section: "Tools",
            }),
          ]
          : []),
      ],
    }))
  );
  if (items.length) return items;
  const status = answers.find((a) => a.status !== "NOERROR")?.status;
  return [{
    id: "dns:none",
    title: status === "NXDOMAIN" ? `${host} doesn't exist` : `No ${answers.map((a) => a.type).join(", ")} record`,
    subtitle: status ?? "NOERROR, empty answer",
    icon: { source: Icons.alert, tint: status === "NXDOMAIN" ? "red" : "gray" },
    detail: { metadata: [meta.text("Resolver", answers[0]?.via ?? "–", { icon: Icons.server })] },
  }];
}

export async function resolveAll(host: string, types: RecordType[], ctx: Context) {
  return await Promise.all(types.map((t) => lookup(host, t, prefs(ctx).resolver ?? "cloudflare", ctx.signal)));
}

export async function dnsResultItems(host: string, types: RecordType[], ctx: Context): Promise<Item[]> {
  try {
    return dnsItems(host, await resolveAll(host, types, ctx));
  } catch (e) {
    if (e instanceof Missing) return [await missingItem("dig", "Looking up DNS through the system resolver")];
    throw e;
  }
}

export function dnsView(host: string, types: RecordType[], ctx: Context): ListSpec {
  return list({
    title: `DNS · ${host}`,
    placeholder: "Filter records…",
    status: (items) => `${items.filter((i) => i.id !== "dns:none").length} records · ${host}`,
    items: () => dnsResultItems(host, types, ctx),
  });
}

// ---------------------------------------------------------------------------
// Ping

export function pingView(host: string, ctx: Context): ListSpec {
  const count = Math.max(1, Math.min(50, Number(prefs(ctx).pingCount) || 4));
  let summary = `Pinging ${host}…`;
  return list({
    title: `Ping · ${host}`,
    status: () => summary,
    async *items({ signal }) {
      try {
        for await (const s of ping(host, count, signal)) {
          const done = s.transmitted !== undefined;
          const loss = s.loss ?? (s.replies.length ? 0 : undefined);
          const q = latencyQuality(s.avg);
          summary = done
            ? `${s.received}/${s.transmitted} replies · ${s.loss}% loss · avg ${ms(s.avg)}`
            : `${s.replies.length}/${count} replies…`;
          const lossColor: Color = !loss ? "green" : loss < 50 ? "orange" : "red";
          const head: Item = {
            id: "ping:summary",
            title: s.errors.length && !s.replies.length
              ? s.errors[0]
              : done
              ? `${q.text} · avg ${ms(s.avg)}`
              : `Pinging ${host}…`,
            subtitle: s.address && s.address !== host ? `${host} (${s.address})` : host,
            icon: {
              source: Icons.activity,
              tint: s.errors.length && !s.replies.length ? "red" : done ? q.color : "blue",
            },
            section: "Statistics",
            accessories: done
              ? [{ tag: `${s.loss}% loss`, color: lossColor }]
              : [{ text: `${s.replies.length}/${count}` }],
            detail: {
              stats: [
                { label: "Min", value: ms(s.min) },
                { label: "Avg", value: ms(s.avg), color: s.avg !== undefined ? q.color : undefined },
                { label: "Max", value: ms(s.max) },
                {
                  label: "Loss",
                  value: loss === undefined ? "–" : `${loss} %`,
                  color: loss === undefined ? undefined : lossColor,
                },
              ],
              metadata: [
                meta.text("Host", host, { icon: Icons.globe }),
                ...(s.address ? [meta.text("Address", s.address)] : []),
                meta.progress(
                  "Replies",
                  s.transmitted ? (s.received ?? 0) / s.transmitted : s.replies.length / count,
                  `${s.received ?? s.replies.length} of ${s.transmitted ?? count}`,
                ),
                ...(s.mdev !== undefined ? [meta.text("Jitter (mdev)", ms(s.mdev), { icon: Icons.activity })] : []),
                ...(s.replies[0]?.ttl ? [meta.text("TTL", s.replies[0].ttl!)] : []),
                ...s.errors.map((e) => meta.text("Error", e, { icon: Icons.alert, color: "red" })),
              ],
            },
            actions: [
              action("Ping Again", () => refresh(), { icon: Icons.refresh, shortcut: "<Ctrl>r" }),
              copy(
                `${host}${s.address ? ` (${s.address})` : ""}: min/avg/max ${ms(s.min)}/${ms(s.avg)}/${ms(s.max)}, ${
                  loss ?? "?"
                }% loss`,
                "Copy Statistics",
                { section: "Copy" },
              ),
              ...(s.address ? [copy(s.address, "Copy Address", { section: "Copy" })] : []),
            ],
          };
          const replies = s.replies.map((r): Item => {
            const rq = latencyQuality(r.time);
            return {
              id: `ping:${r.seq}`,
              title: ms(r.time),
              subtitle: `Reply ${r.seq}`,
              icon: { source: Icons.dot, tint: rq.color },
              section: "Replies",
              accessories: r.ttl ? [{ text: `ttl ${r.ttl}` }] : [],
              actions: [action("Ping Again", () => refresh(), { icon: Icons.refresh })],
            };
          });
          yield [head, ...replies];
        }
      } catch (e) {
        if (e instanceof Missing) yield [await missingItem("ping", "Pinging a host")];
        else throw e;
      }
    },
  });
}

// ---------------------------------------------------------------------------
// Whois

export async function whoisItems(host: string, ctx: Context): Promise<Item[]> {
  let w;
  try {
    w = await whois(host, ctx.signal);
  } catch (e) {
    if (e instanceof Missing) return [await missingItem("whois", "Looking up the owner of a domain or IP")];
    throw e;
  }
  if (!w.fields.length && !w.nameServers.length) {
    return [{
      id: "whois:none",
      title: `No whois record for ${host}`,
      subtitle: w.raw.split("\n").find((l) => l.trim() && !/^[%#]/.test(l))?.trim(),
      icon: { source: Icons.alert, tint: "gray" },
      detail: { markdown: `\`\`\`\n${w.raw.slice(0, 4000)}\n\`\`\`` },
    }];
  }
  const expires = w.fields.find((f) => f.label === "Expires")?.value;
  const days = daysUntil(expires);
  const raw = action("Show Raw Output", () =>
    detail({
      title: `whois ${host}`,
      markdown: `\`\`\`\n${w.raw.slice(0, 20000)}\n\`\`\``,
      actions: [copy(w.raw, "Copy Raw Output")],
    }), { icon: Icons.text, shortcut: "<Ctrl>o" });
  const summary: Metadata[] = [
    ...w.fields.map((f) => meta.text(f.label, /Created|Updated|Expires/.test(f.label) ? shortDate(f.value) : f.value)),
    ...(w.nameServers.length ? [meta.tags("Name servers", w.nameServers.slice(0, 6))] : []),
    ...(w.statuses.length ? [meta.tags("Status", w.statuses.slice(0, 6))] : []),
  ];
  const fieldItems = w.fields.map((f): Item => {
    const date = /Created|Updated|Expires/.test(f.label);
    const warn = f.label === "Expires" && days !== undefined && days < 30;
    return {
      id: `whois:${f.label}`,
      title: date ? shortDate(f.value) : f.value,
      subtitle: f.label,
      icon: {
        source: date
          ? Icons.calendar
          : f.label === "Registrar"
          ? Icons.shield
          : f.label === "Abuse"
          ? Icons.mail
          : Icons.info,
        tint: warn ? "red" : "blue",
      },
      section: isIP(host) ? "Network" : "Domain",
      accessories: f.label === "Expires" && days !== undefined
        ? [{ tag: days < 0 ? "Expired" : `in ${days} days`, color: days < 30 ? "red" : days < 90 ? "orange" : "green" }]
        : [],
      detail: { metadata: summary },
      actions: [copy(f.value, `Copy ${f.label}`), raw, copy(w.raw, "Copy Raw Output", { section: "Copy" })],
    };
  });
  const nsItems = w.nameServers.map((ns): Item => ({
    id: `whois:ns:${ns}`,
    title: ns,
    subtitle: "Name server",
    icon: { source: Icons.server, tint: "green" },
    section: "Name Servers",
    detail: { metadata: summary },
    actions: [
      copy(ns, "Copy Name Server"),
      action(`Look Up ${ns}`, (c) => dnsView(ns, ["A", "AAAA"], c), { icon: Icons.search }),
      raw,
    ],
  }));
  return [...fieldItems, ...nsItems];
}

export function whoisView(host: string, ctx: Context): ListSpec {
  return list({
    title: `Whois · ${host}`,
    placeholder: "Filter fields…",
    status: `whois ${host}`,
    items: () => whoisItems(host, ctx),
  });
}

// ---------------------------------------------------------------------------
// Speed test

export interface SpeedResult {
  down: number;
  up: number;
  latency: number;
  jitter: number;
  at: number;
}

export const lastSpeed = async () => (await storage.get("speed")) as unknown as SpeedResult | undefined;

/** The speed the connection sustains: 90th percentile of the larger requests. */
const sustained = (speeds: number[]) => percentile(speeds.length > 1 ? speeds.slice(1) : speeds, 0.9);

export const speedLine = (r: SpeedResult) => `↓ ${formatSpeed(r.down)} · ↑ ${formatSpeed(r.up)} · ${ms(r.latency)}`;

function speedItems(p: SpeedProgress): Item[] {
  const done = p.phase === "done";
  const down = p.down.length ? sustained(p.down) : p.current ?? 0;
  const up = p.up.length ? sustained(p.up) : 0;
  const lat = median(p.latencies);
  const jit = jitter(p.latencies);
  const again = action("Run Again", () => refresh(), { icon: Icons.refresh, shortcut: "<Ctrl>r" });
  const phaseTitle = {
    latency: "Measuring latency…",
    download: "Measuring download…",
    upload: "Measuring upload…",
    done: "Done",
  }[p.phase];
  const common: Metadata[] = [
    meta.progress("Progress", p.progress, done ? "Done" : phaseTitle),
    meta.text("Downloaded", formatBytes(p.bytesDown), { icon: Icons.download }),
    meta.text("Uploaded", formatBytes(p.bytesUp), { icon: Icons.upload }),
    meta.separator(),
    meta.link("Server", "speed.cloudflare.com", "https://speed.cloudflare.com"),
  ];
  const stats = [
    { label: "Download", value: down ? formatSpeed(down) : "…", color: "blue" as Color },
    { label: "Upload", value: up ? formatSpeed(up) : "…", color: "purple" as Color },
    { label: "Latency", value: p.latencies.length ? ms(lat) : "…" },
    { label: "Jitter", value: p.latencies.length > 1 ? ms(jit) : "…" },
  ];
  const summary = done ? `↓ ${formatSpeed(down)} · ↑ ${formatSpeed(up)} · ${ms(lat)} latency` : "";
  const row = (
    id: string,
    title: string,
    value: string,
    icon: string,
    tint: Color,
    active: boolean,
    finished: boolean,
    extra: Metadata[] = [],
  ): Item => ({
    id,
    title,
    subtitle: value,
    icon: { source: icon, tint: finished ? tint : active ? tint : "gray" },
    section: "Speed Test",
    accessories: active && !done
      ? [{ tag: "Measuring…", color: "blue" }]
      : finished
      ? [{ icon: { source: Icons.check, tint: "green" } }]
      : [],
    detail: { stats, markdown: done ? speedVerdict(down) : undefined, metadata: [...extra, ...common] },
    actions: [again, ...(summary ? [copy(summary, "Copy Results")] : [])],
  });
  return [
    row(
      "download",
      "Download",
      down ? formatSpeed(down) : "Waiting",
      Icons.download,
      "blue",
      p.phase === "download",
      p.down.length > 0 && p.phase !== "download",
      p.down.map((s, i) => meta.text(`Request ${i + 1}`, formatSpeed(s))),
    ),
    row(
      "upload",
      "Upload",
      up ? formatSpeed(up) : "Waiting",
      Icons.upload,
      "purple",
      p.phase === "upload",
      done,
      p.up.map((s, i) => meta.text(`Request ${i + 1}`, formatSpeed(s))),
    ),
    row(
      "latency",
      "Latency",
      p.latencies.length ? `${ms(lat)} · jitter ${ms(jit)}` : "Measuring…",
      Icons.activity,
      latencyQuality(lat).color,
      p.phase === "latency",
      p.phase !== "latency",
      [
        meta.text("Quality", latencyQuality(lat).text, { color: latencyQuality(lat).color }),
        meta.text("Samples", p.latencies.map((l) => l.toFixed(0)).join(", ")),
      ],
    ),
  ];
}

export function speedView(): ListSpec {
  let status = "Measuring latency…";
  return list({
    title: "Speed Test",
    status: () => status,
    async *items({ signal }) {
      let last: SpeedProgress | undefined;
      try {
        for await (const p of speedTest(signal)) {
          last = p;
          status = p.phase === "done"
            ? `Done · ${formatBytes(p.bytesDown + p.bytesUp)} transferred`
            : `${Math.round(p.progress * 100)} % · ${p.phase === "latency" ? "latency" : p.phase}`;
          yield speedItems(p);
        }
      } catch (e) {
        if (signal.aborted) return;
        yield [errorItem("Speed test failed", e), ...(last ? speedItems(last) : [])];
        return;
      }
      if (last) {
        const r: SpeedResult = {
          down: sustained(last.down),
          up: sustained(last.up),
          latency: median(last.latencies),
          jitter: jitter(last.latencies),
          at: Date.now(),
        };
        await storage.set("speed", r as any);
        updateCommandMetadata({ subtitle: speedLine(r) }).catch(() => {});
      }
    },
  });
}
