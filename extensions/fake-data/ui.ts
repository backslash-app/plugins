// What both commands share: the locale and how a value is shown.

import { type Locale, type Value } from "./lib.ts";

const env = (k: string) => {
  try {
    return Deno.env.get(k);
  } catch {
    return undefined;
  }
};

/** The locale preference, `auto` reading the system language. */
export function localeOf(pref: unknown): Locale {
  const p = String(pref ?? "auto").trim().toLowerCase();
  if (p.startsWith("fr")) return "fr";
  if (p.startsWith("en")) return "en";
  const system = env("LC_ALL") || env("LC_MESSAGES") || env("LANG") || "";
  return system.toLowerCase().startsWith("fr") ? "fr" : "en";
}

export const text = (v: Value) => v === null ? "" : String(v);

export const plural = (n: number, word: string) => `${n.toLocaleString("en")} ${word}${n === 1 ? "" : "s"}`;

/** "12.4 KB". */
export function size(chars: number): string {
  if (chars < 1024) return `${chars} B`;
  if (chars < 1024 * 1024) return `${(chars / 1024).toFixed(1)} KB`;
  return `${(chars / 1024 / 1024).toFixed(1)} MB`;
}
