import { action, type Context, Icons, type Item, list } from "@backslash/api";
import { defaultTypes, formatSpeed, isIP, parseIntent } from "../lib.ts";
import {
  dnsResultItems,
  dnsView,
  interfaceItems,
  lastSpeed,
  pingView,
  publicIpItems,
  speedLine,
  speedView,
  whoisItems,
  whoisView,
} from "../ui.ts";

const TOOLS: { id: string; title: string; example: string; icon: string; about: string }[] = [
  {
    id: "dns",
    title: "DNS Lookup",
    example: "dns example.com mx",
    icon: Icons.search,
    about: "A, AAAA, CNAME, MX, NS and TXT records, or the types you name (SOA, CAA, SRV, PTR).",
  },
  {
    id: "ping",
    title: "Ping",
    example: "ping 1.1.1.1",
    icon: Icons.activity,
    about: "Round-trip times, jitter and packet loss.",
  },
  {
    id: "whois",
    title: "Whois",
    example: "whois example.com",
    icon: Icons.shield,
    about: "Registrar, dates and name servers of a domain, or the network an IP belongs to.",
  },
  {
    id: "ip",
    title: "Public IP",
    example: "ip",
    icon: Icons.globe,
    about: "Your public IPv4 and IPv6 and where they are.",
  },
  {
    id: "interfaces",
    title: "Local Interfaces",
    example: "interfaces",
    icon: Icons.plug,
    about: "Addresses, gateways and traffic of your network interfaces.",
  },
];

function toolItems(speed: string | undefined): Item[] {
  return [
    {
      id: "tool:speed",
      title: "Speed Test",
      subtitle: speed ? `Last: ${speed}` : "Download, upload and latency",
      icon: { source: Icons.rocket, tint: "orange" },
      section: "Tools",
      keywords: ["speed", "speedtest", "débit", "bandwidth"],
      detail: {
        markdown:
          "Measures download and upload with Cloudflare's speed test servers. Takes about 20 seconds and transfers up to a few hundred megabytes on fast connections.",
      },
      actions: [action("Start Speed Test", () => speedView(), { icon: Icons.rocket })],
    },
    ...TOOLS.map((t): Item => ({
      id: `tool:${t.id}`,
      title: t.title,
      subtitle: `Type “${t.example}”`,
      icon: { source: t.icon, tint: "blue" },
      section: "Tools",
      keywords: [t.id, t.example],
      detail: { markdown: `${t.about}\n\nType \`${t.example}\` in the search bar.` },
    })),
  ];
}

export default (ctx: Context) =>
  list({
    placeholder: "dns example.com · ping 1.1.1.1 · whois x.org · speed · ip",
    status: (items) => items.find((i) => i.section === "Public IP")?.title ?? "Network Tools",
    async search(query, c) {
      const intent = parseIntent(query);
      const host = "host" in intent ? intent.host : "";
      switch (intent.kind) {
        case "home": {
          const last = await lastSpeed();
          const [ips, ifs] = await Promise.all([
            publicIpItems(c),
            interfaceItems("Local Network", false),
          ]);
          return [...ips, ...ifs, ...toolItems(last ? speedLine(last) : undefined)];
        }
        case "ip":
          return publicIpItems(c);
        case "interfaces":
          return interfaceItems();
        case "speed": {
          const last = await lastSpeed();
          return [{
            id: "speed",
            title: "Start Speed Test",
            subtitle: last ? `Last: ↓ ${formatSpeed(last.down)} · ↑ ${formatSpeed(last.up)}` : "About 20 seconds",
            icon: { source: Icons.rocket, tint: "orange" },
            actions: [action("Start Speed Test", () => speedView(), { icon: Icons.rocket })],
          }];
        }
        case "dns":
          return dnsResultItems(intent.host, intent.types, c);
        case "whois":
          return whoisItems(intent.host, c);
        case "ping":
          return [{
            id: `ping:${host}`,
            title: `Ping ${host}`,
            subtitle: "Press Enter to start",
            icon: { source: Icons.activity, tint: "blue" },
            actions: [action(`Ping ${host}`, () => pingView(host, ctx), { icon: Icons.activity })],
          }];
        case "host": {
          const tools: Item[] = [
            {
              id: `ping:${host}`,
              title: `Ping ${host}`,
              icon: { source: Icons.activity, tint: "blue" },
              section: "Tools",
              actions: [action(`Ping ${host}`, () => pingView(host, ctx), { icon: Icons.activity })],
            },
            {
              id: `whois:${host}`,
              title: `Whois ${host}`,
              icon: { source: Icons.shield, tint: "blue" },
              section: "Tools",
              actions: [action(`Whois ${host}`, () => whoisView(host, ctx), { icon: Icons.shield })],
            },
            {
              id: `dns:${host}`,
              title: `All DNS Records of ${host}`,
              icon: { source: Icons.search, tint: "blue" },
              section: "Tools",
              actions: [
                action("Look Up", () => dnsView(host, isIP(host) ? ["PTR"] : [...defaultTypes, "SOA", "CAA"], ctx), {
                  icon: Icons.search,
                }),
              ],
            },
          ];
          const records = await dnsResultItems(host, isIP(host) ? ["PTR"] : ["A", "AAAA", "CNAME"], c).catch(() => []);
          return [...records, ...tools];
        }
        case "invalid":
          return [{
            id: "invalid",
            title: intent.text
              ? `“${intent.text}” isn't a host name or an IP address`
              : `Type a host after “${intent.tool}”`,
            subtitle: `e.g. ${intent.tool} example.com`,
            icon: { source: Icons.info, tint: "gray" },
          }];
      }
    },
  });
