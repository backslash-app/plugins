// Talking to the YubiKey through ykman (yubikey-manager), and to gpg for its OpenPGP card view.

import { explainYkman, field, type Info, type Key, parseInfo, parseList } from "./lib.ts";

export class NotInstalled extends Error {}

export class YkmanError extends Error {
  constructor(public raw: string) {
    super(explainYkman(raw));
  }
}

async function run(program: string, args: string[], timeout: number): Promise<string> {
  let out: Deno.CommandOutput;
  try {
    out = await new Deno.Command(program, {
      args,
      stdin: "null",
      stdout: "piped",
      stderr: "piped",
      env: { LC_ALL: "C.UTF-8" },
      signal: AbortSignal.timeout(timeout),
    }).output();
  } catch (e) {
    if (e instanceof Deno.errors.NotFound || e instanceof Deno.errors.NotCapable) throw new NotInstalled(program);
    if (e instanceof DOMException && e.name === "TimeoutError") throw new YkmanError("timed out");
    throw e;
  }
  const d = (b: Uint8Array) => new TextDecoder().decode(b);
  if (out.code !== 0) {
    const text = `${d(out.stderr)}\n${d(out.stdout)}`.trim();
    throw program === "ykman" ? new YkmanError(text) : new Error(text.split("\n").pop() || `${program} failed`);
  }
  return d(out.stdout);
}

/**
 * ykman, one call at a time: the key's interfaces can be opened by one program only, and
 * parallel calls would fail with "Failed connecting".
 */
let queue: Promise<unknown> = Promise.resolve();

export function ykman(args: string[], timeout = 15_000): Promise<string> {
  const next = queue.then(() => run("ykman", args, timeout));
  queue = next.catch(() => {});
  return next;
}

export interface Device extends Key {
  info?: Info;
  error?: string;
}

/** Every key plugged in, with its details. */
export async function devices(): Promise<Device[]> {
  const keys = parseList(await ykman(["list"]));
  return await Promise.all(keys.map(async (k) => {
    try {
      const info = parseInfo(await ykman([...(k.serial ? ["--device", k.serial] : []), "info"]));
      return { ...k, serial: k.serial ?? field(info.fields, "Serial number"), info };
    } catch (e) {
      return { ...k, error: (e as Error).message };
    }
  }));
}

export const gpgCardStatus = () => run("gpg", ["--card-status"], 20_000);

/** scdaemon (gpg) keeps the smart card to itself until it is stopped. */
export const releaseFromGpg = () => run("gpgconf", ["--kill", "scdaemon"], 10_000);

export async function osRelease(): Promise<string> {
  return await Deno.readTextFile("/etc/os-release").catch(() => "");
}
