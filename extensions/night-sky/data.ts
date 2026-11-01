// Fixed data: the eclipses of 2026–2030 from NASA's eclipse tables (Fred
// Espenak, eclipse.gsfc.nasa.gov), and the major meteor showers from the
// International Meteor Organization's working list.

export type SolarKind = "total" | "annular" | "partial" | "hybrid";
export type LunarKind = "total" | "partial" | "penumbral";

export interface Eclipse {
  body: "solar" | "lunar";
  kind: SolarKind | LunarKind;
  /** Greatest eclipse, UT (NASA lists it in dynamical time, about 69 s later). */
  greatest: string;
  /** Solar: the eclipse's magnitude at greatest eclipse. Lunar: the umbral magnitude (negative for penumbral eclipses). */
  magnitude: number;
  /** Solar: the longest totality or annularity. Lunar: the partial phase, then totality. */
  durations: string[];
  /** Where it can be seen. */
  regions: string;
  /** Solar: where the Moon covers the Sun completely or sits inside it. */
  path?: string;
  saros: number;
}

const TD_MINUS_UT = 69_000;
const ut = (td: string) => new Date(Date.parse(`${td}Z`) - TD_MINUS_UT).toISOString().replace(/\.000Z$/, "Z");

export const ECLIPSES: Eclipse[] = [
  {
    body: "solar",
    kind: "annular",
    greatest: ut("2026-02-17T12:13:05"),
    magnitude: 0.963,
    durations: ["2 min 20 s"],
    regions: "Southern Argentina and Chile, southern Africa, Antarctica",
    path: "Antarctica",
    saros: 121,
  },
  {
    body: "lunar",
    kind: "total",
    greatest: ut("2026-03-03T11:34:52"),
    magnitude: 1.151,
    durations: ["3 h 27 min", "58 min"],
    regions: "East Asia, Australia, the Pacific, the Americas",
    saros: 133,
  },
  {
    body: "solar",
    kind: "total",
    greatest: ut("2026-08-12T17:47:05"),
    magnitude: 1.039,
    durations: ["2 min 18 s"],
    regions: "Northern North America, western Africa, Europe",
    path: "the Arctic, Greenland, Iceland, Spain",
    saros: 126,
  },
  {
    body: "lunar",
    kind: "partial",
    greatest: ut("2026-08-28T04:14:04"),
    magnitude: 0.93,
    durations: ["3 h 18 min"],
    regions: "Eastern Pacific, the Americas, Europe, Africa",
    saros: 138,
  },
  {
    body: "solar",
    kind: "annular",
    greatest: ut("2027-02-06T16:00:47"),
    magnitude: 0.928,
    durations: ["7 min 51 s"],
    regions: "South America, Antarctica, western and southern Africa",
    path: "Chile, Argentina, the Atlantic",
    saros: 131,
  },
  {
    body: "lunar",
    kind: "penumbral",
    greatest: ut("2027-02-20T23:14:06"),
    magnitude: -0.057,
    durations: [],
    regions: "The Americas, Europe, Africa, Asia",
    saros: 143,
  },
  {
    body: "lunar",
    kind: "penumbral",
    greatest: ut("2027-07-18T16:04:09"),
    magnitude: -1.068,
    durations: [],
    regions: "East Africa, Asia, Australia, the Pacific",
    saros: 110,
  },
  {
    body: "solar",
    kind: "total",
    greatest: ut("2027-08-02T10:07:49"),
    magnitude: 1.079,
    durations: ["6 min 23 s"],
    regions: "Africa, Europe, the Middle East, western and southern Asia",
    path: "Morocco, Spain, Algeria, Libya, Egypt, Saudi Arabia, Yemen, Somalia",
    saros: 136,
  },
  {
    body: "lunar",
    kind: "penumbral",
    greatest: ut("2027-08-17T07:14:59"),
    magnitude: -0.525,
    durations: [],
    regions: "The Pacific, the Americas",
    saros: 148,
  },
  {
    body: "lunar",
    kind: "partial",
    greatest: ut("2028-01-12T04:14:13"),
    magnitude: 0.066,
    durations: ["56 min"],
    regions: "The Americas, Europe, Africa",
    saros: 115,
  },
  {
    body: "solar",
    kind: "annular",
    greatest: ut("2028-01-26T15:08:58"),
    magnitude: 0.921,
    durations: ["10 min 27 s"],
    regions: "Eastern North America, Central and South America, western Europe, northwestern Africa",
    path: "Ecuador, Peru, Brazil, Suriname, Spain, Portugal",
    saros: 141,
  },
  {
    body: "lunar",
    kind: "partial",
    greatest: ut("2028-07-06T18:20:57"),
    magnitude: 0.389,
    durations: ["2 h 21 min"],
    regions: "Europe, Africa, Asia, Australia",
    saros: 120,
  },
  {
    body: "solar",
    kind: "total",
    greatest: ut("2028-07-22T02:56:39"),
    magnitude: 1.056,
    durations: ["5 min 10 s"],
    regions: "Southeast Asia, the East Indies, Australia, New Zealand",
    path: "Australia, New Zealand",
    saros: 146,
  },
  {
    body: "lunar",
    kind: "total",
    greatest: ut("2028-12-31T16:53:15"),
    magnitude: 1.246,
    durations: ["3 h 29 min", "1 h 11 min"],
    regions: "Europe, Africa, Asia, Australia, the Pacific",
    saros: 125,
  },
  {
    body: "solar",
    kind: "partial",
    greatest: ut("2029-01-14T17:13:47"),
    magnitude: 0.871,
    durations: [],
    regions: "North America, Central America",
    saros: 151,
  },
  {
    body: "solar",
    kind: "partial",
    greatest: ut("2029-06-12T04:06:13"),
    magnitude: 0.458,
    durations: [],
    regions: "The Arctic, Scandinavia, Alaska, northern Asia, northern Canada",
    saros: 118,
  },
  {
    body: "lunar",
    kind: "total",
    greatest: ut("2029-06-26T03:23:22"),
    magnitude: 1.844,
    durations: ["3 h 40 min", "1 h 42 min"],
    regions: "The Americas, Europe, Africa, the Middle East",
    saros: 130,
  },
  {
    body: "solar",
    kind: "partial",
    greatest: ut("2029-07-11T15:37:18"),
    magnitude: 0.23,
    durations: [],
    regions: "Southern Chile, southern Argentina",
    saros: 156,
  },
  {
    body: "solar",
    kind: "partial",
    greatest: ut("2029-12-05T15:03:57"),
    magnitude: 0.891,
    durations: [],
    regions: "Southern Argentina, southern Chile, Antarctica",
    saros: 123,
  },
  {
    body: "lunar",
    kind: "total",
    greatest: ut("2029-12-20T22:43:12"),
    magnitude: 1.117,
    durations: ["3 h 33 min", "54 min"],
    regions: "The Americas, Europe, Africa, Asia",
    saros: 135,
  },
  {
    body: "solar",
    kind: "annular",
    greatest: ut("2030-06-01T06:29:13"),
    magnitude: 0.944,
    durations: ["5 min 21 s"],
    regions: "Europe, northern Africa, the Middle East, Asia, the Arctic, Alaska",
    path: "Algeria, Tunisia, Greece, Turkey, Russia, northern China, Japan",
    saros: 128,
  },
  {
    body: "lunar",
    kind: "partial",
    greatest: ut("2030-06-15T18:34:34"),
    magnitude: 0.502,
    durations: ["2 h 24 min"],
    regions: "Europe, Africa, Asia, Australia",
    saros: 140,
  },
  {
    body: "solar",
    kind: "total",
    greatest: ut("2030-11-25T06:51:37"),
    magnitude: 1.047,
    durations: ["3 min 44 s"],
    regions: "Southern Africa, the southern Indian Ocean, the East Indies, Australia, Antarctica",
    path: "Botswana, South Africa, Australia",
    saros: 133,
  },
  {
    body: "lunar",
    kind: "penumbral",
    greatest: ut("2030-12-09T22:28:51"),
    magnitude: -0.163,
    durations: [],
    regions: "The Americas, Europe, Africa, Asia",
    saros: 145,
  },
];

export interface Shower {
  id: string;
  name: string;
  /** French name, for searching. */
  french: string;
  /** The Sun's longitude at the peak (J2000), degrees: the peak comes back at the same point of the Earth's orbit. */
  peakLongitude: number;
  /** Zenithal hourly rate: meteors an hour under a perfect sky with the radiant overhead. */
  zhr: number;
  /** Activity, "MM-DD" to "MM-DD". */
  start: string;
  end: string;
  /** Where the radiant is: the constellation the shower is named after. */
  constellation: string;
  /** The radiant at the peak, degrees. */
  ra: number;
  dec: number;
  /** Speed entering the atmosphere, km/s. */
  speed: number;
  parent: string;
  note?: string;
}

export const SHOWERS: Shower[] = [
  {
    id: "quadrantids",
    name: "Quadrantids",
    french: "Quadrantides",
    peakLongitude: 283.15,
    zhr: 80,
    start: "12-26",
    end: "01-16",
    constellation: "Boötes",
    ra: 230,
    dec: 49,
    speed: 41,
    parent: "asteroid 2003 EH1",
    note: "The peak is sharp, a few hours: miss it and rates drop fast.",
  },
  {
    id: "lyrids",
    name: "Lyrids",
    french: "Lyrides",
    peakLongitude: 32.32,
    zhr: 18,
    start: "04-14",
    end: "04-30",
    constellation: "Lyra",
    ra: 271,
    dec: 34,
    speed: 49,
    parent: "comet C/1861 G1 Thatcher",
  },
  {
    id: "eta-aquariids",
    name: "Eta Aquariids",
    french: "Êta Aquarides",
    peakLongitude: 45.5,
    zhr: 50,
    start: "04-19",
    end: "05-28",
    constellation: "Aquarius",
    ra: 338,
    dec: -1,
    speed: 66,
    parent: "comet 1P/Halley",
    note: "Best from the southern hemisphere, in the hour before dawn.",
  },
  {
    id: "southern-delta-aquariids",
    name: "Southern Delta Aquariids",
    french: "Delta Aquarides du Sud",
    peakLongitude: 127,
    zhr: 25,
    start: "07-12",
    end: "08-23",
    constellation: "Aquarius",
    ra: 340,
    dec: -16,
    speed: 41,
    parent: "comet 96P/Machholz",
  },
  {
    id: "perseids",
    name: "Perseids",
    french: "Perséides",
    peakLongitude: 140,
    zhr: 100,
    start: "07-17",
    end: "08-24",
    constellation: "Perseus",
    ra: 48,
    dec: 58,
    speed: 59,
    parent: "comet 109P/Swift–Tuttle",
  },
  {
    id: "draconids",
    name: "Draconids",
    french: "Draconides",
    peakLongitude: 195.4,
    zhr: 10,
    start: "10-06",
    end: "10-10",
    constellation: "Draco",
    ra: 262,
    dec: 54,
    speed: 20,
    parent: "comet 21P/Giacobini–Zinner",
    note: "Usually weak, with rare outbursts; best in the evening.",
  },
  {
    id: "southern-taurids",
    name: "Southern Taurids",
    french: "Taurides du Sud",
    peakLongitude: 197,
    zhr: 5,
    start: "09-10",
    end: "11-20",
    constellation: "Taurus",
    ra: 32,
    dec: 9,
    speed: 27,
    parent: "comet 2P/Encke",
    note: "Few meteors, but slow and often bright fireballs.",
  },
  {
    id: "orionids",
    name: "Orionids",
    french: "Orionides",
    peakLongitude: 208,
    zhr: 20,
    start: "10-02",
    end: "11-07",
    constellation: "Orion",
    ra: 95,
    dec: 16,
    speed: 66,
    parent: "comet 1P/Halley",
  },
  {
    id: "northern-taurids",
    name: "Northern Taurids",
    french: "Taurides du Nord",
    peakLongitude: 230,
    zhr: 5,
    start: "10-20",
    end: "12-10",
    constellation: "Taurus",
    ra: 58,
    dec: 22,
    speed: 29,
    parent: "comet 2P/Encke",
    note: "Few meteors, but slow and often bright fireballs.",
  },
  {
    id: "leonids",
    name: "Leonids",
    french: "Léonides",
    peakLongitude: 235.27,
    zhr: 15,
    start: "11-06",
    end: "11-30",
    constellation: "Leo",
    ra: 152,
    dec: 22,
    speed: 71,
    parent: "comet 55P/Tempel–Tuttle",
  },
  {
    id: "geminids",
    name: "Geminids",
    french: "Géminides",
    peakLongitude: 262.2,
    zhr: 150,
    start: "12-04",
    end: "12-20",
    constellation: "Gemini",
    ra: 112,
    dec: 33,
    speed: 35,
    parent: "asteroid 3200 Phaethon",
    note: "The richest shower of the year, and its radiant is up from mid-evening.",
  },
  {
    id: "ursids",
    name: "Ursids",
    french: "Ursides",
    peakLongitude: 270.7,
    zhr: 10,
    start: "12-17",
    end: "12-26",
    constellation: "Ursa Minor",
    ra: 217,
    dec: 76,
    speed: 33,
    parent: "comet 8P/Tuttle",
  },
];

export interface PlanetInfo {
  name: string;
  french: string;
  color: "gray" | "yellow" | "red" | "orange" | "teal" | "blue";
  /** Where to look, in a few words. */
  hint: string;
}

export const PLANETS = {
  mercury: { name: "Mercury", french: "Mercure", color: "gray", hint: "low in the twilight, never far from the Sun" },
  venus: { name: "Venus", french: "Vénus", color: "yellow", hint: "the brightest point in the sky after the Moon" },
  mars: { name: "Mars", french: "Mars", color: "red", hint: "a steady orange-red point" },
  jupiter: {
    name: "Jupiter",
    french: "Jupiter",
    color: "orange",
    hint: "very bright and steady; binoculars show its moons",
  },
  saturn: {
    name: "Saturn",
    french: "Saturne",
    color: "yellow",
    hint: "pale yellow; a small telescope shows the rings",
  },
  uranus: { name: "Uranus", french: "Uranus", color: "teal", hint: "at the limit of the naked eye: use binoculars" },
  neptune: {
    name: "Neptune",
    french: "Neptune",
    color: "blue",
    hint: "too faint for the eye: binoculars or a telescope",
  },
} as const satisfies Record<string, PlanetInfo>;
