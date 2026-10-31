import type { Context } from "@backslash/api";
import { cameras, pickCamera } from "../system.ts";
import { takeAndShow } from "../ui.ts";

// Takes the picture right away, then shows it with the earlier ones.
export default async ({ preferences, signal }: Context) => {
  const cam = pickCamera(await cameras(signal), String(preferences.device ?? ""));
  if (!cam) throw new Error("No camera found: plug in a webcam, or check its privacy switch");
  return takeAndShow(cam, preferences);
};
