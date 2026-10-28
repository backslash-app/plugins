// Everything that touches the network or runs a program.

import { exec } from "@backslash/api";
import {
  type DnsAnswer,
  DOWNLOAD_STEPS,
  type Family,
  type Geo,
  type Interface,
  isIP,
  osFamily,
  parseDig,
  parseDoh,
  parseInterfaces,
  parseIpinfo,
  parsePing,
  parseWhois,
  type PingStats,
  type RecordType,
  reverseName,
  serverTime,
  UPLOAD_STEPS,
  type Whois,
} from "./lib.ts";

export class Missing extends Error {
  constructor(public program: string) {
    super(`${program} is not installed`);
  }
}

const notFound = (e: unknown) =>
  e instanceof Deno.errors.NotFound || e instanceof Deno.errors.PermissionDenied ||
  e instanceof Deno.errors.NotCapable;

/** Runs a program; Missing when it isn't installed. */
async function run(program: string, args: string[], signal?: AbortSignal): Promise<string> {
  try {
    return await exec(program, args, { signal });
  } catch (e) {
    if (notFound(e)) throw new Missing(program);
    throw e;
  }
}

export async function family(): Promise<Family | undefined> {
  return osFamily(await Deno.readTextFile("/etc/os-release").catch(() => ""));
}

async function json(url: string, signal?: AbortSignal, headers: Record<string, string> = {}): Promise<unknown> {
  const res = await fetch(url, { signal, headers: { Accept: "application/json", ...headers } });
  if (!res.ok) {
    await res.body?.cancel();
    throw new Error(`${new URL(url).hostname} answered ${res.status}`);
  }
  return await res.json();
}

// ---------------------------------------------------------------------------
// Public IP

/** Public IPv4 and IPv6 (each undefined when there is none, or it can't be reached). */
export async function publicIps(signal?: AbortSignal): Promise<{ v4?: string; v6?: string; error?: string }> {
  const get = (host: string) =>
    json(
      `https://${host}?format=json`,
      AbortSignal.any([signal ?? new AbortController().signal, AbortSignal.timeout(6000)]),
    )
      .then((j) => String((j as { ip: string }).ip))
      .catch((e: Error) => e);
  const [v4, v6] = await Promise.all([get("api.ipify.org"), get("api6.ipify.org")]);
  return {
    v4: typeof v4 === "string" ? v4 : undefined,
    v6: typeof v6 === "string" && v6.includes(":") ? v6 : undefined,
    error: typeof v4 !== "string" && typeof v6 !== "string" ? (v4 as Error).message : undefined,
  };
}

/** Where an address is, from ipinfo.io (50 000 lookups a month without a token). */
export async function geolocate(ip: string, token?: string, signal?: AbortSignal): Promise<Geo> {
  const url = `https://ipinfo.io/${encodeURIComponent(ip)}/json`;
  return parseIpinfo(await json(url, signal, token ? { Authorization: `Bearer ${token}` } : {}));
}

// ---------------------------------------------------------------------------
// Interfaces

export async function interfaces(): Promise<Interface[]> {
  const [addr, route, route6] = await Promise.all([
    run("ip", ["-j", "-s", "addr"]),
    run("ip", ["-j", "route"]).catch(() => "[]"),
    run("ip", ["-j", "-6", "route"]).catch(() => "[]"),
  ]);
  const routes = [...JSON.parse(route || "[]"), ...JSON.parse(route6 || "[]")];
  return parseInterfaces(addr, JSON.stringify(routes));
}

// ---------------------------------------------------------------------------
// DNS

/**
 * One record type, over DNS-over-HTTPS (Cloudflare), or with dig through the
 * system resolver when `resolver` is "system" or Cloudflare can't be reached.
 */
export async function lookup(
  host: string,
  type: RecordType,
  resolver: string,
  signal?: AbortSignal,
): Promise<DnsAnswer & { via: string }> {
  const name = type === "PTR" && isIP(host) ? reverseName(host) : host;
  if (resolver !== "system") {
    try {
      const url = `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=${type}`;
      return {
        ...parseDoh(type, await json(url, signal, { Accept: "application/dns-json" })),
        via: "Cloudflare (DoH)",
      };
    } catch (e) {
      if (signal?.aborted) throw e;
      // Fall back on the system resolver.
    }
  }
  const out = await run("dig", ["+noall", "+answer", "+comments", "+time=3", "+tries=1", "--", name, type], signal);
  return { ...parseDig(type, out), via: "System resolver (dig)" };
}

// ---------------------------------------------------------------------------
// Ping

/** Pings `count` times, yielding the statistics after each line. */
export async function* ping(host: string, count: number, signal: AbortSignal): AsyncGenerator<PingStats> {
  let child: Deno.ChildProcess;
  try {
    child = new Deno.Command("ping", {
      args: ["-c", String(count), "-W", "3", "--", host],
      stdin: "null",
      stdout: "piped",
      stderr: "piped",
      signal,
    }).spawn();
  } catch (e) {
    if (notFound(e)) throw new Missing("ping");
    throw e;
  }
  const stderr = new Response(child.stderr).text();
  let out = "";
  const decoder = new TextDecoder();
  for await (const chunk of child.stdout) {
    out += decoder.decode(chunk, { stream: true });
    yield parsePing(host, out);
  }
  const status = await child.status;
  const err = (await stderr).trim();
  const stats = parsePing(host, `${out}\n${err}`);
  if (!status.success && !stats.transmitted && err) {
    stats.errors = stats.errors.length ? stats.errors : [err.replace(/^ping:\s*/, "")];
  }
  yield stats;
}

// ---------------------------------------------------------------------------
// Whois

export async function whois(host: string, signal?: AbortSignal): Promise<Whois> {
  // Domains are looked up without "www.": registries know the registered name.
  const query = isIP(host) ? host : host.replace(/^www\./, "");
  let out: string;
  try {
    out = await run("whois", ["--", query], signal);
  } catch (e) {
    // whois exits with 1 for "no match" while printing the answer.
    if (e instanceof Missing) throw e;
    const m = String((e as Error).message).match(/exited with \d+: ([\s\S]*)/);
    if (!m) throw e;
    out = m[1];
  }
  return parseWhois(out);
}

// ---------------------------------------------------------------------------
// Speed test (speed.cloudflare.com)

export interface SpeedProgress {
  phase: "latency" | "download" | "upload" | "done";
  /** Unloaded latencies, ms. */
  latencies: number[];
  /** Speed of each finished request, bit/s. */
  down: number[];
  up: number[];
  /** Speed of the request in progress. */
  current?: number;
  bytesDown: number;
  bytesUp: number;
  /** 0 to 1, for the whole test. */
  progress: number;
  error?: string;
}

const SPEED = "https://speed.cloudflare.com";
const MAX_STEP_MS = 4000;
const PHASE_BUDGET_MS = 12000;

export async function* speedTest(signal: AbortSignal): AsyncGenerator<SpeedProgress> {
  const p: SpeedProgress = { phase: "latency", latencies: [], down: [], up: [], bytesDown: 0, bytesUp: 0, progress: 0 };
  const snapshot = () => ({ ...p, latencies: [...p.latencies], down: [...p.down], up: [...p.up] });
  yield snapshot();

  // Latency: time to the first byte of empty downloads, minus the server's own time.
  for (let i = 0; i < 10; i++) {
    const start = performance.now();
    const res = await fetch(`${SPEED}/__down?bytes=0`, { signal, cache: "no-store" });
    const first = performance.now();
    await res.arrayBuffer();
    p.latencies.push(Math.max(0.1, first - start - serverTime(res.headers.get("server-timing"))));
    p.progress = 0.1 * ((i + 1) / 10);
    if (i % 3 === 2) yield snapshot();
  }

  p.phase = "download";
  let phaseStart = performance.now();
  for (const [n, bytes] of DOWNLOAD_STEPS.entries()) {
    const res = await fetch(`${SPEED}/__down?bytes=${bytes}`, { signal, cache: "no-store" });
    if (!res.ok || !res.body) throw new Error(`speed.cloudflare.com answered ${res.status}`);
    const reader = res.body.getReader();
    const start = performance.now();
    let got = 0;
    let lastYield = start;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      got += value.byteLength;
      p.bytesDown += value.byteLength;
      const now = performance.now();
      if (now - lastYield > 300) {
        lastYield = now;
        p.current = (got * 8) / ((now - start) / 1000);
        p.progress = 0.1 + 0.5 * Math.min(1, (now - phaseStart) / PHASE_BUDGET_MS);
        yield snapshot();
      }
    }
    const took = Math.max(1, performance.now() - start);
    p.down.push((got * 8) / (took / 1000));
    p.current = undefined;
    const spent = performance.now() - phaseStart;
    p.progress = 0.1 + 0.5 * Math.min(1, spent / PHASE_BUDGET_MS);
    yield snapshot();
    if (took > MAX_STEP_MS || spent > PHASE_BUDGET_MS || n === DOWNLOAD_STEPS.length - 1) break;
  }

  p.phase = "upload";
  p.progress = 0.6;
  yield snapshot();
  phaseStart = performance.now();
  const latency = p.latencies.length ? [...p.latencies].sort((a, b) => a - b)[p.latencies.length >> 1] : 0;
  for (const [n, bytes] of UPLOAD_STEPS.entries()) {
    const body = new Uint8Array(bytes);
    const start = performance.now();
    const res = await fetch(`${SPEED}/__up`, {
      method: "POST",
      body,
      signal,
      headers: { "Content-Type": "application/octet-stream" },
    });
    await res.arrayBuffer();
    if (!res.ok) throw new Error(`speed.cloudflare.com answered ${res.status}`);
    const took = Math.max(1, performance.now() - start - latency - serverTime(res.headers.get("server-timing")));
    p.bytesUp += bytes;
    p.up.push((bytes * 8) / (took / 1000));
    const spent = performance.now() - phaseStart;
    p.progress = 0.6 + 0.4 * Math.min(1, spent / PHASE_BUDGET_MS);
    yield snapshot();
    if (took > MAX_STEP_MS || spent > PHASE_BUDGET_MS || n === UPLOAD_STEPS.length - 1) break;
  }
  p.phase = "done";
  p.progress = 1;
  yield snapshot();
}
