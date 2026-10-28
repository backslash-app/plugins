// Asking UPower, Solaar and HeadsetControl, whichever are installed.

import { merge, parseHeadsetJson, parseHeadsetText, parseSolaar, parseUpowerDump, type Peripheral } from "./lib.ts";

interface Output {
  code: number;
  stdout: string;
  stderr: string;
}

async function sh(program: string, args: string[], timeout = 15_000): Promise<Output> {
  const { code, stdout, stderr } = await new Deno.Command(program, {
    args,
    env: { LC_ALL: "C" },
    stdin: "null",
    stdout: "piped",
    stderr: "piped",
    signal: AbortSignal.timeout(timeout),
  }).output();
  const text = (b: Uint8Array) => new TextDecoder().decode(b).trim();
  return { code, stdout: text(stdout), stderr: text(stderr) };
}

const missing = (e: unknown) => e instanceof Deno.errors.NotFound || e instanceof Deno.errors.NotCapable;

type Result = { devices: Peripheral[]; installed: boolean; error?: string };

async function tool(program: string, run: () => Promise<Peripheral[]>): Promise<Result> {
  try {
    return { devices: await run(), installed: true };
  } catch (e) {
    if (missing(e)) return { devices: [], installed: false };
    return { devices: [], installed: true, error: `${program}: ${(e as Error).message}` };
  }
}

async function upower(): Promise<Peripheral[]> {
  const o = await sh("upower", ["--dump"]);
  if (o.code !== 0) throw new Error(o.stderr || "UPower is not running");
  return parseUpowerDump(o.stdout);
}

async function solaar(): Promise<Peripheral[]> {
  // Slow: it asks each device in turn.
  const o = await sh("solaar", ["show"], 20_000);
  if (o.code !== 0) {
    if (/no (supported )?(device|receiver)/i.test(o.stderr + o.stdout)) return [];
    throw new Error(o.stderr.split("\n").pop() || `exited with ${o.code}`);
  }
  return parseSolaar(o.stdout);
}

const noHeadset = (o: Output) => /No supported (device|headset)|device_count"?\s*:\s*0/i.test(o.stdout + o.stderr);

async function headsets(): Promise<Peripheral[]> {
  const json = await sh("headsetcontrol", ["-b", "-o", "json"]);
  if (json.stdout.startsWith("{")) return parseHeadsetJson(json.stdout);
  if (noHeadset(json)) return [];
  // HeadsetControl 2.x has no JSON output.
  const text = await sh("headsetcontrol", ["-b"]);
  if (noHeadset(text)) return [];
  return parseHeadsetText(`${text.stdout}\n${text.stderr}`);
}

export interface Loaded {
  devices: Peripheral[];
  /** No tool at all. */
  nothing: boolean;
  errors: string[];
}

export async function load(): Promise<Loaded> {
  const [u, s, h] = await Promise.all([
    tool("upower", upower),
    tool("solaar", solaar),
    tool("headsetcontrol", headsets),
  ]);
  return {
    devices: merge(u.devices, s.devices, h.devices),
    nothing: !u.installed && !s.installed && !h.installed,
    errors: [u.error, s.error, h.error].filter((e): e is string => !!e),
  };
}

async function headsetcontrol(args: string[]): Promise<void> {
  let o: Output;
  try {
    o = await sh("headsetcontrol", args);
  } catch (e) {
    if (missing(e)) throw new Error("HeadsetControl is not installed");
    throw e;
  }
  if (o.code !== 0 || /not supported|failed/i.test(o.stderr)) {
    throw new Error(o.stderr.split("\n").pop() || "The headset didn't accept the change: is it on?");
  }
}

/** 0 (off) to 128. */
export const setSidetone = (level: number) => headsetcontrol(["-s", String(level)]);
export const setLights = (on: boolean) => headsetcontrol(["-l", on ? "1" : "0"]);
/** Minutes before the headset turns itself off; 0 never. */
export const setInactiveTime = (minutes: number) => headsetcontrol(["-i", String(minutes)]);
