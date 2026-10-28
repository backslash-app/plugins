// Nager.Date and the Éducation nationale calendar, cached per year in storage.

import { storage } from "@backslash/api";
import {
  addDays,
  type Country,
  type Day,
  type Holiday,
  normalizeCountry,
  normalizeZone,
  type SchoolPeriod,
  schoolPeriods,
  schoolQuery,
  type SchoolRecord,
} from "./lib.ts";

export const HOSTS = ["date.nager.at", "data.education.gouv.fr"];

const NAGER = "https://date.nager.at/api/v3";
const SCHOOL =
  "https://data.education.gouv.fr/api/explore/v2.1/catalog/datasets/fr-en-calendrier-scolaire/exports/json";

type Json = Parameters<typeof storage.set>[1];

interface Cached<T> {
  at: number;
  data: T;
}

async function cached<T>(key: string, maxAge: number, load: () => Promise<T>): Promise<T> {
  const hit = await storage.get(key).catch(() => undefined) as Cached<T> | undefined;
  if (hit && Date.now() - hit.at < maxAge) return hit.data;
  try {
    const data = await load();
    await storage.set(key, { at: Date.now(), data } as unknown as Json).catch(() => {});
    return data;
  } catch (e) {
    // Offline: an old copy is better than nothing, holidays rarely move.
    if (hit && !(e instanceof DOMException && e.name === "AbortError")) return hit.data;
    throw e;
  }
}

async function get<T>(url: string, signal?: AbortSignal, service = "Nager.Date"): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { signal, headers: { Accept: "application/json" } });
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") throw e;
    throw new Error(`${service} can't be reached: check your connection`);
  }
  if (res.status === 404) throw new UnknownCountry(`${service} has no data for this`);
  if (res.status === 204) return [] as T;
  if (!res.ok) throw new Error(`${service} answered ${res.status}`);
  return await res.json() as T;
}

export class UnknownCountry extends Error {}

const DAY = 86_400_000;

/** A year of public holidays, cached for a month (the current year) or a week (the next ones may still change). */
export function publicHolidays(country: string, year: number, signal?: AbortSignal): Promise<Holiday[]> {
  const cc = normalizeCountry(country);
  const maxAge = year < new Date().getFullYear() ? 365 * DAY : year === new Date().getFullYear() ? 30 * DAY : 7 * DAY;
  return cached(`public:${cc}:${year}`, maxAge, async () => {
    try {
      return await get<Holiday[]>(`${NAGER}/PublicHolidays/${year}/${cc}`, signal);
    } catch (e) {
      if (e instanceof UnknownCountry) {
        throw new UnknownCountry(`Nager.Date has no public holidays for “${cc}”: check the country code in Settings`);
      }
      throw e;
    }
  });
}

/** Country names, cached for a month. */
export async function countries(signal?: AbortSignal): Promise<Map<string, string>> {
  const list = await cached("countries", 30 * DAY, () => get<Country[]>(`${NAGER}/AvailableCountries`, signal))
    .catch(() => [] as Country[]);
  return new Map(list.map((c) => [c.countryCode, c.name]));
}

/** School holiday periods of a zone from about four months ago to 14 months ahead, cached for a week. */
export function schoolHolidays(zone: string, on: Day, signal?: AbortSignal): Promise<SchoolPeriod[]> {
  const z = normalizeZone(zone);
  const from = addDays(on, -120);
  const to = addDays(on, 430);
  return cached(`school:${z}`, 7 * DAY, async () => {
    const params = new URLSearchParams({
      where: schoolQuery(z, from, to),
      select: "description,population,start_date,end_date,location,zones,annee_scolaire",
      order_by: "start_date",
    });
    const records = await get<SchoolRecord[]>(
      `${SCHOOL}?${params}`,
      signal,
      "The Éducation nationale open data portal",
    );
    const periods = schoolPeriods(records);
    if (!periods.length) {
      throw new UnknownCountry(
        `No school holidays found for “${z}”: use A, B, C, Corse or an overseas académie in Settings`,
      );
    }
    return periods;
  });
}
