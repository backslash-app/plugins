// Navitia (api.navitia.io) with a token, and the favourite stops.

import { Icons, type Item, open, storage } from "@backslash/api";
import {
  coordId,
  type Departure,
  type Disruption,
  mergePlaces,
  type NavDeparture,
  navError,
  type NavJourney,
  type NavPlace,
  type Place,
  toDeparture,
  toNav,
  toPlace,
} from "./lib.ts";

export const HOSTS = ["api.navitia.io"];

const BASE = "https://api.navitia.io/v1";
export const TOKEN_URL = "https://navitia.io/inscription";

export class SetupError extends Error {}
export class NoSolution extends Error {}

export function token(preferences: Record<string, unknown>): string {
  const t = String(preferences.token ?? "").trim();
  if (!t) throw new SetupError("Add your Navitia token in Settings");
  return t;
}

interface NavErrorBody {
  error?: { id?: string; message?: string };
  message?: string;
}

async function navitia<T>(tok: string, path: string, signal?: AbortSignal): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, { signal, headers: { Authorization: tok, Accept: "application/json" } });
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") throw e;
    throw new Error("Navitia can't be reached: check your connection");
  }
  const body = await res.json().catch(() => undefined) as (T & NavErrorBody) | undefined;
  if (res.status === 401 || res.status === 403) {
    throw new SetupError(`Navitia refused the token${body?.message ? ` (${body.message})` : ""}: check it in Settings`);
  }
  if (res.status === 429) throw new Error("Navitia's daily quota is used up: try again later");
  if (body?.error) {
    if (body.error.id === "no_solution") throw new NoSolution(navError(body.error.id, body.error.message));
    throw new Error(navError(body.error.id, body.error.message));
  }
  if (!res.ok || !body) throw new Error(`Navitia answered ${res.status}`);
  return body;
}

// ---------------------------------------------------------------------------
// Places

const PLACE_TYPES = ["stop_area", "address", "administrative_region", "poi"];

/** Places matching `q` in each coverage, merged by Navitia's quality score. */
export async function searchPlaces(
  tok: string,
  q: string,
  regions: string[],
  { stopsOnly = false, signal }: { stopsOnly?: boolean; signal?: AbortSignal } = {},
): Promise<Place[]> {
  const scores = new Map<string, number>();
  const params = new URLSearchParams({ q, count: "12", depth: "1", disable_geojson: "true" });
  for (const t of stopsOnly ? ["stop_area"] : PLACE_TYPES) params.append("type[]", t);
  const results = await Promise.allSettled(regions.map(async (r) => {
    const { places = [] } = await navitia<{ places?: NavPlace[] }>(
      tok,
      `/coverage/${encodeURIComponent(r)}/places?${params}`,
      signal,
    );
    return places.map((p) => {
      scores.set(p.id, Math.max(scores.get(p.id) ?? 0, p.quality ?? 0));
      return toPlace(p, r);
    });
  }));
  const ok = results.filter((r): r is PromiseFulfilledResult<Place[]> => r.status === "fulfilled").map((r) => r.value);
  if (!ok.length && results[0]?.status === "rejected") throw results[0].reason;
  return mergePlaces(ok, scores);
}

// ---------------------------------------------------------------------------
// Departures

export interface Board {
  departures: Departure[];
  /** The network's "now", in its own time zone. */
  now: string;
  /** Disruptions of the stop itself. */
  disruptions: Disruption[];
}

export async function departures(tok: string, stop: Place, signal?: AbortSignal, count = 10): Promise<Board> {
  const params = new URLSearchParams({
    count: String(count),
    data_freshness: "realtime",
    depth: "1",
    disable_geojson: "true",
  });
  const kind = stop.kind === "stop_point" ? "stop_points" : "stop_areas";
  const body = await navitia<{
    departures?: NavDeparture[];
    disruptions?: (Disruption & { impacted_objects?: { pt_object?: { id?: string } }[] })[];
    context?: { current_datetime?: string };
  }>(
    tok,
    `/coverage/${encodeURIComponent(stop.coverage)}/${kind}/${encodeURIComponent(stop.id)}/departures?${params}`,
    signal,
  );
  const byId = new Map((body.disruptions ?? []).map((d) => [d.id, d]));
  return {
    departures: (body.departures ?? []).map((d) => toDeparture(d, byId)),
    now: body.context?.current_datetime ?? toNav(new Date()),
    disruptions: (body.disruptions ?? []).filter((d) =>
      d.status !== "past" && d.impacted_objects?.some((o) => o.pt_object?.id === stop.id)
    ),
  };
}

// ---------------------------------------------------------------------------
// Journeys

export interface Plan {
  journeys: NavJourney[];
  now: string;
}

/** Journeys between two places; across coverages, Navitia picks the region from the coordinates. */
export async function journeys(
  tok: string,
  from: Place,
  to: Place,
  when: Date | string | undefined,
  signal?: AbortSignal,
): Promise<Plan> {
  const same = from.coverage === to.coverage;
  const point = (p: Place) => (same || !p.coord ? p.id : coordId(p.coord));
  const params = new URLSearchParams({
    from: point(from),
    to: point(to),
    count: "6",
    depth: "1",
    data_freshness: "realtime",
    disable_geojson: "true",
    datetime_represents: "departure",
  });
  if (when) params.set("datetime", typeof when === "string" ? when : toNav(when));
  const path = same ? `/coverage/${encodeURIComponent(from.coverage)}/journeys` : "/journeys";
  const body = await navitia<{ journeys?: NavJourney[]; context?: { current_datetime?: string } }>(
    tok,
    `${path}?${params}`,
    signal,
  );
  const list = (body.journeys ?? []).filter((j) => j.sections?.length);
  if (!list.length) throw new NoSolution("No journey found at this time");
  return { journeys: list, now: body.context?.current_datetime ?? toNav(new Date()) };
}

// ---------------------------------------------------------------------------
// Favourites and recent places

type Json = Parameters<typeof storage.set>[1];

const read = async (key: string): Promise<Place[]> => ((await storage.get(key)) ?? []) as unknown as Place[];

export const favourites = () => read("favourites");

export async function addFavourite(p: Place): Promise<void> {
  const all = await favourites();
  if (!all.some((f) => f.id === p.id)) await storage.set("favourites", [...all, p] as unknown as Json);
}

export async function removeFavourite(p: Place): Promise<void> {
  await storage.set("favourites", (await favourites()).filter((f) => f.id !== p.id) as unknown as Json);
}

export async function moveFavourite(p: Place, by: number): Promise<void> {
  const all = await favourites();
  const i = all.findIndex((f) => f.id === p.id);
  const j = i + by;
  if (i < 0 || j < 0 || j >= all.length) return;
  [all[i], all[j]] = [all[j], all[i]];
  await storage.set("favourites", all as unknown as Json);
}

export const recentPlaces = () => read("recent");

export async function rememberPlace(p: Place): Promise<void> {
  const all = (await recentPlaces()).filter((r) => r.id !== p.id);
  await storage.set("recent", [p, ...all].slice(0, 8) as unknown as Json);
}

export function setupItem(e: SetupError): Item {
  return {
    id: "setup",
    title: e.message,
    subtitle: "A free Navitia token: 5,000 requests a day",
    icon: { source: Icons.key, tint: "orange" },
    detail: {
      markdown: [
        "## Connect Navitia",
        "",
        "Navitia gives timetables, real time and journeys for SNCF trains, Île-de-France (RATP, Transilien),",
        "and most French city networks.",
        "",
        "1. Sign up on **navitia.io** (Enter opens the page); the token arrives by email.",
        "2. Paste it in **Settings → Extensions → Public Transport → Configure**.",
        "3. Optionally set the **coverage**: `auto` searches `sncf` and `fr-idf`; name others",
        "   (`fr-se`, `fr-ne`…) separated by commas.",
      ].join("\n"),
    },
    actions: [open(TOKEN_URL, "Get a Navitia Token", { icon: Icons.key })],
  };
}
