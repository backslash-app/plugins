// License texts: embedded for the short ones, fetched once from choosealicense.com's repository otherwise.

import { exec, storage } from "@backslash/api";
import { TEXTS } from "./data.ts";
import { bodyOf, gitName, type License, rawUrl } from "./lib.ts";

/** The license text with its [year] / [fullname] placeholders. */
export async function licenseText(l: License, signal?: AbortSignal): Promise<string> {
  if (TEXTS[l.key]) return TEXTS[l.key];
  const key = `text:${l.key}`;
  const cached = await storage.get<string>(key).catch(() => undefined);
  if (cached) return cached;
  let res: Response;
  try {
    res = await fetch(rawUrl(l), { signal });
  } catch (e) {
    if (signal?.aborted) throw e;
    throw new Error(`Couldn't download the ${l.spdx} text: check your connection`);
  }
  if (!res.ok) throw new Error(`Couldn't download the ${l.spdx} text (GitHub answered ${res.status})`);
  const text = bodyOf(await res.text());
  await storage.set(key, text).catch(() => {});
  return text;
}

/** The copyright holder: the preference, else git's user.name, else the login name. */
export async function holderName(preference: unknown): Promise<string> {
  const pref = typeof preference === "string" ? preference.trim() : "";
  if (pref) return pref;
  try {
    const name = gitName(await exec("git", ["config", "--global", "user.name"]));
    if (name) return name;
  } catch {
    // git missing or no name configured
  }
  return Deno.env.get("USER") ?? "";
}

export const HOME = Deno.env.get("HOME") ?? "";

export async function exists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) return false;
    throw e;
  }
}
