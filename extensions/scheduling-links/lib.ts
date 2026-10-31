// Cal.com and Calendly bookings and event types, turned into one shape, and
// the dates and labels shown for them. No network here.

import { Icons, type Item, open } from "@backslash/api";

export type Provider = "cal" | "calendly";
export const PROVIDER_NAMES: Record<Provider, string> = { cal: "Cal.com", calendly: "Calendly" };

export const CAL_API = "https://api.cal.com/v2";
export const CALENDLY_API = "https://api.calendly.com";

/** Missing or refused credentials: shown as a setup row rather than an error. */
export class SetupError extends Error {
  constructor(message: string, readonly provider?: Provider) {
    super(message);
  }
}

export interface Account {
  provider: Provider;
  token: string;
}

/** The accounts the preferences set up; a SetupError when there is none. */
export function accountsOf(prefs: Record<string, unknown>): Account[] {
  const out: Account[] = [];
  const cal = String(prefs.calApiKey ?? "").trim().replace(/^Bearer\s+/i, "");
  const calendly = String(prefs.calendlyToken ?? "").trim().replace(/^Bearer\s+/i, "");
  if (cal) out.push({ provider: "cal", token: cal });
  if (calendly) out.push({ provider: "calendly", token: calendly });
  if (!out.length) throw new SetupError("Connect Cal.com or Calendly");
  return out;
}

/** A sentence for an API error. */
export function apiError(provider: Provider, status: number, body: unknown): Error {
  const name = PROVIDER_NAMES[provider];
  const b = body as {
    message?: string;
    title?: string;
    error?: string | { message?: string; details?: unknown };
    details?: { message?: string }[];
  } | undefined;
  const error = typeof b?.error === "object" ? b.error?.message : b?.error;
  const message = [b?.message ?? error ?? b?.title, b?.details?.map((d) => d.message).filter(Boolean).join(", ")]
    .filter(Boolean).join(": ");
  if (status === 401) {
    return new SetupError(`${name} refused the ${provider === "cal" ? "API key" : "token"}`, provider);
  }
  if (status === 403) return new SetupError(`${name} doesn't allow this${message ? `: ${message}` : ""}`, provider);
  if (status === 404) return new Error(`Not found on ${name}: it may have been canceled or deleted`);
  if (status === 429) return new Error(`${name} is rate limiting: try again in a minute`);
  return new Error(`${name} answered ${status}${message ? `: ${message}` : ""}`);
}

// ---------------------------------------------------------------------------
// Shapes shown by the commands

export interface Attendee {
  name: string;
  email: string;
  timeZone?: string;
  noShow?: boolean;
  answers?: { question: string; answer: string }[];
  rescheduleUrl?: string;
  cancelUrl?: string;
}

export interface Booking {
  provider: Provider;
  /** Cal.com booking uid, Calendly event uuid: what cancelling takes. */
  id: string;
  title: string;
  start: string;
  end: string;
  /** `pending` means waiting for your confirmation (Cal.com). */
  status: "upcoming" | "pending" | "canceled";
  attendees: Attendee[];
  hosts: string[];
  joinUrl?: string;
  /** "Google Meet", "Zoom", "12 rue de Rivoli"… */
  location?: string;
  description?: string;
  webUrl: string;
}

export interface EventLink {
  provider: Provider;
  id: string;
  title: string;
  slug: string;
  url: string;
  minutes?: number;
  description?: string;
  hidden: boolean;
  /** Calendly event type URI, to create single-use links. */
  uri?: string;
  /** Calendly: solo, group, round robin… */
  kind?: string;
}

// ---------------------------------------------------------------------------
// Locations

const LOCATION_LABELS: [RegExp, string][] = [
  [/daily|cal[-_ ]?video/i, "Cal Video"],
  [/google[:_ -]?(meet|conference)/i, "Google Meet"],
  [/zoom/i, "Zoom"],
  [/office365|microsoft[_ -]?teams|msteams|teams/i, "Microsoft Teams"],
  [/webex/i, "Webex"],
  [/gotomeeting/i, "GoToMeeting"],
  [/whereby/i, "Whereby"],
  [/jitsi/i, "Jitsi"],
  [/huddle01/i, "Huddle01"],
  [/outbound_call|inbound_call|phone/i, "Phone call"],
];

const URL_RE = /https?:\/\/[^\s<>"')]+/i;

/** The first web address in any of these strings. */
export function firstUrl(...values: (string | null | undefined)[]): string | undefined {
  for (const v of values) {
    const m = v ? URL_RE.exec(v) : null;
    if (m) return m[0].replace(/[.,;]+$/, "");
  }
  return undefined;
}

/** "integrations:google:meet" → "Google Meet"; an address or a link stays as it is (a link's host). */
export function locationLabel(location: string | undefined | null, type?: string): string | undefined {
  for (const value of [type, location]) {
    if (!value) continue;
    for (const [re, label] of LOCATION_LABELS) if (re.test(value) && !/^https?:/i.test(value)) return label;
  }
  if (!location) return undefined;
  const url = firstUrl(location);
  if (url) {
    const host = new URL(url).hostname.replace(/^www\./, "");
    for (const [re, label] of LOCATION_LABELS) if (re.test(host)) return label;
    if (host === "meet.google.com") return "Google Meet";
    return host;
  }
  if (/^integrations:/i.test(location)) return undefined;
  return location;
}

// ---------------------------------------------------------------------------
// Cal.com

export interface CalBooking {
  id: number;
  uid: string;
  title: string;
  description?: string | null;
  status: string;
  start: string;
  end: string;
  duration?: number;
  eventTypeId?: number;
  eventType?: { id?: number; slug?: string } | null;
  meetingUrl?: string | null;
  location?: string | null;
  attendees?: { name?: string; email?: string; timeZone?: string; absent?: boolean }[];
  hosts?: { name?: string; email?: string; username?: string }[];
  bookingFieldsResponses?: Record<string, unknown>;
  metadata?: Record<string, unknown> | null;
}

/** Booking questions worth showing: not the name and email the attendee row already has. */
function calAnswers(responses: Record<string, unknown> | undefined): { question: string; answer: string }[] {
  if (!responses) return [];
  const skip = new Set(["name", "email", "guests", "location", "attendeePhoneNumber", "rescheduleReason"]);
  return Object.entries(responses)
    .filter(([k, v]) => !skip.has(k) && v !== null && v !== undefined && v !== "" && typeof v !== "object")
    .map(([k, v]) => ({
      question: k === "notes" ? "Notes" : k.replace(/[-_]+/g, " ").replace(/^\w/, (c) => c.toUpperCase()),
      answer: String(v),
    }));
}

export function fromCalBooking(b: CalBooking): Booking {
  const status = /cancel|reject/i.test(b.status)
    ? "canceled"
    : /pending|unconfirmed/i.test(b.status)
    ? "pending"
    : "upcoming";
  const answers = calAnswers(b.bookingFieldsResponses);
  const video = typeof b.metadata?.videoCallUrl === "string" ? b.metadata.videoCallUrl : undefined;
  return {
    provider: "cal",
    id: b.uid,
    title: b.title,
    start: b.start,
    end: b.end,
    status,
    attendees: (b.attendees ?? []).map((a, i) => ({
      name: a.name || a.email || "Guest",
      email: a.email ?? "",
      timeZone: a.timeZone,
      noShow: a.absent || undefined,
      ...(i === 0 && answers.length ? { answers } : {}),
    })),
    hosts: (b.hosts ?? []).map((h) => h.name || h.username || h.email || "").filter(Boolean),
    joinUrl: firstUrl(b.meetingUrl, video, b.location),
    location: locationLabel(b.location ?? b.meetingUrl),
    description: b.description?.trim() || undefined,
    webUrl: `https://app.cal.com/booking/${b.uid}`,
  };
}

export interface CalEventType {
  id: number;
  title: string;
  slug: string;
  lengthInMinutes?: number;
  length?: number;
  description?: string | null;
  hidden?: boolean;
  bookingUrl?: string;
}

export function fromCalEventType(e: CalEventType, username: string | undefined): EventLink | undefined {
  const url = e.bookingUrl || (username ? `https://cal.com/${username}/${e.slug}` : undefined);
  if (!url) return undefined;
  return {
    provider: "cal",
    id: String(e.id),
    title: e.title,
    slug: e.slug,
    url,
    minutes: e.lengthInMinutes ?? e.length,
    description: e.description?.trim() || undefined,
    hidden: Boolean(e.hidden),
  };
}

// ---------------------------------------------------------------------------
// Calendly

export interface CalendlyEvent {
  uri: string;
  name: string;
  status: "active" | "canceled" | string;
  start_time: string;
  end_time: string;
  event_type?: string;
  location?: { type?: string; location?: string | null; join_url?: string | null; status?: string } | null;
  invitees_counter?: { total: number; active: number; limit: number };
  event_memberships?: { user?: string; user_email?: string; user_name?: string }[];
  event_guests?: { email: string }[];
  meeting_notes_plain?: string | null;
}

export interface CalendlyInvitee {
  uri?: string;
  email: string;
  name?: string | null;
  status?: string;
  timezone?: string | null;
  cancel_url?: string;
  reschedule_url?: string;
  no_show?: unknown;
  questions_and_answers?: { question: string; answer: string }[];
}

export const uuidOf = (uri: string) => uri.replace(/\/+$/, "").split("/").pop() ?? uri;

export function fromCalendlyEvent(e: CalendlyEvent, invitees: CalendlyInvitee[] = []): Booking {
  const attendees: Attendee[] = invitees
    .filter((i) => i.status !== "canceled")
    .map((i) => ({
      name: i.name || i.email,
      email: i.email,
      timeZone: i.timezone ?? undefined,
      noShow: i.no_show ? true : undefined,
      answers: i.questions_and_answers?.filter((q) => q.answer?.trim()),
      rescheduleUrl: i.reschedule_url,
      cancelUrl: i.cancel_url,
    }));
  for (const g of e.event_guests ?? []) {
    if (!attendees.some((a) => a.email === g.email)) attendees.push({ name: g.email, email: g.email });
  }
  const loc = e.location ?? undefined;
  return {
    provider: "calendly",
    id: uuidOf(e.uri),
    title: e.name,
    start: e.start_time,
    end: e.end_time,
    status: e.status === "canceled" ? "canceled" : "upcoming",
    attendees,
    hosts: (e.event_memberships ?? []).map((m) => m.user_name || m.user_email || "").filter(Boolean),
    joinUrl: firstUrl(loc?.join_url, loc?.location),
    location: locationLabel(
      loc?.location ?? loc?.join_url,
      loc?.type === "physical" || loc?.type === "custom" ? undefined : loc?.type,
    ),
    description: e.meeting_notes_plain?.trim() || undefined,
    webUrl: "https://calendly.com/app/scheduled_events/user/me",
  };
}

export interface CalendlyEventType {
  uri: string;
  name: string;
  slug?: string;
  scheduling_url: string;
  duration?: number;
  active?: boolean;
  secret?: boolean;
  kind?: string;
  pooling_type?: string | null;
  type?: string;
  description_plain?: string | null;
}

export function fromCalendlyEventType(e: CalendlyEventType): EventLink {
  const kind = e.pooling_type === "round_robin"
    ? "Round robin"
    : e.pooling_type === "collective"
    ? "Collective"
    : e.kind === "group"
    ? "Group"
    : undefined;
  return {
    provider: "calendly",
    id: uuidOf(e.uri),
    uri: e.uri,
    title: e.name,
    slug: e.slug ?? uuidOf(e.scheduling_url),
    url: e.scheduling_url,
    minutes: e.duration,
    description: e.description_plain?.trim() || undefined,
    hidden: Boolean(e.secret),
    kind,
  };
}

// ---------------------------------------------------------------------------
// Dates

const DAY = 86_400_000;

function dayKey(d: Date, timeZone?: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

/** "Today", "Tomorrow", "Wednesday 5 November", with the year when it isn't this one. */
export function dayTitle(iso: string, now = new Date(), timeZone?: string): string {
  const d = new Date(iso);
  const key = dayKey(d, timeZone);
  if (key === dayKey(now, timeZone)) return "Today";
  if (key === dayKey(new Date(now.getTime() + DAY), timeZone)) return "Tomorrow";
  if (key === dayKey(new Date(now.getTime() - DAY), timeZone)) return "Yesterday";
  const sameYear = key.slice(0, 4) === dayKey(now, timeZone).slice(0, 4);
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).formatToParts(d);
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return [part("weekday"), part("day"), part("month"), sameYear ? "" : part("year")].filter(Boolean).join(" ");
}

const clock = (d: Date, timeZone?: string) =>
  new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d);

/** "14:00–14:30". */
export function timeRange(start: string, end: string, timeZone?: string): string {
  return `${clock(new Date(start), timeZone)}–${clock(new Date(end), timeZone)}`;
}

/** Minutes between two instants: 30, 90… */
export const minutesBetween = (start: string, end: string) =>
  Math.round((Date.parse(end) - Date.parse(start)) / 60_000);

/** "45 min", "1 h", "1 h 30". */
export function duration(minutes: number | undefined): string {
  if (!minutes || minutes <= 0) return "";
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60), m = minutes % 60;
  return m ? `${h} h ${String(m).padStart(2, "0")}` : `${h} h`;
}

/** "now", "in 5 min", "in 3 h", "in 2 d", "ended". */
export function untilLabel(start: string, end: string, now = Date.now()): string {
  const s = Date.parse(start), e = Date.parse(end);
  if (now >= e) return "ended";
  if (now >= s) return "now";
  const min = Math.round((s - now) / 60_000);
  if (min < 1) return "now";
  if (min < 60) return `in ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `in ${h} h`;
  return `in ${Math.round(h / 24)} d`;
}

/** Joining makes sense from 15 minutes before to the end. */
export const joinable = (b: Booking, now = Date.now()) =>
  Boolean(b.joinUrl) && now >= Date.parse(b.start) - 15 * 60_000 && now < Date.parse(b.end);

/** Not ended, not canceled, soonest first. */
export function upcomingOnly(list: Booking[], now = Date.now()): Booking[] {
  return list
    .filter((b) => b.status !== "canceled" && Date.parse(b.end) > now)
    .sort((a, b) => a.start.localeCompare(b.start) || a.title.localeCompare(b.title));
}

// ---------------------------------------------------------------------------
// Text

/** "Ada Lovelace", "Ada Lovelace +2". */
export function attendeeSummary(b: Booking): string {
  if (!b.attendees.length) return "";
  const first = b.attendees[0].name;
  return b.attendees.length > 1 ? `${first} +${b.attendees.length - 1}` : first;
}

const md = (s: string) => s.replace(/([\\`*_[\]<>])/g, "\\$1");

export function bookingMarkdown(b: Booking, timeZone?: string): string {
  const lines = [
    `## ${md(b.title)}`,
    "",
    `**${dayTitle(b.start, new Date(), timeZone)}**, ${timeRange(b.start, b.end, timeZone)}${
      b.location ? ` · ${md(b.location)}` : ""
    }`,
  ];
  if (b.status === "pending") lines.push("", "_Waiting for your confirmation in Cal.com._");
  if (b.attendees.length) {
    lines.push("", "### Attendees", "");
    for (const a of b.attendees) {
      lines.push(
        `- **${md(a.name)}**${a.email && a.email !== a.name ? ` <${a.email}>` : ""}${
          a.timeZone ? ` · ${a.timeZone}` : ""
        }`,
      );
    }
  }
  const answers = b.attendees.flatMap((a) => a.answers ?? []);
  if (answers.length) {
    lines.push("", "### Answers", "");
    for (const q of answers) lines.push(`**${md(q.question)}**`, "", md(q.answer), "");
  }
  if (b.description) lines.push("", "### Notes", "", md(b.description));
  return lines.join("\n").trim();
}

/** Pasted in an email or a chat: "Intro call, Wednesday 5 November 14:00–14:30, https://meet…". */
export function bookingSummary(b: Booking, now = new Date(), timeZone?: string): string {
  return [
    `${b.title}, ${dayTitle(b.start, now, timeZone)} ${timeRange(b.start, b.end, timeZone)}`,
    b.joinUrl,
  ].filter(Boolean).join(", ");
}

// ---------------------------------------------------------------------------
// Setup

const CONFIGURE = "**Settings → Extensions → Scheduling Links → Configure**";

export function setupItem(e: SetupError): Item {
  return {
    id: "setup",
    title: e.message,
    subtitle: e.provider ? `${PROVIDER_NAMES[e.provider]} settings` : "Scheduling Links settings",
    icon: { source: Icons.key, tint: "orange" },
    detail: {
      markdown: [
        `## ${e.message}`,
        "",
        `Add one or both in ${CONFIGURE}:`,
        "",
        "**Cal.com**: an API key from **Settings → Developer → API Keys** (it starts with `cal_live_`).",
        "",
        "**Calendly**: a personal access token from **Integrations → API & Webhooks → Personal access tokens**.",
        "",
        "Both are stored in the system keyring.",
      ].join("\n"),
    },
    actions: [
      open("https://app.cal.com/settings/developer/api-keys", "Open Cal.com API Keys", { icon: Icons.key }),
      open("https://calendly.com/integrations/api_webhooks", "Open Calendly API Settings", { icon: Icons.key }),
    ],
  };
}
