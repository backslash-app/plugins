import { action, type Context, Icons, type Item, list, refresh, updateCommandMetadata } from "@backslash/api";
import { recent } from "../api.ts";
import { dayLabel, type Service, SERVICES, services, settings, trackLine } from "../lib.ts";
import { errorItem, setupItem, trackItem } from "../views.ts";

let status = "";

const reload = action("Reload", () => refresh(), { icon: Icons.refresh, shortcut: "<Ctrl>r" });

export default (ctx: Context) => {
  const s = settings(ctx.preferences);
  const available = services(s);
  return list({
    placeholder: "Filter recent tracks…",
    status: () => status,
    // Tab switches service when both are set.
    filter: available.length > 1
      ? { options: available.map((v) => ({ value: v, title: SERVICES[v].title })), default: available[0] }
      : undefined,
    empty: { title: "No scrobbles yet", description: "Play something with your scrobbler on", icon: Icons.music },
    async items({ filter, signal }): Promise<Item[]> {
      if (!available.length) {
        status = "";
        return [setupItem()];
      }
      const service = (available.includes(filter as Service) ? filter : available[0]) as Service;
      try {
        const { tracks, total } = await recent(service, s, signal);
        const playing = tracks.find((t) => t.playing);
        updateCommandMetadata({ subtitle: playing ? `▶ ${trackLine(playing)}` : null }).catch(() => {});
        const now = Date.now();
        status = `${SERVICES[service].title} · ${
          total !== undefined ? `${total.toLocaleString("en")} scrobbles` : `${tracks.length} recent listens`
        }`;
        return tracks.map((t) => trackItem(t, service, s, dayLabel(t.at, now), [reload], now));
      } catch (e) {
        if (signal.aborted) throw e;
        status = "";
        return [errorItem(e, service)];
      }
    },
  });
};
