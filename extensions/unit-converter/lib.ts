// Conversions typed in the search bar: `5 km in miles`, `72f to c`,
// `2 GiB en MB`, `90 km/h in mph`.

export type Dimension = "length" | "mass" | "temperature" | "data" | "time" | "volume" | "speed" | "area";

export interface Unit {
  symbol: string;
  /** The symbol and every other way to write it. */
  names: string[];
  dimension: Dimension;
  /** Value in the dimension's base unit for 1 of this unit (unused for temperatures). */
  factor: number;
}

const unit = (symbol: string, dimension: Dimension, factor: number, names: string[]): Unit => ({
  symbol,
  names: [symbol, ...names],
  dimension,
  factor,
});

export const UNITS: Unit[] = [
  // Length (base: metre)
  unit("mm", "length", 0.001, ["millimeter", "millimeters", "millimetre", "millimètre", "millimètres"]),
  unit("cm", "length", 0.01, ["centimeter", "centimeters", "centimètre", "centimètres"]),
  unit("m", "length", 1, ["meter", "meters", "metre", "mètre", "mètres"]),
  unit("km", "length", 1000, ["kilometer", "kilometers", "kilomètre", "kilomètres"]),
  unit("in", "length", 0.0254, ["inch", "inches", "pouce", "pouces", '"']),
  unit("ft", "length", 0.3048, ["foot", "feet", "pied", "pieds", "'"]),
  unit("yd", "length", 0.9144, ["yard", "yards"]),
  unit("mi", "length", 1609.344, ["mile", "miles"]),
  unit("nmi", "length", 1852, ["nautical mile", "nautical miles", "mille marin"]),
  // Mass (base: kilogram)
  unit("mg", "mass", 1e-6, ["milligram", "milligrams", "milligramme", "milligrammes"]),
  unit("g", "mass", 0.001, ["gram", "grams", "gramme", "grammes"]),
  unit("kg", "mass", 1, ["kilogram", "kilograms", "kilogramme", "kilogrammes", "kilo", "kilos"]),
  unit("t", "mass", 1000, ["tonne", "tonnes", "ton", "tons"]),
  unit("oz", "mass", 0.028349523125, ["ounce", "ounces", "once", "onces"]),
  unit("lb", "mass", 0.45359237, ["lbs", "pound", "pounds", "livre", "livres"]),
  unit("st", "mass", 6.35029318, ["stone", "stones"]),
  // Temperature (converted through kelvins)
  unit("°C", "temperature", 1, ["c", "°c", "celsius", "degc"]),
  unit("°F", "temperature", 1, ["f", "°f", "fahrenheit", "degf"]),
  unit("K", "temperature", 1, ["k", "kelvin", "kelvins"]),
  // Data (base: byte)
  unit("bit", "data", 0.125, ["bits"]),
  unit("B", "data", 1, ["b", "byte", "bytes", "octet", "octets", "o"]),
  unit("kB", "data", 1e3, ["kb", "ko", "kilobyte", "kilobytes", "kilooctet", "kilooctets"]),
  unit("MB", "data", 1e6, ["mb", "mo", "megabyte", "megabytes", "mégaoctet", "mégaoctets"]),
  unit("GB", "data", 1e9, ["gb", "go", "gigabyte", "gigabytes", "gigaoctet", "gigaoctets"]),
  unit("TB", "data", 1e12, ["tb", "to", "terabyte", "terabytes", "téraoctet", "téraoctets"]),
  unit("KiB", "data", 1024, ["kib", "kio", "kibibyte", "kibibytes"]),
  unit("MiB", "data", 1048576, ["mib", "mio", "mebibyte", "mebibytes"]),
  unit("GiB", "data", 1073741824, ["gib", "gio", "gibibyte", "gibibytes"]),
  unit("TiB", "data", 1099511627776, ["tib", "tio", "tebibyte", "tebibytes"]),
  // Time (base: second)
  unit("ms", "time", 0.001, ["millisecond", "milliseconds", "milliseconde", "millisecondes"]),
  unit("s", "time", 1, ["sec", "secs", "second", "seconds", "seconde", "secondes"]),
  unit("min", "time", 60, ["mins", "minute", "minutes"]),
  unit("h", "time", 3600, ["hr", "hrs", "hour", "hours", "heure", "heures"]),
  unit("d", "time", 86400, ["day", "days", "jour", "jours", "j"]),
  unit("wk", "time", 604800, ["week", "weeks", "semaine", "semaines"]),
  unit("yr", "time", 31557600, ["year", "years", "an", "ans", "année", "années"]),
  // Volume (base: litre)
  unit("ml", "volume", 0.001, ["millilitre", "millilitres", "milliliter", "milliliters"]),
  unit("cl", "volume", 0.01, ["centilitre", "centilitres"]),
  unit("l", "volume", 1, ["litre", "litres", "liter", "liters"]),
  unit("gal", "volume", 3.785411784, ["gallon", "gallons"]),
  unit("qt", "volume", 0.946352946, ["quart", "quarts"]),
  unit("cup", "volume", 0.2365882365, ["cups", "tasse", "tasses"]),
  unit("fl oz", "volume", 0.0295735295625, ["floz", "fluid ounce", "fluid ounces"]),
  // Speed (base: metre per second)
  unit("m/s", "speed", 1, ["mps"]),
  unit("km/h", "speed", 1 / 3.6, ["kmh", "kph"]),
  unit("mph", "speed", 0.44704, ["mi/h"]),
  unit("kn", "speed", 1852 / 3600, ["knot", "knots", "noeud", "noeuds", "nœud", "nœuds"]),
  // Area (base: square metre)
  unit("m²", "area", 1, ["m2", "sqm"]),
  unit("km²", "area", 1e6, ["km2"]),
  unit("ha", "area", 1e4, ["hectare", "hectares"]),
  unit("acre", "area", 4046.8564224, ["acres"]),
  unit("ft²", "area", 0.09290304, ["ft2", "sqft"]),
];

/** Words between the amount and the target unit. Tried in this order. */
export const SEPARATORS = [" to ", " in ", " en ", " as ", " vers ", "->", "=>", " → ", "→", " = "];

/** Only ASCII letters change case: "MB" is "mb", "MÈTRE" is not "mètre". */
const asciiLower = (s: string) => s.replace(/[A-Z]/g, (c) => c.toLowerCase());

export function findUnit(name: string): Unit | undefined {
  const n = name.trim();
  // Case matters for data units (mb vs Mb are rare enough to fold); try exact first.
  return UNITS.find((u) => u.names.includes(n)) ??
    UNITS.find((u) => u.names.some((x) => asciiLower(x) === asciiLower(n)));
}

/** Splits `"5.5km"` / `"5,5 km"` / `"-40 °F"` into the number and the rest. */
export function splitNumber(text: string): [number, string] | undefined {
  const s = text.trim();
  let end = 0;
  while (end < s.length && (/[0-9.,]/.test(s[end]) || (end === 0 && s[end] === "-"))) end++;
  const number = s.slice(0, end).trim().replaceAll(",", ".");
  if (!/^-?(\d+\.?\d*|\.\d+)$/.test(number)) return undefined;
  return [Number(number), s.slice(end).trim()];
}

/** Splits `"<amount><from> <separator> <to>"`; `undefined` when it isn't one. */
export function splitConversion(query: string): { value: number; from: string; to: string } | undefined {
  const q = query.trim();
  if (new TextEncoder().encode(q).length > 80) return undefined;
  const lower = q.toLowerCase();
  const sep = SEPARATORS.find((s) => lower.includes(s));
  if (!sep) return undefined;
  const i = lower.indexOf(sep);
  const split = splitNumber(q.slice(0, i));
  if (!split) return undefined;
  const [value, from] = split;
  const to = q.slice(i + sep.length).trim();
  if (!from || !to) return undefined;
  return { value, from, to };
}

export interface Request {
  value: number;
  from: Unit;
  to: Unit;
}

/** Recognizes a unit conversion; `undefined` for anything else. */
export function parse(query: string): Request | undefined {
  const c = splitConversion(query);
  if (!c) return undefined;
  const from = findUnit(c.from);
  const to = findUnit(c.to);
  if (!from || !to || from.dimension !== to.dimension) return undefined;
  return { value: c.value, from, to };
}

export function convert(value: number, from: Unit, to: Unit): number {
  if (from.dimension === "temperature") {
    const kelvin = from.symbol === "°C" ? value + 273.15 : from.symbol === "°F" ? (value - 32) * 5 / 9 + 273.15 : value;
    if (to.symbol === "°C") return kelvin - 273.15;
    if (to.symbol === "°F") return (kelvin - 273.15) * 9 / 5 + 32;
    return kelvin;
  }
  return value * from.factor / to.factor;
}

/** At most 6 significant digits, no float noise, thousands grouped with a
 * narrow no-break space: `1 609 344`. */
export function format(value: number): string {
  if (value === 0) return "0";
  const magnitude = Math.floor(Math.log10(Math.abs(value)));
  const decimals = Math.min(Math.max(5 - magnitude, 0), 10);
  let s = Math.abs(value) >= 1e21 ? BigInt(Math.round(value)).toString() : value.toFixed(decimals);
  if (s.includes(".")) s = s.replace(/0+$/, "").replace(/\.$/, "");
  const [int, frac] = s.split(".");
  const sign = int.startsWith("-") ? "-" : "";
  const digits = sign ? int.slice(1) : int;
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return `${sign}${grouped}${frac === undefined ? "" : `.${frac}`}`;
}
