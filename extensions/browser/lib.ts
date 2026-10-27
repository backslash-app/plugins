// Pure helpers, unit-tested in lib_test.ts.

/** Firefox stores times in microseconds since 1970. */
export const firefoxTime = (us: number): number => Math.floor(us / 1000);

/**
 * Chromium stores times in microseconds since 1601-01-01, beyond what a
 * JavaScript number holds exactly: pass milliseconds (divided in SQL).
 */
export const chromeTime = (ms: number): number => (ms > 0 ? Math.floor(ms - 11_644_473_600_000) : 0);

/** Microseconds as a decimal string (Chromium's JSON files) to Unix ms. */
export const chromeTimeString = (us: string): number => {
  try {
    return chromeTime(Number(BigInt(us) / 1000n));
  } catch {
    return 0;
  }
};

export function domain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** "3 min ago", "yesterday"… */
export function ago(ms: number, now = Date.now()): string {
  const s = Math.max(0, (now - ms) / 1000);
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 172800) return "yesterday";
  if (s < 30 * 86400) return `${Math.floor(s / 86400)} days ago`;
  return new Date(ms).toLocaleDateString();
}

/** Bookmarks in Chromium's `Bookmarks` JSON file. */
export function chromeBookmarks(json: unknown): { url: string; title: string; added: number }[] {
  const out: { url: string; title: string; added: number }[] = [];
  const walk = (node: any) => {
    if (!node || typeof node !== "object") return;
    if (node.type === "url" && typeof node.url === "string") {
      out.push({
        url: node.url,
        title: node.name ?? node.url,
        added: chromeTimeString(String(node.date_added ?? "0")),
      });
    }
    for (const child of node.children ?? []) walk(child);
  };
  for (const root of Object.values((json as any)?.roots ?? {})) walk(root);
  return out;
}

/**
 * Decodes a Firefox `.jsonlz4` file: "mozLz40\0", the decompressed size
 * (u32, little endian), then one LZ4 block.
 */
export function mozLz4(data: Uint8Array): string {
  const magic = new TextDecoder().decode(data.subarray(0, 8));
  if (magic !== "mozLz40\0") throw new Error("not a mozlz4 file");
  const size = new DataView(data.buffer, data.byteOffset + 8, 4).getUint32(0, true);
  return new TextDecoder().decode(lz4Block(data.subarray(12), size));
}

/** LZ4 block format decoder (no frame). */
export function lz4Block(src: Uint8Array, size: number): Uint8Array {
  const dst = new Uint8Array(size);
  let s = 0;
  let d = 0;
  while (s < src.length) {
    const token = src[s++];
    let literals = token >> 4;
    if (literals === 15) {
      let b;
      do {
        b = src[s++];
        literals += b;
      } while (b === 255);
    }
    dst.set(src.subarray(s, s + literals), d);
    s += literals;
    d += literals;
    if (s >= src.length) break;
    const offset = src[s] | (src[s + 1] << 8);
    s += 2;
    let length = (token & 15) + 4;
    if ((token & 15) === 15) {
      let b;
      do {
        b = src[s++];
        length += b;
      } while (b === 255);
    }
    // Byte by byte: matches may overlap what they copy.
    for (let i = 0; i < length; i++, d++) dst[d] = dst[d - offset];
  }
  return dst.subarray(0, d);
}

export interface Tab {
  url: string;
  title: string;
  lastAccessed: number;
  pinned: boolean;
}

/** Open tabs from Firefox's session file. */
export function firefoxTabs(session: any): Tab[] {
  const tabs: Tab[] = [];
  for (const win of session?.windows ?? []) {
    for (const tab of win.tabs ?? []) {
      const entry = tab.entries?.[(tab.index ?? 1) - 1] ?? tab.entries?.at(-1);
      if (!entry?.url || entry.url.startsWith("about:")) continue;
      tabs.push({
        url: entry.url,
        title: entry.title || entry.url,
        lastAccessed: Number(tab.lastAccessed ?? 0),
        pinned: Boolean(tab.pinned),
      });
    }
  }
  return tabs.sort((a, b) => b.lastAccessed - a.lastAccessed);
}

/** Image type from its first bytes, for favicon files. */
export function imageExtension(data: Uint8Array): string | undefined {
  if (data[0] === 0x89 && data[1] === 0x50) return "png";
  if (data[0] === 0xff && data[1] === 0xd8) return "jpg";
  if (data[0] === 0 && data[1] === 0 && data[2] === 1) return "ico";
  if (data[0] === 0x52 && data[1] === 0x49 && data[8] === 0x57) return "webp";
  const head = new TextDecoder().decode(data.subarray(0, 100)).trimStart();
  if (head.startsWith("<svg") || head.startsWith("<?xml")) return "svg";
  return undefined;
}
