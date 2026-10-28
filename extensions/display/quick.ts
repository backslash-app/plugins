// Shared by the no-view commands.
import { type Backlight, install, percent, stepped } from "./lib.ts";
import { backlights, ddcDisplays, family, nightLight, setBacklight, setNightLight } from "./system.ts";

async function all(ddc: boolean): Promise<{ list: Backlight[]; via: Awaited<ReturnType<typeof backlights>>["via"] }> {
  const bl = await backlights();
  const list = [...bl.list, ...(ddc ? await ddcDisplays() : [])];
  if (!list.length) {
    throw new Error(
      `No adjustable backlight: install brightnessctl (${
        install(await family(), "brightnessctl")
      }), or ddcutil for external monitors`,
    );
  }
  return { list, via: bl.via };
}

/** Sets every screen to `pct`, or steps it; returns the new level of the first one. */
export async function brightness(target: number | { step: number }, ddc: boolean): Promise<string> {
  const { list, via } = await all(ddc);
  let first: number | undefined;
  for (const b of list) {
    const pct = typeof target === "number" ? target : stepped(percent(b), target.step);
    await setBacklight(b, pct, via);
    first ??= pct;
  }
  return `Brightness ${first} %`;
}

export async function toggleNight(kelvin: number): Promise<string> {
  const n = await nightLight();
  if (!n) throw new Error("No night light: install wlsunset, hyprsunset or gammastep");
  await setNightLight(!n.enabled, kelvin);
  return `Night light ${n.enabled ? "off" : "on"}`;
}
