// Reading the network: ip, avahi-browse, nmap (or ping) sweeps, getent and the
// system's IEEE vendor list.

import { exec } from "@backslash/api";
import {
  type Device,
  hostsOf,
  mergeDevices,
  type Neighbor,
  ouiPrefix,
  parseAddrs,
  parseAvahi,
  parseGateways,
  parseGetent,
  parseIpNeigh,
  parseNmap,
  parseOuiDb,
  parseProcArp,
  type Service,
  type Subnet,
  sweepTarget,
} from "./lib.ts";

/** Where systems keep the IEEE OUI list (same list as `read` in the manifest). */
export const OUI_FILES = [
  "/usr/share/hwdata/oui.txt",
  "/usr/share/ieee-data/oui.txt",
  "/usr/share/misc/oui.txt",
  "/usr/share/nmap/nmap-mac-prefixes",
  "/usr/share/wireshark/manuf",
];

/** Output of a program, or "" when it is missing, fails or takes too long. */
async function output(program: string, args: string[], ms: number, signal?: AbortSignal): Promise<string> {
  try {
    const timeout = AbortSignal.timeout(ms);
    const out = await new Deno.Command(program, {
      args,
      stdin: "null",
      stdout: "piped",
      stderr: "null",
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    }).output();
    return new TextDecoder().decode(out.stdout);
  } catch {
    return "";
  }
}

export async function installed(program: string): Promise<boolean> {
  try {
    await new Deno.Command(program, { args: ["--version"], stdin: "null", stdout: "null", stderr: "null" }).output();
    return true;
  } catch {
    return false;
  }
}

export async function neighbors(signal?: AbortSignal): Promise<Neighbor[]> {
  const json = await output("ip", ["-j", "neigh"], 3000, signal);
  if (json.trim()) return parseIpNeigh(json);
  return parseProcArp(await Deno.readTextFile("/proc/net/arp").catch(() => ""));
}

export async function subnets(signal?: AbortSignal): Promise<Subnet[]> {
  return parseAddrs(await output("ip", ["-j", "-4", "addr"], 3000, signal));
}

export async function gateways(signal?: AbortSignal): Promise<string[]> {
  return parseGateways(await output("ip", ["-j", "route", "show", "default"], 3000, signal));
}

/** mDNS / DNS-SD services, resolved; empty without avahi-daemon. */
export async function services(signal?: AbortSignal): Promise<Service[]> {
  return parseAvahi(await output("avahi-browse", ["-a", "-p", "-r", "-t"], 6000, signal));
}

/** Host names for addresses: /etc/hosts, mDNS (nss-mdns) and reverse DNS, as the system resolves them. */
export async function names(ips: string[], signal?: AbortSignal): Promise<Map<string, string>> {
  if (!ips.length) return new Map();
  return parseGetent(await output("getent", ["hosts", ...ips], 4000, signal));
}

/** The vendors of these MAC addresses from the system's IEEE list, if it has one. */
export async function ouiDb(macs: string[]): Promise<Map<string, string> | undefined> {
  const wanted = new Set(macs.map(ouiPrefix));
  for (const file of OUI_FILES) {
    const text = await Deno.readTextFile(file).catch(() => undefined);
    if (text) return parseOuiDb(text, wanted);
  }
  return undefined;
}

/**
 * Wakes up every address of the local networks (a /24 at most) so they show
 * in the neighbor table: `nmap -sn`, or 254 pings when nmap isn't installed.
 */
export async function sweep(subs: Subnet[], signal?: AbortSignal): Promise<{ ip: string; host?: string }[]> {
  const targets = [...new Set(subs.map(sweepTarget))];
  if (!targets.length) return [];
  if (await installed("nmap")) {
    return parseNmap(await output("nmap", ["-sn", "-n", "-T4", "-oG", "-", ...targets], 60_000, signal));
  }
  const queue = targets.flatMap(hostsOf);
  const up: { ip: string }[] = [];
  await Promise.all(Array.from({ length: 48 }, async () => {
    for (let ip = queue.shift(); ip; ip = queue.shift()) {
      if (signal?.aborted) return;
      try {
        const out = await new Deno.Command("ping", {
          args: ["-c", "1", "-W", "1", "-n", ip],
          stdin: "null",
          stdout: "null",
          stderr: "null",
        }).output();
        if (out.success) up.push({ ip });
      } catch {
        return;
      }
    }
  }));
  return up;
}

/** Everything about the devices of the network; `swept` adds a ping sweep first. */
export async function devices(o: { sweep: boolean; signal?: AbortSignal }): Promise<Device[]> {
  const [subs, gws] = await Promise.all([subnets(o.signal), gateways(o.signal)]);
  const [swept, svc] = await Promise.all([
    o.sweep ? sweep(subs, o.signal) : Promise.resolve([]),
    services(o.signal),
  ]);
  const neigh = await neighbors(o.signal);
  const ips = [...new Set([...neigh.map((n) => n.ip), ...swept.map((s) => s.ip)])].filter((ip) => ip.includes("."));
  const [resolved, db] = await Promise.all([names(ips, o.signal), ouiDb(neigh.map((n) => n.mac))]);
  return mergeDevices({ neighbors: neigh, services: svc, names: resolved, swept, gateways: gws, own: subs, ouiDb: db });
}

export async function ping(ip: string): Promise<string> {
  try {
    return await exec("ping", ["-c", "4", "-W", "1", "-n", ip], { signal: AbortSignal.timeout(10_000) });
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) throw new Error("ping is not installed: install iputils-ping");
    // A host that doesn't answer makes ping exit 1, with its summary.
    return (e as Error).message.replace(/^ping exited with \d+: /, "");
  }
}
