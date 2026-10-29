// The system's tools: lsblk and zpool as the user, smartctl and btrfs as root through pkexec.

import { storage } from "@backslash/api";
import {
  btrfsFilesystems,
  COLUMNS,
  COLUMNS_SHORT,
  type Disk,
  explainTestError,
  parseLsblk,
  parseReadScript,
  parseZpoolList,
  parseZpoolStatus,
  pkexecError,
  type Pool,
  readScript,
  type RootReport,
  shellLine,
  ZPOOL_COLUMNS,
} from "./lib.ts";

interface Output {
  code: number;
  stdout: string;
  stderr: string;
}

export class NotInstalled extends Error {}

async function sh(program: string, args: string[], timeout = 30_000): Promise<Output> {
  let out: Deno.CommandOutput;
  try {
    out = await new Deno.Command(program, {
      args,
      stdin: "null",
      stdout: "piped",
      stderr: "piped",
      env: { LC_ALL: "C" },
      signal: AbortSignal.timeout(timeout),
    }).output();
  } catch (e) {
    if (e instanceof Deno.errors.NotFound || e instanceof Deno.errors.NotCapable) throw new NotInstalled(program);
    throw e;
  }
  const text = (b: Uint8Array) => new TextDecoder().decode(b);
  return { code: out.code, stdout: text(out.stdout), stderr: text(out.stderr).trim() };
}

/** Runs a script as root, after polkit asks for the password once. */
export async function asRoot(script: string): Promise<string> {
  let o: Output;
  try {
    // Two minutes to type the password, and for slow USB drives to answer.
    o = await sh("pkexec", ["/bin/sh", "-c", script], 180_000);
  } catch (e) {
    if (e instanceof NotInstalled) throw new Error("pkexec (polkit) is needed to read SMART data");
    throw e;
  }
  const denied = pkexecError(o.code, o.stderr);
  if (denied) throw new Error(denied);
  if (o.code !== 0) throw new Error(o.stderr.split("\n").filter(Boolean).pop() || `Exited with ${o.code}`);
  return o.stdout;
}

export async function disks(): Promise<Disk[]> {
  let o = await sh("lsblk", ["-J", "-b", "-o", COLUMNS]);
  if (o.code !== 0) o = await sh("lsblk", ["-J", "-b", "-o", COLUMNS_SHORT]);
  if (o.code !== 0) throw new Error(o.stderr || "lsblk failed");
  return parseLsblk(o.stdout);
}

/** ZFS pools, or nothing when ZFS isn't installed or has no pool. */
export async function pools(): Promise<Pool[]> {
  let list: Output;
  try {
    list = await sh("zpool", ["list", "-H", "-o", ZPOOL_COLUMNS]);
  } catch (e) {
    if (e instanceof NotInstalled) return [];
    throw e;
  }
  if (list.code !== 0) return [];
  const found = parseZpoolList(list.stdout);
  if (!found.length) return [];
  const status = await sh("zpool", ["status"]).catch(() => undefined);
  const details = parseZpoolStatus(status?.stdout ?? "");
  return found.map((p) => ({ ...p, ...details.get(p.name), devices: details.get(p.name)?.devices ?? [] }));
}

// ---------------------------------------------------------------------------
// What root reads, kept between openings

export interface Saved {
  at: number;
  report: RootReport;
}

const KEY = "report";

export async function saved(): Promise<Saved | undefined> {
  return await storage.get(KEY).catch(() => undefined) as unknown as Saved | undefined;
}

/** Reads SMART of every drive and the Btrfs state, in one password prompt, and keeps it. */
export async function readAsRoot(all: Disk[]): Promise<Saved> {
  const mounts = btrfsFilesystems(all).flatMap((f) => (f.mountpoint ? [f.mountpoint] : []));
  const report = parseReadScript(await asRoot(readScript(all.map((d) => d.path), mounts)));
  const result = { at: Date.now(), report };
  await storage.set(KEY, result as never).catch(() => {});
  return result;
}

export async function startSelfTest(device: string): Promise<string> {
  // smartctl exits non-zero for warnings it found earlier on the drive, so the text decides.
  const out = await asRoot(`${shellLine(["smartctl", "-t", "short", device])} 2>&1; exit 0`);
  if (/Testing has begun|Self-test has begun|test started/i.test(out)) {
    return out.match(/Please wait (\d+) minutes?/)?.[1] ?? "";
  }
  throw new Error(explainTestError(out));
}

export async function startBtrfsScrub(mountpoint: string): Promise<void> {
  const out = await asRoot(`${shellLine(["btrfs", "scrub", "start", mountpoint])} 2>&1 || echo "@@failed"`);
  if (out.includes("@@failed")) {
    const line = out.replace("@@failed", "").trim().split("\n").pop() ?? "";
    throw new Error(/already running/i.test(line) ? "A scrub is already running" : line || "The scrub didn't start");
  }
}

export async function startZfsScrub(pool: string): Promise<void> {
  const out = await asRoot(`${shellLine(["zpool", "scrub", pool])} 2>&1 || echo "@@failed"`);
  if (out.includes("@@failed")) {
    const line = out.replace("@@failed", "").trim().split("\n").pop() ?? "";
    throw new Error(/currently scrubbing|in progress/i.test(line) ? "A scrub is already running" : line);
  }
}
