import { action, copy, Icons, type Item, list, meta, open, refresh } from "@backslash/api";
import { events } from "../api.ts";
import {
  ago,
  bySection,
  dateSection,
  eventKind,
  infoLinks,
  md,
  precision,
  sortEvents,
  type SpaceEvent,
  tMinus,
  webcasts,
  when,
} from "../lib.ts";

let fresh = false;
const refreshAction = action("Refresh", () => {
  fresh = true;
  return refresh();
}, { icon: Icons.refresh, shortcut: "<Ctrl>r" });

function eventItem(e: SpaceEvent, now: number): Item {
  const kind = eventKind(e);
  const p = precision(e.date_precision);
  const date = when(e.date!, p);
  const vids = webcasts(e);
  const info = infoLinks(e);
  const past = Date.parse(e.date!) < now;
  const countdown = p === "exact" ? tMinus(e.date!, now) : date;
  const related = [...(e.spacestations ?? []), ...(e.launches ?? [])].map((x) => x.name);
  return {
    id: String(e.id),
    title: e.name,
    subtitle: e.location ?? undefined,
    icon: { source: Icons.sparkle, tint: e.webcast_live ? "red" : kind.color },
    section: e.webcast_live ? "Now" : dateSection(e.date!, p, now),
    keywords: [kind.label, ...related, ...(e.program ?? []).map((x) => x.name)],
    accessories: [
      ...(e.webcast_live ? [{ tag: "Live", color: "red" as const }] : []),
      { tag: kind.label, color: kind.color },
      { text: countdown, tooltip: date, icon: Icons.clock },
    ],
    detail: {
      markdown: [
        `## ${md(e.name)}`,
        "",
        e.description ? md(e.description) : "",
        "",
        vids.length ? ["### Webcasts", "", ...vids.map((v) => `- [${md(v.title)}](${v.url})`)].join("\n") : "",
      ].join("\n").trim(),
      metadata: [
        meta.tags("Type", [{ text: kind.label, color: kind.color }]),
        meta.text("When", date, { icon: Icons.calendar }),
        ...(p === "exact" ? [meta.text("Countdown", past ? ago(e.date!, now) : countdown, { icon: Icons.timer })] : []),
        ...(e.location ? [meta.text("Where", e.location, { icon: Icons.pin })] : []),
        ...(e.spacestations?.length ? [meta.tags("Station", e.spacestations.map((x) => x.name))] : []),
        ...(e.launches?.length ? [meta.tags("Launch", e.launches.map((x) => x.name))] : []),
        ...(e.program?.length ? [meta.tags("Program", e.program.map((x) => x.name))] : []),
        ...(e.news_url ? [meta.link("News", "Article", e.news_url)] : []),
      ],
    },
    actions: [
      ...(vids[0] ? [open(vids[0].url, e.webcast_live ? "Watch Live" : "Open Webcast", { icon: Icons.play })] : []),
      ...(e.news_url ? [open(e.news_url, "Open News Article", { icon: Icons.book, shortcut: "<Ctrl>o" })] : []),
      copy(`${e.name}: ${date}`, "Copy Event", { shortcut: "<Ctrl><Shift>c" }),
      ...vids.slice(1).map((v) => open(v.url, `Open ${v.title}`, { icon: Icons.video, section: "Webcasts" })),
      ...info.map((v) => open(v.url, `Open ${v.title}`, { icon: Icons.link, section: "More" })),
      refreshAction,
    ],
  };
}

export default list({
  placeholder: "Filter dockings, spacewalks, landings…",
  empty: { title: "No upcoming events", icon: Icons.sparkle },
  actions: [refreshAction],
  status: (items) => items.length === 1 ? "1 event" : `${items.length} events`,
  items: async (ctx) => {
    const prefs = ctx.preferences as { apiKey?: string };
    const r = await events({ token: prefs.apiKey || undefined, signal: ctx.signal, fresh });
    fresh = false;
    const now = Date.now();
    const items = sortEvents(r.data).map((e) => eventItem(e, now));
    if (r.stale) {
      items.unshift({
        id: "stale",
        title: `Showing events from ${ago(new Date(r.at).toISOString(), now)}`,
        subtitle: r.stale,
        icon: { source: Icons.alert, tint: "orange" },
        section: "Offline",
        actions: [refreshAction],
      });
    }
    return bySection(items);
  },
});
