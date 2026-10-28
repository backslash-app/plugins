// The text to work on (selection, clipboard) and the calls to DeepL and LanguageTool.

import { clipboard } from "@backslash/api";
import {
  byteLength,
  checkBody,
  type CheckResult,
  deeplError,
  deeplHost,
  type Formality,
  ltError,
  type LtResponse,
  type LtSettings,
  parseCheck,
  parseTranslation,
  translateBody,
  type Translation,
  type Usage,
} from "./lib.ts";

/** The primary selection (the text selected with the mouse), Wayland or X11. */
export async function selection(): Promise<string> {
  const tries: [string, string[]][] = [
    ["wl-paste", ["--primary", "--no-newline"]],
    ["xclip", ["-o", "-selection", "primary"]],
    ["xsel", ["-o", "-p"]],
  ];
  for (const [program, args] of tries) {
    try {
      const out = await new Deno.Command(program, { args, stdin: "null", stdout: "piped", stderr: "null" }).output();
      if (out.success) {
        const text = new TextDecoder().decode(out.stdout);
        if (text.trim()) return text;
      }
    } catch {
      // Not installed, or no display of that kind.
    }
  }
  return "";
}

export async function clipboardText(): Promise<string> {
  try {
    return await clipboard.read();
  } catch {
    return "";
  }
}

export async function translate(
  key: string,
  text: string,
  target: string,
  options: { source?: string; formality?: Formality; signal?: AbortSignal } = {},
): Promise<Translation> {
  let res: Response;
  try {
    res = await fetch(`${deeplHost(key)}/v2/translate`, {
      method: "POST",
      signal: options.signal,
      headers: { Authorization: `DeepL-Auth-Key ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify(translateBody(text, target, options)),
    });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw new Error(`DeepL is unreachable: ${(e as Error).message}`);
  }
  const body = await res.text();
  if (!res.ok) throw deeplError(res.status, body);
  return parseTranslation(JSON.parse(body), { original: text, target, formality: options.formality ?? "default" });
}

/**
 * Translates into `target`; text already in that language goes to `second`
 * instead (French text with FR as target comes out in English, say).
 */
export async function translateSmart(
  key: string,
  text: string,
  langs: { target: string; second?: string; source?: string; explicit?: boolean; formality?: Formality },
  signal?: AbortSignal,
): Promise<Translation> {
  const first = await translate(key, text, langs.target, { source: langs.source, formality: langs.formality, signal });
  if (!langs.explicit && langs.second && first.source === langs.target.split("-")[0]) {
    return await translate(key, text, langs.second, { source: first.source, formality: langs.formality, signal });
  }
  return first;
}

let usageCache: { key: string; at: number; usage?: Usage } | undefined;

/** This month's characters, cached a minute; undefined if DeepL doesn't say. */
export async function usage(key: string, signal?: AbortSignal): Promise<Usage | undefined> {
  if (usageCache?.key === key && Date.now() - usageCache.at < 60_000) return usageCache.usage;
  try {
    const res = await fetch(`${deeplHost(key)}/v2/usage`, {
      signal,
      headers: { Authorization: `DeepL-Auth-Key ${key}` },
    });
    const u = res.ok ? (await res.json()) as Usage : (await res.body?.cancel(), undefined);
    usageCache = { key, at: Date.now(), usage: u?.character_limit ? u : undefined };
  } catch {
    usageCache = { key, at: Date.now() };
  }
  return usageCache.usage;
}

export async function check(text: string, s: LtSettings, signal?: AbortSignal): Promise<CheckResult> {
  if (s.maxBytes && byteLength(text) > s.maxBytes) {
    throw new Error(
      `The free LanguageTool API checks 20 KB at a time (this text is ${Math.ceil(byteLength(text) / 1000)} KB)`,
    );
  }
  let res: Response;
  try {
    res = await fetch(`${s.url}/v2/check`, {
      method: "POST",
      signal,
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: checkBody(text, s),
    });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw new Error(`LanguageTool is unreachable at ${s.url}: ${(e as Error).message}`);
  }
  const body = await res.text();
  if (!res.ok) throw ltError(res.status, body, s);
  return parseCheck(text, JSON.parse(body) as LtResponse);
}
