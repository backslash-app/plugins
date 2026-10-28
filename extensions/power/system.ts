// Power profiles and batteries from the system's tools.

import { exec } from "@backslash/api";
import {
  type Battery,
  parsePowerProfiles,
  parseTuned,
  parseUdevPower,
  parseUpower,
  type PowerState,
  type Profile,
} from "./lib.ts";

export interface Profiles {
  list: Profile[];
  tool?: "powerprofilesctl" | "tuned-adm";
  error?: string;
}

/** power-profiles-daemon (or tuned-ppd), else tuned. */
export async function profiles(): Promise<Profiles> {
  let error: string | undefined;
  try {
    const list = parsePowerProfiles(await exec("powerprofilesctl", ["list"]));
    if (list.length) return { list, tool: "powerprofilesctl" };
  } catch (e) {
    if (!(e instanceof Deno.errors.NotFound)) error = String((e as Error).message ?? e);
  }
  try {
    const list = parseTuned(await exec("tuned-adm", ["list"]));
    if (list.length) return { list, tool: "tuned-adm" };
  } catch (e) {
    if (!(e instanceof Deno.errors.NotFound)) error ??= String((e as Error).message ?? e);
  }
  return { list: [], error };
}

export async function setProfile(tool: Profiles["tool"], id: string): Promise<void> {
  if (tool === "tuned-adm") await exec("tuned-adm", ["profile", id]);
  else await exec("powerprofilesctl", ["set", id]);
}

/** Batteries from the kernel (through udev, as Deno can't read /sys), else UPower. */
export async function power(): Promise<PowerState> {
  try {
    const state = parseUdevPower(await exec("udevadm", ["info", "--export-db"]));
    if (state.batteries.length || state.plugged !== undefined) return state;
  } catch {
    // No udev: ask UPower.
  }
  try {
    const devices = (await exec("upower", ["-e"])).split("\n").filter((d) => d && !d.includes("DisplayDevice"));
    const batteries = (await Promise.all(devices.map(async (d) => parseUpower(await exec("upower", ["-i", d])))))
      .filter(
        (b): b is Battery => !!b,
      );
    const ac = devices.find((d) => /line_power/.test(d));
    const plugged = ac ? /online:\s+yes/.test(await exec("upower", ["-i", ac])) : undefined;
    return { batteries, plugged };
  } catch {
    return { batteries: [] };
  }
}
