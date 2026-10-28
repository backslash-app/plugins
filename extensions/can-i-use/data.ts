// Downloading caniuse's data once a week, trimmed, cached in ~/.cache/backslash/can-i-use.

import { DATA_URL, type Dataset, trim } from "./lib.ts";

const HOME = Deno.env.get("HOME") ?? "";
export const CACHE_DIR = `${HOME}/.cache/backslash/can-i-use`;
const CACHE_FILE = `${CACHE_DIR}/features.json`;

export async function readCache(): Promise<Dataset | undefined> {
  try {
    const d = JSON.parse(await Deno.readTextFile(CACHE_FILE)) as Dataset;
    return Array.isArray(d.features) ? d : undefined;
  } catch {
    return undefined;
  }
}

/** Downloads the full data (about 4.8 MB), keeps what we show (about 1 MB) and caches it. */
export async function download(signal?: AbortSignal): Promise<Dataset> {
  const res = await fetch(DATA_URL, { signal });
  if (!res.ok) throw new Error(`GitHub answered ${res.status} for the caniuse data`);
  const data = trim(await res.json());
  if (!data.features.length) throw new Error("The caniuse data has no features: try again later");
  try {
    await Deno.mkdir(CACHE_DIR, { recursive: true });
    await Deno.writeTextFile(`${CACHE_FILE}.tmp`, JSON.stringify(data));
    await Deno.rename(`${CACHE_FILE}.tmp`, CACHE_FILE);
  } catch (e) {
    console.error("Can't write the caniuse cache:", e);
  }
  return data;
}
