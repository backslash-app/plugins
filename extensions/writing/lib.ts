// DeepL and LanguageTool: languages, query parsing, request building and response mapping.

import { type Color, Icons } from "@backslash/api";

export const DEEPL_KEYS_URL = "https://www.deepl.com/your-account/keys";
export const DEEPL_SIGNUP_URL = "https://www.deepl.com/pro-api";
export const LT_PUBLIC = "https://api.languagetool.org";
export const LT_PREMIUM = "https://api.languagetoolplus.com";
export const LT_LOCAL_DOCS = "https://dev.languagetool.org/http-server";

/** A missing or refused DeepL key: views show how to get one. */
export class KeyError extends Error {}

// ---------------------------------------------------------------------------
// Languages

/** DeepL's target languages (source languages are the same, without variants). */
export const LANGUAGES: Record<string, string> = {
  AR: "Arabic",
  BG: "Bulgarian",
  CS: "Czech",
  DA: "Danish",
  DE: "German",
  EL: "Greek",
  "EN-GB": "English (UK)",
  "EN-US": "English (US)",
  ES: "Spanish",
  "ES-419": "Spanish (Latin America)",
  ET: "Estonian",
  FI: "Finnish",
  FR: "French",
  HE: "Hebrew",
  HU: "Hungarian",
  ID: "Indonesian",
  IT: "Italian",
  JA: "Japanese",
  KO: "Korean",
  LT: "Lithuanian",
  LV: "Latvian",
  NB: "Norwegian",
  NL: "Dutch",
  PL: "Polish",
  "PT-BR": "Portuguese (Brazil)",
  "PT-PT": "Portuguese (Portugal)",
  RO: "Romanian",
  RU: "Russian",
  SK: "Slovak",
  SL: "Slovenian",
  SV: "Swedish",
  TH: "Thai",
  TR: "Turkish",
  UK: "Ukrainian",
  VI: "Vietnamese",
  "ZH-HANS": "Chinese (simplified)",
  "ZH-HANT": "Chinese (traditional)",
};

/** Languages offered first in "Translate To". */
export const COMMON = [
  "EN-US",
  "EN-GB",
  "FR",
  "DE",
  "ES",
  "IT",
  "PT-BR",
  "NL",
  "PL",
  "JA",
  "ZH-HANS",
  "KO",
  "RU",
  "UK",
];

/** DeepL's formality option works for these targets. */
const FORMAL = new Set(["DE", "FR", "IT", "ES", "ES-419", "NL", "PL", "PT-BR", "PT-PT", "JA", "RU"]);
export const supportsFormality = (target: string) => FORMAL.has(target.toUpperCase());

/** The base language of a code: "EN-US" → "EN", "zh-hans" → "ZH". */
export const base = (code: string) => code.toUpperCase().split("-")[0];

/** A name for a code, target or source ("EN" → "English"). */
export function languageName(code: string): string {
  const c = code.toUpperCase();
  if (LANGUAGES[c]) return LANGUAGES[c];
  const variant = Object.entries(LANGUAGES).find(([k]) => base(k) === c);
  return variant ? variant[1].replace(/ \(.*\)$/, "") : c;
}

/**
 * A code typed by the user, as a DeepL target: "en" follows the preferred
 * English variant, "pt" Brazil, "zh" simplified. Undefined when unknown.
 */
export function normalizeTarget(code: string, preferred = "EN-US"): string | undefined {
  const c = code.trim().toUpperCase();
  if (!c) return undefined;
  if (LANGUAGES[c]) return c;
  const pref = preferred.toUpperCase();
  if (c === "EN") return base(pref) === "EN" && LANGUAGES[pref] ? pref : "EN-US";
  if (c === "PT") return base(pref) === "PT" && LANGUAGES[pref] ? pref : "PT-BR";
  if (c === "ZH") return "ZH-HANS";
  if (c === "NO") return "NB";
  return undefined;
}

/** A source language: base codes only. */
export function normalizeSource(code: string): string | undefined {
  const c = base(code.trim());
  return Object.keys(LANGUAGES).some((k) => base(k) === c) ? c : c === "NO" ? "NB" : undefined;
}

export interface Request {
  text: string;
  target?: string;
  source?: string;
}

/**
 * Picks a language out of the query: "de: Hello", ">de Hello", "Hello >de",
 * "fr>en Bonjour". Anything else is text to translate as typed.
 */
export function parseQuery(query: string, preferred = "EN-US"): Request {
  const q = query.trim();
  const code = "([a-z]{2}(?:-[a-z0-9]{2,4})?)";
  const pair = q.match(new RegExp(`^${code}\\s*>\\s*${code}\\s*:?\\s+([\\s\\S]+)$`, "i"));
  if (pair) {
    const source = normalizeSource(pair[1]);
    const target = normalizeTarget(pair[2], preferred);
    if (source && target) return { text: pair[3].trim(), source, target };
  }
  const prefix = q.match(new RegExp(`^${code}\\s*:\\s*([\\s\\S]+)$`, "i"));
  if (prefix) {
    const target = normalizeTarget(prefix[1], preferred);
    if (target) return { text: prefix[2].trim(), target };
  }
  const arrow = q.match(new RegExp(`^>\\s*${code}\\s+([\\s\\S]+)$`, "i"));
  if (arrow) {
    const target = normalizeTarget(arrow[1], preferred);
    if (target) return { text: arrow[2].trim(), target };
  }
  const suffix = q.match(new RegExp(`^([\\s\\S]+?)\\s+>\\s*${code}$`, "i"));
  if (suffix) {
    const target = normalizeTarget(suffix[2], preferred);
    if (target) return { text: suffix[1].trim(), target };
  }
  return { text: q };
}

/** The languages from the preferences, checked. */
export function languagePrefs(
  prefs: Record<string, unknown>,
): { target: string; second?: string; formality: Formality } {
  const raw = String(prefs.targetLang ?? "").trim() || "EN-US";
  const target = normalizeTarget(raw);
  if (!target) throw new Error(`“${raw}” is not a DeepL language: set Translate to, e.g. EN-US, FR or DE`);
  const second = normalizeTarget(String(prefs.secondLang ?? ""), target);
  const f = String(prefs.formality ?? "default").trim().toLowerCase();
  return {
    target,
    second: second && base(second) !== base(target) ? second : undefined,
    formality: f === "more" || f === "less" ? f : "default",
  };
}

// ---------------------------------------------------------------------------
// DeepL

export type Formality = "default" | "more" | "less";

export const FORMALITIES: { value: Formality; title: string }[] = [
  { value: "default", title: "Default" },
  { value: "more", title: "More Formal" },
  { value: "less", title: "Less Formal" },
];

/** Free keys end with ":fx" and use their own host. */
export function deeplHost(key: string): string {
  return key.trim().endsWith(":fx") ? "https://api-free.deepl.com" : "https://api.deepl.com";
}

export function deeplKey(prefs: Record<string, unknown>): string {
  const key = String(prefs.deeplKey ?? "").trim();
  if (!key) throw new KeyError("Add your DeepL API key");
  return key;
}

/** The JSON body of `/v2/translate`; "prefer_" formality never fails on other languages. */
export function translateBody(text: string, target: string, options: { source?: string; formality?: Formality } = {}) {
  return {
    text: [text],
    target_lang: target,
    ...(options.source ? { source_lang: options.source } : {}),
    ...(options.formality && options.formality !== "default" && supportsFormality(target)
      ? { formality: `prefer_${options.formality}` }
      : {}),
  };
}

export interface Translation {
  text: string;
  /** Detected (or given) source language, a base code like "FR". */
  source: string;
  target: string;
  original: string;
  formality: Formality;
}

export function parseTranslation(
  json: unknown,
  request: { original: string; target: string; formality: Formality },
): Translation {
  const t = (json as { translations?: { text: string; detected_source_language?: string }[] })?.translations?.[0];
  if (!t) throw new Error("DeepL sent no translation");
  return {
    text: t.text,
    source: (t.detected_source_language ?? "").toUpperCase(),
    target: request.target,
    original: request.original,
    formality: request.formality,
  };
}

export function deeplError(status: number, text: string): Error {
  let message = "";
  try {
    message = JSON.parse(text)?.message ?? "";
  } catch {
    message = text.slice(0, 160);
  }
  if (status === 403 || status === 401) return new KeyError("DeepL refused the API key: check it in the preferences");
  if (status === 456) return new Error("Your DeepL character quota for this month is used up");
  if (status === 429) return new Error("DeepL is rate limiting: wait a moment and try again");
  if (status === 413) return new Error("The text is too long for DeepL (128 KiB at most)");
  if (status >= 500) return new Error(`DeepL is unavailable (${status}): try again later`);
  return new Error(`DeepL answered ${status}${message ? `: ${message}` : ""}`);
}

export interface Usage {
  character_count: number;
  character_limit: number;
}

export const formatNumber = (n: number) => n.toLocaleString("en-US");

// ---------------------------------------------------------------------------
// LanguageTool

export interface LtSettings {
  url: string;
  premium?: { username: string; apiKey: string };
  language: string;
  variants: string[];
  picky: boolean;
  /** The free API takes 20 KB a check. */
  maxBytes?: number;
}

/** The server and options from the preferences; refuses hosts outside the permissions. */
export function ltSettings(prefs: Record<string, unknown>): LtSettings {
  const raw = (String(prefs.ltServer ?? "").trim() || LT_PUBLIC).replace(/\/+$/, "").replace(/\/v2(\/check)?$/, "");
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`“${raw}” is not a LanguageTool server address`);
  }
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  const hosted = url.protocol === "https:" &&
    ["api.languagetool.org", "api.languagetoolplus.com"].includes(url.hostname);
  if (!local && !hosted) {
    throw new Error("LanguageTool server: use api.languagetool.org, api.languagetoolplus.com or a server on localhost");
  }
  const username = String(prefs.ltUser ?? "").trim();
  const apiKey = String(prefs.ltKey ?? "").trim();
  const language = String(prefs.ltLanguage ?? "").trim() || "auto";
  return {
    url: `${url.origin}${url.pathname.replace(/\/$/, "")}`,
    premium: username && apiKey ? { username, apiKey } : undefined,
    language,
    variants: String(prefs.ltVariants ?? "").split(",").map((v) => v.trim()).filter(Boolean),
    picky: prefs.ltPicky === true || prefs.ltPicky === "true",
    maxBytes: url.hostname === "api.languagetool.org" ? 20_000 : undefined,
  };
}

/** The form body of `/v2/check`. */
export function checkBody(text: string, s: LtSettings): URLSearchParams {
  const body = new URLSearchParams({ text, language: s.language });
  if (s.language === "auto" && s.variants.length) body.set("preferredVariants", s.variants.join(","));
  if (s.picky) body.set("level", "picky");
  if (s.premium) {
    body.set("username", s.premium.username);
    body.set("apiKey", s.premium.apiKey);
  }
  return body;
}

export function ltError(status: number, text: string, s: Pick<LtSettings, "url">): Error {
  if (status === 429) {
    return new Error(
      s.url.includes("api.languagetool.org")
        ? "LanguageTool's free API allows 20 checks a minute: wait a moment, or use Premium or a local server"
        : "LanguageTool is rate limiting: wait a moment and try again",
    );
  }
  if (status === 413) return new Error("The text is too long for this LanguageTool server");
  if (status === 401 || status === 403) return new Error("LanguageTool refused the username or API key");
  return new Error(`LanguageTool answered ${status}${text ? `: ${text.trim().slice(0, 160)}` : ""}`);
}

interface LtMatch {
  message: string;
  shortMessage?: string;
  replacements?: { value: string }[];
  offset: number;
  length: number;
  context?: { text: string; offset: number; length: number };
  sentence?: string;
  rule?: {
    id: string;
    description?: string;
    issueType?: string;
    category?: { id: string; name: string };
    urls?: { value: string }[];
  };
}

export interface LtResponse {
  language?: { name: string; code: string; detectedLanguage?: { name: string; code: string; confidence?: number } };
  matches?: LtMatch[];
}

export interface Issue {
  /** Stable while the text doesn't change before it. */
  id: string;
  offset: number;
  length: number;
  /** The flagged text. */
  error: string;
  message: string;
  shortMessage: string;
  replacements: string[];
  category: string;
  categoryId: string;
  ruleId: string;
  rule: string;
  type: string;
  url?: string;
  context: { text: string; offset: number; length: number };
}

export interface CheckResult {
  language: string;
  languageCode: string;
  issues: Issue[];
}

export function parseCheck(text: string, json: LtResponse): CheckResult {
  const issues = (json.matches ?? []).map((m): Issue => {
    const error = text.slice(m.offset, m.offset + m.length);
    return {
      id: `${m.rule?.id ?? "rule"}@${m.offset}:${error}`,
      offset: m.offset,
      length: m.length,
      error,
      message: m.message.trim(),
      shortMessage: (m.shortMessage ?? "").trim(),
      replacements: (m.replacements ?? []).map((r) => r.value).filter((v, i, a) => a.indexOf(v) === i).slice(0, 12),
      category: m.rule?.category?.name ?? "Other",
      categoryId: m.rule?.category?.id ?? "MISC",
      ruleId: m.rule?.id ?? "",
      rule: m.rule?.description ?? "",
      type: m.rule?.issueType ?? "uncategorized",
      url: m.rule?.urls?.[0]?.value,
      context: m.context ?? { text, offset: m.offset, length: m.length },
    };
  });
  const lang = json.language;
  const detected = lang?.detectedLanguage;
  return {
    language: detected?.name ?? lang?.name ?? "",
    languageCode: detected?.code ?? lang?.code ?? "",
    issues: issues.sort((a, b) => a.offset - b.offset),
  };
}

export function mdEscape(text: string): string {
  return text.replace(/([\\`*_[\]#<>|~])/g, "\\$1");
}

/** The issue's context with the flagged part in bold, as markdown. */
export function highlight(issue: Pick<Issue, "context">): string {
  const { text, offset, length } = issue.context;
  const before = text.slice(0, offset);
  const error = text.slice(offset, offset + length);
  const after = text.slice(offset + length);
  return `${mdEscape(before)}**${mdEscape(error) || "\\_"}**${mdEscape(after)}`.replace(/\n/g, " ");
}

/** The whole text with every issue in bold. */
export function highlightAll(text: string, issues: Issue[]): string {
  let out = "";
  let at = 0;
  for (const i of [...issues].sort((a, b) => a.offset - b.offset)) {
    if (i.offset < at) continue;
    out += mdEscape(text.slice(at, i.offset)) + `**${mdEscape(text.slice(i.offset, i.offset + i.length)) || "\\_"}**`;
    at = i.offset + i.length;
  }
  return (out + mdEscape(text.slice(at))).replace(/\n/g, "  \n");
}

export function applyFix(text: string, issue: Pick<Issue, "offset" | "length">, replacement: string): string {
  return text.slice(0, issue.offset) + replacement + text.slice(issue.offset + issue.length);
}

/** Every first suggestion, from the end so offsets stay right; overlapping issues keep the first. */
export function applyAll(text: string, issues: Issue[]): { text: string; applied: number } {
  const picked: Issue[] = [];
  let end = -1;
  for (const i of [...issues].sort((a, b) => a.offset - b.offset)) {
    if (!i.replacements.length || i.offset < end) continue;
    picked.push(i);
    end = i.offset + i.length;
  }
  let out = text;
  for (const i of picked.reverse()) out = applyFix(out, i, i.replacements[0]);
  return { text: out, applied: picked.length };
}

/** A glyph and a color per kind of issue. */
export function issueLook(type: string): { icon: string; tint: Color; label: string } {
  switch (type) {
    case "misspelling":
      return { icon: Icons.text, tint: "red", label: "Spelling" };
    case "grammar":
      return { icon: Icons.alert, tint: "orange", label: "Grammar" };
    case "typographical":
    case "whitespace":
      return { icon: Icons.font, tint: "gray", label: "Typography" };
    case "style":
    case "register":
      return { icon: Icons.sparkle, tint: "blue", label: "Style" };
    case "duplication":
      return { icon: Icons.copy, tint: "orange", label: "Repetition" };
    case "inconsistency":
      return { icon: Icons.shuffle, tint: "purple", label: "Consistency" };
    default:
      return { icon: Icons.info, tint: "yellow", label: "Other" };
  }
}

/** A readable "teh → the" for an issue row. */
export function fixTitle(issue: Issue): string {
  const error = issue.error.trim() || "␣";
  return issue.replacements.length ? `${error} → ${issue.replacements[0] || "(remove)"}` : error;
}

export function words(text: string): number {
  return (text.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) ?? []).length;
}

/** A one-line preview of a text. */
export function preview(text: string, max = 80): string {
  const one = text.replace(/\s+/g, " ").trim();
  return one.length > max ? `${one.slice(0, max - 1).trimEnd()}…` : one;
}

/** UTF-8 size, what the public API limits. */
export const byteLength = (text: string) => new TextEncoder().encode(text).length;
