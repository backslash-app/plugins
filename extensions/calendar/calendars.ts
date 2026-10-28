// Fetching the calendars, with a short cache in storage so opening the
// command is instant, and the events as launcher items.

import {
  type Action,
  action,
  copy,
  detail,
  Icons,
  type Item,
  meta,
  type Metadata,
  open,
  refresh,
  storage,
} from "@backslash/api";
import {
  attending,
  type Calendar,
  calendarLabel,
  cleanDescription,
  describeRule,
  eventText,
  findMeeting,
  formatDuration,
  hostAllowed,
  isNow,
  type Occurrence,
  PALETTE,
  parseCalendar,
  placeOf,
  relative,
  timeRange,
  urlKey,
} from "./lib.ts";

export const CACHE_MINUTES = 5;
/** Larger calendars are kept in memory only, not in storage. */
const MAX_CACHED = 3_000_000;

export interface Loaded {
  url: string;
  index: number;
  name: string;
  calendar?: Calendar;
  error?: string;
  fetchedAt?: number;
}

type Cached = { at: number; text: string };
const memory = new Map<string, Cached>();

async function fetchText(url: string, signal: AbortSignal): Promise<string> {
  if (!hostAllowed(url)) {
    throw new Error(
      `${new URL(url).hostname} is not one of the calendar services this extension may reach ` +
        "(Google, Outlook, iCloud, Fastmail, Proton, Zoho, Yahoo)",
    );
  }
  let res: Response;
  try {
    res = await fetch(url, { signal, headers: { Accept: "text/calendar, */*" } });
  } catch (e) {
    if (signal.aborted) throw e;
    if (e instanceof Deno.errors.NotCapable || e instanceof Deno.errors.PermissionDenied) {
      throw new Error(`${new URL(url).hostname} is not allowed (redirected outside the allowed calendar hosts?)`);
    }
    throw new Error(`Could not reach ${new URL(url).hostname}: ${(e as Error).message}`);
  }
  if (res.status === 401 || res.status === 403 || res.status === 404) {
    throw new Error(`${new URL(url).hostname} answered ${res.status}: the address may have been reset; copy it again`);
  }
  if (!res.ok) throw new Error(`${new URL(url).hostname} answered ${res.status}`);
  const text = await res.text();
  if (!/BEGIN:VCALENDAR/i.test(text.slice(0, 2000))) {
    throw new Error("This address does not return an iCalendar (.ics) file: use the “iCal” / “ICS” address");
  }
  return text;
}

/** One calendar, from memory, storage (if fresh) or the network. */
async function loadOne(url: string, index: number, signal: AbortSignal, force: boolean): Promise<Loaded> {
  const key = `ics:${await urlKey(url)}`;
  const fresh = (c?: Cached) => c && Date.now() - c.at < CACHE_MINUTES * 60_000;
  let cached = memory.get(url);
  if (!force && !fresh(cached)) {
    const stored = await storage.get<Cached>(key).catch(() => undefined);
    if (stored && typeof stored.text === "string") cached = stored;
  }
  try {
    if (force || !fresh(cached)) {
      const text = await fetchText(url, signal);
      cached = { at: Date.now(), text };
      memory.set(url, cached);
      if (text.length <= MAX_CACHED) await storage.set(key, cached).catch(() => {});
    }
  } catch (e) {
    if (signal.aborted) throw e;
    // Offline or failing: an older copy is better than nothing.
    if (!cached) return { url, index, name: calendarLabel(url), error: (e as Error).message };
    const calendar = parseCalendar(cached.text);
    return {
      url,
      index,
      name: calendar.name ?? calendarLabel(url),
      calendar,
      fetchedAt: cached.at,
      error: (e as Error).message,
    };
  }
  const calendar = parseCalendar(cached!.text);
  return { url, index, name: calendar.name ?? calendarLabel(url), calendar, fetchedAt: cached!.at };
}

export function loadAll(urls: string[], signal: AbortSignal, force = false): Promise<Loaded[]> {
  return Promise.all(urls.map((u, i) => loadOne(u, i, signal, force)));
}

// --- Items -------------------------------------------------------------------

export interface Shown extends Occurrence {
  calendar: Loaded;
}

const longDate = (at: number, zone: string) =>
  new Date(at).toLocaleDateString("en-GB", { timeZone: zone, weekday: "long", day: "numeric", month: "long" });

const mapsUrl = (place: string) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place)}`;

function eventMetadata(o: Shown, zone: string, now: number, several: boolean, hour12: boolean): Metadata[] {
  const e = o.event;
  const meeting = findMeeting(e);
  const place = placeOf(e.location);
  const { going, total } = attending(e);
  const lines: Metadata[] = [
    meta.text("When", `${longDate(o.start, zone)}, ${timeRange(o, zone, now, hour12)}`, { icon: Icons.calendar }),
  ];
  if (isNow(o, now)) {
    lines.push(
      meta.text("Status", `In progress · ends ${relative(o.end, now)}`, { icon: Icons.inProgress, color: "green" }),
    );
  }
  if (e.status === "TENTATIVE") lines.push(meta.text("Status", "Tentative", { icon: Icons.question, color: "orange" }));
  if (place) lines.push(meta.text("Location", place, { icon: Icons.pin }));
  if (meeting) lines.push(meta.link("Video call", meeting.service, meeting.url));
  if (e.organizer?.name || e.organizer?.email) {
    lines.push(meta.person("Organizer", e.organizer.name ?? e.organizer.email!));
  }
  if (total) {
    lines.push(meta.text("Attendees", total === going ? String(total) : `${going} of ${total} going`, {
      icon: Icons.person,
    }));
    const names = e.attendees.filter((a) => a.status !== "DECLINED").map((a) => a.name ?? a.email ?? "").filter(
      Boolean,
    );
    if (names.length) {
      lines.push(meta.tags("Guests", [...names.slice(0, 8), ...(names.length > 8 ? [`+${names.length - 8}`] : [])]));
    }
  }
  const rule = describeRule(e.rule);
  if (o.recurring) lines.push(meta.text("Repeats", rule ?? "Yes", { icon: Icons.repeat }));
  lines.push(meta.separator());
  lines.push(
    meta.text("Calendar", o.calendar.name, { icon: Icons.dot, color: PALETTE[o.calendar.index % PALETTE.length] }),
  );
  if (several && e.transparent) lines.push(meta.text("Shown as", "Free"));
  return lines;
}

function eventActions(o: Shown, zone: string, now: number, hour12: boolean): Action[] {
  const e = o.event;
  const meeting = findMeeting(e);
  const place = placeOf(e.location);
  const page = action("Show Details", () =>
    detail({
      title: e.summary,
      markdown: `# ${e.summary}\n\n${cleanDescription(e.description) || "_No description._"}`,
      metadata: eventMetadata(o, zone, now, true, hour12),
      status: `${o.calendar.name} · ${timeRange(o, zone, now, hour12)}`,
      actions: eventActions(o, zone, now, hour12).filter((a) => a.title !== "Show Details"),
    }), { icon: Icons.info, shortcut: "<Ctrl>i" });
  return [
    ...(meeting ? [open(meeting.url, "Join Meeting", { icon: Icons.video })] : []),
    page,
    ...(e.url && /^https?:/i.test(e.url) && e.url !== meeting?.url
      ? [open(e.url, "Open Event Page", { section: "Open" })]
      : []),
    ...(place ? [open(mapsUrl(place), "Open Location in Maps", { icon: Icons.pin, section: "Open" })] : []),
    ...(meeting ? [copy(meeting.url, "Copy Meeting Link", { shortcut: "<Ctrl><Shift>c", section: "Copy" })] : []),
    copy(eventText(o, zone, now, meeting), "Copy Event Details", { section: "Copy" }),
    ...(place ? [copy(place, "Copy Location", { section: "Copy" })] : []),
    action("Refresh Calendars", () => {
      requestRefresh();
      return refresh();
    }, { icon: Icons.refresh, shortcut: "<Ctrl>r", section: "Calendar" }),
  ];
}

/** Set by "Refresh Calendars": the next load skips the cache. */
let force = false;
export function takeForce(): boolean {
  const f = force;
  force = false;
  return f;
}
export function requestRefresh() {
  force = true;
}

export function eventItem(
  o: Shown,
  o2: { zone: string; now: number; section: string; several: boolean; hour12: boolean },
): Item {
  const { zone, now, section, several, hour12 } = o2;
  const e = o.event;
  const meeting = findMeeting(e);
  const place = placeOf(e.location);
  const live = !o.allDay && isNow(o, now);
  const past = o.end <= now;
  const color = PALETTE[o.calendar.index % PALETTE.length];
  const { total } = attending(e);
  const desc = cleanDescription(e.description);
  const soon = !o.allDay && !live && o.start > now && o.start - now < 3 * 3_600_000;
  return {
    id: `${o.calendar.index}:${e.uid}:${o.start}`,
    title: e.summary,
    subtitle: timeRange(o, zone, now, hour12),
    icon: live
      ? { source: meeting ? Icons.video : Icons.inProgress, tint: "green" }
      : { source: meeting ? Icons.video : o.allDay ? Icons.calendar : Icons.dot, tint: past ? "gray" : color },
    section,
    keywords: [place, meeting?.service ?? "", o.calendar.name, e.organizer?.name ?? ""].filter(Boolean),
    accessories: [
      ...(live ? [{ tag: `Now · ends ${relative(o.end, now)}`, color: "green" as const }] : []),
      ...(soon
        ? [{ tag: relative(o.start, now), color: o.start - now <= 15 * 60_000 ? "orange" as const : "blue" as const }]
        : []),
      ...(e.status === "TENTATIVE"
        ? [{ icon: { source: Icons.question, tint: "orange" as const }, tooltip: "Tentative" }]
        : []),
      ...(meeting ? [{ text: meeting.service, tooltip: meeting.url }] : []),
      ...(place
        ? [{ icon: Icons.pin, text: place.length > 28 ? `${place.slice(0, 27)}…` : place, tooltip: place }]
        : []),
      ...(total > 1 ? [{ icon: Icons.person, text: String(total), tooltip: `${total} attendees` }] : []),
      ...(o.recurring ? [{ icon: Icons.repeat, tooltip: describeRule(e.rule) ?? "Recurring" }] : []),
      ...(several ? [{ icon: { source: Icons.dot, tint: color }, tooltip: o.calendar.name }] : []),
    ],
    detail: {
      stats: [
        {
          label: o.allDay ? "Day" : "Starts",
          value: o.allDay ? "All day" : timeRange(o, zone, now, hour12).split(" – ")[0],
        },
        { label: "Duration", value: formatDuration(o.end - o.start) },
        ...(total ? [{ label: "Attendees", value: total }] : []),
      ],
      markdown: desc ? (desc.length > 1500 ? `${desc.slice(0, 1500)}…` : desc) : undefined,
      metadata: eventMetadata(o, zone, now, several, hour12),
    },
    actions: eventActions(o, zone, now, hour12),
  };
}
