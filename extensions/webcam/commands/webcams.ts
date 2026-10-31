import { Icons, list } from "@backslash/api";
import { cameras, pickCamera } from "../system.ts";
import { cameraRow } from "../ui.ts";

export default list({
  placeholder: "Filter cameras…",
  empty: {
    title: "No camera found",
    description: "Plug in a webcam, or check that it isn't disabled by a privacy switch or in the BIOS",
    icon: Icons.camera,
  },
  status: (items) => `${items.length} camera${items.length === 1 ? "" : "s"}`,
  async items({ preferences, signal }) {
    const list = await cameras(signal);
    const def = pickCamera(list, String(preferences.device ?? ""));
    return list.map((c) => cameraRow(c, preferences, c === def && list.length > 1));
  },
});
