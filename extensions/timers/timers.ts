import { exec, storage } from "@backslash/api";
import { timerArgs } from "./lib.ts";

export interface Timer {
  unit: string;
  name: string;
  seconds: number;
  /** Unix ms. */
  ends: number;
}

const saved = async (): Promise<Timer[]> => ((await storage.get("timers")) ?? []) as unknown as Timer[];

/** Units of our timers that systemd still knows. */
async function activeUnits(): Promise<Set<string>> {
  const out = await exec("systemctl", [
    "--user",
    "list-timers",
    "--all",
    "--plain",
    "--no-legend",
    "backslash-timer-*",
  ]);
  return new Set([...out.matchAll(/backslash-timer-\d+/g)].map((m) => m[0]));
}

/** Running timers, soonest first. Forgets those that rang or were stopped elsewhere. */
export async function running(): Promise<Timer[]> {
  const all = await saved();
  const active = await activeUnits().catch(() => undefined);
  const alive = all.filter((t) => t.ends > Date.now() && (!active || active.has(t.unit)));
  if (alive.length !== all.length) await storage.set("timers", alive as any);
  return alive.sort((a, b) => a.ends - b.ends);
}

export async function start(seconds: number, name: string): Promise<Timer> {
  const unit = `backslash-timer-${Date.now()}`;
  await exec("systemd-run", timerArgs(unit, seconds, name));
  const timer = { unit, name, seconds, ends: Date.now() + seconds * 1000 };
  await storage.set("timers", [...await saved(), timer] as any);
  return timer;
}

export async function stop(t: Timer): Promise<void> {
  await exec("systemctl", ["--user", "stop", `${t.unit}.timer`]).catch(() => {});
  await storage.set("timers", (await saved()).filter((s) => s.unit !== t.unit) as any);
}
