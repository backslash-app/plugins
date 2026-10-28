import { assert, assertEquals } from "@std/assert";
import {
  calendarLabel,
  cleanDescription,
  describeRule,
  expand,
  findMeeting,
  formatDuration,
  hostAllowed,
  occurrences,
  parseCalendar,
  parseDate,
  parseDuration,
  parseProp,
  parseRule,
  parseUrls,
  placeOf,
  relative,
  resolveZone,
  sectionOf,
  statusFor,
  subtitleFor,
  timeRange,
  unescapeText,
  unfold,
} from "./lib.ts";
import { eventItem, type Shown } from "./calendars.ts";

const PARIS = "Europe/Paris";
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 16) + "Z";
const civil = (s: string) => Date.parse(`${s}Z`);

/** Wraps VEVENT bodies in a calendar. */
const ics = (...events: string[]) =>
  [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "X-WR-CALNAME:Work",
    ...events.flatMap((e) => ["BEGIN:VEVENT", e.trim(), "END:VEVENT"]),
    "END:VCALENDAR",
  ]
    .join("\r\n");

const at = (s: string) => Date.parse(s);

Deno.test("lines: unfolding, properties with quoted parameters, escaped text", () => {
  assertEquals(unfold("A:1\r\nB:long\r\n  line\r\n\tend\nC:3"), ["A:1", "B:long lineend", "C:3"]);
  assertEquals(parseProp('ATTENDEE;CN="Doe, Jane";PARTSTAT=ACCEPTED:mailto:jane@x.com'), {
    name: "ATTENDEE",
    params: { CN: "Doe, Jane", PARTSTAT: "ACCEPTED" },
    value: "mailto:jane@x.com",
  });
  assertEquals(parseProp('DESCRIPTION;ALTREP="http://x.com/a:b":Text: with colon')?.value, "Text: with colon");
  assertEquals(parseProp("dtstart;tzid=Europe/Paris:20261028T090000")?.name, "DTSTART");
  assertEquals(parseProp("no colon"), undefined);
  assertEquals(unescapeText("Line\\nTwo\\, three\\; four \\\\ five"), "Line\nTwo, three; four \\ five");
});

Deno.test("dates and time zones", () => {
  assertEquals(parseDate("20261028"), { civil: civil("2026-10-28T00:00:00"), allDay: true });
  assertEquals(parseDate("20261028T093000Z"), { civil: civil("2026-10-28T09:30:00"), zone: "UTC", allDay: false });
  assertEquals(parseDate("2026-10-28"), undefined);
  assertEquals(parseDate("20261028T093000", { TZID: "Europe/Paris" })?.zone, PARIS);
  assertEquals(parseDate("20261028T093000", { VALUE: "DATE" })?.allDay, true);
  assertEquals(parseDate("20261028T093000")?.zone, undefined); // floating
  assertEquals(resolveZone("Romance Standard Time"), PARIS);
  assertEquals(resolveZone("Pacific Standard Time"), "America/Los_Angeles");
  assertEquals(resolveZone("/mozilla.org/20050126_1/Europe/Paris"), PARIS);
  assertEquals(resolveZone('"America/New_York"'), "America/New_York");
  assertEquals(resolveZone("(UTC+01:00) Brussels, Copenhagen, Madrid, Paris"), "Etc/GMT-1");
  assertEquals(resolveZone("GMT"), "UTC");
  assertEquals(resolveZone("Nowhere Standard Time"), undefined);
  assertEquals(parseDuration("PT1H30M"), 5_400_000);
  assertEquals(parseDuration("P1D"), 86_400_000);
  assertEquals(parseDuration("P1W"), 7 * 86_400_000);
  assertEquals(parseDuration("-PT15M"), -900_000);
  assertEquals(parseDuration("P"), undefined);
});

Deno.test("recurrence rules", () => {
  const r = parseRule("FREQ=MONTHLY;INTERVAL=2;BYDAY=2TU,-1FR;COUNT=6;WKST=SU")!;
  assertEquals(r, {
    freq: "MONTHLY",
    interval: 2,
    count: 6,
    byDay: [{ day: 2, n: 2 }, { day: 5, n: -1 }],
    wkst: 0,
  });
  assertEquals(parseRule("FREQ=WEEKLY;UNTIL=20261231T225959Z")?.until?.zone, "UTC");
  assertEquals(parseRule("FREQ=HOURLY"), undefined);
  const days = (rule: string, start: string, end: string) =>
    [...occurrences(civil(start), parseRule(rule)!, civil(end))].map((c) => new Date(c).toISOString().slice(0, 10));

  assertEquals(days("FREQ=DAILY;INTERVAL=2;COUNT=4", "2026-10-01T09:00:00", "2027-01-01T00:00:00"), [
    "2026-10-01",
    "2026-10-03",
    "2026-10-05",
    "2026-10-07",
  ]);
  // Mon/Wed/Fri until a date (inclusive), starting on a Wednesday.
  assertEquals(days("FREQ=WEEKLY;BYDAY=MO,WE,FR;UNTIL=20261012", "2026-10-07T10:00:00", "2027-01-01T00:00:00"), [
    "2026-10-07",
    "2026-10-09",
    "2026-10-12",
  ]);
  // Every other week on Tuesday and Thursday.
  assertEquals(days("FREQ=WEEKLY;INTERVAL=2;BYDAY=TU,TH;COUNT=5", "2026-10-06T10:00:00", "2027-01-01T00:00:00"), [
    "2026-10-06",
    "2026-10-08",
    "2026-10-20",
    "2026-10-22",
    "2026-11-03",
  ]);
  // Second Tuesday and last Friday of the month.
  assertEquals(days("FREQ=MONTHLY;BYDAY=2TU,-1FR", "2026-10-13T10:00:00", "2026-12-31T00:00:00"), [
    "2026-10-13",
    "2026-10-30",
    "2026-11-10",
    "2026-11-27",
    "2026-12-08",
    "2026-12-25",
  ]);
  // The 31st only exists in some months.
  assertEquals(days("FREQ=MONTHLY;COUNT=4", "2026-10-31T08:00:00", "2028-01-01T00:00:00"), [
    "2026-10-31",
    "2026-12-31",
    "2027-01-31",
    "2027-03-31",
  ]);
  assertEquals(days("FREQ=MONTHLY;BYMONTHDAY=-1;COUNT=3", "2027-01-31T08:00:00", "2028-01-01T00:00:00"), [
    "2027-01-31",
    "2027-02-28",
    "2027-03-31",
  ]);
  // Last weekday of the month.
  assertEquals(days("FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1;COUNT=3", "2026-10-30T17:00:00", "2028-01-01"), [
    "2026-10-30",
    "2026-11-30",
    "2026-12-31",
  ]);
  assertEquals(days("FREQ=YEARLY;COUNT=3", "2024-02-29T00:00:00", "2040-01-01T00:00:00"), [
    "2024-02-29",
    "2028-02-29",
    "2032-02-29",
  ]);
  assertEquals(days("FREQ=DAILY;BYDAY=SA,SU;COUNT=3", "2026-10-30T09:00:00", "2027-01-01"), [
    "2026-10-30",
    "2026-10-31",
    "2026-11-01",
  ]);
});

Deno.test("skipping old periods gives the same occurrences", () => {
  for (
    const rule of [
      "FREQ=WEEKLY;BYDAY=MO,TH",
      "FREQ=DAILY;INTERVAL=3",
      "FREQ=MONTHLY;BYDAY=1WE",
      "FREQ=YEARLY",
      "FREQ=WEEKLY;INTERVAL=2",
    ]
  ) {
    const r = parseRule(rule)!;
    const start = civil("2015-03-02T09:00:00");
    const end = civil("2026-12-31T00:00:00");
    const from = civil("2026-10-01T00:00:00");
    const all = [...occurrences(start, r, end)].filter((c) => c >= from);
    const skipped = [...occurrences(start, r, end, from)].filter((c) => c >= from);
    assertEquals(skipped, all, rule);
  }
});

Deno.test("expanding a calendar: zones, DST, exceptions, overrides, cancellations", () => {
  const cal = parseCalendar(ics(
    // Weekly standup at 09:30 Paris time, across the end of summer time (25 Oct 2026).
    `UID:standup
SUMMARY:Standup
DTSTART;TZID=Europe/Paris:20261019T093000
DTEND;TZID=Europe/Paris:20261019T094500
RRULE:FREQ=WEEKLY;BYDAY=MO,WE
EXDATE;TZID=Europe/Paris:20261021T093000
LOCATION:https://meet.google.com/abc-defg-hij`,
    // The 28 Oct standup was moved to 11:00.
    `UID:standup
RECURRENCE-ID;TZID=Europe/Paris:20261028T093000
SUMMARY:Standup (moved)
DTSTART;TZID=Europe/Paris:20261028T110000
DTEND;TZID=Europe/Paris:20261028T111500`,
    `UID:cancelled
SUMMARY:Gone
STATUS:CANCELLED
DTSTART:20261027T100000Z
DTEND:20261027T110000Z`,
    `UID:offsite
SUMMARY:Offsite
DTSTART;VALUE=DATE:20261029
DTEND;VALUE=DATE:20261031`,
    `UID:until
SUMMARY:Daily until
DTSTART:20261026T150000Z
DURATION:PT30M
RRULE:FREQ=DAILY;UNTIL=20261027T150000Z`,
    `UID:count
SUMMARY:Ten times
DTSTART;TZID=America/New_York:20260901T120000
DTEND;TZID=America/New_York:20260901T130000
RRULE:FREQ=WEEKLY;COUNT=10`,
    `UID:outlook
SUMMARY:Outlook meeting
DTSTART;TZID="Romance Standard Time":20261030T140000
DTEND;TZID="Romance Standard Time":20261030T150000`,
  ));
  assertEquals(cal.name, "Work");
  const list = expand(cal.events, at("2026-10-19T00:00:00Z"), at("2026-11-03T00:00:00Z"), PARIS);
  const got = list.map((o) => `${o.event.summary}@${iso(o.start)}`);
  assertEquals(got, [
    "Standup@2026-10-19T07:30Z", // CEST, UTC+2
    "Ten times@2026-10-20T16:00Z", // EDT, UTC−4
    // 21 Oct excluded by EXDATE
    "Standup@2026-10-26T08:30Z", // CET, UTC+1: still 09:30 in Paris
    "Daily until@2026-10-26T15:00Z",
    "Daily until@2026-10-27T15:00Z", // UNTIL is inclusive
    "Ten times@2026-10-27T16:00Z",
    "Standup (moved)@2026-10-28T10:00Z", // replaces 28 Oct 09:30
    "Offsite@2026-10-28T23:00Z", // all day from local midnight
    "Outlook meeting@2026-10-30T13:00Z",
    "Standup@2026-11-02T08:30Z",
  ]);
  const offsite = list.find((o) => o.event.summary === "Offsite")!;
  assertEquals([offsite.allDay, (offsite.end - offsite.start) / 3_600_000], [true, 48]);
  // COUNT=10 from 1 September: the last one is 3 November, after New York left summer time.
  const ten = expand(cal.events, at("2026-09-01T00:00:00Z"), at("2027-01-01T00:00:00Z"), PARIS)
    .filter((o) => o.event.uid === "count");
  assertEquals(ten.length, 10);
  assertEquals(iso(ten[9].start), "2026-11-03T17:00Z"); // New York back on EST
  assertEquals(iso(ten[0].start), "2026-09-01T16:00Z");
});

Deno.test("floating times and events that started before the window", () => {
  const cal = parseCalendar(ics(
    `UID:float
SUMMARY:Lunch
DTSTART:20261028T120000
DTEND:20261028T130000`,
    `UID:trip
SUMMARY:Trip
DTSTART;VALUE=DATE:20261025
DTEND;VALUE=DATE:20261030`,
  ));
  const list = expand(cal.events, at("2026-10-28T00:00:00+01:00"), at("2026-10-29T00:00:00+01:00"), PARIS);
  assertEquals(list.map((o) => o.event.summary), ["Trip", "Lunch"]);
  assertEquals(iso(list[1].start), "2026-10-28T11:00Z");
});

Deno.test("video calls and descriptions", () => {
  assertEquals(findMeeting({ location: "https://meet.google.com/abc-defg-hij", description: "" }), {
    url: "https://meet.google.com/abc-defg-hij",
    service: "Google Meet",
  });
  assertEquals(
    findMeeting({ location: "Room 4", description: "Join: https://acme.zoom.us/j/123456789?pwd=xyz." })?.url,
    "https://acme.zoom.us/j/123456789?pwd=xyz",
  );
  assertEquals(
    findMeeting({
      location: "",
      description: "<https://teams.microsoft.com/l/meetup-join/19%3ameeting_x%40thread.v2/0>",
    })
      ?.service,
    "Microsoft Teams",
  );
  assertEquals(findMeeting({ location: "https://meet.jit.si/OurRoom", description: "" })?.service, "Jitsi Meet");
  assertEquals(
    findMeeting({
      conference: "https://meet.google.com/zzz-zzzz-zzz",
      location: "https://zoom.us/j/1",
      description: "",
    })
      ?.service,
    "Google Meet",
  );
  assertEquals(findMeeting({ location: "Cafe", description: "no link" }), undefined);
  assertEquals(placeOf("Room 4 / https://zoom.us/j/1"), "Room 4");
  assertEquals(placeOf("https://meet.google.com/x"), "");
  assertEquals(
    cleanDescription('Agenda<br>- <b>one</b><br><a href="https://x.com/doc">The doc</a>&nbsp;&amp; more'),
    "Agenda\n- one\n[The doc](https://x.com/doc) & more",
  );
  assertEquals(cleanDescription("Hi\n\n-::~:~::~:~::~::-\nJoin with Google Meet: …\n-::~:~::~:~::~::-"), "Hi");
});

Deno.test("sections, ranges and relative times", () => {
  const now = at("2026-10-28T10:00:00+01:00"); // Wednesday
  assertEquals(sectionOf(at("2026-10-28T18:00:00+01:00"), now, PARIS), "Today");
  assertEquals(sectionOf(at("2026-10-29T09:00:00+01:00"), now, PARIS), "Tomorrow");
  assertEquals(sectionOf(at("2026-10-31T09:00:00+01:00"), now, PARIS), "Saturday");
  assertEquals(sectionOf(at("2026-11-09T09:00:00+01:00"), now, PARIS), "Mon 9 Nov");
  const occ = (start: string, end: string, allDay = false) => ({
    event: parseCalendar(ics("UID:x\nSUMMARY:X\nDTSTART:20261028T090000Z")).events[0],
    start: at(start),
    end: at(end),
    allDay,
    recurring: false,
  });
  assertEquals(timeRange(occ("2026-10-28T09:30:00+01:00", "2026-10-28T10:15:00+01:00"), PARIS, now), "09:30 – 10:15");
  assertEquals(
    timeRange(occ("2026-10-28T09:30:00+01:00", "2026-10-28T10:15:00+01:00"), PARIS, now, true),
    "9:30 AM – 10:15 AM",
  );
  assertEquals(timeRange(occ("2026-10-27T22:00:00+01:00", "2026-10-28T11:00:00+01:00"), PARIS, now), "Until 11:00");
  assertEquals(
    timeRange(occ("2026-10-28T00:00:00+01:00", "2026-10-30T00:00:00+01:00", true), PARIS, now),
    "All day · 2 days",
  );
  assertEquals(
    timeRange(occ("2026-10-28T23:00:00+01:00", "2026-10-29T01:00:00+01:00"), PARIS, now),
    "23:00 – Thu 29 Oct 01:00",
  );
  assertEquals(relative(now + 12 * 60_000, now), "in 12 min");
  assertEquals(relative(now + 75 * 60_000, now), "in 1 h 15");
  assertEquals(relative(now + 120 * 60_000, now), "in 2 h");
  assertEquals(formatDuration(45 * 60_000), "45 min");
  assertEquals(formatDuration(90 * 60_000), "1 h 30");
  assertEquals(formatDuration(2 * 86_400_000), "2 days");
});

Deno.test("subtitle and status line", () => {
  const cal = parseCalendar(ics(
    "UID:a\nSUMMARY:Design review\nDTSTART:20261028T083000Z\nDTEND:20261028T093000Z",
    "UID:b\nSUMMARY:Standup\nDTSTART:20261028T101200Z\nDTEND:20261028T103000Z",
    "UID:c\nSUMMARY:Holiday\nDTSTART;VALUE=DATE:20261028",
  ));
  const list = expand(cal.events, at("2026-10-27T23:00:00Z"), at("2026-10-28T23:00:00Z"), PARIS);
  assertEquals(subtitleFor(list, at("2026-10-28T09:00:00Z"), PARIS), "Now: Design review");
  assertEquals(subtitleFor(list, at("2026-10-28T10:00:00Z"), PARIS), "Standup in 12 min");
  assertEquals(subtitleFor(list, at("2026-10-28T11:00:00Z"), PARIS), null);
  assertEquals(
    statusFor(list, at("2026-10-28T10:00:00Z"), PARIS, 2),
    "2 events left today · next: Standup in 12 min · 2 calendars",
  );
});

Deno.test("rule descriptions", () => {
  assertEquals(describeRule(parseRule("FREQ=WEEKLY;BYDAY=MO,WE")), "Weekly on Monday, Wednesday");
  assertEquals(describeRule(parseRule("FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,TU,WE,TH,FR")), "Every 2 weeks on weekdays");
  assertEquals(describeRule(parseRule("FREQ=MONTHLY;BYDAY=2TU")), "Monthly on the 2nd Tuesday");
  assertEquals(describeRule(parseRule("FREQ=MONTHLY;BYDAY=-1FR;COUNT=6")), "Monthly on the last Friday, 6 times");
  assertEquals(describeRule(parseRule("FREQ=DAILY;UNTIL=20261231")), "Daily, until 2026-12-31");
  assertEquals(describeRule(undefined), undefined);
});

Deno.test("calendar addresses and hosts", () => {
  assertEquals(
    parseUrls(
      "webcal://p42-caldav.icloud.com/published/2/abc\n https://calendar.google.com/calendar/ical/me%40gmail.com/private-x/basic.ics, not-a-url",
    ),
    [
      "https://p42-caldav.icloud.com/published/2/abc",
      "https://calendar.google.com/calendar/ical/me%40gmail.com/private-x/basic.ics",
    ],
  );
  assertEquals(parseUrls(undefined), []);
  assert(hostAllowed("https://p42-caldav.icloud.com/x"));
  assert(hostAllowed("https://outlook.office365.com/owa/calendar/x/calendar.ics"));
  assert(!hostAllowed("https://nextcloud.example.com/remote.php/dav"));
  assert(!hostAllowed("https://evilicloud.com/x"));
  assertEquals(
    calendarLabel("https://calendar.google.com/calendar/ical/me%40gmail.com/private-x/basic.ics"),
    "me@gmail.com",
  );
  assertEquals(calendarLabel("https://outlook.office365.com/owa/calendar/x/calendar.ics"), "Outlook");
});

Deno.test("an event item: in progress, Join Meeting first", () => {
  const cal = parseCalendar(ics(`UID:r
SUMMARY:Design review
DTSTART:20261028T090000Z
DTEND:20261028T100000Z
LOCATION:Room 4
DESCRIPTION:Notes\\nhttps://acme.zoom.us/j/42
ORGANIZER;CN=Ada:mailto:ada@x.com
ATTENDEE;CN=Ada;PARTSTAT=ACCEPTED:mailto:ada@x.com
ATTENDEE;CN=Bob;PARTSTAT=DECLINED:mailto:bob@x.com
ATTENDEE;CN=Cy:mailto:cy@x.com`));
  const [o] = expand(cal.events, at("2026-10-28T00:00:00Z"), at("2026-10-29T00:00:00Z"), PARIS);
  const shown: Shown = { ...o, calendar: { url: "u", index: 0, name: "Work", calendar: cal } };
  const now = at("2026-10-28T09:40:00Z");
  const item = eventItem(shown, { zone: PARIS, now, section: "Today", several: false, hour12: false });
  assertEquals(item.icon, { source: "bs-video", tint: "green" });
  assertEquals(item.subtitle, "10:00 – 11:00");
  assertEquals(item.accessories?.[0], { tag: "Now · ends in 20 min", color: "green" });
  assertEquals(item.actions?.[0].title, "Join Meeting");
  assertEquals((item.actions?.[0] as { target: string }).target, "https://acme.zoom.us/j/42");
  const meta = item.detail?.metadata?.map((m) => `${m.label}=${m.value ?? ""}`) ?? [];
  assert(meta.includes("Attendees=2 of 3 going"), meta.join(" | "));
  assert(meta.includes("Location=Room 4"));
  assertEquals(item.detail?.stats?.[1], { label: "Duration", value: "1 h" });
});
