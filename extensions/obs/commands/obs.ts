import { Icons, type Item, list } from "@backslash/api";
import { audioInputs, status } from "../api.ts";
import { statusLine } from "../lib.ts";
import { disconnect, obs, screenshots } from "../system.ts";
import {
  audioItem,
  nextChange,
  offlineItem,
  recordingItem,
  replayBufferItem,
  sceneItem,
  streamingItem,
  virtualCamItem,
} from "../ui.ts";

let footer = "Connecting to OBS…";

export default list({
  placeholder: "Record, stream, switch scenes, mute…",
  empty: { title: "Nothing in OBS", description: "Add scenes and audio sources in OBS", icon: Icons.video },
  status: () => footer,
  // Live: the status is asked again every second while the view is open.
  async *items(ctx) {
    const { signal } = ctx;
    let shots = new Map<string, string>();
    let shotsTaken = false;
    while (!signal.aborted) {
      let client;
      try {
        client = await obs(ctx);
        if (!client.version) {
          const v = await client.request("GetVersion").catch(() => ({} as Record<string, unknown>));
          client.version = typeof v.obsVersion === "string" ? v.obsVersion : "";
        }
        const st = await status(client);
        const audio = await audioInputs(client, st.inputs);
        footer = statusLine(client.version, st.stats);
        const items: Item[] = [
          await recordingItem(client, st),
          streamingItem(client, st),
          ...(st.virtualCam === undefined ? [] : [virtualCamItem(client, st.virtualCam)]),
          ...(st.replayBuffer === undefined ? [] : [replayBufferItem(client, st.replayBuffer)]),
          ...st.scenes.map((s) => sceneItem(client!, s, st, shots.get(s.name))),
          ...audio.map((a) => audioItem(client!, a)),
        ];
        yield items;
        if (!shotsTaken) {
          shotsTaken = true;
          shots = await screenshots(client, st.scenes.map((s) => s.name));
          if (shots.size) continue;
        }
        await nextChange(signal, 1000);
      } catch (e) {
        if (signal.aborted) return;
        footer = "Not connected";
        yield [await offlineItem((e as Error).message, ctx)];
        // Retried, so the list comes alive once OBS starts.
        await nextChange(signal, 3000);
      }
    }
    await disconnect();
  },
});
