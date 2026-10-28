// Calendar logic besides parsing: calendar URLs, video calls, day sections,
// time ranges and the "Standup in 12 min" line.

export * from "./ics.ts";
import { type CalEvent, instantToCivil, type Occurrence, type Rule } from "./ics.ts";

/** Calendar URLs from the preference: separated by spaces, commas or new lines; webcal:// becomes https://. */
export function parseUrls(pref: unknown): string[] {
  const out: string[] = [];
  for (const raw of String(pref ?? "").split(/[\s,]+/)) {
    const t = raw.trim().replace(/^<|>$/g, "");
    if (!t) continue;
    const url = t.replace(/^webcals?:\/\//i, "https://");
    try {
      const u = new URL(url);
      if ((u.protocol === "https:" || u.protocol === "http:") && !out.includes(u.href)) out.push(u.href);
    } catch { /* not a URL: ignored */ }
  }
  return out;
}

/** The hosts this extension may reach (keep in sync with backslash.toml). */
export const ALLOWED_HOSTS = [
  "calendar.google.com",
  "outlook.office365.com",
  "outlook.office.com",
  "outlook.live.com",
  "caldav.fastmail.com",
  "user.fm",
  "*.icloud.com",
  "calendar.proton.me",
  "calendar.zoho.com",
  "calendar.zoho.eu",
  "export.calendar.yahoo.com",
];

export function hostAllowed(url: string, hosts = ALLOWED_HOSTS): boolean {
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return false;
  }
  return hosts.some((h) => (h.startsWith("*.") ? host === h.slice(2) || host.endsWith(h.slice(1)) : host === h));
}

/** A short name for a calendar without X-WR-CALNAME. */
export function calendarLabel(url: string): string {
  try {
    const u = new URL(url);
    if (u.hostname === "calendar.google.com") {
      const id = decodeURIComponent(u.pathname.split("/")[3] ?? "");
      return id.includes("@") && !id.includes("group.calendar") ? id : "Google Calendar";
    }
    if (u.hostname.startsWith("outlook.")) return "Outlook";
    if (u.hostname.endsWith("icloud.com")) return "iCloud";
    if (u.hostname === "caldav.fastmail.com" || u.hostname === "user.fm") return "Fastmail";
    if (u.hostname === "calendar.proton.me") return "Proton Calendar";
    return u.hostname;
  } catch {
    return url;
  }
}

/** A stable key for caching a URL in storage (secret URLs are not used as keys). */
export async function urlKey(url: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(url));
  return [...new Uint8Array(hash)].slice(0, 12).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ---------------------------------------------------------------------------
// Video calls

export interface Meeting {
  url: string;
  service: string;
}

const MEETINGS: [RegExp, string][] = [
  [/https:\/\/meet\.google\.com\/[a-z0-9-]+(?:\?[^\s<>"')\]]*)?/i, "Google Meet"],
  [/https:\/\/(?:[\w-]+\.)*zoom\.us\/(?:j|my|w|s)\/[^\s<>"')\]]+/i, "Zoom"],
  [/https:\/\/teams\.microsoft\.com\/l\/meetup-join\/[^\s<>"')\]]+/i, "Microsoft Teams"],
  [/https:\/\/teams\.live\.com\/meet\/[^\s<>"')\]]+/i, "Microsoft Teams"],
  [/https:\/\/meet\.jit\.si\/[^\s<>"')\]]+/i, "Jitsi Meet"],
  [/https:\/\/(?:[\w-]+\.)*jitsi\.[a-z.]+\/[^\s<>"')\]]+/i, "Jitsi Meet"],
  [/https:\/\/[\w-]+\.webex\.com\/[^\s<>"')\]]+/i, "Webex"],
  [/https:\/\/whereby\.com\/[^\s<>"')\]]+/i, "Whereby"],
  [/https:\/\/(?:app\.)?slack\.com\/huddle\/[^\s<>"')\]]+/i, "Slack Huddle"],
  [/https:\/\/discord\.(?:gg|com)\/[^\s<>"')\]]+/i, "Discord"],
];

/** The first video-call link of an event: conference property, then location, URL and description. */
export function findMeeting(e: Pick<CalEvent, "conference" | "location" | "description" | "url">): Meeting | undefined {
  for (const text of [e.conference, e.location, e.url, e.description]) {
    if (!text) continue;
    for (const [re, service] of MEETINGS) {
      const m = re.exec(text);
      if (m) return { url: m[0].replace(/[.,;]+$/, ""), service };
    }
  }
  return undefined;
}

/** The location without a video link in it ("Room 4 / https://zoom.us/j/1" → "Room 4"). */
export function placeOf(location: string): string {
  return location.replace(/https?:\/\/\S+/g, "").replace(/^[\s,;/|-]+|[\s,;/|-]+$/g, "").trim();
}

/** Descriptions sometimes come as HTML (Google, Outlook): plain text with links kept. */
export function cleanDescription(text: string): string {
  let t = text.replace(/\r/g, "");
  if (/<\/?(?:br|p|div|a|b|i|span|ul|li|html)\b/i.test(t)) {
    t = t
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(?:p|div|li)>/gi, "\n")
      .replace(/<li[^>]*>/gi, "- ")
      .replace(
        /<a [^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/gi,
        (_, href: string, label: string) =>
          label.replace(/<[^>]+>/g, "").trim() && label !== href ? `[${label.replace(/<[^>]+>/g, "")}](${href})` : href,
      )
      .replace(/<[^>]+>/g, "")
      .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  }
  // Google's "-::~:~::~:…" join-info block and Teams' underscores are noise.
  t = t.replace(/-::~[:~]+::-[\s\S]*?-::~[:~]+::-/g, "").replace(/_{10,}/g, "");
  return t.replace(/\n{3,}/g, "\n\n").trim();
}

// ---------------------------------------------------------------------------
// Days and times

const DAY = 86_400_000;

/** `YYYY-MM-DD` of an instant in a zone. */
export function dayKey(at: number, zone: string): string {
  return new Date(instantToCivil(at, zone)).toISOString().slice(0, 10);
}

/** "Today", "Tomorrow", a weekday within a week, else "Mon 9 Nov". */
export function sectionOf(at: number, now: number, zone: string): string {
  const day = dayKey(at, zone);
  const today = dayKey(now, zone);
  if (day <= today) return "Today";
  const diff = Math.round((Date.parse(day) - Date.parse(today)) / DAY);
  const d = new Date(`${day}T12:00:00Z`);
  if (diff === 1) return "Tomorrow";
  if (diff < 7) return d.toLocaleDateString("en", { weekday: "long", timeZone: "UTC" });
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
}

export function formatClock(at: number, zone: string, hour12 = false): string {
  return new Date(at).toLocaleTimeString(hour12 ? "en-US" : "en-GB", {
    timeZone: zone,
    hour: hour12 ? "numeric" : "2-digit",
    minute: "2-digit",
    hour12,
  });
}

/** "09:30 – 10:00", "All day", "All day · 3 days", "Until 14:00" for events started earlier. */
export function timeRange(o: Occurrence, zone: string, now: number, hour12 = false): string {
  if (o.allDay) {
    const days = Math.round((o.end - o.start) / DAY);
    return days > 1 ? `All day · ${days} days` : "All day";
  }
  if (o.end === o.start) return formatClock(o.start, zone, hour12);
  const sameDay = dayKey(o.start, zone) === dayKey(o.end - 1, zone);
  const startedBefore = dayKey(o.start, zone) < dayKey(now, zone);
  if (startedBefore) {
    const endsToday = dayKey(o.end - 1, zone) === dayKey(now, zone);
    return `Until ${endsToday ? "" : `${shortDay(o.end - 1, zone)} `}${formatClock(o.end, zone, hour12)}`;
  }
  const end = sameDay
    ? formatClock(o.end, zone, hour12)
    : `${shortDay(o.end - 1, zone)} ${formatClock(o.end, zone, hour12)}`;
  return `${formatClock(o.start, zone, hour12)} – ${end}`;
}

const shortDay = (at: number, zone: string) =>
  new Date(at).toLocaleDateString("en-GB", { timeZone: zone, weekday: "short", day: "numeric", month: "short" });

/** "45 min", "1 h", "1 h 30", "2 days". */
export function formatDuration(ms: number): string {
  const min = Math.round(ms / 60000);
  if (min < 60) return `${min} min`;
  if (min < 24 * 60) {
    const h = Math.floor(min / 60), m = min % 60;
    return m ? `${h} h ${String(m).padStart(2, "0")}` : `${h} h`;
  }
  const days = Math.round(min / 1440);
  return `${days} day${days > 1 ? "s" : ""}`;
}

/** "in 12 min", "in 2 h", "in 1 h 15", "now". */
export function relative(at: number, now: number): string {
  const min = Math.round((at - now) / 60000);
  if (min <= 0) return "now";
  if (min < 60) return `in ${min} min`;
  const h = Math.floor(min / 60), m = min % 60;
  return m ? `in ${h} h ${String(m).padStart(2, "0")}` : `in ${h} h`;
}

export const isNow = (o: Occurrence, now: number) => o.start <= now && now < o.end;

/**
 * The command's subtitle in the root search: what is happening now, else
 * the next timed event today ("Standup in 12 min"), else null.
 */
export function subtitleFor(list: Occurrence[], now: number, zone: string): string | null {
  const current = list.filter((o) => !o.allDay && isNow(o, now));
  if (current.length) {
    return `Now: ${current[0].event.summary}${current.length > 1 ? ` (+${current.length - 1})` : ""}`;
  }
  const next = list.find((o) => !o.allDay && o.start > now && dayKey(o.start, zone) === dayKey(now, zone));
  return next ? `${next.event.summary} ${relative(next.start, now)}` : null;
}

/** The footer: "3 events today · next: Standup in 12 min". */
export function statusFor(list: Occurrence[], now: number, zone: string, calendars: number): string {
  const today = dayKey(now, zone);
  const todays = list.filter((o) =>
    (o.allDay ? dayKey(o.start, zone) <= today : dayKey(o.start, zone) === today) &&
    o.end > now
  );
  const parts = [`${todays.length || "No"} event${todays.length === 1 ? "" : "s"} left today`];
  const next = list.find((o) => !o.allDay && o.start > now);
  if (next) parts.push(`next: ${next.event.summary} ${relative(next.start, now)}`);
  if (calendars > 1) parts.push(`${calendars} calendars`);
  return parts.join(" · ");
}

/** "Weekly on Monday, Wednesday", "Every 2 weeks", "Monthly on the 2nd Tuesday", "Daily, 10 times". */
export function describeRule(rule: Rule | undefined): string | undefined {
  if (!rule) return undefined;
  const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const unit = { DAILY: "day", WEEKLY: "week", MONTHLY: "month", YEARLY: "year" }[rule.freq];
  let text = rule.interval > 1
    ? `Every ${rule.interval} ${unit}s`
    : { DAILY: "Daily", WEEKLY: "Weekly", MONTHLY: "Monthly", YEARLY: "Yearly" }[rule.freq];
  const ord = (n: number) => (n === -1 ? "last" : `${n}${n === 1 ? "st" : n === 2 ? "nd" : n === 3 ? "rd" : "th"}`);
  if (rule.byDay?.length) {
    const weekdays = [1, 2, 3, 4, 5];
    const plain = rule.byDay.every((d) => d.n === undefined);
    if (plain && rule.byDay.length === 5 && weekdays.every((w) => rule.byDay!.some((d) => d.day === w))) {
      text += " on weekdays";
    } else {
      text += ` on ${rule.byDay.map((d) => (d.n ? `the ${ord(d.n)} ${DAYS[d.day]}` : DAYS[d.day])).join(", ")}`;
    }
  } else if (rule.byMonthDay?.length) {
    text += ` on day ${rule.byMonthDay.map((d) => (d < 0 ? (d === -1 ? "last" : `${d}`) : String(d))).join(", ")}`;
  }
  if (rule.count) text += `, ${rule.count} times`;
  else if (rule.until) text += `, until ${new Date(rule.until.civil).toISOString().slice(0, 10)}`;
  return text;
}

/** Plain text of an event, for "Copy Event Details". */
export function eventText(o: Occurrence, zone: string, now: number, meeting?: Meeting): string {
  const e = o.event;
  const day = new Date(o.start).toLocaleDateString("en-GB", {
    timeZone: zone,
    weekday: "long",
    day: "numeric",
    month: "long",
  });
  return [
    e.summary,
    `${day}, ${timeRange(o, zone, now)}`,
    placeOf(e.location) && `Location: ${placeOf(e.location)}`,
    meeting && `${meeting.service}: ${meeting.url}`,
  ].filter(Boolean).join("\n");
}

/** Invited people, and how many did not decline. */
export function attending(e: CalEvent): { going: number; total: number } {
  return { going: e.attendees.filter((a) => a.status !== "DECLINED").length, total: e.attendees.length };
}

export const PALETTE = ["blue", "purple", "green", "orange", "pink", "teal", "red", "yellow"] as const;
