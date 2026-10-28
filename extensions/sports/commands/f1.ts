import {
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
  updateCommandMetadata,
} from "@backslash/api";
import {
  constructorStandings,
  driverStandings,
  favouriteDrivers,
  lastResults,
  schedule,
  toggleDriver,
} from "../api.ts";
import {
  type Driver,
  driverName,
  localDate,
  localTime,
  placesGained,
  type Race,
  resultTime,
  sessions,
  teamColor,
  until,
} from "../lib.ts";

const FILTERS = [
  { value: "next", title: "Next Race" },
  { value: "results", title: "Last Results" },
  { value: "drivers", title: "Drivers" },
  { value: "constructors", title: "Constructors" },
  { value: "calendar", title: "Calendar" },
];

let fresh = false;
const refreshAction = action("Refresh", () => {
  fresh = true;
  return refresh();
}, { icon: Icons.refresh, shortcut: "<Ctrl>r" });

const where = (r: Race) => `${r.Circuit.Location.locality}, ${r.Circuit.Location.country}`;

function driverAction(d: Driver, favourites: Set<string>) {
  const has = favourites.has(d.driverId);
  return action(has ? "Remove from Favourites" : "Add to Favourites", async () => {
    const added = await toggleDriver(d.driverId);
    await toast(added ? `${driverName(d)} added to your drivers` : `${driverName(d)} removed`, { style: "success" });
    return refresh();
  }, { icon: has ? Icons.starFilled : Icons.star, shortcut: "<Ctrl>s" });
}

const star = (on: boolean) => (on ? [{ icon: { source: Icons.starFilled, tint: "yellow" as const } }] : []);

function nextRaceItems(all: Race[], now: number): Item[] {
  // The next race is the first whose race start hasn't passed by more than three hours.
  const race = all.find((r) => Date.parse(sessions(r).at(-1)!.start) + 3 * 3600_000 > now);
  if (!race) return [];
  const list = sessions(race);
  const live = list.find((s) => Date.parse(s.start) <= now && Date.parse(s.start) + 2 * 3600_000 > now);
  const upcoming = list.find((s) => Date.parse(s.start) > now);
  const sprint = list.some((s) => s.name === "Sprint");
  updateCommandMetadata({
    subtitle: upcoming ? `${race.raceName}: ${upcoming.name} ${until(upcoming.start, now)}` : null,
  }).catch(() => {});
  const text = [
    `${race.raceName} (round ${race.round}), ${race.Circuit.circuitName}`,
    ...list.map((s) => `${s.name}: ${localDate(s.start)}${s.timeKnown ? ` ${localTime(s.start)}` : ""}`),
  ].join("\n");
  return list.map((s) => {
    const past = Date.parse(s.start) + 2 * 3600_000 <= now;
    const isLive = s === live;
    return {
      id: `${race.round}|${s.name}`,
      title: s.name,
      subtitle: `${localDate(s.start)}${s.timeKnown ? `, ${localTime(s.start)}` : ""}`,
      icon: {
        source: s.name === "Race" ? Icons.flag : isLive ? Icons.play : past ? Icons.done : Icons.clock,
        tint: isLive ? "red" : past ? "gray" : s.name === "Race" ? "green" : "blue",
      },
      section: `Round ${race.round} · ${race.raceName}`,
      accessories: [
        ...(isLive ? [{ tag: "live", color: "red" as const }] : []),
        ...(sprint && s.name.startsWith("Sprint") ? [{ tag: "sprint", color: "purple" as const }] : []),
        { text: past ? "done" : until(s.start, now) },
      ],
      detail: {
        stats: [
          { label: "Starts", value: s.timeKnown ? localTime(s.start) : "TBC" },
          { label: "Countdown", value: past ? "done" : until(s.start, now).replace("in ", "") },
        ],
        markdown: `## ${race.raceName}\n\n${race.Circuit.circuitName}, ${where(race)}\n\n` +
          list.map((x) => `- **${x.name}**: ${localDate(x.start)}${x.timeKnown ? `, ${localTime(x.start)}` : ""}`).join(
            "\n",
          ),
        metadata: [
          meta.text("Round", `${race.round} of ${all.length}`),
          meta.text("Circuit", race.Circuit.circuitName, { icon: Icons.pin }),
          meta.text("Where", where(race), { icon: Icons.globe }),
          meta.text("Times", "Your local time", { icon: Icons.clock }),
          ...(race.url ? [meta.link("About", "Wikipedia", race.url)] : []),
        ],
      },
      actions: [
        copy(text, "Copy Weekend Schedule", { shortcut: "<Ctrl><Shift>c" }),
        ...(race.url ? [open(race.url, "Open on Wikipedia", { icon: Icons.book, shortcut: "<Ctrl>o" })] : []),
        refreshAction,
      ],
    };
  });
}

async function resultItems(signal: AbortSignal, favourites: Set<string>): Promise<Item[]> {
  const race = await lastResults(signal, fresh);
  if (!race) return [];
  const section = `${race.raceName} · ${localDate(`${race.date}T12:00:00Z`)}`;
  return (race.Results ?? []).map((r) => {
    const gained = placesGained(r);
    const fastest = r.FastestLap?.rank === "1";
    const time = resultTime(r);
    return {
      id: r.Driver.driverId,
      title: `${r.positionText}. ${driverName(r.Driver)}`,
      subtitle: r.Constructor.name,
      icon: { source: Icons.square, tint: teamColor(r.Constructor.constructorId) },
      section,
      keywords: [r.Driver.code ?? "", r.Driver.familyName, r.Constructor.name],
      accessories: [
        ...star(favourites.has(r.Driver.driverId)),
        ...(fastest ? [{ tag: "fastest lap", color: "purple" as const, tooltip: r.FastestLap?.Time?.time }] : []),
        ...(gained
          ? [{
            text: gained > 0 ? `▲${gained}` : `▼${-gained}`,
            color: gained > 0 ? "green" as const : "red" as const,
            tooltip: `Started P${r.grid}`,
          }]
          : []),
        ...(time ? [{ text: time }] : []),
        { tag: `${r.points} pts`, color: Number(r.points) > 0 ? "blue" as const : "gray" as const },
      ],
      detail: {
        stats: [
          { label: "Position", value: r.positionText },
          { label: "Grid", value: r.grid === "0" ? "Pit lane" : r.grid },
          { label: "Points", value: r.points },
        ],
        metadata: [
          meta.text("Team", r.Constructor.name, { icon: Icons.square, color: undefined }),
          meta.text("Laps", r.laps),
          meta.text("Status", r.status),
          ...(r.Time?.time ? [meta.text("Time", r.Time.time, { icon: Icons.timer })] : []),
          ...(r.FastestLap?.Time
            ? [meta.text("Fastest lap", `${r.FastestLap.Time.time} (lap ${r.FastestLap.lap}, #${r.FastestLap.rank})`)]
            : []),
          ...(r.Driver.nationality ? [meta.text("Nationality", r.Driver.nationality)] : []),
        ],
      },
      actions: [
        copy(
          `${race.raceName}: P${r.positionText} ${driverName(r.Driver)} (${r.Constructor.name})${
            time ? ` ${time}` : ""
          }`,
          "Copy Result",
          {
            shortcut: "<Ctrl><Shift>c",
          },
        ),
        driverAction(r.Driver, favourites),
        ...(race.url ? [open(race.url, "Open Race on Wikipedia", { icon: Icons.book, shortcut: "<Ctrl>o" })] : []),
        refreshAction,
      ],
    };
  });
}

async function driverItems(signal: AbortSignal, favourites: Set<string>): Promise<Item[]> {
  const { rows, round, season } = await driverStandings(signal, fresh);
  const leader = Number(rows[0]?.points ?? 0);
  return rows.map((s) => {
    const team = s.Constructors.at(-1);
    const gap = leader - Number(s.points);
    return {
      id: s.Driver.driverId,
      title: `${s.positionText}. ${driverName(s.Driver)}`,
      subtitle: team?.name,
      icon: { source: Icons.square, tint: teamColor(team?.constructorId ?? "") },
      section: `${season} drivers · after round ${round}`,
      keywords: [s.Driver.code ?? "", s.Driver.familyName],
      accessories: [
        ...star(favourites.has(s.Driver.driverId)),
        ...(Number(s.wins) ? [{ text: `${s.wins} win${s.wins === "1" ? "" : "s"}`, icon: Icons.flag }] : []),
        ...(gap > 0 ? [{ text: `−${gap}`, tooltip: "Points behind the leader" }] : []),
        { tag: `${s.points} pts`, color: s.positionText === "1" ? "yellow" as const : "blue" as const },
      ],
      actions: [
        copy(`${s.positionText}. ${driverName(s.Driver)}: ${s.points} pts`, "Copy Line", {
          shortcut: "<Ctrl><Shift>c",
        }),
        driverAction(s.Driver, favourites),
        ...(s.Driver.url ? [open(s.Driver.url, "Open on Wikipedia", { icon: Icons.book, shortcut: "<Ctrl>o" })] : []),
        refreshAction,
      ],
    };
  });
}

async function constructorItems(signal: AbortSignal): Promise<Item[]> {
  const { rows, round, season } = await constructorStandings(signal, fresh);
  const leader = Number(rows[0]?.points ?? 0);
  return rows.map((s) => ({
    id: s.Constructor.constructorId,
    title: `${s.positionText}. ${s.Constructor.name}`,
    subtitle: s.Constructor.nationality,
    icon: { source: Icons.square, tint: teamColor(s.Constructor.constructorId) },
    section: `${season} constructors · after round ${round}`,
    accessories: [
      ...(Number(s.wins) ? [{ text: `${s.wins} win${s.wins === "1" ? "" : "s"}`, icon: Icons.flag }] : []),
      ...(leader - Number(s.points) > 0
        ? [{ text: `−${leader - Number(s.points)}`, tooltip: "Points behind the leader" }]
        : []),
      { tag: `${s.points} pts`, color: s.positionText === "1" ? "yellow" as const : "blue" as const },
    ],
    actions: [
      copy(`${s.positionText}. ${s.Constructor.name}: ${s.points} pts`, "Copy Line", { shortcut: "<Ctrl><Shift>c" }),
      ...(s.Constructor.url
        ? [open(s.Constructor.url, "Open on Wikipedia", { icon: Icons.book, shortcut: "<Ctrl>o" })]
        : []),
      refreshAction,
    ],
  }));
}

function calendarItems(all: Race[], now: number): Item[] {
  return all.map((r) => {
    const race = sessions(r).at(-1)!;
    const past = Date.parse(race.start) + 3 * 3600_000 <= now;
    const sprint = !!r.Sprint;
    return {
      id: r.round,
      title: `${r.round}. ${r.raceName}`,
      subtitle: where(r),
      icon: { source: past ? Icons.done : Icons.flag, tint: past ? "gray" : "green" },
      section: past ? "Done" : "Coming Up",
      keywords: [r.Circuit.circuitName, r.Circuit.Location.country],
      accessories: [
        ...(sprint ? [{ tag: "sprint", color: "purple" as const }] : []),
        {
          text: `${localDate(race.start)}${race.timeKnown ? `, ${localTime(race.start)}` : ""}`,
          tooltip: past ? undefined : until(race.start, now),
        },
      ],
      actions: [
        ...(r.url ? [open(r.url, "Open on Wikipedia", { icon: Icons.book })] : []),
        copy(
          `${r.raceName}: ${localDate(race.start)} ${race.timeKnown ? localTime(race.start) : ""}`.trim(),
          "Copy Date",
        ),
        refreshAction,
      ],
    };
  });
}

export default (_ctx: Context) =>
  list({
    placeholder: "Filter drivers, teams, sessions…",
    filter: { options: FILTERS, default: "next" },
    empty: {
      title: "Nothing to show",
      description: "The season is over or hasn't started yet: see the Calendar",
      icon: Icons.flag,
    },
    async items({ signal, filter }) {
      const favourites = new Set(await favouriteDrivers());
      const now = Date.now();
      let items: Item[];
      switch (filter) {
        case "results":
          items = await resultItems(signal, favourites);
          break;
        case "drivers":
          items = await driverItems(signal, favourites);
          break;
        case "constructors":
          items = await constructorItems(signal);
          break;
        case "calendar":
          items = calendarItems(await schedule(signal), now);
          break;
        default:
          items = nextRaceItems(await schedule(signal), now);
      }
      fresh = false;
      return items;
    },
  });
