// Loading the glyph list: from storage, else downloaded once from the
// nerd-fonts repository, else the small list shipped with the extension.

import { storage } from "@backslash/api";
import { type Glyph, type GlyphData, GLYPHNAMES_URL, isGlyphData, parseGlyphnames, STALE_AFTER } from "./lib.ts";
import popular from "./fallback.json" with { type: "json" };

export const POPULAR = popular as Glyph[];

export type Loaded = GlyphData & {
  source: "cache" | "download" | "fallback";
  error?: string;
};

export async function download(signal?: AbortSignal): Promise<GlyphData> {
  const res = await fetch(GLYPHNAMES_URL, { signal });
  if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
  const data = parseGlyphnames(await res.text());
  await storage.set("glyphs", data);
  return data;
}

let loading: Promise<Loaded> | undefined;

/** Loaded once per process; a stale cache is used while a fresh copy downloads. */
export function glyphs(): Promise<Loaded> {
  loading ??= (async () => {
    const cached = await storage.get("glyphs").catch(() => undefined);
    if (isGlyphData(cached)) {
      if (Date.now() - cached.fetched > STALE_AFTER) download().catch(() => {});
      return { ...cached, source: "cache" as const };
    }
    try {
      return { ...(await download()), source: "download" as const };
    } catch (err) {
      loading = undefined; // Try the network again next time.
      return {
        version: "",
        fetched: 0,
        glyphs: POPULAR,
        source: "fallback" as const,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  })();
  return loading;
}

export function reset() {
  loading = undefined;
}

export async function recent(): Promise<string[]> {
  const r = await storage.get<string[]>("recent").catch(() => undefined);
  return Array.isArray(r) ? r : [];
}
