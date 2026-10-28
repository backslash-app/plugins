// Parsing what the user typed into a random draw, and drawing it. Pure: the
// source of randomness is passed in (crypto by default), tested in lib_test.ts.

/** Returns a uniformly random unsigned 32-bit integer. */
export type Source = () => number;

const buffer = new Uint32Array(64);
let left = 0;

/** crypto.getRandomValues, 64 values at a time. */
export const cryptoSource: Source = () => {
  if (left === 0) {
    crypto.getRandomValues(buffer);
    left = buffer.length;
  }
  return buffer[--left];
};

const TWO_32 = 2 ** 32;
const TWO_53 = 2 ** 53;

/**
 * A uniform integer in [min, max], both included, without modulo bias
 * (rejection sampling on 32 or 53 random bits).
 */
export function randomInt(min: number, max: number, rnd: Source = cryptoSource): number {
  if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max)) throw new RangeError("Bounds must be safe integers");
  if (max < min) [min, max] = [max, min];
  const span = max - min + 1;
  if (span > TWO_53) throw new RangeError("Range too large");
  if (span === 1) return min;
  if (span <= TWO_32) {
    const limit = TWO_32 - (TWO_32 % span);
    for (;;) {
      const x = rnd();
      if (x < limit) return min + (x % span);
    }
  }
  const limit = TWO_53 - (TWO_53 % span);
  for (;;) {
    const x = (rnd() & 0x1fffff) * TWO_32 + rnd();
    if (x < limit) return min + (x % span);
  }
}

/** A uniform float in [0, 1) with 53 bits of precision. */
export const randomFloat = (rnd: Source = cryptoSource) => ((rnd() & 0x1fffff) * TWO_32 + rnd()) / TWO_53;

/** Fisher–Yates, on a copy. */
export function shuffle<T>(items: readonly T[], rnd: Source = cryptoSource): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = randomInt(0, i, rnd);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export const pick = <T>(items: readonly T[], rnd: Source = cryptoSource): T =>
  items[randomInt(0, items.length - 1, rnd)];

// ---------------------------------------------------------------------------
// Language

export type Lang = "en" | "fr";

/** The preference ("auto", "en", "fr"), falling back on the locale variables. */
export function language(pref: string | undefined, locale: string | undefined): Lang {
  const p = (pref ?? "").trim().toLowerCase();
  if (p === "en" || p === "fr") return p;
  return (locale ?? "").toLowerCase().startsWith("fr") ? "fr" : "en";
}

// ---------------------------------------------------------------------------
// Dice

export interface Dice {
  count: number;
  sides: number;
  modifier: number;
  /** Keep the highest (positive) or lowest (negative) N dice, as in "4d6kh3". */
  keep?: number;
}

export const MAX_DICE = 100;
export const MAX_SIDES = 1000;

/** "2d6+3", "d20", "3D8-1", "4d6kh3", "2de6" (French). Undefined when it isn't dice notation. */
export function parseDice(text: string): Dice | undefined {
  const m = text.trim().toLowerCase().replace(/\s+/g, "").match(
    /^(\d{0,3})(?:d|de|dé)(\d{1,4})(?:(k|kh|kl)(\d{1,3}))?(?:([+-])(\d{1,5}))?$/,
  );
  if (!m) return undefined;
  const count = m[1] ? Number(m[1]) : 1;
  const sides = Number(m[2]);
  if (count < 1 || count > MAX_DICE || sides < 2 || sides > MAX_SIDES) return undefined;
  const modifier = m[5] ? (m[5] === "-" ? -1 : 1) * Number(m[6]) : 0;
  let keep: number | undefined;
  if (m[3]) {
    const n = Number(m[4]);
    if (n < 1 || n > count) return undefined;
    keep = m[3] === "kl" ? -n : n;
  }
  return { count, sides, modifier, ...(keep !== undefined && keep !== count ? { keep } : {}) };
}

export const diceNotation = (d: Dice) =>
  `${d.count}d${d.sides}${d.keep ? `${d.keep > 0 ? "kh" : "kl"}${Math.abs(d.keep)}` : ""}${
    d.modifier > 0 ? `+${d.modifier}` : d.modifier < 0 ? `${d.modifier}` : ""
  }`;

export interface Roll {
  dice: Dice;
  rolls: number[];
  /** Indexes of the dice that count (all of them unless `keep`). */
  kept: number[];
  total: number;
  min: number;
  max: number;
}

export function roll(dice: Dice, rnd: Source = cryptoSource): Roll {
  const rolls = Array.from({ length: dice.count }, () => randomInt(1, dice.sides, rnd));
  let kept = rolls.map((_, i) => i);
  if (dice.keep) {
    const order = [...kept].sort((a, b) => dice.keep! > 0 ? rolls[b] - rolls[a] : rolls[a] - rolls[b]);
    kept = order.slice(0, Math.abs(dice.keep)).sort((a, b) => a - b);
  }
  const n = kept.length;
  return {
    dice,
    rolls,
    kept,
    total: kept.reduce((s, i) => s + rolls[i], 0) + dice.modifier,
    min: n + dice.modifier,
    max: n * dice.sides + dice.modifier,
  };
}

/** "[3, 5] + 3", with the dropped dice in parentheses: "[(1), 4, 6, 5]". */
export function rollBreakdown(r: Roll): string {
  const kept = new Set(r.kept);
  const dice = r.rolls.map((v, i) => kept.has(i) ? String(v) : `(${v})`).join(", ");
  const mod = r.dice.modifier > 0 ? ` + ${r.dice.modifier}` : r.dice.modifier < 0 ? ` − ${-r.dice.modifier}` : "";
  return `[${dice}]${mod}`;
}

// ---------------------------------------------------------------------------
// Ranges

export interface Range {
  min: number;
  max: number;
  /** Digits after the decimal point; 0 for integers. */
  decimals: number;
}

const NUM = String.raw`[-−]?\d+(?:[.,]\d+)?`;
const num = (s: string) => Number(s.replace("−", "-").replace(",", "."));
const decimalsOf = (s: string) => s.match(/[.,](\d+)$/)?.[1].length ?? 0;

/**
 * "1-100", "1..6", "-10 10", "1 to 50", "de 1 à 10", "between 5 and 8",
 * "0.5-2.5", or one number "100" (= 1 to 100). Undefined otherwise.
 */
export function parseRange(text: string): Range | undefined {
  const t = text.trim().toLowerCase()
    .replace(/^(?:random|rand|number|nombre|nb|num|entre|between|from|de|du)\s+/, "")
    .replace(/^(?:random|rand|number|nombre|nb|num|entre|between|from|de|du)\s+/, "");
  const single = t.match(new RegExp(`^(${NUM})$`));
  if (single) {
    const max = num(single[1]);
    if (!Number.isFinite(max) || max < 1 || decimalsOf(single[1])) return undefined;
    return safe({ min: 1, max, decimals: 0 });
  }
  const m = t.match(
    new RegExp(`^(${NUM})\\s*(?:-|–|—|\\.\\.\\.?|:|\\s+(?:to|and|et|à|a|au)\\s+|\\s+)\\s*(${NUM})$`),
  );
  if (!m) return undefined;
  let min = num(m[1]);
  let max = num(m[2]);
  if (!Number.isFinite(min) || !Number.isFinite(max)) return undefined;
  if (max < min) [min, max] = [max, min];
  return safe({ min, max, decimals: Math.min(6, Math.max(decimalsOf(m[1]), decimalsOf(m[2]))) });
}

const safe = (r: Range): Range | undefined =>
  Number.isSafeInteger(Math.round(r.min * 10 ** r.decimals)) &&
    Number.isSafeInteger(Math.round(r.max * 10 ** r.decimals))
    ? r
    : undefined;

/** A number in the range, both bounds included, in steps of 10^-decimals. */
export function drawInRange(r: Range, rnd: Source = cryptoSource): number {
  const f = 10 ** r.decimals;
  const n = randomInt(Math.round(r.min * f), Math.round(r.max * f), rnd);
  return r.decimals ? Number((n / f).toFixed(r.decimals)) : n;
}

export const formatNumber = (n: number, decimals = 0) =>
  n.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).replace(/,/g, " ");

// ---------------------------------------------------------------------------
// Lists

/** "a, b, c", "a; b", "a or b", "tea ou café", one per line. */
export function parseList(text: string): string[] {
  const t = text.trim();
  const parts = /[\n,;|]/.test(t) ? t.split(/[\n,;|]/) : t.split(/\s+(?:or|ou)\s+/i);
  return parts.map((p) => p.trim()).filter(Boolean);
}

// ---------------------------------------------------------------------------
// Colors

export interface RGB {
  r: number;
  g: number;
  b: number;
}

export const randomColor = (rnd: Source = cryptoSource): RGB => {
  const x = rnd();
  return { r: x & 0xff, g: (x >>> 8) & 0xff, b: (x >>> 16) & 0xff };
};

export const hex = (c: RGB) => `#${[c.r, c.g, c.b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;

export function hsl(c: RGB): { h: number; s: number; l: number } {
  const r = c.r / 255, g = c.g / 255, b = c.b / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l: Math.round(l * 100) };
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: Math.round(((h * 60) + 360) % 360), s: Math.round(s * 100), l: Math.round(l * 100) };
}

/** Relative luminance (WCAG), to tell light colors from dark ones. */
export function luminance(c: RGB): number {
  const lin = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
}

// ---------------------------------------------------------------------------
// Answers

export const COIN: Record<Lang, [string, string]> = { en: ["Heads", "Tails"], fr: ["Pile", "Face"] };
export const YES_NO: Record<Lang, [string, string]> = { en: ["Yes", "No"], fr: ["Oui", "Non"] };

export type Mood = "yes" | "maybe" | "no";

/** The 20 classic Magic 8-Ball answers: 10 positive, 5 non-committal, 5 negative. */
export const EIGHT_BALL: Record<Lang, [string, Mood][]> = {
  en: [
    ["It is certain.", "yes"],
    ["It is decidedly so.", "yes"],
    ["Without a doubt.", "yes"],
    ["Yes, definitely.", "yes"],
    ["You may rely on it.", "yes"],
    ["As I see it, yes.", "yes"],
    ["Most likely.", "yes"],
    ["Outlook good.", "yes"],
    ["Yes.", "yes"],
    ["Signs point to yes.", "yes"],
    ["Reply hazy, try again.", "maybe"],
    ["Ask again later.", "maybe"],
    ["Better not tell you now.", "maybe"],
    ["Cannot predict now.", "maybe"],
    ["Concentrate and ask again.", "maybe"],
    ["Don't count on it.", "no"],
    ["My reply is no.", "no"],
    ["My sources say no.", "no"],
    ["Outlook not so good.", "no"],
    ["Very doubtful.", "no"],
  ],
  fr: [
    ["C'est certain.", "yes"],
    ["C'est décidément le cas.", "yes"],
    ["Sans aucun doute.", "yes"],
    ["Oui, absolument.", "yes"],
    ["Tu peux compter dessus.", "yes"],
    ["Tel que je le vois, oui.", "yes"],
    ["Très probablement.", "yes"],
    ["Les perspectives sont bonnes.", "yes"],
    ["Oui.", "yes"],
    ["Les signes disent oui.", "yes"],
    ["Réponse floue, réessaie.", "maybe"],
    ["Redemande plus tard.", "maybe"],
    ["Mieux vaut ne pas te le dire maintenant.", "maybe"],
    ["Impossible de prédire maintenant.", "maybe"],
    ["Concentre-toi et redemande.", "maybe"],
    ["N'y compte pas.", "no"],
    ["Ma réponse est non.", "no"],
    ["Mes sources disent non.", "no"],
    ["Les perspectives ne sont pas bonnes.", "no"],
    ["Très peu probable.", "no"],
  ],
};

// ---------------------------------------------------------------------------
// Intent

export type Intent =
  | { kind: "tools" }
  | { kind: "coin"; count: number }
  | { kind: "dice"; dice: Dice }
  | { kind: "range"; range: Range }
  | { kind: "pick"; items: string[]; count: number }
  | { kind: "shuffle"; items: string[] }
  | { kind: "color" }
  | { kind: "yesno" }
  | { kind: "eightball"; question: string }
  | { kind: "unknown"; text: string };

const strip = (t: string, re: RegExp) => t.replace(re, "").trim();

/** What the text typed in the search bar asks for. Also tells whether it reads as French. */
export function parseIntent(query: string): Intent {
  const t = query.trim();
  const lower = t.toLowerCase();
  if (!t) return { kind: "tools" };

  const coin = lower.match(/^(?:flip|toss|coins?|coinflip|heads or tails|pile ou face|pile|pièce|piece)(?=\s|$)(.*)$/);
  if (coin && /^(?:\s+(?:a|an|une|une?|\d{1,3}|x\d{1,3}|[x×]|coins?|pièces?|times|fois))*$/.test(coin[1])) {
    const n = coin[1].match(/\d{1,3}/)?.[0];
    return { kind: "coin", count: Math.max(1, Math.min(100, Number(n ?? 1))) };
  }

  if (/^(?:dice|die|roll|dé|dés|de|lancer)$/.test(lower)) {
    return { kind: "dice", dice: { count: 1, sides: 6, modifier: 0 } };
  }
  const diceText = strip(lower, /^(?:roll|dice|lancer|dés?)\s+/);
  const dice = parseDice(diceText);
  if (dice) return { kind: "dice", dice };

  if (/^(?:colou?r|couleur|hex|swatch)(?:\s+(?:random|aléatoire))?$/.test(lower)) return { kind: "color" };
  if (/^(?:random\s+colou?r|couleur\s+aléatoire)$/.test(lower)) return { kind: "color" };

  if (/^(?:yes\s*(?:or|\/)\s*no|y\/?n|oui\s*(?:ou|\/)\s*non|yesno)\s*\??$/.test(lower)) return { kind: "yesno" };

  const ball = lower.match(/^(?:8\s*-?ball|8|magic\s*8(?:\s*-?ball)?|boule\s*magique|boule)\b[\s:,]*/);
  if (ball) return { kind: "eightball", question: t.slice(ball[0].length).trim() };

  const shuffleWord = lower.match(/^(?:shuffle|mix|mélanger|melanger|mélange|melange|order|ordre)\b[\s:]*/);
  if (shuffleWord) return { kind: "shuffle", items: parseList(t.slice(shuffleWord[0].length)) };

  const pickWord = lower.match(
    /^(?:pick|choose|choice|select|draw|choisir|choisis|choix|tirer|tire)(?:\s+(\d{1,3}))?(?:\s+(?:from|among|parmi|dans))?\b[\s:]*/,
  );
  if (pickWord) {
    const items = parseList(t.slice(pickWord[0].length));
    return { kind: "pick", items, count: Math.max(1, Math.min(items.length || 1, Number(pickWord[1] ?? 1))) };
  }

  const range = parseRange(t);
  if (range) return { kind: "range", range };

  if (t.endsWith("?")) return { kind: "eightball", question: t };

  const items = parseList(t);
  if (items.length >= 2) return { kind: "pick", items, count: 1 };
  return { kind: "unknown", text: t };
}

/** Whether the text reads as French, for the answers when the preference is "auto". */
export const looksFrench = (query: string) =>
  /\b(pile|pièce|dé|dés|couleur|oui|non|boule|choisir|choisis|mélanger|parmi|est-ce|est ce|je|tu|vais|dois|ou)\b/i
    .test(query);
