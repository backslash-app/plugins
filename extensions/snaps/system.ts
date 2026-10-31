// Running snap: listing as the user, changes as root through pkexec (polkit asks for the password).

import {
  type Connection,
  type Info,
  parseConnections,
  parseInfo,
  parseList,
  parseRefreshList,
  pkexecError,
  rootScript,
  type Snap,
  snapError,
  type Update,
} from "./lib.ts";

export class NotInstalled extends Error {}

interface Output {
  code: number;
  stdout: string;
  stderr: string;
}

async function sh(program: string, args: string[], timeout: number, signal?: AbortSignal): Promise<Output> {
  try {
    const { code, stdout, stderr } = await new Deno.Command(program, {
      args,
      stdin: "null",
      stdout: "piped",
      stderr: "piped",
      env: { LC_ALL: "C.UTF-8" },
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeout)]) : AbortSignal.timeout(timeout),
    }).output();
    const text = (b: Uint8Array) => new TextDecoder().decode(b);
    return { code, stdout: text(stdout), stderr: text(stderr).trim() };
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) throw new NotInstalled(program);
    if (e instanceof DOMException && e.name === "TimeoutError") throw new Error(`${program} took too long`);
    throw e;
  }
}

async function snap(args: string[], signal?: AbortSignal, timeout = 30_000): Promise<string> {
  const o = await sh("snap", args, timeout, signal);
  if (o.code !== 0) throw new Error(snapError(o.stderr || o.stdout));
  return o.stdout;
}

export async function revisions(signal?: AbortSignal) {
  return parseList(await snap(["list", "--all"], signal));
}

/** Descriptions, commands and channels of every snap, in one call (snapd asks the store). */
export async function infos(names: string[], signal?: AbortSignal): Promise<Map<string, Info>> {
  if (!names.length) return new Map();
  // One unknown name makes snap exit with 1, but it prints the others.
  const o = await sh("snap", ["info", ...names], 60_000, signal)
    .catch(() => undefined);
  return new Map(parseInfo(o?.stdout ?? "").map((i) => [i.name, i]));
}

export async function updates(signal?: AbortSignal): Promise<Map<string, Update>> {
  const o = await sh("snap", ["refresh", "--list"], 60_000, signal)
    .catch(() => undefined);
  return new Map(parseRefreshList(o?.stdout ?? "").map((u) => [u.name, u]));
}

export async function connections(name: string): Promise<Connection[]> {
  return parseConnections(await snap(["connections", name]));
}

/** The size of a revision's squashfs file. */
export async function revisionSize(name: string, rev: string): Promise<number | undefined> {
  try {
    return (await Deno.stat(`/var/lib/snapd/snaps/${name}_${rev}.snap`)).size;
  } catch {
    return undefined;
  }
}

/** Fills `sizes` with `name_rev` → bytes for every revision. */
export async function sizes(snaps: Snap[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  await Promise.all(snaps.flatMap((s) =>
    [s.current, ...s.old].map(async (r) => {
      const size = await revisionSize(s.name, r.rev);
      if (size !== undefined) out.set(`${s.name}_${r.rev}`, size);
    })
  ));
  return out;
}

/** Runs snap commands as root, after polkit asks for the password once. */
export async function asRoot(commands: string[][], timeout = 15 * 60_000): Promise<void> {
  let o: Output;
  try {
    o = await sh("pkexec", ["/bin/sh", "-c", rootScript(commands)], timeout);
  } catch (e) {
    if (e instanceof NotInstalled) throw new Error("pkexec (polkit) is needed to change snaps");
    throw e;
  }
  const denied = pkexecError(o.code, o.stderr);
  if (denied) throw new Error(denied);
  if (o.code !== 0) throw new Error(snapError(o.stderr || o.stdout));
}

/** Starts a snap's app; it outlives the launcher. */
export function launch(command: string): void {
  try {
    new Deno.Command("snap", { args: ["run", command], stdin: "null", stdout: "null", stderr: "null" }).spawn()
      .unref();
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) throw new Error("snap was not found");
    throw e;
  }
}
