import { Icons, list, updateCommandMetadata } from "@backslash/api";
import { memories, type Server, server, SetupError, setupItem, thumbnails } from "../api.ts";
import { assetView, laneGroups, memoryGroups, plural } from "../lib.ts";
import { assetItem } from "../views.ts";

let footer = "";

export default list({
  layout: "grid",
  columns: 5,
  placeholder: "Filter today's memories by place, camera, people…",
  empty: {
    title: "No memories today",
    description: "Immich shows the photos taken on this day in past years",
    icon: Icons.history,
  },
  status: () => footer,
  async *items({ preferences, signal }) {
    let s: Server;
    try {
      s = server(preferences);
    } catch (e) {
      if (e instanceof SetupError) {
        yield [setupItem(e)];
        return;
      }
      throw e;
    }
    const now = new Date();
    let groups;
    try {
      const r = await memories(s, now, signal);
      groups = r.kind === "memories" ? memoryGroups(r.list, now) : laneGroups(r.list, now);
    } catch (e) {
      if (e instanceof SetupError) {
        yield [setupItem(e)];
        return;
      }
      throw e;
    }
    const all = groups.flatMap((g) => g.assets.map((a) => ({ group: g.title, view: assetView(a) })));
    const count = all.length;
    footer = count ? `${plural(count, "photo")} from ${plural(groups.length, "year")}` : "";
    updateCommandMetadata({ subtitle: count ? `${plural(count, "memory", "memories")} today` : null }).catch(() => {});
    const rows = (thumbs?: Map<string, string>) =>
      all.map(({ group, view }) => assetItem(s, view, thumbs?.get(view.id), group));
    yield rows();
    if (count) yield rows(await thumbnails(s, all.map((x) => x.view.id), { signal, deadline: 8000 }));
  },
});
