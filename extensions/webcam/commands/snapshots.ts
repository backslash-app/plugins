import type { Context } from "@backslash/api";
import { cameras, pickCamera } from "../system.ts";
import { snapshotsView } from "../ui.ts";

export default async ({ preferences, signal }: Context) => {
  // With a camera, Ctrl+N takes another one from here.
  const cam = pickCamera(await cameras(signal).catch(() => []), String(preferences.device ?? ""));
  return snapshotsView(preferences, cam);
};
