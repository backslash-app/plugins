// Running adb and the programs around it (scrcpy, systemd-run, the terminal).

import {
  type Battery,
  connectOutcome,
  type Device,
  deviceInfo,
  type Info,
  installCommand,
  isPng,
  osFamily,
  parseBattery,
  parseDevices,
  parseGetprop,
  parseWifiIp,
  scrcpyRunArgs,
  scrcpyUnit,
} from "./lib.ts";

export const HOME = Deno.env.get("HOME") ?? "";

export class Missing extends Error {
  constructor(readonly tool: "adb" | "scrcpy", message: string) {
    super(message);
  }
}

const decode = (b: Uint8Array) => new TextDecoder().decode(b);

/** Runs a program; stdout as bytes. Throws {@link Missing} when it isn't installed, stderr otherwise. */
async function runRaw(program: string, args: string[], signal?: AbortSignal, timeout = 15_000): Promise<Uint8Array> {
  const timer = AbortSignal.timeout(timeout);
  let out: Deno.CommandOutput;
  try {
    out = await new Deno.Command(program, {
      args,
      stdin: "null",
      stdout: "piped",
      stderr: "piped",
      signal: signal ? AbortSignal.any([signal, timer]) : timer,
    }).output();
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) {
      if (program === "adb") throw new Missing("adb", "adb is not installed");
      if (program === "scrcpy") throw new Missing("scrcpy", "scrcpy is not installed");
      throw new Error(`${program} is not installed`);
    }
    if (timer.aborted && !signal?.aborted) throw new Error(`${program} ${args.slice(0, 4).join(" ")} took too long`);
    throw e;
  }
  if (!out.success) {
    const err = (decode(out.stderr).trim() || decode(out.stdout).trim()).replace(/^adb: (error: )?/, "");
    throw new Error(err || `${program} failed`);
  }
  return out.stdout;
}

export async function adb(args: string[], signal?: AbortSignal, timeout?: number): Promise<string> {
  return decode(await runRaw("adb", args, signal, timeout)).replace(/\r\n/g, "\n").trim();
}

/** adb on one device. */
export const onDevice = (serial: string, args: string[], signal?: AbortSignal, timeout?: number) =>
  adb(["-s", serial, ...args], signal, timeout);

export async function devices(signal?: AbortSignal): Promise<Device[]> {
  return parseDevices(await adb(["devices", "-l"], signal));
}

export interface Details {
  info: Info;
  battery?: Battery;
  ip?: string;
}

const MARK = "@@backslash@@";

/** Model, Android version, battery and Wi-Fi address in one adb call. */
export async function details(serial: string, signal?: AbortSignal): Promise<Details> {
  const out = await onDevice(
    serial,
    [
      "shell",
      `getprop; echo ${MARK}; dumpsys battery; echo ${MARK}; ip -f inet addr show wlan0 2>/dev/null`,
    ],
    signal,
    10_000,
  );
  const [props = "", battery = "", ip = ""] = out.split(MARK);
  return { info: deviceInfo(parseGetprop(props)), battery: parseBattery(battery), ip: parseWifiIp(ip) };
}

/** The screen as PNG bytes. */
export async function screenshot(serial: string): Promise<Uint8Array> {
  const bytes = await runRaw("adb", ["-s", serial, "exec-out", "screencap", "-p"], undefined, 20_000);
  if (!isPng(bytes)) throw new Error("The device didn't send a picture: unlock it and try again");
  return bytes;
}

/** A folder in ~/Pictures to save screenshots in: ~/Pictures/Screenshots when it exists. */
export async function screenshotFolder(): Promise<string> {
  for (const dir of [`${HOME}/Pictures/Screenshots`, `${HOME}/Pictures`]) {
    try {
      if ((await Deno.stat(dir)).isDirectory) return dir;
    } catch {
      // try the next one
    }
  }
  await Deno.mkdir(`${HOME}/Pictures`, { recursive: true });
  return `${HOME}/Pictures`;
}

/** Opens scrcpy in its own systemd user unit (so it outlives the launcher), or as a plain child without systemd. */
export async function mirror(serial: string, title: string, extra: string[] = []): Promise<void> {
  // Checks scrcpy is there first: systemd-run would start a unit that fails at once.
  await runRaw("scrcpy", ["--version"], undefined, 5000).catch((e) => {
    if (e instanceof Missing) throw e;
  });
  await runRaw("systemctl", ["--user", "stop", `${scrcpyUnit(serial)}.service`], undefined, 5000).catch(() => {});
  try {
    await runRaw("systemd-run", scrcpyRunArgs(serial, title, extra), undefined, 10_000);
    return;
  } catch (e) {
    const message = String((e as Error).message);
    if (!/not installed|Failed to connect to bus|No such file/i.test(message)) throw e;
  }
  const [, , , , , ...argv] = scrcpyRunArgs(serial, title, extra);
  new Deno.Command(argv[0], { args: argv.slice(1), stdin: "null", stdout: "null", stderr: "null" }).spawn().unref();
}

/** `adb connect` with the outcome as a sentence. */
export async function connect(address: string): Promise<{ ok: boolean; message: string }> {
  try {
    return connectOutcome(await adb(["connect", address], undefined, 15_000));
  } catch (e) {
    return connectOutcome((e as Error).message);
  }
}

export async function pair(address: string, code: string): Promise<{ ok: boolean; message: string }> {
  try {
    return connectOutcome(await adb(["pair", address, code], undefined, 20_000));
  } catch (e) {
    return connectOutcome((e as Error).message);
  }
}

let release: Promise<string> | undefined;

export async function installHint(tool: "adb" | "scrcpy"): Promise<string> {
  release ??= Deno.readTextFile("/etc/os-release").catch(() => "");
  return installCommand(tool, osFamily(await release));
}

export interface Apk {
  path: string;
  name: string;
  size: number;
  modified: number;
}

/** APKs in ~/Downloads, newest first. */
export async function downloadedApks(): Promise<Apk[]> {
  const dir = `${HOME}/Downloads`;
  const out: Apk[] = [];
  try {
    for await (const e of Deno.readDir(dir)) {
      if (!e.isFile || !/\.apk$/i.test(e.name)) continue;
      const st = await Deno.stat(`${dir}/${e.name}`).catch(() => undefined);
      if (st) out.push({ path: `${dir}/${e.name}`, name: e.name, size: st.size, modified: st.mtime?.getTime() ?? 0 });
    }
  } catch {
    // no Downloads folder
  }
  return out.sort((a, b) => b.modified - a.modified);
}
