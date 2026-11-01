import { assert, assertEquals, assertFalse } from "@std/assert";
import { parse } from "@std/toml";
import { HOSTS } from "./api.ts";
import {
  ago,
  bySection,
  countdown,
  country,
  dateSection,
  eventKind,
  eventsUrl,
  hostLabel,
  infoLinks,
  isLive,
  type Launch,
  launchesUrl,
  launchText,
  mapUrl,
  matchesProviders,
  md,
  missionName,
  orbit,
  type Page,
  parseProviders,
  place,
  precision,
  providerName,
  providerShort,
  providerWords,
  recentSection,
  rocketName,
  slimEvent,
  slimLaunch,
  sortEvents,
  sortRecent,
  sortUpcoming,
  type SpaceEvent,
  splitName,
  status,
  summary,
  throttleWait,
  tMinus,
  upcomingSection,
  webcasts,
  when,
  windowLength,
} from "./lib.ts";

const read = async <T>(name: string) =>
  JSON.parse(await Deno.readTextFile(new URL(`./fixtures/${name}`, import.meta.url))) as Page<T>;

const upcoming = (await read<Launch>("upcoming.json")).results;
const events = (await read<SpaceEvent>("events.json")).results;
const [electron, kinetica, falcon] = upcoming;

const NOW = Date.parse("2026-11-02T12:00:00Z");
const UTC = "UTC";

/** A launch that happened, built like the API's `previous` answers. */
const failed: Launch = {
  id: "f1",
  name: "Firefly Alpha | Message in a Booster",
  status: { id: 4, name: "Launch Failure", abbrev: "Failure" },
  net: "2026-10-31T18:00:00Z",
  net_precision: { id: 1, name: "Minute" },
  failreason: "Second stage engine shut down early.",
  launch_service_provider: { id: 265, name: "Firefly Aerospace", abbrev: "FA" },
  rocket: { configuration: { name: "Firefly Alpha", full_name: "Firefly Alpha" } },
  mission: { name: "Message in a Booster", orbit: { id: 17, name: "Sun-Synchronous Orbit", abbrev: "SSO" } },
  pad: { name: "SLC-2W", location: { name: "Vandenberg SFB, CA, USA", country_code: "USA" } },
};

Deno.test("the fixtures are real API answers", () => {
  assertEquals(upcoming.length, 3);
  assertEquals(events.length, 3);
  assertEquals(providerName(falcon), "SpaceX");
});

Deno.test("urls", () => {
  assertEquals(
    launchesUrl("upcoming"),
    "https://ll.thespacedevs.com/2.3.0/launches/upcoming/?limit=40&mode=detailed&hide_recent_previous=true",
  );
  assertEquals(
    launchesUrl("previous", 10),
    "https://ll.thespacedevs.com/2.3.0/launches/previous/?limit=10&mode=detailed",
  );
  assertEquals(eventsUrl(), "https://ll.thespacedevs.com/2.3.0/events/upcoming/?limit=30");
  for (const u of [launchesUrl("upcoming"), eventsUrl()]) assert(HOSTS.includes(new URL(u).hostname));
});

Deno.test("throttled answers say how long to wait", () => {
  assertEquals(throttleWait("Request was throttled. Expected available in 1234 seconds."), 1234);
  assertEquals(throttleWait("Expected available in 1 second."), 1);
  assertEquals(throttleWait("Not found."), undefined);
  assertEquals(throttleWait(undefined), undefined);
});

Deno.test("status: by id, by name, unknown", () => {
  assertEquals(status(falcon.status), { label: "Go", color: "green", done: false });
  assertEquals(status(failed.status).label, "Failure");
  assert(status(failed.status).done);
  assertEquals(status({ id: 2, name: "To Be Determined", abbrev: "TBD" }).color, "gray");
  assertEquals(status({ id: 8, name: "To Be Confirmed", abbrev: "TBC" }).label, "TBC");
  assertEquals(status({ id: 5, name: "On Hold", abbrev: "Hold" }).color, "orange");
  assertEquals(status({ id: 6, name: "Launch in Flight", abbrev: "In Flight" }).label, "In Flight");
  assertEquals(
    status({ id: 7, name: "Launch was a Partial Failure", abbrev: "Partial Failure" }).label,
    "Partial Failure",
  );
  assertEquals(status({ id: 3, name: "Launch Successful", abbrev: "Success" }).done, true);
  // Without an id (older answers), the name decides.
  assertEquals(status({ name: "Go for Launch" }).label, "Go");
  assertEquals(status({ name: "Launch Successful", abbrev: "Success" }).label, "Success");
  assertEquals(status({ name: "Something new", abbrev: "New" }), { label: "New", color: "gray", done: false });
  assertEquals(status(null).label, "Unknown");
});

Deno.test("precision", () => {
  assertEquals(precision(electron.net_precision), "exact"); // Minute
  assertEquals(precision(kinetica.net_precision), "exact"); // Hour
  assertEquals(precision(events[0].date_precision), "day");
  assertEquals(precision(events[1].date_precision), "month");
  assertEquals(precision({ id: 9, name: "Quarter 2" }), "quarter");
  assertEquals(precision({ id: 13, name: "Half 2" }), "half");
  assertEquals(precision({ id: 14, name: "Year" }), "year");
  assertEquals(precision({ name: "Week" }), "week");
  assertEquals(precision({ name: "Afternoon" }), "day");
  assertEquals(precision(null), "exact");
});

Deno.test("T-minus and ago", () => {
  assertEquals(tMinus("2026-11-02T16:41:00Z", NOW), "T-4h 41m");
  assertEquals(tMinus("2026-11-02T12:45:00Z", NOW), "T-45m");
  assertEquals(tMinus("2026-11-04T13:00:00Z", NOW), "T-2d 01h");
  assertEquals(tMinus("2026-11-02T12:00:20Z", NOW), "T-0");
  assertEquals(tMinus("2026-11-02T11:48:00Z", NOW), "T+12m");
  assertEquals(tMinus("2026-11-02T09:30:00Z", NOW), "T+2h 30m");
  assertEquals(ago("2026-11-02T11:59:50Z", NOW), "just now");
  assertEquals(ago("2026-11-02T11:15:00Z", NOW), "45 min ago");
  assertEquals(ago("2026-11-02T07:00:00Z", NOW), "5 h ago");
  assertEquals(ago("2026-11-01T10:00:00Z", NOW), "yesterday");
  assertEquals(ago("2026-10-28T10:00:00Z", NOW), "5 days ago");
});

Deno.test("dates as precise as they are known", () => {
  const iso = "2026-11-03T01:42:00Z";
  assertEquals(when(iso, "exact", UTC), "Tue 3 Nov 2026, 01:42");
  assertEquals(when(iso, "exact", "America/Los_Angeles"), "Mon 2 Nov 2026, 17:42");
  assertEquals(when(iso, "day", UTC), "Tue 3 Nov 2026");
  assertEquals(when(iso, "week", UTC), "Week of 3 Nov 2026");
  assertEquals(when(iso, "month", UTC), "November 2026");
  assertEquals(when(iso, "quarter", UTC), "Q4 2026");
  assertEquals(when("2027-03-01T00:00:00Z", "half", UTC), "H1 2027");
  assertEquals(when(iso, "year", UTC), "2026");
});

Deno.test("countdown: T-minus, NET date or how long ago", () => {
  assertEquals(countdown(falcon, NOW, UTC), "T-13h 42m");
  assertEquals(countdown({ ...falcon, net_precision: { id: 7, name: "Month" } }, NOW, UTC), "NET November 2026");
  assertEquals(countdown(failed, NOW, UTC), "yesterday");
  assertEquals(summary(falcon, NOW, UTC), "Falcon 9 Block 5 · USSF-432 · T-13h 42m");
});

Deno.test("launch window", () => {
  assertEquals(windowLength(falcon), "4 h");
  assertEquals(windowLength(electron), "2 h 20 min");
  assertEquals(windowLength({ ...falcon, window_end: falcon.window_start }), "instantaneous");
  assertEquals(windowLength({ ...falcon, window_end: "2026-11-03T02:27:00Z" }), "45 min");
  assertEquals(windowLength({ ...falcon, window_end: null }), undefined);
});

Deno.test("names, pad, country and orbit", () => {
  assertEquals(splitName("Falcon 9 Block 5 | Starlink Group 10-12"), {
    rocket: "Falcon 9 Block 5",
    mission: "Starlink Group 10-12",
  });
  assertEquals(splitName("Mystery launch"), { rocket: "Mystery launch", mission: "" });
  assertEquals(rocketName(electron), "Electron");
  assertEquals(missionName(electron), "The Sea God Surveys (iQPS Launch 9)");
  // Without rocket or mission objects, the launch name is split.
  const bare: Launch = { id: "x", name: "Long March 2D | Yaogan 45", net: falcon.net };
  assertEquals([rocketName(bare), missionName(bare)], ["Long March 2D", "Yaogan 45"]);
  assertEquals(providerName(bare), "Unknown provider");
  assertEquals(place(bare), "Unknown pad");
  assertEquals(place(falcon), "Space Launch Complex 4E, Vandenberg SFB, CA, USA");
  assertEquals(country(electron), "New Zealand");
  assertEquals(country(failed), "USA");
  assertEquals(orbit(electron), "Low Earth Orbit (LEO)");
  assertEquals(orbit(failed), "Sun-Synchronous Orbit (SSO)");
  assertEquals(orbit(bare), undefined);
});

Deno.test("short provider names", () => {
  assertEquals(providerShort(falcon.launch_service_provider), "SpaceX");
  assertEquals(
    providerShort({ id: 88, name: "China Aerospace Science and Technology Corporation", abbrev: "CASC" }),
    "CASC",
  );
  assertEquals(providerShort({ id: 1, name: "A very long provider name" }), "A very long provider name");
  assertEquals(providerShort(null), "Unknown");
});

Deno.test("providers: aliases and the preference", () => {
  assertEquals(parseProviders(" SpaceX, Rocket Lab ;ISRO,, "), ["spacex", "rocket lab", "isro"]);
  assertEquals(parseProviders(undefined), []);
  assert(providerWords(falcon.launch_service_provider).includes("spacex"));
  assert(
    providerWords({ id: 88, name: "China Aerospace Science and Technology Corporation", abbrev: "CASC" })
      .includes("cnsa"),
  );
  assert(providerWords({ id: 31, name: "Indian Space Research Organization", abbrev: "ISRO" }).includes("isro"));
  assert(providerWords({ id: 115, name: "Arianespace", abbrev: "ASA" }).includes("esa"));
  assert(providerWords(kinetica.launch_service_provider).includes("china"));
  assertEquals(providerWords(null), []);

  const all = [...upcoming, failed];
  const pick = (pref: string) => all.filter((l) => matchesProviders(l, parseProviders(pref))).map(rocketName);
  assertEquals(pick(""), ["Electron", "Kinetica 2", "Falcon 9 Block 5", "Firefly Alpha"]);
  assertEquals(pick("SpaceX, Rocket Lab"), ["Electron", "Falcon 9 Block 5"]);
  assertEquals(pick("china"), ["Kinetica 2"]);
  assertEquals(pick("firefly"), ["Firefly Alpha"]);
  assertEquals(pick("ISRO"), []);
  // Short words only match whole names: "ula" isn't in "Firefly Alpha Launch".
  assertEquals(pick("fa"), ["Firefly Alpha"]);
  assertFalse(matchesProviders(falcon, ["ula"]));
});

Deno.test("webcasts and links", () => {
  const vids = webcasts(falcon);
  assertEquals(vids.length, 2);
  assert(vids.every((v) => v.url.startsWith("https://")));
  assertEquals(webcasts(electron), []);
  // Live first, then by priority; a missing title becomes the host.
  const sorted = webcasts({
    vid_urls: [
      { url: "https://b.example/1", priority: 1, title: "B" },
      { url: "https://www.youtube.com/watch?v=x", priority: 9, live: true },
      { url: "javascript:alert(1)", priority: 0 },
    ],
    video_url: "https://c.example/2",
  });
  assertEquals(sorted.map((v) => v.title), ["youtube.com", "B", "c.example"]);
  assertEquals(sorted[0].live, true);
  assertEquals(infoLinks(electron)[0].title, "The Sea God Surveys");
  assertEquals(hostLabel("not a url"), "not a url");
});

Deno.test("pad on a map", () => {
  assertEquals(
    mapUrl(electron.pad),
    "https://www.openstreetmap.org/?mlat=-39.260881&mlon=177.865826#map=13/-39.260881/177.865826",
  );
  assertEquals(mapUrl({ name: "X", map_url: "https://maps.google.com/?q=1,2" }), "https://maps.google.com/?q=1,2");
  assertEquals(mapUrl({ name: "X", latitude: null, longitude: null }), undefined);
  assertEquals(mapUrl(null), undefined);
});

Deno.test("live launches", () => {
  assertFalse(isLive(falcon));
  assert(isLive({ ...falcon, webcast_live: true }));
  assert(isLive({ ...falcon, status: { id: 6, name: "Launch in Flight", abbrev: "In Flight" } }));
});

Deno.test("sections and order", () => {
  assertEquals(upcomingSection(electron, NOW, UTC), "Today");
  assertEquals(upcomingSection(falcon, NOW, UTC), "Tomorrow");
  assertEquals(upcomingSection({ ...falcon, webcast_live: true }, NOW, UTC), "Now");
  assertEquals(dateSection("2026-11-06T10:00:00Z", "exact", NOW, UTC), "This week");
  assertEquals(dateSection("2026-11-20T10:00:00Z", "day", NOW, UTC), "This month");
  assertEquals(dateSection("2027-01-20T10:00:00Z", "exact", NOW, UTC), "Later");
  assertEquals(dateSection("2026-11-20T10:00:00Z", "month", NOW, UTC), "Date not set");
  // A launch that slipped past its time is still today's.
  assertEquals(dateSection("2026-11-02T10:00:00Z", "exact", NOW, UTC), "Today");
  assertEquals(recentSection(failed, NOW), "This week");
  assertEquals(recentSection({ ...failed, net: "2026-11-02T08:00:00Z" }, NOW), "Last 24 hours");
  assertEquals(recentSection({ ...failed, net: "2026-08-02T08:00:00Z" }, NOW), "Earlier");

  const items = [
    { id: 1, section: "Date not set" },
    { id: 2, section: "Today" },
    { id: 3, section: "Later" },
    { id: 4, section: "Today" },
    { id: 5, section: "Now" },
    { id: 6, section: "Offline" },
  ];
  assertEquals(bySection(items).map((i) => i.id), [6, 5, 2, 4, 3, 1]);
});

Deno.test("sorting", () => {
  const shuffled = [falcon, failed, electron, kinetica];
  assertEquals(sortUpcoming(shuffled).map((l) => l.id), [failed, electron, kinetica, falcon].map((l) => l.id));
  assertEquals(sortRecent(shuffled)[0].id, falcon.id);
  const undated: SpaceEvent = { id: 9, name: "Someday", date: null };
  assertEquals(sortEvents([events[2], undated, events[0], events[1]]).map((e) => e.id), events.map((e) => e.id));
});

Deno.test("copied launch text", () => {
  assertEquals(
    launchText(falcon, UTC),
    [
      falcon.name,
      "Go: Tue 3 Nov 2026, 01:42",
      "Provider: SpaceX",
      "Pad: Space Launch Complex 4E, Vandenberg SFB, CA, USA",
      "Orbit: Low Earth Orbit (LEO)",
      `Webcast: ${webcasts(falcon)[0].url}`,
    ].join("\n"),
  );
  assertEquals(launchText(failed, UTC).split("\n")[1], "Failure: Sat 31 Oct 2026, 18:00");
});

Deno.test("events", () => {
  const [eva, insertion, flyby] = events;
  assertEquals(eventKind(eva), { label: "EVA", color: "purple" });
  assertEquals(eventKind(insertion).color, "orange");
  assertEquals(eventKind(flyby).color, "orange");
  assertEquals(eventKind({ id: 1, name: "x", date: null, type: { name: "Docking" } }).color, "blue");
  assertEquals(eventKind({ id: 1, name: "x", date: null, type: { name: "Splashdown" } }).color, "teal");
  assertEquals(eventKind({ id: 1, name: "x", date: null }), { label: "Event", color: "gray" });
  assertEquals(webcasts(eva)[0].url, "https://plus.nasa.gov/scheduled-video/u-s-spacewalk-101/");
});

Deno.test("cached copies keep only what is shown", () => {
  const slim = slimLaunch(falcon);
  // Everything the views read survives…
  for (
    const f of [rocketName, missionName, providerName, place, country, orbit, (l: Launch) => countdown(l, NOW, UTC)]
  ) {
    assertEquals(f(slim), f(falcon));
  }
  assertEquals(webcasts(slim), webcasts(falcon));
  assertEquals(infoLinks(slimLaunch(electron)), infoLinks(electron));
  assertEquals(mapUrl(slimLaunch(electron).pad), mapUrl(electron.pad));
  assertEquals(launchText(slim, UTC), launchText(falcon, UTC));
  assertEquals(providerWords(slim.launch_service_provider), providerWords(falcon.launch_service_provider));
  // …and it is much smaller.
  assert(JSON.stringify(slim).length * 3 < JSON.stringify(falcon).length);
  assertEquals(slimLaunch(slim), slim);

  const e = slimEvent(events[0]);
  assertEquals(webcasts(e), webcasts(events[0]));
  assertEquals(eventKind(e), eventKind(events[0]));
  assertEquals(slimEvent(e), e);
  assertEquals(slimLaunch({ id: "x", name: "Bare", net: falcon.net }).pad, null);
});

Deno.test("markdown escaping", () => {
  assertEquals(md("A *bold* [link] `code` <b> | x_y"), "A \\*bold\\* \\[link\\] \\`code\\` \\<b\\> \\| x\\_y");
});

Deno.test("hosts match the manifest", async () => {
  const manifest = parse(await Deno.readTextFile(new URL("./backslash.toml", import.meta.url))) as {
    extension: { id: string; categories: string[] };
    permissions: { net: string[] };
    commands: { name: string }[];
  };
  assertEquals(manifest.extension.id, "space-launches");
  assertEquals(manifest.permissions.net, HOSTS);
  for (const c of manifest.commands) await Deno.stat(new URL(`./commands/${c.name}.ts`, import.meta.url));
});
