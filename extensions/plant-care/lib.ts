// Plants, their watering and feeding schedule. Pure functions: dates are local days "YYYY-MM-DD".

import type { Color } from "@backslash/api";
import { type Species, speciesById } from "./species.ts";

export interface Plant {
  id: string;
  name: string;
  /** A {@link Species} id, if picked from the presets. */
  species?: string;
  room?: string;
  /** Days between waterings. */
  waterEvery: number;
  /** Weeks between feeds; 0 or missing = never. */
  feedEvery?: number;
  lastWatered?: string;
  lastFed?: string;
  /** Not due before this day (snoozed). */
  snoozedUntil?: string;
  notes?: string;
  /** Days it was watered, newest first, at most {@link HISTORY}. */
  history: string[];
  created: number;
}

export const HISTORY = 60;

// ---------------------------------------------------------------------------
// Days

const pad = (n: number) => String(n).padStart(2, "0");

/** The local day of `date`. */
export function dayOf(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function toUtc(day: string): number {
  const [y, m, d] = day.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

export function addDays(day: string, n: number): string {
  const d = new Date(toUtc(day) + n * 86_400_000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** Whole days from `a` to `b` (positive when `b` is later). */
export function daysBetween(a: string, b: string): number {
  return Math.round((toUtc(b) - toUtc(a)) / 86_400_000);
}

export function isDay(text: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  return addDays(text, 0) === text;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "today", "yesterday", "Mon 3 Nov", "3 Nov 2025". */
export function formatDay(day: string, today: string): string {
  const diff = daysBetween(today, day);
  if (diff === 0) return "today";
  if (diff === -1) return "yesterday";
  if (diff === 1) return "tomorrow";
  const [y, m, d] = day.split("-").map(Number);
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][new Date(toUtc(day)).getUTCDay()];
  return y === Number(today.slice(0, 4)) ? `${weekday} ${d} ${MONTHS[m - 1]}` : `${d} ${MONTHS[m - 1]} ${y}`;
}

/**
 * A day typed in a form: "today", "yesterday", "3 days ago", "2026-10-28", "28/10", "28/10/2026"
 * (and the French "aujourd'hui", "hier", "il y a 3 jours"). Undefined when it isn't one; never in the future.
 */
export function parseDay(text: string, today: string): string | undefined {
  const t = text.trim().toLowerCase();
  if (!t || t === "today" || t === "now" || t === "aujourd'hui" || t === "aujourd’hui") return today;
  if (t === "yesterday" || t === "hier") return addDays(today, -1);
  const ago = /^(?:il y a\s+)?(\d+)\s*(d|days?|j|jours?|w|weeks?|semaines?)(?:\s+ago)?$/.exec(t);
  if (ago) {
    const n = Number(ago[1]) * (/^(w|week|sem)/.test(ago[2]) ? 7 : 1);
    return addDays(today, -n);
  }
  let day: string | undefined;
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
  const dmy = /^(\d{1,2})[/.](\d{1,2})(?:[/.](\d{2}|\d{4}))?$/.exec(t);
  if (iso) day = `${iso[1]}-${pad(+iso[2])}-${pad(+iso[3])}`;
  else if (dmy) {
    const year = dmy[3] ? (dmy[3].length === 2 ? 2000 + Number(dmy[3]) : Number(dmy[3])) : Number(today.slice(0, 4));
    day = `${year}-${pad(+dmy[2])}-${pad(+dmy[1])}`;
    // "28/12" typed in January means last December.
    if (!dmy[3] && daysBetween(today, day) > 0) day = `${year - 1}-${day.slice(5)}`;
  }
  if (!day || !isDay(day) || daysBetween(today, day) > 0) return undefined;
  return day;
}

/** "7", "7 days", "1 week", "2w", "10 jours" → days; undefined when it isn't a period. */
export function parseEvery(text: string, unit: "days" | "weeks" = "days"): number | undefined {
  const m = /^(\d+(?:[.,]\d+)?)\s*(d|days?|j|jours?|w|weeks?|sem|semaines?|m|months?|mois)?$/i.exec(text.trim());
  if (!m) return undefined;
  const n = Number(m[1].replace(",", "."));
  const u = (m[2] ?? "").toLowerCase();
  let days = /^(w|week|sem)/.test(u) ? n * 7 : /^(m|month|mois)/.test(u) ? n * 30 : /^(d|day|j|jour)/.test(u) ? n : NaN;
  if (Number.isNaN(days)) days = unit === "weeks" ? n * 7 : n;
  const result = unit === "weeks" ? Math.round(days / 7) : Math.round(days);
  return result >= (unit === "weeks" ? 0 : 1) && result <= 365 ? result : undefined;
}

// ---------------------------------------------------------------------------
// Schedule

/** The day the plant next needs water: today when it never was. */
export function nextWatering(p: Plant, today: string): string {
  const due = p.lastWatered ? addDays(p.lastWatered, p.waterEvery) : today;
  return p.snoozedUntil && daysBetween(due, p.snoozedUntil) > 0 ? p.snoozedUntil : due;
}

export function nextFeeding(p: Plant, today: string): string | undefined {
  if (!p.feedEvery) return undefined;
  return p.lastFed ? addDays(p.lastFed, p.feedEvery * 7) : today;
}

export interface Due {
  /** Days until it's due; negative when overdue. */
  days: number;
  label: string;
  color: Color;
}

export function waterDue(p: Plant, today: string): Due {
  const days = daysBetween(today, nextWatering(p, today));
  if (!p.lastWatered && days <= 0) return { days, label: "Water today", color: "orange" };
  if (days < 0) return { days, label: `Overdue by ${plural(-days, "day")}`, color: "red" };
  if (days === 0) return { days, label: "Water today", color: "orange" };
  if (days === 1) return { days, label: "Tomorrow", color: "yellow" };
  return { days, label: `In ${plural(days, "day")}`, color: days <= 3 ? "blue" : "green" };
}

export function feedDue(p: Plant, today: string): Due | undefined {
  const next = nextFeeding(p, today);
  if (!next) return undefined;
  const days = daysBetween(today, next);
  if (days <= 0) {
    return { days, label: days < 0 ? `Feed (${plural(-days, "day")} late)` : "Feed today", color: "purple" };
  }
  return { days, label: `Feed in ${plural(days, "day")}`, color: "gray" };
}

export const needsWater = (p: Plant, today: string): boolean => waterDue(p, today).days <= 0;

/** Most urgent first, then by name. */
export function sortPlants(plants: Plant[], today: string): Plant[] {
  return [...plants].sort((x, y) =>
    waterDue(x, today).days - waterDue(y, today).days || x.name.localeCompare(y.name, undefined, { numeric: true })
  );
}

export function section(p: Plant, today: string): string {
  const { days } = waterDue(p, today);
  if (days <= 0) return "Needs Water";
  if (days <= 7) return "This Week";
  return "Later";
}

export function water(p: Plant, day: string): Plant {
  const history = [day, ...p.history.filter((d) => d !== day)].sort().reverse().slice(0, HISTORY);
  const lastWatered = p.lastWatered && daysBetween(p.lastWatered, day) < 0 ? p.lastWatered : day;
  const { snoozedUntil: _, ...rest } = p;
  return { ...rest, lastWatered, history };
}

/** Takes back the last watering (a mistaken click). */
export function undoWater(p: Plant): Plant {
  const [, ...history] = p.history;
  return { ...p, history, lastWatered: history[0] };
}

export function feed(p: Plant, day: string): Plant {
  return { ...p, lastFed: day };
}

/** Not due again before tomorrow. */
export function snooze(p: Plant, today: string, days = 1): Plant {
  return { ...p, snoozedUntil: addDays(today, days) };
}

/** The real rhythm: the median of the gaps between the last waterings, if there are at least 3. */
export function actualRhythm(p: Plant): number | undefined {
  if (p.history.length < 3) return undefined;
  const recent = p.history.slice(0, 11);
  const gaps: number[] = [];
  for (let i = 1; i < recent.length; i++) gaps.push(daysBetween(recent[i], recent[i - 1]));
  gaps.sort((x, y) => x - y);
  const mid = Math.floor(gaps.length / 2);
  return gaps.length % 2 ? gaps[mid] : Math.round((gaps[mid - 1] + gaps[mid]) / 2);
}

export function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

export function every(days: number): string {
  if (days === 1) return "every day";
  if (days % 7 === 0) return days === 7 ? "every week" : `every ${days / 7} weeks`;
  return `every ${days} days`;
}

/** "2 plants need water" for the root search and the tray. */
export function dueSummary(plants: Plant[], today: string): string {
  const due = plants.filter((p) => needsWater(p, today));
  if (!plants.length) return "";
  if (!due.length) {
    const next = sortPlants(plants, today)[0];
    return `Next: ${next.name} ${waterDue(next, today).label.toLowerCase()}`;
  }
  return due.length === 1 ? `${due[0].name} needs water` : `${due.length} plants need water`;
}

export function speciesOf(p: Plant): Species | undefined {
  return speciesById(p.species);
}

/** The values saved from the form, checked. */
export function plantFromForm(
  values: Record<string, string | boolean>,
  today: string,
  base: Plant | undefined,
  id: string,
  now: number,
): Plant {
  const name = String(values.name ?? "").trim();
  if (!name) throw new Error("Give the plant a name");
  const species = speciesById(String(values.species ?? ""));
  const everyText = String(values.waterEvery ?? "").trim();
  const waterEvery = everyText ? parseEvery(everyText) : species?.waterDays ?? base?.waterEvery ?? 7;
  if (!waterEvery) throw new Error(`“${everyText}” is not a number of days (7, 10 days, 2 weeks)`);
  const feedText = String(values.feedEvery ?? "").trim();
  const feedEvery = feedText ? parseEvery(feedText, "weeks") : species?.feedWeeks ?? base?.feedEvery ?? 0;
  if (feedEvery === undefined) throw new Error(`“${feedText}” is not a number of weeks (4, 1 month; 0 for never)`);
  const lastText = String(values.lastWatered ?? "").trim();
  let lastWatered = base?.lastWatered;
  if (lastText) {
    lastWatered = parseDay(lastText, today);
    if (!lastWatered) throw new Error(`“${lastText}” is not a past day (today, yesterday, 3 days ago, 2026-10-28)`);
  }
  const history = base?.history ?? [];
  const plant: Plant = {
    id,
    name,
    ...(species ? { species: species.id } : {}),
    ...(String(values.room ?? "").trim() ? { room: String(values.room).trim() } : {}),
    waterEvery,
    ...(feedEvery ? { feedEvery } : {}),
    ...(base?.lastFed ? { lastFed: base.lastFed } : {}),
    ...(base?.snoozedUntil ? { snoozedUntil: base.snoozedUntil } : {}),
    ...(String(values.notes ?? "").trim() ? { notes: String(values.notes).trim() } : {}),
    history,
    created: base?.created ?? now,
  };
  return lastWatered && lastWatered !== base?.lastWatered ? water(plant, lastWatered) : plant;
}

/** Keeps what's valid from storage. */
export function sanitize(value: unknown): Plant[] {
  if (!Array.isArray(value)) return [];
  return value.filter((p): p is Plant =>
    !!p && typeof p === "object" && typeof p.id === "string" && typeof p.name === "string" &&
    typeof p.waterEvery === "number" && p.waterEvery > 0
  ).map((p) => ({ ...p, history: Array.isArray(p.history) ? p.history.filter(isDay) : [] }));
}

export function newId(): string {
  return crypto.randomUUID().slice(0, 8);
}
