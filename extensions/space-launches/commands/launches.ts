import {
  action,
  copy,
  Icons,
  type Item,
  list,
  meta,
  type Metadata,
  open,
  refresh,
  updateCommandMetadata,
} from "@backslash/api";
import { launches } from "../api.ts";
import {
  ago,
  bySection,
  countdown,
  country,
  infoLinks,
  isLive,
  type Kind,
  type Launch,
  launchText,
  mapUrl,
  matchesProviders,
  md,
  missionName,
  orbit,
  parseProviders,
  place,
  precision,
  providerName,
  providerShort,
  providerWords,
  recentSection,
  rocketName,
  sortRecent,
  sortUpcoming,
  status,
  summary,
  upcomingSection,
  webcasts,
  when,
  windowLength,
} from "../lib.ts";

interface Prefs {
  providers?: string;
  apiKey?: string;
}

let fresh = false;
const refreshAction = action("Refresh", () => {
  fresh = true;
  return refresh();
}, { icon: Icons.refresh, shortcut: "<Ctrl>r" });

function detailMarkdown(l: Launch, kind: Kind): string {
  const st = status(l.status);
  const lines = [`## ${md(missionName(l))}`, "", `**${md(rocketName(l))}** by ${md(providerName(l))}`, ""];
  if (l.status?.description) lines.push(`*${md(l.status.description)}*`, "");
  if (st.label === "Hold" && l.holdreason) lines.push(`> Hold: ${md(l.holdreason)}`, "");
  if (st.done && l.failreason) lines.push(`> ${md(l.failreason)}`, "");
  if (l.mission?.description) lines.push(md(l.mission.description), "");
  if (l.weather_concerns && kind === "upcoming") lines.push(`**Weather:** ${md(l.weather_concerns)}`, "");
  const vids = webcasts(l);
  if (vids.length) {
    lines.push("### Webcasts", "", ...vids.map((v) => `- [${md(v.title)}](${v.url})${v.live ? " (live)" : ""}`), "");
  }
  return lines.join("\n").trim();
}

function metadata(l: Launch): Metadata[] {
  const st = status(l.status);
  const p = precision(l.net_precision);
  const win = windowLength(l);
  const map = mapUrl(l.pad);
  return [
    meta.tags("Status", [{ text: st.label, color: st.color }]),
    meta.text(st.done ? "Launched" : "Launch (NET)", when(l.net, p), { icon: Icons.calendar }),
    ...(win ? [meta.text("Window", win, { icon: Icons.timer })] : []),
    ...(l.probability !== null && l.probability !== undefined && l.probability >= 0 && !st.done
      ? [meta.progress("Weather go", l.probability / 100, `${l.probability} %`)]
      : []),
    meta.separator(),
    meta.text("Rocket", rocketName(l), { icon: Icons.rocket }),
    meta.text("Provider", providerName(l), { icon: Icons.flag }),
    ...(l.mission?.type ? [meta.text("Mission type", l.mission.type)] : []),
    ...(orbit(l) ? [meta.text("Orbit", orbit(l)!, { icon: Icons.globe })] : []),
    ...(l.program?.length ? [meta.tags("Program", l.program.map((x) => x.name))] : []),
    meta.separator(),
    map ? meta.link("Pad", place(l), map) : meta.text("Pad", place(l), { icon: Icons.pin }),
    ...(country(l) ? [meta.text("Country", country(l)!)] : []),
  ];
}

function launchItem(l: Launch, kind: Kind, now: number): Item {
  const st = status(l.status);
  const live = isLive(l);
  const vids = webcasts(l);
  const info = infoLinks(l);
  const map = mapUrl(l.pad);
  const p = precision(l.net_precision);
  return {
    id: l.id,
    title: missionName(l),
    subtitle: `${rocketName(l)} · ${providerShort(l.launch_service_provider)}`,
    icon: { source: Icons.rocket, tint: live ? "red" : st.color },
    section: kind === "upcoming" ? upcomingSection(l, now) : recentSection(l, now),
    keywords: [
      ...providerWords(l.launch_service_provider),
      rocketName(l),
      place(l),
      country(l) ?? "",
      orbit(l) ?? "",
      st.label,
    ].filter(Boolean),
    accessories: [
      ...(live
        ? [{ tag: vids.some((v) => v.live) || l.webcast_live ? "Live" : "In flight", color: "red" as const }]
        : []),
      ...(orbit(l) ? [{ text: l.mission?.orbit?.abbrev ?? orbit(l)!, tooltip: orbit(l) }] : []),
      { tag: st.label, color: st.color, tooltip: l.status?.name ?? undefined },
      {
        text: countdown(l, now),
        tooltip: when(l.net, p),
        icon: st.done ? undefined : Icons.clock,
      },
    ],
    detail: {
      stats: [
        { label: st.done ? "Launched" : "Countdown", value: countdown(l, now), color: st.color },
        { label: "Status", value: st.label, color: st.color },
      ],
      markdown: detailMarkdown(l, kind),
      metadata: metadata(l),
    },
    actions: [
      ...(vids[0] ? [open(vids[0].url, vids[0].live ? "Watch Live" : "Open Webcast", { icon: Icons.play })] : []),
      copy(launchText(l), "Copy Launch Details", { shortcut: "<Ctrl><Shift>c" }),
      copy(`${missionName(l)}: ${when(l.net, p)}`, "Copy Date", { icon: Icons.calendar }),
      ...vids.slice(1).map((v) => open(v.url, `Open ${v.title}`, { icon: Icons.video, section: "Webcasts" })),
      ...(map ? [open(map, "Show Pad on Map", { icon: Icons.pin, shortcut: "<Ctrl>m" })] : []),
      ...(l.pad?.wiki_url ? [open(l.pad.wiki_url, "Open Pad on Wikipedia", { icon: Icons.book })] : []),
      ...info.map((v) => open(v.url, `Open ${v.title}`, { icon: Icons.link, section: "More" })),
      refreshAction,
    ],
  };
}

export default list({
  placeholder: "Filter by mission, rocket, provider, pad or orbit…",
  filter: { options: [{ value: "upcoming", title: "Upcoming" }, { value: "previous", title: "Recent" }] },
  empty: {
    title: "No launches",
    description: "None matches your providers in Settings → Extensions → Space Launches",
    icon: Icons.rocket,
  },
  actions: [refreshAction],
  status: (items) => items.length === 0 ? "" : items.length === 1 ? "1 launch" : `${items.length} launches`,
  items: async (ctx) => {
    const kind: Kind = ctx.filter === "previous" ? "previous" : "upcoming";
    const prefs = ctx.preferences as Prefs;
    const wanted = parseProviders(prefs.providers);
    const r = await launches(kind, { token: prefs.apiKey || undefined, signal: ctx.signal, fresh });
    fresh = false;
    const now = Date.now();
    const shown = (kind === "upcoming" ? sortUpcoming(r.data) : sortRecent(r.data))
      .filter((l) => matchesProviders(l, wanted));
    if (kind === "upcoming") {
      const next = shown.find((l) => !status(l.status).done);
      updateCommandMetadata({ subtitle: next ? summary(next, now) : null }).catch(() => {});
    }
    const items = shown.map((l) => launchItem(l, kind, now));
    if (r.stale) {
      items.unshift({
        id: "stale",
        title: `Showing launches from ${ago(new Date(r.at).toISOString(), now)}`,
        subtitle: r.stale,
        icon: { source: Icons.alert, tint: "orange" },
        section: "Offline",
        actions: [refreshAction],
      });
    }
    return kind === "upcoming" ? bySection(items) : items;
  },
});
