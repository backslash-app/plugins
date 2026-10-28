import { action, copy, Icons, type Item, list, open, refresh } from "@backslash/api";
import { guarded, nbaGames, nbaKey } from "../api.ts";
import { localDate, localDay, type NbaGame, nbaState, nbaStatus, shiftDay, sortNba } from "../lib.ts";

let fresh = false;
const refreshAction = action("Refresh", () => {
  fresh = true;
  return refresh();
}, { icon: Icons.refresh, shortcut: "<Ctrl>r" });

function gameItem(g: NbaGame): Item {
  const state = nbaState(g);
  const away = g.visitor_team;
  const home = g.home_team;
  const scored = state !== "scheduled";
  const status = nbaStatus(g);
  const awayWon = state === "final" && g.visitor_team_score > g.home_team_score;
  const homeWon = state === "final" && g.home_team_score > g.visitor_team_score;
  const title = scored
    ? `${away.name} ${g.visitor_team_score} – ${g.home_team_score} ${home.name}`
    : `${away.name} @ ${home.name}`;
  return {
    id: String(g.id),
    title,
    subtitle: `${away.full_name} at ${home.full_name}`,
    icon: {
      source: state === "live" ? Icons.play : state === "final" ? Icons.done : Icons.clock,
      tint: state === "live" ? "red" : state === "final" ? "gray" : "blue",
    },
    section: state === "live" ? "Live" : state === "final" ? "Final" : "Upcoming",
    keywords: [away.abbreviation, home.abbreviation, away.city, home.city],
    accessories: [
      ...(g.postseason ? [{ tag: "playoffs", color: "purple" as const }] : []),
      ...(state === "scheduled" ? [{ text: localDate(g.datetime ?? `${g.date}T12:00:00Z`) }] : []),
      { tag: status, color: state === "live" ? "red" as const : state === "final" ? "gray" as const : "blue" as const },
    ],
    detail: {
      stats: [
        { label: away.abbreviation, value: scored ? g.visitor_team_score : "–", color: awayWon ? "green" : undefined },
        { label: home.abbreviation, value: scored ? g.home_team_score : "–", color: homeWon ? "green" : undefined },
      ],
      markdown: `## ${away.full_name} at ${home.full_name}\n\n**${status}**${g.postseason ? " · Playoffs" : ""}`,
    },
    actions: [
      copy(scored ? `${title} (${status})` : `${away.full_name} at ${home.full_name}, ${status}`, "Copy Score", {
        shortcut: "<Ctrl><Shift>c",
      }),
      open(`https://www.nba.com/games`, "Open NBA.com", { icon: Icons.globe, shortcut: "<Ctrl>o" }),
      refreshAction,
    ],
  };
}

export default list({
  placeholder: "Filter games by team…",
  empty: {
    title: "No NBA game",
    description: "No game yesterday, today or tomorrow: the season runs October to June",
    icon: Icons.calendar,
  },
  status: (items) => (items[0]?.id === "setup" ? "Not connected" : `${items.length} games`),
  items: ({ preferences, signal }) =>
    guarded(async () => {
      const key = nbaKey(preferences);
      // NBA dates are US dates: a game at 01:30 in Paris is "yesterday" there.
      const today = localDay();
      const games = await nbaGames(key, [shiftDay(today, -1), today, shiftDay(today, 1)], signal, fresh);
      fresh = false;
      const now = Date.now();
      // Finished games older than a day and a half are old news.
      const recent = games.filter((g) =>
        nbaState(g) !== "final" || now - Date.parse(g.datetime ?? `${g.date}T23:00:00Z`) < 36 * 3600_000
      );
      return sortNba(recent).map(gameItem);
    }),
});
