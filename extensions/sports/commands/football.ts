import {
  type Action,
  action,
  type Context,
  copy,
  Icons,
  type Item,
  list,
  meta,
  open,
  refresh,
  toast,
} from "@backslash/api";
import { favouriteTeams, footballToken, guarded, matches, teamMatches, toggleFavourite } from "../api.ts";
import {
  competitionCodes,
  isLive,
  isOver,
  localDate,
  localDay,
  localTime,
  type Match,
  roundName,
  scoreText,
  shiftDay,
  sortMatches,
  statusLook,
  type Team,
  teamName,
  until,
} from "../lib.ts";
import { teamView } from "./standings.ts";

const FILTERS = [
  { value: "today", title: "Today" },
  { value: "live", title: "Live" },
  { value: "yesterday", title: "Yesterday" },
  { value: "tomorrow", title: "Tomorrow" },
  { value: "week", title: "Next 7 Days" },
  { value: "mine", title: "My Teams" },
];

let fresh = false;
const refreshAction = action("Refresh", () => {
  fresh = true;
  return refresh();
}, { icon: Icons.refresh, shortcut: "<Ctrl>r" });

function favouriteAction(team: Team, favourites: Set<number>, shortcut?: string): Action {
  const has = favourites.has(team.id);
  return action(has ? `Remove ${teamName(team)} from Favourites` : `Add ${teamName(team)} to Favourites`, async () => {
    const added = await toggleFavourite(team);
    await toast(added ? `${teamName(team)} added to your teams` : `${teamName(team)} removed`, { style: "success" });
    return refresh();
  }, { icon: has ? Icons.starFilled : Icons.star, shortcut, section: "Favourites" });
}

export function matchItem(m: Match, favourites: Set<number>, ctx: Context, section?: string): Item {
  const look = statusLook(m);
  const live = isLive(m.status);
  const done = isOver(m.status);
  const home = teamName(m.homeTeam);
  const away = teamName(m.awayTeam);
  const score = scoreText(m);
  const fav = favourites.has(m.homeTeam.id) || favourites.has(m.awayTeam.id);
  const shown = live || done ? `${home} ${score} ${away}` : `${home} – ${away}`;
  const half = m.score.halfTime;
  const url = `https://www.google.com/search?q=${encodeURIComponent(`${m.homeTeam.name} ${m.awayTeam.name}`)}`;
  return {
    id: String(m.id),
    title: shown,
    subtitle: [m.competition.name, roundName(m)].filter(Boolean).join(" · "),
    icon: m.competition.emblem ?? { source: fav ? Icons.starFilled : Icons.dot, tint: live ? "red" : "gray" },
    section: section ?? (live ? "Live" : m.competition.name),
    keywords: [m.homeTeam.name, m.awayTeam.name, m.homeTeam.tla ?? "", m.awayTeam.tla ?? "", m.competition.code],
    accessories: [
      ...(fav ? [{ icon: { source: Icons.starFilled, tint: "yellow" as const }, tooltip: "One of your teams" }] : []),
      ...(!live && !done ? [{ text: localDate(m.utcDate), tooltip: until(m.utcDate) }] : []),
      { tag: look.text, color: look.color },
    ],
    detail: {
      stats: [
        {
          label: home,
          value: m.score.fullTime.home ?? "–",
          color: m.score.winner === "HOME_TEAM" ? "green" : undefined,
        },
        {
          label: away,
          value: m.score.fullTime.away ?? "–",
          color: m.score.winner === "AWAY_TEAM" ? "green" : undefined,
        },
      ],
      markdown: [
        `## ${m.homeTeam.name} – ${m.awayTeam.name}`,
        live || done
          ? `**${score}** · ${look.text}`
          : `Kick-off **${localDate(m.utcDate)} at ${localTime(m.utcDate)}** (${until(m.utcDate)})`,
        half && half.home !== null && half.away !== null ? `Half-time: ${half.home} – ${half.away}` : "",
      ].filter(Boolean).join("\n\n"),
      metadata: [
        meta.text("Competition", m.competition.name, { icon: Icons.flag }),
        ...(roundName(m) ? [meta.text("Round", roundName(m))] : []),
        ...(m.group
          ? [meta.text("Group", m.group.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase()))]
          : []),
        meta.text("Kick-off", `${localDate(m.utcDate)}, ${localTime(m.utcDate)}`, { icon: Icons.clock }),
        meta.tags("Status", [{ text: look.text, color: look.color }]),
        ...(m.venue ? [meta.text("Venue", m.venue, { icon: Icons.pin })] : []),
        ...(m.referees?.[0] ? [meta.text("Referee", m.referees[0].name)] : []),
      ],
    },
    actions: [
      action(`${home}: Next Matches`, () => teamView(m.homeTeam, ctx), { icon: Icons.calendar }),
      action(`${away}: Next Matches`, () => teamView(m.awayTeam, ctx), { icon: Icons.calendar }),
      copy(
        `${m.homeTeam.name} ${live || done ? score : "–"} ${m.awayTeam.name} (${m.competition.name}, ${look.text})`,
        "Copy Score",
        {
          shortcut: "<Ctrl><Shift>c",
        },
      ),
      open(url, "Search the Web", { icon: Icons.search, shortcut: "<Ctrl>o" }),
      favouriteAction(m.homeTeam, favourites, "<Ctrl>s"),
      favouriteAction(m.awayTeam, favourites),
      refreshAction,
    ],
  };
}

function inRange(m: Match, filter: string, today: string): boolean {
  const day = localDay(new Date(m.utcDate));
  switch (filter) {
    case "live":
      return isLive(m.status);
    case "yesterday":
      return day === shiftDay(today, -1);
    case "tomorrow":
      return day === shiftDay(today, 1);
    case "week":
      return day >= today && day <= shiftDay(today, 7) && !isOver(m.status);
    default:
      return day === today || isLive(m.status);
  }
}

export default (ctx: Context) =>
  list({
    placeholder: "Filter matches by team or competition…",
    filter: { options: FILTERS, default: "today" },
    empty: {
      title: "No match",
      description: ctx.filter === "mine"
        ? "Add teams to your favourites with Ctrl+S on a match or in Football Standings"
        : "Nothing in your competitions for this day: try Next 7 Days, or add competitions in Settings",
      icon: Icons.calendar,
    },
    status: (items) => {
      const live = items.filter((i) => i.section === "Live").length;
      return items[0]?.id === "setup" ? "Not connected" : `${items.length} matches${live ? ` · ${live} live` : ""}`;
    },
    items: ({ preferences, signal, filter }) =>
      guarded(async () => {
        const token = footballToken(preferences);
        const favs = await favouriteTeams();
        const ids = new Set(favs.map((t) => t.id));
        const force = fresh;
        fresh = false;
        if (filter === "mine") {
          const lists = await Promise.all(
            favs.map((t) => teamMatches(token, t, signal, force).catch(() => [] as Match[])),
          );
          return favs.flatMap((team, i) =>
            lists[i].map((m) => matchItem(m, ids, ctx, isLive(m.status) ? "Live" : teamName(team)))
          );
        }
        const today = localDay();
        const codes = competitionCodes(preferences.competitions);
        const all = await matches(token, codes, shiftDay(today, -1), shiftDay(today, 8), { signal, fresh: force });
        return sortMatches(all.filter((m) => inRange(m, filter ?? "today", today)), ids)
          .map((m) => matchItem(m, ids, ctx, filter === "week" ? localDate(m.utcDate) : undefined));
      }),
  });
