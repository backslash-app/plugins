// Pure logic: VIN checks done locally (check digit, maker prefix, country,
// model year), reading NHTSA's vPIC decode and recall answers, and the query.

export const VPIC = "https://vpic.nhtsa.dot.gov/api";
export const RECALLS = "https://api.nhtsa.gov";

// ---------------------------------------------------------------------------
// VIN, locally

/** Letters a VIN may hold: no I, O or Q, which look like 1 and 0. */
const VIN_CHARS = /^[A-HJ-NPR-Z0-9]+$/;

/** Upper case, without the spaces, dashes and dots people paste with it. */
export function normalizeVin(text: string): string {
  return text.toUpperCase().replace(/[\s.\-_]/g, "");
}

/** Characters that never appear in a VIN, with their positions (1-based). */
export function invalidChars(vin: string): { position: number; char: string }[] {
  return [...vin].flatMap((char, i) => /[A-HJ-NPR-Z0-9]/.test(char) ? [] : [{ position: i + 1, char }]);
}

const TRANSLITERATION: Record<string, number> = {
  A: 1,
  B: 2,
  C: 3,
  D: 4,
  E: 5,
  F: 6,
  G: 7,
  H: 8,
  J: 1,
  K: 2,
  L: 3,
  M: 4,
  N: 5,
  P: 7,
  R: 9,
  S: 2,
  T: 3,
  U: 4,
  V: 5,
  W: 6,
  X: 7,
  Y: 8,
  Z: 9,
};
const WEIGHTS = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2];

/** The 9th character a VIN should have (North American rule, also used in China): a digit or X. */
export function checkDigit(vin: string): string {
  if (vin.length !== 17 || !VIN_CHARS.test(vin)) throw new Error("A VIN has 17 letters and digits");
  const sum = [...vin].reduce((total, c, i) => total + (/\d/.test(c) ? Number(c) : TRANSLITERATION[c]) * WEIGHTS[i], 0);
  const rest = sum % 11;
  return rest === 10 ? "X" : String(rest);
}

/** VINs from North America and China must carry a valid check digit; elsewhere it is optional. */
export function checkDigitRequired(vin: string): boolean {
  return /^[1-5]/.test(vin) || vin.startsWith("L");
}

export const REGIONS: [RegExp, string][] = [
  [/^[A-H]/, "Africa"],
  [/^[J-R]/, "Asia"],
  [/^[S-Z]/, "Europe"],
  [/^[1-5]/, "North America"],
  [/^[67]/, "Oceania"],
  [/^[89]/, "South America"],
];

export function region(vin: string): string | undefined {
  return REGIONS.find(([re]) => re.test(vin))?.[1];
}

/** Order of the second character in ISO 3780 country ranges. */
const ORDER = "ABCDEFGHJKLMNPRSTUVWXYZ1234567890";

/** [first char, second from, second to, country]: the common ranges of ISO 3780. */
const COUNTRIES: [string, string, string, string][] = [
  ["A", "A", "H", "South Africa"],
  ["J", "A", "0", "Japan"],
  ["K", "L", "R", "South Korea"],
  ["L", "A", "0", "China"],
  ["M", "A", "E", "India"],
  ["M", "F", "K", "Indonesia"],
  ["M", "L", "R", "Thailand"],
  ["N", "L", "R", "Turkey"],
  ["P", "L", "R", "Malaysia"],
  ["R", "F", "K", "Taiwan"],
  ["S", "A", "M", "United Kingdom"],
  ["S", "N", "T", "Germany"],
  ["S", "U", "Z", "Poland"],
  ["T", "A", "H", "Switzerland"],
  ["T", "J", "P", "Czech Republic"],
  ["T", "R", "V", "Hungary"],
  ["T", "W", "1", "Portugal"],
  ["U", "U", "7", "Romania"],
  ["V", "A", "E", "Austria"],
  ["V", "F", "R", "France"],
  ["V", "S", "W", "Spain"],
  ["W", "A", "0", "Germany"],
  ["X", "L", "R", "Netherlands"],
  ["X", "S", "W", "Russia"],
  ["Y", "A", "E", "Belgium"],
  ["Y", "F", "K", "Finland"],
  ["Y", "S", "W", "Sweden"],
  ["Z", "A", "R", "Italy"],
  ["1", "A", "0", "United States"],
  ["4", "A", "0", "United States"],
  ["5", "A", "0", "United States"],
  ["2", "A", "0", "Canada"],
  ["3", "A", "W", "Mexico"],
  ["6", "A", "W", "Australia"],
  ["7", "A", "E", "New Zealand"],
  ["8", "A", "E", "Argentina"],
  ["9", "A", "E", "Brazil"],
  ["9", "3", "9", "Brazil"],
];

/** The country a VIN's first two characters were assigned to, when it is a common one. */
export function country(vin: string): string | undefined {
  const [first, second] = [vin[0], vin[1]];
  const at = ORDER.indexOf(second);
  if (at < 0) return undefined;
  return COUNTRIES.find(([f, from, to]) => f === first && at >= ORDER.indexOf(from) && at <= ORDER.indexOf(to))?.[3];
}

/** World manufacturer identifiers (the first three characters) of common makes. */
export const WMI: Record<string, string> = {
  "1C3": "Chrysler",
  "1C4": "Chrysler",
  "1FA": "Ford",
  "1FM": "Ford",
  "1FT": "Ford",
  "1G1": "Chevrolet",
  "1G6": "Cadillac",
  "1GC": "Chevrolet",
  "1GT": "GMC",
  "1GY": "Cadillac",
  "1HG": "Honda",
  "1J4": "Jeep",
  "1N4": "Nissan",
  "1VW": "Volkswagen",
  "2HG": "Honda",
  "2HM": "Hyundai",
  "2T1": "Toyota",
  "3FA": "Ford",
  "3N1": "Nissan",
  "3VW": "Volkswagen",
  "4JG": "Mercedes-Benz",
  "4S3": "Subaru",
  "4T1": "Toyota",
  "5FN": "Honda",
  "5J6": "Honda",
  "5NP": "Hyundai",
  "5UX": "BMW",
  "5YJ": "Tesla",
  "JA3": "Mitsubishi",
  "JF1": "Subaru",
  "JHM": "Honda",
  "JM1": "Mazda",
  "JN1": "Nissan",
  "JTH": "Lexus",
  "KMH": "Hyundai",
  "KNA": "Kia",
  "KND": "Kia",
  "SAJ": "Jaguar",
  "SAL": "Land Rover",
  "SCC": "Lotus",
  "SCF": "Aston Martin",
  "SHH": "Honda",
  "TMB": "Škoda",
  "TRU": "Audi",
  "UU1": "Dacia",
  "VF1": "Renault",
  "VF3": "Peugeot",
  "VF7": "Citroën",
  "VNK": "Toyota",
  "VR3": "Peugeot",
  "VSS": "SEAT",
  "W0L": "Opel",
  "WAU": "Audi",
  "WBA": "BMW",
  "WBS": "BMW M",
  "WDB": "Mercedes-Benz",
  "WDD": "Mercedes-Benz",
  "WF0": "Ford",
  "WMW": "MINI",
  "WP0": "Porsche",
  "WP1": "Porsche",
  "WV2": "Volkswagen Commercial Vehicles",
  "WVW": "Volkswagen",
  "YS3": "Saab",
  "YV1": "Volvo",
  "ZAM": "Maserati",
  "ZAR": "Alfa Romeo",
  "ZFA": "Fiat",
  "ZFF": "Ferrari",
  "ZHW": "Lamborghini",
};

/** Two-character prefixes a make uses for all its identifiers. */
const WMI_PREFIX: Record<string, string> = { JT: "Toyota", KM: "Hyundai", KN: "Kia", WD: "Mercedes-Benz", WB: "BMW" };

export function manufacturer(vin: string): string | undefined {
  return WMI[vin.slice(0, 3)] ?? WMI_PREFIX[vin.slice(0, 2)];
}

/** A 9 in the third place marks a maker building fewer than 1,000 vehicles a year: positions 12–14 complete its identifier. */
export function smallManufacturer(vin: string): boolean {
  return vin[2] === "9";
}

const YEAR_CODES = "ABCDEFGHJKLMNPRSTVWXY123456789";

/**
 * The model years the 10th character can mean, newest first: the code repeats
 * every 30 years. North American cars and light trucks tell the cycles apart
 * by the 7th character: a digit for 1980–2009, a letter from 2010 on.
 */
export function modelYears(vin: string, now = new Date()): number[] {
  const i = YEAR_CODES.indexOf(vin[9]);
  if (i < 0) return [];
  const latest = now.getFullYear() + 1;
  if (/^[1-5]/.test(vin) && vin.length >= 7) {
    const year = 1980 + i + (/\d/.test(vin[6]) ? 0 : 30);
    return year <= latest ? [year] : [year - 30];
  }
  const years: number[] = [];
  for (let y = 1980 + i; y <= latest; y += 30) years.push(y);
  return years.reverse();
}

export interface LocalVin {
  vin: string;
  valid: boolean;
  /** Why it isn't a usable VIN, when it isn't. */
  problem?: string;
  checkDigit?: { expected: string; found: string; required: boolean; ok: boolean };
  region?: string;
  country?: string;
  manufacturer?: string;
  small: boolean;
  years: number[];
  wmi: string;
  /** Positions 4–8: the vehicle descriptor (model, body, engine). */
  vds: string;
  /** Positions 10–17: year, plant and serial number. */
  vis: string;
  serial: string;
}

/** Everything that can be told from a VIN without asking anyone. */
export function inspectVin(input: string, now = new Date()): LocalVin {
  const vin = normalizeVin(input);
  const base: LocalVin = {
    vin,
    valid: false,
    small: smallManufacturer(vin),
    years: [],
    wmi: vin.slice(0, 3),
    vds: vin.slice(3, 8),
    vis: vin.slice(9),
    serial: vin.slice(11),
  };
  const bad = invalidChars(vin);
  if (bad.length) {
    const list = bad.map((b) => `${b.char} at ${b.position}`).join(", ");
    const hint = bad.some((b) => "IOQ".includes(b.char)) ? ": VINs never use I, O or Q (read them as 1 and 0)" : "";
    return { ...base, problem: `Invalid character${bad.length > 1 ? "s" : ""} ${list}${hint}` };
  }
  if (vin.length !== 17) return { ...base, problem: `${vin.length} of the 17 characters of a VIN` };
  const expected = checkDigit(vin);
  const required = checkDigitRequired(vin);
  return {
    ...base,
    valid: true,
    checkDigit: { expected, found: vin[8], required, ok: expected === vin[8] },
    region: region(vin),
    country: country(vin),
    manufacturer: manufacturer(vin),
    years: modelYears(vin, now),
  };
}

// ---------------------------------------------------------------------------
// vPIC

export const decodeUrl = (vin: string) => `${VPIC}/vehicles/DecodeVinValues/${encodeURIComponent(vin)}?format=json`;

export interface VpicResponse {
  Count: number;
  Message: string;
  Results: Record<string, string | null>[];
}

export interface Decoded {
  vin: string;
  make?: string;
  model?: string;
  year?: number;
  trim?: string;
  series?: string;
  body?: string;
  doors?: string;
  type?: string;
  engine?: string;
  fuel?: string;
  electrification?: string;
  drive?: string;
  transmission?: string;
  plant?: string;
  manufacturer?: string;
  weightClass?: string;
  seats?: string;
  steering?: string;
  /** Safety equipment the maker reports as standard. */
  standard: string[];
  optional: string[];
  /** vPIC's numbered remarks, without "0 - VIN decoded clean". */
  errors: { code: string; text: string }[];
  /** "clean", "partial" (something is off but a make was found) or "failed". */
  quality: "clean" | "partial" | "failed";
  suggestedVin?: string;
  extra?: string;
}

/** vPIC answers "" or "Not Applicable" for what it doesn't know. */
function value(r: Record<string, string | null>, key: string): string | undefined {
  const v = (r[key] ?? "").trim();
  return v && v !== "Not Applicable" && v !== "0" ? v : undefined;
}

/** "HONDA" → "Honda", "MERCEDES-BENZ" → "Mercedes-Benz"; short ones (BMW, GMC, KIA) stay as given unless known. */
export function titleCase(name: string): string {
  const keep = new Set(["BMW", "GMC", "RAM", "MINI", "SEAT", "MG", "BYD", "DS"]);
  return name.split(/(\s+|-)/).map((w) => {
    if (keep.has(w.toUpperCase())) return w.toUpperCase();
    if (/^[A-Z][A-Z]+$/.test(w)) return w[0] + w.slice(1).toLowerCase();
    return w;
  }).join("");
}

const FEATURES: [string, string][] = [
  ["ABS", "Anti-lock brakes"],
  ["ESC", "Electronic stability control"],
  ["TractionControl", "Traction control"],
  ["CIB", "Automatic emergency braking"],
  ["PedestrianAutomaticEmergencyBraking", "Pedestrian emergency braking"],
  ["ForwardCollisionWarning", "Forward collision warning"],
  ["BlindSpotMon", "Blind spot warning"],
  ["LaneDepartureWarning", "Lane departure warning"],
  ["LaneKeepSystem", "Lane keeping assist"],
  ["AdaptiveCruiseControl", "Adaptive cruise control"],
  ["RearVisibilitySystem", "Backup camera"],
  ["ParkAssist", "Parking assist"],
  ["DaytimeRunningLight", "Daytime running lights"],
  ["AdaptiveDrivingBeam", "Adaptive driving beam"],
  ["KeylessIgnition", "Keyless ignition"],
];

function engineText(r: Record<string, string | null>): string | undefined {
  const litres = value(r, "DisplacementL");
  const cylinders = value(r, "EngineCylinders");
  const config = value(r, "EngineConfiguration");
  const hp = value(r, "EngineHP");
  const layout = cylinders
    ? config === "V-Shaped"
      ? `V${cylinders}`
      : config === "In-Line"
      ? `inline ${cylinders}`
      : config === "Horizontally opposed (boxer)"
      ? `flat ${cylinders}`
      : `${cylinders} cylinders`
    : undefined;
  const parts = [
    litres ? `${Number(litres).toFixed(1)} L` : undefined,
    layout,
    hp ? `${Math.round(Number(hp))} hp` : undefined,
  ].filter(Boolean);
  const other = value(r, "OtherEngineInfo");
  if (!parts.length) return other;
  return parts.join(" ") + (other ? ` (${other})` : "");
}

/** The useful part of a vPIC `DecodeVinValues` answer. */
export function toDecoded(res: VpicResponse): Decoded {
  const r = res.Results?.[0] ?? {};
  const codes = (value(r, "ErrorCode") ?? "0").split(",").map((c) => c.trim()).filter(Boolean);
  const texts = (r.ErrorText ?? "").split(";").map((t) => t.trim()).filter(Boolean);
  const errors = texts.flatMap((t) => {
    const m = /^(\d+)\s*-\s*(.*)$/.exec(t);
    if (!m || m[1] === "0") return [];
    return [{ code: m[1], text: m[2].replace(/\.$/, "") }];
  });
  const make = value(r, "Make");
  const quality = !make ? "failed" : codes.every((c) => c === "0") ? "clean" : "partial";
  const year = value(r, "ModelYear");
  const speeds = value(r, "TransmissionSpeeds");
  const style = value(r, "TransmissionStyle");
  const plant = [value(r, "PlantCity"), value(r, "PlantState"), value(r, "PlantCountry")]
    .filter(Boolean).map((p) => titleCase(p!).replace(/\(Usa\)/, "(USA)")).join(", ");
  const doors = value(r, "Doors");
  return {
    vin: value(r, "VIN") ?? "",
    make: make ? titleCase(make) : undefined,
    model: value(r, "Model"),
    year: year ? Number(year) : undefined,
    trim: value(r, "Trim"),
    series: value(r, "Series"),
    body: value(r, "BodyClass"),
    doors: doors ? `${doors} doors` : undefined,
    type: value(r, "VehicleType") ? titleCase(value(r, "VehicleType")!) : undefined,
    engine: engineText(r),
    fuel: [value(r, "FuelTypePrimary"), value(r, "FuelTypeSecondary")].filter(Boolean).join(" / ") || undefined,
    electrification: value(r, "ElectrificationLevel"),
    drive: value(r, "DriveType"),
    transmission: style ? (speeds ? `${style}, ${speeds} speed${speeds === "1" ? "" : "s"}` : style) : undefined,
    plant: plant || undefined,
    manufacturer: value(r, "Manufacturer"),
    weightClass: value(r, "GVWR"),
    seats: value(r, "Seats"),
    steering: value(r, "SteeringLocation"),
    standard: FEATURES.filter(([k]) => value(r, k) === "Standard").map(([, name]) => name),
    optional: FEATURES.filter(([k]) => value(r, k) === "Optional").map(([, name]) => name),
    errors,
    quality,
    suggestedVin: value(r, "SuggestedVIN"),
    extra: value(r, "AdditionalErrorText"),
  };
}

/** "2003 Honda Accord EX-V6". */
export function vehicleName(d: Pick<Decoded, "year" | "make" | "model" | "trim">): string {
  return [d.year, d.make, d.model, d.trim].filter(Boolean).join(" ") || "Unknown vehicle";
}

// ---------------------------------------------------------------------------
// Recalls

export const recallsUrl = (make: string, model: string, year: number) =>
  `${RECALLS}/recalls/recallsByVehicle?${new URLSearchParams({ make, model, modelYear: String(year) })}`;

/** NHTSA's public page of a recall campaign. */
export const recallPage = (campaign: string) => `https://www.nhtsa.gov/recalls?nhtsaId=${encodeURIComponent(campaign)}`;

export interface RecallsResponse {
  Count: number;
  Message: string;
  results: {
    Manufacturer?: string;
    NHTSACampaignNumber: string;
    parkIt?: boolean;
    parkOutSide?: boolean;
    overTheAirUpdate?: boolean;
    ReportReceivedDate?: string;
    Component?: string;
    Summary?: string;
    Consequence?: string;
    Remedy?: string;
    Notes?: string;
    ModelYear?: string;
    Make?: string;
    Model?: string;
  }[];
}

export interface Recall {
  campaign: string;
  /** ISO date the report was received. */
  date?: string;
  component: string;
  summary: string;
  consequence?: string;
  remedy?: string;
  notes?: string;
  manufacturer?: string;
  parkIt: boolean;
  parkOutside: boolean;
  overTheAir: boolean;
}

/** The recalls API writes dates day first: "16/01/2013" → "2013-01-16". */
export function reportDate(text: string | undefined): string | undefined {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text?.trim() ?? "");
  if (!m || Number(m[2]) < 1 || Number(m[2]) > 12 || Number(m[1]) < 1 || Number(m[1]) > 31) return undefined;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

/**
 * "AIR BAGS:FRONTAL:DRIVER SIDE" → "Air bags › Frontal › Driver side". What is
 * in parentheses is mostly abbreviations ("(TCM/PCM/TECM)"), so it stays as written.
 */
export function componentName(text: string | undefined): string {
  if (!text) return "Unspecified component";
  return text.split(":").map((p) => p.trim()).filter(Boolean).map((p) => {
    const s = p.split(/(\([^)]*\))/).map((part) => part.startsWith("(") ? part : part.toLowerCase()).join("");
    return s[0].toUpperCase() + s.slice(1);
  }).join(" › ");
}

/** Recalls newest first; the same campaign listed twice is kept once. */
export function toRecalls(res: RecallsResponse): Recall[] {
  const seen = new Set<string>();
  return (res.results ?? []).filter((r) => {
    if (seen.has(r.NHTSACampaignNumber)) return false;
    seen.add(r.NHTSACampaignNumber);
    return true;
  }).map((r) => ({
    campaign: r.NHTSACampaignNumber,
    date: reportDate(r.ReportReceivedDate),
    component: componentName(r.Component),
    summary: r.Summary?.trim() ?? "",
    consequence: r.Consequence?.trim() || undefined,
    remedy: r.Remedy?.trim() || undefined,
    notes: r.Notes?.trim() || undefined,
    manufacturer: r.Manufacturer,
    parkIt: r.parkIt === true,
    parkOutside: r.parkOutSide === true,
    overTheAir: r.overTheAirUpdate === true,
  })).sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
}

// ---------------------------------------------------------------------------
// What the user typed

/** Makes written in two words, so "land rover defender 2020" splits right. */
const TWO_WORD_MAKES = ["land rover", "alfa romeo", "aston martin", "mercedes benz", "rolls royce", "harley davidson"];

export type Query =
  | { kind: "empty" }
  | { kind: "vin"; vin: string }
  | { kind: "partial"; vin: LocalVin }
  | { kind: "recalls"; make: string; model: string; year: number }
  | { kind: "help"; text: string };

export function parseQuery(text: string, now = new Date()): Query {
  const q = text.trim();
  if (!q) return { kind: "empty" };
  const compact = normalizeVin(q);
  const asVin = (): Query => {
    const local = inspectVin(compact, now);
    return local.valid ? { kind: "vin", vin: compact } : { kind: "partial", vin: local };
  };
  const looksLikeVin = /^[A-Z0-9]{17}$/.test(compact) && /\d/.test(compact);
  // Without spaces, 17 characters are a VIN; with spaces, "make model year" wins.
  if (looksLikeVin && !/\s/.test(q)) return asVin();
  const yearMatch = /^(?:(\d{4})\s+(.+)|(.+?)\s+(\d{4}))$/.exec(q);
  if (yearMatch) {
    const year = Number(yearMatch[1] ?? yearMatch[4]);
    const rest = (yearMatch[2] ?? yearMatch[3]).trim();
    if (year >= 1950 && year <= now.getFullYear() + 2) {
      let make: string, model: string;
      if (rest.includes(",")) {
        [make, model] = rest.split(",", 2).map((s) => s.trim());
      } else {
        const lower = rest.toLowerCase();
        const two = TWO_WORD_MAKES.find((m) => lower.startsWith(m + " "));
        const cut = two ? two.length : rest.indexOf(" ");
        make = cut > 0 ? rest.slice(0, cut) : rest;
        model = cut > 0 ? rest.slice(cut).trim() : "";
      }
      make = make.replace(/^mercedes benz$/i, "Mercedes-Benz").replace(/^rolls royce$/i, "Rolls-Royce")
        .replace(/^harley davidson$/i, "Harley-Davidson");
      if (make && model) return { kind: "recalls", make, model, year };
    }
  }
  if (looksLikeVin) return asVin();
  if (/^[A-Z0-9]{8,16}$/.test(compact) && /\d/.test(compact) && !/\s/.test(q)) {
    return { kind: "partial", vin: inspectVin(compact, now) };
  }
  return { kind: "help", text: q };
}

// ---------------------------------------------------------------------------
// Text

/** A short plain-text summary to copy. */
export function summaryText(d: Decoded, recalls?: Recall[]): string {
  const lines = [
    `${vehicleName(d)} — VIN ${d.vin}`,
    d.body && `Body: ${d.body}${d.doors ? `, ${d.doors}` : ""}`,
    d.engine && `Engine: ${d.engine}`,
    d.fuel && `Fuel: ${d.fuel}`,
    d.drive && `Drive: ${d.drive}`,
    d.transmission && `Transmission: ${d.transmission}`,
    d.plant && `Built in ${d.plant}`,
    recalls && `Recalls: ${recalls.length}`,
  ];
  return lines.filter(Boolean).join("\n");
}

export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
