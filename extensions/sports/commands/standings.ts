import {
  action,
  type Context,
  copy,
  Icons,
  type Item,
  list,
  type ListSpec,
  meta,
  refresh,
  toast,
} from "@backslash/api";
import {
  favouriteTeams,
  footballToken,
  guarded,
  standings,
  teamMatches,
  teamResults,
  toggleFavourite,
} from "../api.ts";
import {
  competitionCodes,
  COMPETITIONS,
  formColor,
  formOf,
  localDate,
  localTime,
  mainTables,
  type Match,
  resultFor,
  roundName,
  scoreText,
  type StandingRow,
  type Team,
  teamName,
  until,
} from "../lib.ts";

/** A team's next matches and latest results. */
export function teamView(team: Team, _ctx?: Context): ListSpec {
  return list({
    title: team.name,
    placeholder: "Filter matches…",
    empty: {
      title: "No match planned",
      description: "football-data.org lists none for this team",
      icon: Icons.calendar,
    },
    actions: [
      action("Toggle Favourite", async () => {
        const added = await toggleFavourite(team);
        await toast(added ? `${teamName(team)} added to your teams` : `${teamName(team)} removed`, {
          style: "success",
        });
      }, { icon: Icons.star, shortcut: "<Ctrl>s" }),
    ],
    items: ({ preferences, signal }) =>
      guarded(async () => {
        const token = footballToken(preferences);
        const [next, last] = await Promise.all([teamMatches(token, team, signal), teamResults(token, team, signal)]);
        const row = (m: Match, section: string): Item => {
          const result = resultFor(m, team.id);
          const other = m.homeTeam.id === team.id ? m.awayTeam : m.homeTeam;
          const where = m.homeTeam.id === team.id ? "home" : "away";
          return {
            id: String(m.id),
            title: `${teamName(m.homeTeam)} ${section === "Results" ? scoreText(m) : "–"} ${teamName(m.awayTeam)}`,
            subtitle: [m.competition.name, roundName(m)].filter(Boolean).join(" · "),
            icon: other.crest ?? Icons.dot,
            section,
            accessories: [
              { tag: where, color: "gray" },
              ...(result ? [{ tag: result, color: formColor(result) }] : []),
              {
                text: `${localDate(m.utcDate)}${section === "Results" ? "" : `, ${localTime(m.utcDate)}`}`,
                tooltip: until(m.utcDate),
              },
            ],
            actions: [
              copy(
                `${m.homeTeam.name} – ${m.awayTeam.name}, ${localDate(m.utcDate)} ${localTime(m.utcDate)}`,
                "Copy Match",
              ),
            ],
          };
        };
        return [...next.map((m) => row(m, "Next")), ...last.map((m) => row(m, "Results"))];
      }),
  });
}

function standingItem(
  r: StandingRow,
  group: string | undefined,
  favourites: Set<number>,
  size: number,
  ctx: Context,
): Item {
  const form = formOf(r.form);
  const fav = favourites.has(r.team.id);
  const zone = r.position <= 4 ? "blue" : r.position > size - 3 ? "red" : "gray";
  return {
    id: `${group ?? ""}|${r.team.id}`,
    title: `${r.position}. ${r.team.shortName ?? r.team.name}`,
    subtitle: form.length ? form.join(" ") : `${r.playedGames} played`,
    icon: r.team.crest ?? { source: Icons.dot, tint: zone },
    section: group,
    keywords: [r.team.name, r.team.tla ?? ""],
    accessories: [
      ...(fav ? [{ icon: { source: Icons.starFilled, tint: "yellow" as const }, tooltip: "One of your teams" }] : []),
      { text: `${r.goalDifference > 0 ? "+" : ""}${r.goalDifference}`, tooltip: "Goal difference" },
      { text: `${r.playedGames} P`, tooltip: "Played" },
      { tag: `${r.points} pts`, color: zone === "gray" ? "gray" : zone },
    ],
    detail: {
      stats: [
        { label: "Position", value: r.position },
        { label: "Points", value: r.points },
        { label: "Played", value: r.playedGames },
      ],
      metadata: [
        meta.text("Won · Drawn · Lost", `${r.won} · ${r.draw} · ${r.lost}`),
        meta.text(
          "Goals",
          `${r.goalsFor} for, ${r.goalsAgainst} against (${r.goalDifference > 0 ? "+" : ""}${r.goalDifference})`,
        ),
        ...(form.length ? [meta.tags("Form", form.map((f) => ({ text: f, color: formColor(f) })))] : []),
      ],
    },
    actions: [
      action("Next Matches and Results", () => teamView(r.team, ctx), { icon: Icons.calendar }),
      action(fav ? "Remove from Favourites" : "Add to Favourites", async () => {
        const added = await toggleFavourite(r.team);
        await toast(added ? `${teamName(r.team)} added to your teams` : `${teamName(r.team)} removed`, {
          style: "success",
        });
        return refresh();
      }, { icon: fav ? Icons.starFilled : Icons.star, shortcut: "<Ctrl>s" }),
      copy(`${r.position}. ${r.team.name}: ${r.points} pts (${r.playedGames} played)`, "Copy Line", {
        shortcut: "<Ctrl><Shift>c",
      }),
    ],
  };
}

export default (ctx: Context) => {
  const codes = competitionCodes(ctx.preferences.competitions).filter((c) => c !== "WC" && c !== "EC");
  return list({
    placeholder: "Filter teams…",
    filter: { options: codes.map((c) => ({ value: c, title: COMPETITIONS[c] ?? c })), default: codes[0] },
    empty: { title: "No table yet", description: "The season hasn't started, or this is a cup", icon: Icons.chartUp },
    status: (items) => (items[0]?.id === "setup" ? "Not connected" : `${items.length} teams`),
    items: ({ preferences, signal, filter }) =>
      guarded(async () => {
        const token = footballToken(preferences);
        const code = filter && codes.includes(filter) ? filter : codes[0];
        const [table, favs] = await Promise.all([standings(token, code, signal), favouriteTeams()]);
        const ids = new Set(favs.map((t) => t.id));
        const tables = mainTables(table);
        return tables.flatMap((t) => {
          const group = tables.length > 1 && t.group
            ? t.group.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase())
            : undefined;
          return t.table.map((r) => standingItem(r, group, ids, t.table.length, ctx));
        });
      }),
  });
};
