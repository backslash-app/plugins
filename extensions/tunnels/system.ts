// Tunnel units (systemd-run --user), their logs and public URLs, the listening ports.

import { exec } from "@backslash/api";
import {
  freeWebPort,
  type Listener,
  ngrokLogUrl,
  type NgrokTunnel,
  parseNgrokApi,
  parseSs,
  parseSystemdTime,
  parseUnits,
  type Provider,
  startArgs,
  trycloudflareUrl,
  tunnelError,
  unitName,
  type UnitState,
} from "./lib.ts";

export class NoSession extends Error {}

const busError = (e: unknown) => /Failed to connect to bus|No medium found|\$DBUS_SESSION_BUS_ADDRESS/i.test(String(e));

async function systemctl(args: string[]): Promise<string> {
  try {
    return await exec("systemctl", ["--user", ...args]);
  } catch (e) {
    if (e instanceof Deno.errors.NotFound || busError(e)) {
      throw new NoSession("Tunnels run as systemd user services, and there is no systemd user session here");
    }
    throw e;
  }
}

const installed = new Map<Provider, Promise<boolean>>();

/** Whether ngrok or cloudflared can be started. */
export function available(provider: Provider): Promise<boolean> {
  if (!installed.has(provider)) {
    installed.set(
      provider,
      exec(provider, [provider === "ngrok" ? "version" : "--version"]).then(
        () => true,
        (e) => !(e instanceof Deno.errors.NotFound),
      ),
    );
  }
  return installed.get(provider)!;
}

export async function units(): Promise<UnitState[]> {
  const out = await systemctl(["list-units", "--all", "--plain", "--no-legend", "backslash-tunnel-*"]);
  return parseUnits(out).filter((u) => u.active === "active" || u.active === "activating");
}

export async function startedAt(unit: string): Promise<number | undefined> {
  const out = await systemctl(["show", "-p", "ActiveEnterTimestamp", "--value", `${unit}.service`]).catch(() => "");
  return parseSystemdTime(out);
}

export const journal = (unit: string, lines = 300) =>
  exec("journalctl", ["--user", "-u", `${unit}.service`, "-o", "cat", "--no-pager", "-n", String(lines)]).catch(() =>
    ""
  );

/** ngrok's agent API: the public URL and traffic counters. */
async function ngrokApi(webPort: number): Promise<NgrokTunnel[] | undefined> {
  try {
    const res = await fetch(`http://127.0.0.1:${webPort}/api/tunnels`, { signal: AbortSignal.timeout(2000) });
    return res.ok ? parseNgrokApi(await res.json()) : undefined;
  } catch {
    return undefined;
  }
}

export interface Live {
  unit: UnitState;
  url?: string;
  ngrok?: NgrokTunnel;
  started?: number;
  error?: string;
}

export async function describe(unit: UnitState): Promise<Live> {
  const started = await startedAt(unit.name);
  if (unit.provider === "ngrok") {
    const api = await ngrokApi(unit.webPort ?? 4040);
    if (api?.length) return { unit, url: api[0].publicUrl, ngrok: api[0], started };
    const log = await journal(unit.name);
    return { unit, url: ngrokLogUrl(log), started, error: tunnelError("ngrok", log) };
  }
  const log = await journal(unit.name);
  return { unit, url: trycloudflareUrl(log), started, error: tunnelError("cloudflared", log) };
}

export async function listening(): Promise<Listener[]> {
  return parseSs(await exec("ss", ["-Hltnp"]).catch(() => ""));
}

/**
 * Starts a tunnel and waits for its public URL (cloudflared takes a few
 * seconds). Throws with the reason when it stops right away.
 */
export async function start(provider: Provider, port: number, signal?: AbortSignal): Promise<string | undefined> {
  if (!await available(provider)) throw new Error(`${provider} is not installed`);
  const running = await units();
  if (running.some((u) => u.port === port && u.provider === provider)) {
    throw new Error(`:${port} is already shared with ${provider}`);
  }
  const webPort = provider === "ngrok" ? freeWebPort(running.filter((u) => u.provider === "ngrok")) : undefined;
  if (provider === "ngrok" && !webPort) throw new Error("Too many ngrok tunnels: stop one first");
  const name = unitName(provider, port, webPort);
  const env = { PATH: Deno.env.get("PATH"), HOME: Deno.env.get("HOME") };
  try {
    await exec("systemd-run", startArgs(provider, port, env, webPort));
  } catch (e) {
    if (e instanceof Deno.errors.NotFound || busError(e)) {
      throw new NoSession("Tunnels run as systemd user services, and there is no systemd user session here");
    }
    throw e;
  }
  const deadline = Date.now() + 25_000;
  while (Date.now() < deadline && !signal?.aborted) {
    await new Promise((r) => setTimeout(r, 600));
    const unit = (await units()).find((u) => u.name === name);
    const log = await journal(name);
    if (!unit) throw new Error(tunnelError(provider, log) ?? `${provider} stopped right away`);
    const live = await describe(unit);
    if (live.url) return live.url;
    if (live.error && provider === "ngrok") {
      await stop(name);
      throw new Error(live.error);
    }
  }
  return undefined;
}

export async function stop(unit: string): Promise<void> {
  await systemctl(["stop", `${unit}.service`]);
}
