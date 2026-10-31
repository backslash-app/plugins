import { Icons, type Item, list } from "@backslash/api";
import { parseScenes } from "../lib.ts";
import { obs, screenshots } from "../system.ts";
import { offlineItem, sceneItem } from "../ui.ts";

let footer = "";

export default list({
  placeholder: "Switch to scene…",
  empty: { title: "No scenes", description: "Add scenes in OBS", icon: Icons.window },
  status: () => footer,
  async *items(ctx) {
    let client;
    try {
      client = await obs(ctx);
    } catch (e) {
      yield [await offlineItem((e as Error).message, ctx)];
      return;
    }
    const st = parseScenes(await client.request("GetSceneList"));
    footer = st.current ? `On air: ${st.current}` : `${st.scenes.length} scenes`;
    const rows = (shots: Map<string, string>): Item[] =>
      st.scenes.map((s) => ({ ...sceneItem(client!, s, st, shots.get(s.name), true), section: undefined }));
    yield rows(new Map());
    const shots = await screenshots(client, st.scenes.map((s) => s.name));
    if (shots.size && !ctx.signal.aborted) yield rows(shots);
  },
});
