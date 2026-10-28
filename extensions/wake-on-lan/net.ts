// Sending magic packets, the neighbor table and reachability checks.

import { exec, storage } from "@backslash/api";
import dgram from "node:dgram";
import {
  dedupeNeighbors,
  type Machine,
  magicPacket,
  type Neighbor,
  parseBroadcasts,
  parseIpNeigh,
  parseProcArp,
  PROBE_PORTS,
  programArgs,
  PROGRAMS,
} from "./lib.ts";

/**
 * Where the machines can be, as declared in `[permissions] net` (kept equal
 * by a test): the local networks and Tailscale for pings and probes,
 * 0.0.0.0 to open the UDP socket and 255.255.255.255 for the broadcast.
 */
export const HOSTS = [
  "0.0.0.0",
  "255.255.255.255",
  "localhost",
  "*.local",
  "*.lan",
  "*.home.arpa",
  "*.ts.net",
  "10.0.0.0/8",
  "172.16.0.0/12",
  "192.168.0.0/16",
  "100.64.0.0/10",
];

// ---------------------------------------------------------------------------
// Storage

export async function machines(): Promise<Machine[]> {
  return (await storage.get<Machine[] & never>("machines")) ?? [];
}

export async function saveMachines(list: Machine[]): Promise<void> {
  await storage.set("machines", list as never);
}

export async function upsert(m: Machine): Promise<void> {
  const list = await machines();
  const i = list.findIndex((x) => x.id === m.id);
  if (i >= 0) list[i] = m;
  else list.push(m);
  await saveMachines(list);
}

// ---------------------------------------------------------------------------
// Sending

const isPermission = (e: unknown) => e instanceof Deno.errors.NotCapable || e instanceof Deno.errors.PermissionDenied;

/**
 * UDP broadcast from Deno. `Deno.listenDatagram` (only with --unstable-net)
 * sets SO_BROADCAST itself; otherwise node:dgram, with setBroadcast(true).
 */
async function sendUdp(packet: Uint8Array, address: string, port: number): Promise<void> {
  // deno-lint-ignore no-explicit-any
  const listen = (Deno as any).listenDatagram;
  if (typeof listen === "function") {
    const conn = listen({ transport: "udp", hostname: "0.0.0.0", port: 0 });
    try {
      for (let i = 0; i < 3; i++) await conn.send(packet, { transport: "udp", hostname: address, port });
    } finally {
      conn.close();
    }
    return;
  }
  const socket = dgram.createSocket({ type: "udp4" });
  try {
    await new Promise<void>((resolve, reject) => {
      socket.once("error", reject);
      socket.bind(0, () => resolve());
    });
    socket.setBroadcast(true);
    for (let i = 0; i < 3; i++) {
      await new Promise<void>((resolve, reject) =>
        socket.send(packet, port, address, (err) => err ? reject(err) : resolve())
      );
    }
  } finally {
    socket.close();
  }
}

/** Sends the magic packet; returns how ("Deno" or the program used). */
export async function wake(m: Machine): Promise<string> {
  const packet = magicPacket(m.mac, m.secureOn);
  let udpError: unknown;
  try {
    await sendUdp(packet, m.broadcast, m.port);
    return "Deno";
  } catch (e) {
    if (isPermission(e)) {
      throw new Error(`${m.broadcast} is outside the networks this extension may reach: use your LAN's broadcast`);
    }
    udpError = e;
  }
  for (const program of PROGRAMS) {
    try {
      await exec(program, programArgs(program, m));
      return program;
    } catch (e) {
      if (!(e instanceof Deno.errors.NotFound)) {
        if (program === "etherwake") throw new Error("etherwake needs root: install wakeonlan instead");
        throw e;
      }
    }
  }
  throw new Error(
    `Couldn't send the magic packet (${
      udpError instanceof Error ? udpError.message : udpError
    }), and none of wakeonlan, wol or etherwake is installed`,
  );
}

// ---------------------------------------------------------------------------
// Neighbors

export async function neighbors(signal?: AbortSignal): Promise<Neighbor[]> {
  try {
    return dedupeNeighbors(parseIpNeigh(await exec("ip", ["-j", "neigh"], { signal })));
  } catch {
    try {
      return dedupeNeighbors(parseProcArp(await Deno.readTextFile("/proc/net/arp")));
    } catch {
      return [];
    }
  }
}

export async function broadcasts(signal?: AbortSignal): Promise<Record<string, string>> {
  try {
    return parseBroadcasts(await exec("ip", ["-j", "-4", "addr"], { signal }));
  } catch {
    return {};
  }
}

// ---------------------------------------------------------------------------
// Reachability

async function tcpProbe(host: string, port: number, ms: number): Promise<boolean> {
  try {
    const conn = await Deno.connect({ hostname: host, port, signal: AbortSignal.timeout(ms) });
    conn.close();
    return true;
  } catch (e) {
    // A refused connection means the machine answered: it is up.
    if (e instanceof Deno.errors.ConnectionRefused) return true;
    if (isPermission(e)) throw e;
    return false;
  }
}

async function ping(host: string): Promise<boolean> {
  try {
    await exec("ping", ["-c", "1", "-W", "1", host], { signal: AbortSignal.timeout(2500) });
    return true;
  } catch {
    return false;
  }
}

export type Reachability = "online" | "offline" | "unknown" | "outside";

/** Up when a port answers (even refusing) or a ping comes back. */
export async function reachable(host: string | undefined, ms = 900): Promise<Reachability> {
  if (!host) return "unknown";
  try {
    const probes = PROBE_PORTS.map((p) => tcpProbe(host, p, ms));
    const anyUp = await new Promise<boolean>((resolve, reject) => {
      let left = probes.length;
      for (const p of probes) {
        p.then((up) => {
          if (up) resolve(true);
          else if (--left === 0) resolve(false);
        }, reject);
      }
    });
    if (anyUp) return "online";
  } catch (e) {
    if (isPermission(e)) return "outside";
  }
  return (await ping(host)) ? "online" : "offline";
}

/** The address to check: the saved host, else the IP the neighbor table has for the MAC. */
export function probeTarget(m: Machine, table: Neighbor[]): string | undefined {
  return m.host ?? table.find((n) => n.mac === m.mac)?.ip;
}
