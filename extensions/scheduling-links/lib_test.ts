import { assert, assertEquals, assertInstanceOf, assertStringIncludes, assertThrows } from "@std/assert";
import {
  accountsOf,
  apiError,
  attendeeSummary,
  bookingMarkdown,
  bookingSummary,
  type CalBooking,
  type CalendlyEvent,
  type CalendlyInvitee,
  dayTitle,
  duration,
  firstUrl,
  fromCalBooking,
  fromCalendlyEvent,
  fromCalendlyEventType,
  fromCalEventType,
  joinable,
  locationLabel,
  minutesBetween,
  SetupError,
  setupItem,
  timeRange,
  untilLabel,
  upcomingOnly,
  uuidOf,
} from "./lib.ts";

const UTC = "UTC";

Deno.test("accounts from preferences", () => {
  assertThrows(() => accountsOf({}), SetupError, "Connect Cal.com or Calendly");
  assertEquals(accountsOf({ calApiKey: " cal_live_abc ", calendlyToken: "" }), [{
    provider: "cal",
    token: "cal_live_abc",
  }]);
  assertEquals(accountsOf({ calendlyToken: "Bearer eyJraWQ" }).map((a) => a.token), ["eyJraWQ"]);
  assertEquals(accountsOf({ calApiKey: "k", calendlyToken: "t" }).map((a) => a.provider), ["cal", "calendly"]);
});

Deno.test("API errors are sentences", () => {
  assertInstanceOf(apiError("cal", 401, { status: "error", error: { message: "Invalid API Key" } }), SetupError);
  assertEquals(apiError("calendly", 401, {}).message, "Calendly refused the token");
  assertEquals(
    apiError("calendly", 400, {
      title: "Invalid Argument",
      message: "The supplied parameters are invalid.",
      details: [{ message: "must be a valid ISO 8601 timestamp" }],
    }).message,
    "Calendly answered 400: The supplied parameters are invalid.: must be a valid ISO 8601 timestamp",
  );
  assertEquals(
    apiError("cal", 400, { status: "error", error: { message: "Booking already cancelled" } }).message,
    "Cal.com answered 400: Booking already cancelled",
  );
  assertStringIncludes(apiError("cal", 429, undefined).message, "rate limiting");
  assertStringIncludes(setupItem(new SetupError("x")).detail!.markdown!, "cal_live_");
});

Deno.test("links and locations", () => {
  assertEquals(
    firstUrl(null, "Join at https://meet.google.com/abc-defg-hij.", "x"),
    "https://meet.google.com/abc-defg-hij",
  );
  assertEquals(firstUrl("integrations:daily", undefined), undefined);
  assertEquals(locationLabel("integrations:google:meet"), "Google Meet");
  assertEquals(locationLabel("integrations:daily"), "Cal Video");
  assertEquals(locationLabel("integrations:office365_video"), "Microsoft Teams");
  assertEquals(locationLabel("https://us02web.zoom.us/j/8123456789"), "Zoom");
  assertEquals(locationLabel("https://meet.google.com/abc-defg-hij"), "Google Meet");
  assertEquals(locationLabel("https://app.cal.com/video/8yR3"), "app.cal.com");
  assertEquals(locationLabel("12 rue de Rivoli, Paris"), "12 rue de Rivoli, Paris");
  assertEquals(locationLabel(null, "zoom_conference"), "Zoom");
  assertEquals(locationLabel(null, "microsoft_teams_conference"), "Microsoft Teams");
  assertEquals(locationLabel("+33 6 12 34 56 78", "outbound_call"), "Phone call");
  assertEquals(locationLabel("integrations:something-new"), undefined);
});

// GET /v2/bookings (cal-api-version 2024-08-13)
const calBooking: CalBooking = {
  id: 1234,
  uid: "aB3dEf9GhIjK",
  title: "30 Min Meeting between Steven and Ada Lovelace",
  description: "Let's talk about the engine.",
  hosts: [{
    id: 1,
    name: "Steven",
    email: "steven@example.com",
    username: "steven",
    timeZone: "Europe/Paris",
  }] as never,
  status: "accepted",
  start: "2026-11-02T14:00:00.000Z",
  end: "2026-11-02T14:30:00.000Z",
  duration: 30,
  eventTypeId: 50,
  eventType: { id: 50, slug: "30min" },
  meetingUrl: "https://app.cal.com/video/aB3dEf9GhIjK",
  location: "integrations:daily",
  attendees: [
    { name: "Ada Lovelace", email: "ada@example.org", timeZone: "Europe/London", absent: false },
    { name: "Charles Babbage", email: "charles@example.org", timeZone: "Europe/London" },
  ],
  bookingFieldsResponses: {
    name: "Ada Lovelace",
    email: "ada@example.org",
    notes: "Bring the diagrams",
    "company-size": "11-50",
    guests: ["charles@example.org"],
  },
};

Deno.test("Cal.com bookings", () => {
  const b = fromCalBooking(calBooking);
  assertEquals(b.id, "aB3dEf9GhIjK");
  assertEquals(b.status, "upcoming");
  assertEquals(b.joinUrl, "https://app.cal.com/video/aB3dEf9GhIjK");
  assertEquals(b.location, "Cal Video");
  assertEquals(b.webUrl, "https://app.cal.com/booking/aB3dEf9GhIjK");
  assertEquals(b.hosts, ["Steven"]);
  assertEquals(b.attendees.map((a) => a.name), ["Ada Lovelace", "Charles Babbage"]);
  assertEquals(b.attendees[0].answers, [
    { question: "Notes", answer: "Bring the diagrams" },
    { question: "Company size", answer: "11-50" },
  ]);
  assertEquals(attendeeSummary(b), "Ada Lovelace +1");
  assertEquals(fromCalBooking({ ...calBooking, status: "unconfirmed" }).status, "pending");
  assertEquals(fromCalBooking({ ...calBooking, status: "cancelled" }).status, "canceled");
  const zoom = fromCalBooking({
    ...calBooking,
    meetingUrl: null,
    location: "https://us02web.zoom.us/j/8123456789?pwd=abc",
    attendees: [],
  });
  assertEquals(zoom.joinUrl, "https://us02web.zoom.us/j/8123456789?pwd=abc");
  assertEquals(zoom.location, "Zoom");
  assertEquals(attendeeSummary(zoom), "");
  const md = bookingMarkdown(b, UTC);
  assertStringIncludes(md, "**Ada Lovelace** <ada@example.org> · Europe/London");
  assertStringIncludes(md, "**Company size**");
  assertStringIncludes(md, "Let's talk about the engine.");
});

// GET /scheduled_events and /scheduled_events/{uuid}/invitees
const calendlyEvent: CalendlyEvent = {
  uri: "https://api.calendly.com/scheduled_events/GBGBDCAADAEDCRZ2",
  name: "Intro Call",
  status: "active",
  start_time: "2026-11-03T09:00:00.000000Z",
  end_time: "2026-11-03T09:45:00.000000Z",
  event_type: "https://api.calendly.com/event_types/AAAAAAAAAAAAAAAA",
  location: { type: "google_conference", status: "pushed", join_url: "https://meet.google.com/xyz-abcd-efg" },
  invitees_counter: { total: 1, active: 1, limit: 1 },
  event_memberships: [{ user: "https://api.calendly.com/users/X", user_email: "me@example.com", user_name: "Steven" }],
  event_guests: [{ email: "guest@example.net" }],
};
const invitees: CalendlyInvitee[] = [
  {
    uri: "https://api.calendly.com/scheduled_events/GBGBDCAADAEDCRZ2/invitees/AAA",
    email: "grace@example.com",
    name: "Grace Hopper",
    status: "active",
    timezone: "America/New_York",
    cancel_url: "https://calendly.com/cancellations/AAA",
    reschedule_url: "https://calendly.com/reschedulings/AAA",
    questions_and_answers: [
      { question: "What would you like to discuss?", answer: "Compilers" },
      { question: "Anything else?", answer: " " },
    ],
  },
  { email: "gone@example.com", name: "Gone", status: "canceled" },
];

Deno.test("Calendly events", () => {
  assertEquals(uuidOf(calendlyEvent.uri), "GBGBDCAADAEDCRZ2");
  const b = fromCalendlyEvent(calendlyEvent, invitees);
  assertEquals(b.id, "GBGBDCAADAEDCRZ2");
  assertEquals(b.joinUrl, "https://meet.google.com/xyz-abcd-efg");
  assertEquals(b.location, "Google Meet");
  assertEquals(b.attendees.map((a) => a.email), ["grace@example.com", "guest@example.net"]);
  assertEquals(b.attendees[0].answers, [{ question: "What would you like to discuss?", answer: "Compilers" }]);
  assertEquals(b.attendees[0].rescheduleUrl, "https://calendly.com/reschedulings/AAA");
  assertEquals(b.hosts, ["Steven"]);
  const physical = fromCalendlyEvent({
    ...calendlyEvent,
    location: { type: "physical", location: "Café de Flore, 172 Bd Saint-Germain" },
  });
  assertEquals(physical.location, "Café de Flore, 172 Bd Saint-Germain");
  assertEquals(physical.joinUrl, undefined);
  assertEquals(fromCalendlyEvent({ ...calendlyEvent, location: null }).location, undefined);
  assertEquals(fromCalendlyEvent({ ...calendlyEvent, status: "canceled" }).status, "canceled");
});

Deno.test("event types", () => {
  assertEquals(
    fromCalEventType({ id: 7, title: "30 Min", slug: "30min", lengthInMinutes: 30, hidden: false }, "steven")?.url,
    "https://cal.com/steven/30min",
  );
  assertEquals(
    fromCalEventType({ id: 7, title: "x", slug: "x", bookingUrl: "https://cal.com/team/acme/x" }, undefined)?.url,
    "https://cal.com/team/acme/x",
  );
  assertEquals(fromCalEventType({ id: 7, title: "x", slug: "x" }, undefined), undefined);
  const c = fromCalendlyEventType({
    uri: "https://api.calendly.com/event_types/BBBB",
    name: "Team sync",
    slug: "team-sync",
    scheduling_url: "https://calendly.com/acme/team-sync",
    duration: 60,
    active: true,
    secret: true,
    kind: "solo",
    pooling_type: "round_robin",
    description_plain: "Weekly",
  });
  assertEquals(c.kind, "Round robin");
  assertEquals(c.hidden, true);
  assertEquals(c.uri, "https://api.calendly.com/event_types/BBBB");
  assertEquals(c.minutes, 60);
});

Deno.test("dates and labels", () => {
  const now = new Date("2026-11-02T10:00:00Z");
  assertEquals(dayTitle("2026-11-02T14:00:00Z", now, UTC), "Today");
  assertEquals(dayTitle("2026-11-03T09:00:00Z", now, UTC), "Tomorrow");
  assertEquals(dayTitle("2026-11-05T09:00:00Z", now, UTC), "Thursday 5 November");
  assertEquals(dayTitle("2027-01-05T09:00:00Z", now, UTC), "Tuesday 5 January 2027");
  assertEquals(timeRange("2026-11-02T14:00:00Z", "2026-11-02T14:30:00Z", UTC), "14:00–14:30");
  assertEquals(timeRange("2026-11-02T14:00:00Z", "2026-11-02T14:30:00Z", "Europe/Paris"), "15:00–15:30");
  assertEquals(minutesBetween("2026-11-02T14:00:00Z", "2026-11-02T15:30:00Z"), 90);
  assertEquals(duration(30), "30 min");
  assertEquals(duration(60), "1 h");
  assertEquals(duration(90), "1 h 30");
  assertEquals(duration(0), "");
  const t = now.getTime();
  assertEquals(untilLabel("2026-11-02T10:05:00Z", "2026-11-02T10:30:00Z", t), "in 5 min");
  assertEquals(untilLabel("2026-11-02T13:00:00Z", "2026-11-02T13:30:00Z", t), "in 3 h");
  assertEquals(untilLabel("2026-11-04T10:00:00Z", "2026-11-04T10:30:00Z", t), "in 2 d");
  assertEquals(untilLabel("2026-11-02T09:45:00Z", "2026-11-02T10:15:00Z", t), "now");
  assertEquals(untilLabel("2026-11-02T09:00:00Z", "2026-11-02T09:30:00Z", t), "ended");
});

Deno.test("joinable, ordering and summary", () => {
  const b = fromCalBooking(calBooking);
  assert(joinable(b, Date.parse("2026-11-02T13:50:00Z")));
  assert(!joinable(b, Date.parse("2026-11-02T13:00:00Z")));
  assert(!joinable(b, Date.parse("2026-11-02T14:31:00Z")));
  const c = fromCalendlyEvent(calendlyEvent, invitees);
  const ended = fromCalBooking({
    ...calBooking,
    uid: "old",
    start: "2026-11-01T10:00:00Z",
    end: "2026-11-01T11:00:00Z",
  });
  const canceled = fromCalBooking({ ...calBooking, uid: "x", status: "cancelled" });
  assertEquals(
    upcomingOnly([c, ended, canceled, b], Date.parse("2026-11-02T10:00:00Z")).map((x) => x.id),
    ["aB3dEf9GhIjK", "GBGBDCAADAEDCRZ2"],
  );
  assertEquals(
    bookingSummary(c, new Date("2026-11-02T10:00:00Z"), UTC),
    "Intro Call, Tomorrow 09:00–09:45, https://meet.google.com/xyz-abcd-efg",
  );
});
