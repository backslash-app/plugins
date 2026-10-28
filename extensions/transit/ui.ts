// Views shared by the two commands: place search, a stop's departures, journeys.

import {
  type Action,
  action,
  type Context,
  copy,
  Icons,
  type Item,
  list,
  type ListSpec,
  meta,
  open,
  type Outcome,
  refresh,
  toast,
} from "@backslash/api";
import {
  addFavourite,
  type Board,
  departures,
  favourites,
  journeys,
  NoSolution,
  type Plan,
  recentPlaces,
  rememberPlace,
  searchPlaces,
  SetupError,
  setupItem,
  token,
} from "./api.ts";
import {
  clock,
  co2,
  coverages,
  delayLook,
  type Departure,
  disruptionColor,
  disruptionText,
  duration,
  journeyMarkdown,
  journeyType,
  kindIcon,
  kindLabel,
  legs,
  legsSummary,
  minutesUntil,
  type NavJourney,
  navMinutes,
  type Place,
  shortStop,
  tint,
  transfers,
  wait,
} from "./lib.ts";

export const guarded = async (load: () => Promise<Item[]>): Promise<Item[]> => {
  try {
    return await load();
  } catch (e) {
    if (e instanceof SetupError) return [setupItem(e)];
    throw e;
  }
};

export const placeSubtitle = (p: Place) =>
  [kindLabel(p.kind), p.city && !p.name.includes(p.city) ? p.city : "", p.coverage].filter(Boolean).join(" · ");

/** A search over Navitia places; `pick` decides what Enter does. */
export function placeSearch(
  title: string,
  pick: Pick_,
  options: { stopsOnly?: boolean; pickTitle: string; suggestions?: () => Promise<Place[]> },
): ListSpec {
  return list({
    title,
    placeholder: options.stopsOnly ? "Search a station or stop…" : "Search a station, address or city…",
    empty: { title: "Type a place", description: "A station, a stop, an address or a city", icon: Icons.search },
    async search(query, ctx) {
      return await guarded(async () => {
        const q = query.trim();
        if (!q) {
          const suggested = options.suggestions ? await options.suggestions() : [];
          return suggested.map((p) => placeItem(p, pick, options.pickTitle, "Suggestions"));
        }
        const tok = token(ctx.preferences);
        const places = await searchPlaces(tok, q, coverages(ctx.preferences.coverage), {
          stopsOnly: options.stopsOnly,
          signal: ctx.signal,
        });
        return places.map((p) => placeItem(p, pick, options.pickTitle));
      });
    },
  });
}

type Pick_ = (p: Place, ctx: Context) => Outcome | Promise<Outcome>;

function placeItem(p: Place, pick: Pick_, pickTitle: string, section?: string): Item {
  return {
    id: `${p.coverage}|${p.id}`,
    title: p.name,
    subtitle: placeSubtitle(p),
    icon: { source: kindIcon(p.kind), tint: p.kind === "stop_area" ? "blue" : "gray" },
    section,
    accessories: [{ tag: kindLabel(p.kind), color: "gray" }],
    actions: [
      action(pickTitle, (ctx) => pick(p, ctx), { icon: Icons.arrowRight }),
      ...(p.kind === "stop_area"
        ? [
          action("Add to Favourites", async () => {
            await addFavourite(p);
            await toast(`${shortStop(p.name)} added to your stops`, { style: "success" });
          }, { icon: Icons.star, shortcut: "<Ctrl>s" }),
          action("Show Departures", () => boardView(p), { icon: Icons.clock, shortcut: "<Ctrl>d" }),
        ]
        : []),
      copy(p.name, "Copy Name", { section: "Copy" }),
      ...(p.coord
        ? [
          open(
            `https://www.openstreetmap.org/?mlat=${p.coord.lat}&mlon=${p.coord.lon}#map=17/${p.coord.lat}/${p.coord.lon}`,
            "Show on Map",
            {
              icon: Icons.globe,
              shortcut: "<Ctrl>o",
            },
          ),
        ]
        : []),
    ],
  };
}

// ---------------------------------------------------------------------------
// Departures

export function departureItem(d: Departure, stop: Place, now: string, extra: Action[] = []): Item {
  const minutes = minutesUntil(d.time, now);
  const look = delayLook(d);
  const disrupted = d.disruptions.length > 0;
  const worst = d.disruptions[0];
  return {
    id: `${stop.id}|${d.line}|${d.direction}|${d.base ?? d.time}`,
    title: `${d.line} → ${d.direction}`,
    subtitle: [
      d.network && !d.line.includes(d.network) ? d.network : "",
      d.platform && d.platform !== stop.name ? shortStop(d.platform) : "",
    ]
      .filter(Boolean).join(" · "),
    icon: { source: Icons.square, tint: tint(d.color) },
    section: shortStop(stop.name),
    keywords: [d.code, d.mode, d.direction, d.network ?? ""],
    accessories: [
      ...(disrupted
        ? [{ icon: { source: Icons.alert, tint: disruptionColor(worst) }, tooltip: disruptionText(worst) }]
        : []),
      { tag: look.text, color: look.color, tooltip: d.realtime ? "Real time" : "Timetable, no real time" },
      {
        text: `${clock(d.time)} · ${wait(minutes)}`,
        tooltip: d.base && d.base !== d.time ? `Scheduled ${clock(d.base)}` : undefined,
      },
    ],
    detail: {
      stats: [
        { label: "Leaves in", value: wait(minutes), color: minutes <= 2 ? "orange" : undefined },
        { label: "Delay", value: look.text, color: look.color },
      ],
      markdown: [
        `## ${d.line} → ${d.direction}`,
        ...d.disruptions.map((x) =>
          `> **${x.severity?.name ?? "Disruption"}**\n>\n> ${disruptionText(x).replace(/\n/g, "\n> ")}`
        ),
        ...d.extra.map((x) => `*${x.replace(/_/g, " ")}*`),
      ].join("\n\n"),
      metadata: [
        meta.text("Departs", clock(d.time), { icon: Icons.clock, color: look.color }),
        ...(d.base && d.base !== d.time ? [meta.text("Scheduled", clock(d.base))] : []),
        meta.tags("Line", [{ text: d.line }]),
        meta.text("Direction", d.direction, { icon: Icons.arrowRight }),
        ...(d.mode ? [meta.text("Mode", d.mode)] : []),
        ...(d.network ? [meta.text("Network", d.network)] : []),
        ...(d.platform ? [meta.text("From", shortStop(d.platform), { icon: Icons.pin })] : []),
        meta.text("Data", d.realtime ? "Real time" : "Timetable"),
      ],
    },
    actions: [
      copy(`${d.line} → ${d.direction} at ${clock(d.time)} (${look.text})`, "Copy Departure", {
        shortcut: "<Ctrl><Shift>c",
      }),
      action("Refresh", () => refresh(), { icon: Icons.refresh, shortcut: "<Ctrl>r" }),
      ...extra,
    ],
  };
}

export function boardItems(board: Board, stop: Place, extra: Action[] = []): Item[] {
  const alerts: Item[] = board.disruptions.map((x) => ({
    id: `alert|${stop.id}|${x.id}`,
    title: x.severity?.name ?? "Disruption",
    subtitle: disruptionText(x).split("\n")[0],
    icon: { source: Icons.alert, tint: disruptionColor(x) },
    section: shortStop(stop.name),
    detail: { markdown: disruptionText(x) },
    actions: [copy(disruptionText(x), "Copy Message"), ...extra],
  }));
  return [...alerts, ...board.departures.map((d) => departureItem(d, stop, board.now, extra))];
}

export function boardView(stop: Place): ListSpec {
  return list({
    title: shortStop(stop.name),
    placeholder: "Filter by line or direction…",
    empty: {
      title: "No departure soon",
      description: "Nothing leaves from this stop in the next hours",
      icon: Icons.clock,
    },
    actions: [
      action("Add to Favourites", async () => {
        await addFavourite(stop);
        await toast(`${shortStop(stop.name)} added to your stops`, { style: "success" });
      }, { icon: Icons.star, shortcut: "<Ctrl>s" }),
    ],
    items: (ctx) =>
      guarded(async () => boardItems(await departures(token(ctx.preferences), stop, ctx.signal, 20), stop)),
  });
}

// ---------------------------------------------------------------------------
// Journeys

function journeyItem(j: NavJourney, i: number, now: string, from: Place, to: Place): Item {
  const ls = legs(j);
  const rides = ls.filter((l) => l.kind === "transit");
  const emissions = co2(j);
  const kind = journeyType(j.type);
  const leaves = minutesUntil(j.departure_date_time, now);
  const walking = j.durations?.walking;
  const fare = j.fare?.found && j.fare.total ? `${(Number(j.fare.total.value) / 100).toFixed(2)} €` : undefined;
  const text = [
    `${shortStop(from.name)} → ${shortStop(to.name)}`,
    `${clock(j.departure_date_time)} → ${clock(j.arrival_date_time)} (${duration(j.duration)}, ${
      transfers(j.nb_transfers)
    })`,
    ...ls.filter((l) => l.kind === "transit").map((l) =>
      `${clock(l.depart)} ${l.label}${l.direction ? ` towards ${l.direction}` : ""}: ${l.from} → ${l.to}`
    ),
  ].join("\n");
  return {
    id: `${j.departure_date_time}|${i}`,
    title: `${clock(j.departure_date_time)} → ${clock(j.arrival_date_time)} · ${duration(j.duration)}`,
    subtitle: legsSummary(ls),
    icon: { source: Icons.square, tint: tint(rides[0]?.color) },
    keywords: rides.map((r) => r.label),
    accessories: [
      ...(kind ? [{ tag: kind, color: "blue" as const }] : []),
      { tag: transfers(j.nb_transfers), color: j.nb_transfers === 0 ? "green" as const : "gray" as const },
      ...(emissions ? [{ text: emissions, icon: Icons.leaf, tooltip: "Estimated CO₂ emissions" }] : []),
      { text: leaves > 0 ? `in ${wait(leaves)}` : "now" },
    ],
    detail: {
      stats: [
        { label: "Duration", value: duration(j.duration) },
        { label: "Changes", value: j.nb_transfers },
        ...(emissions ? [{ label: "CO₂", value: emissions.replace(" CO₂", ""), color: "green" as const }] : []),
      ],
      markdown: `## ${shortStop(from.name)} → ${shortStop(to.name)}\n\n${journeyMarkdown(j)}`,
      metadata: [
        meta.text("Leaves", `${clock(j.departure_date_time)} (in ${wait(Math.max(0, leaves))})`, { icon: Icons.clock }),
        meta.text("Arrives", clock(j.arrival_date_time), { icon: Icons.flag }),
        ...(walking ? [meta.text("Walking", duration(walking), { icon: Icons.person })] : []),
        ...(fare ? [meta.text("Fare", fare, { icon: Icons.ticket })] : []),
        meta.tags("Lines", rides.map((r) => ({ text: r.label }))),
        ...(j.status ? [meta.text("Status", j.status.replace(/_/g, " ").toLowerCase(), { color: "orange" })] : []),
      ],
    },
    actions: [
      copy(text, "Copy Journey", { shortcut: "<Ctrl><Shift>c" }),
    ],
  };
}

export function journeysView(from: Place, to: Place, when?: string): ListSpec {
  let last: Plan | undefined;
  const later = action("Later Journeys", () => {
    const end = last?.journeys.at(-1)?.departure_date_time;
    const next = end ? navMinutes(end) : undefined;
    if (!next) return;
    const d = new Date((next + 1) * 60_000);
    const p = (n: number) => String(n).padStart(2, "0");
    const dt = `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}T${p(d.getUTCHours())}${
      p(d.getUTCMinutes())
    }00`;
    return journeysView(from, to, dt);
  }, { icon: Icons.next, shortcut: "<Ctrl>l" });
  const swap = action("Reverse Journey", () => journeysView(to, from), {
    icon: Icons.repeat,
    shortcut: "<Ctrl><Shift>r",
  });
  return list({
    title: `${shortStop(from.name)} → ${shortStop(to.name)}`,
    placeholder: "Filter journeys by line…",
    empty: { title: "No journey found", description: "Try another time, or nearby stops", icon: Icons.search },
    actions: [later, swap],
    status: (items) => (when ? `From ${clock(when)} · ` : "") + `${items.length} journeys`,
    items: (ctx) =>
      guarded(async () => {
        try {
          last = await journeys(token(ctx.preferences), from, to, when, ctx.signal);
        } catch (e) {
          if (e instanceof NoSolution) return [];
          throw e;
        }
        await Promise.all([rememberPlace(from), rememberPlace(to)]).catch(() => {});
        return last.journeys.map((j, i) => {
          const item = journeyItem(j, i, last!.now, from, to);
          return { ...item, actions: [...item.actions!, later, swap] };
        });
      }),
  });
}

/** Favourite stops, then recent places, for the journey planner's empty search. */
export async function suggestions(): Promise<Place[]> {
  const [fav, recent] = await Promise.all([favourites(), recentPlaces()]);
  const seen = new Set<string>();
  return [...recent, ...fav].filter((p) => !seen.has(p.id) && seen.add(p.id));
}
