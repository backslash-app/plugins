// Reading the sensors: `sensors -j` when lm-sensors is installed, /sys/class/hwmon otherwise (Deno opens /sys
// only with --allow-all, so its files are read in one batch by `grep -sH`), and nvidia-smi for NVIDIA's driver.

import { exec } from "@backslash/api";
import {
  attachModels,
  hwmonPaths,
  parseGrep,
  parseHwmon,
  parseNvidiaSmi,
  parseSensorsJson,
  type Reading,
} from "./lib.ts";

/** Runs a program and returns its stdout whatever the exit code; undefined when it is missing. */
async function capture(program: string, args: string[], timeout = 5000): Promise<string | undefined> {
  try {
    const { stdout } = await new Deno.Command(program, {
      args,
      stdin: "null",
      stdout: "piped",
      stderr: "null",
      signal: AbortSignal.timeout(timeout),
    }).output();
    return new TextDecoder().decode(stdout);
  } catch {
    return undefined;
  }
}

const PATHS = hwmonPaths();
const NVIDIA_DRIVER = "/proc/driver/nvidia/version";

export interface Readings {
  readings: Reading[];
  /** lm-sensors answered; else the readings come from sysfs. */
  lmSensors: boolean;
}

/**
 * Every temperature and fan. `nvidia` asks nvidia-smi when NVIDIA's driver is loaded: it wakes a sleeping
 * GPU on laptops with two, so background checks leave it out.
 */
export async function read(options: { nvidia?: boolean } = {}): Promise<Readings> {
  const [json, grep] = await Promise.all([
    capture("sensors", ["-j"]),
    capture("grep", ["-sHa", "", "--", ...PATHS, NVIDIA_DRIVER]),
  ]);
  const files = parseGrep(grep ?? "");
  const hwmon = parseHwmon(files);
  const lm = json ? parseSensorsJson(json) : [];
  const lmSensors = lm.length > 0;
  const readings = lmSensors ? attachModels(lm, hwmon) : hwmon;
  if (options.nvidia && files.has(NVIDIA_DRIVER)) {
    const smi = await exec("nvidia-smi", [
      "--query-gpu=index,name,temperature.gpu,fan.speed",
      "--format=csv,noheader,nounits",
    ]).catch(() => "");
    readings.push(...parseNvidiaSmi(smi));
  }
  return { readings, lmSensors };
}

/** Sleeps, waking up early when the view goes away. */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
  });
}

/** A desktop notification, when notify-send is there (the launcher's toasts only show while it is open). */
export async function notify(title: string, body: string, critical: boolean): Promise<void> {
  await exec("notify-send", [
    "-a",
    "Backslash",
    "-i",
    "temperature",
    "-u",
    critical ? "critical" : "normal",
    title,
    body,
  ]).catch(() => {});
}
