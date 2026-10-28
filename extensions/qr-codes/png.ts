// A minimal PNG writer for QR codes: 8-bit grayscale, zlib-compressed with
// CompressionStream (deflate = zlib format, as PNG wants).

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes: Uint8Array, crc = 0xffffffff): number {
  for (const b of bytes) crc = CRC_TABLE[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return crc;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  const typeBytes = new TextEncoder().encode(type);
  out.set(typeBytes, 4);
  out.set(data, 8);
  view.setUint32(8 + data.length, (crc32(out.subarray(4, 8 + data.length)) ^ 0xffffffff) >>> 0);
  return out;
}

async function zlib(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new CompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export interface PngOptions {
  /** Pixels per module. */
  scale?: number;
  /** Light modules around the code (the standard asks for 4). */
  border?: number;
  /** Gray levels, 0 to 255. */
  dark?: number;
  light?: number;
}

/** Encodes modules[y][x] (true = dark) as a PNG. */
export async function png(modules: boolean[][], o: PngOptions = {}): Promise<Uint8Array> {
  const scale = Math.max(1, Math.round(o.scale ?? 10));
  const border = Math.max(0, Math.round(o.border ?? 4));
  const n = modules.length;
  const side = (n + border * 2) * scale;
  const dark = o.dark ?? 0;
  const light = o.light ?? 255;
  const raw = new Uint8Array((side + 1) * side);
  for (let y = 0; y < side; y++) {
    const row = y * (side + 1);
    raw[row] = 0; // filter: none
    const my = Math.floor(y / scale) - border;
    for (let x = 0; x < side; x++) {
      const mx = Math.floor(x / scale) - border;
      const on = my >= 0 && my < n && mx >= 0 && mx < n && modules[my][mx];
      raw[row + 1 + x] = on ? dark : light;
    }
  }
  const ihdr = new Uint8Array(13);
  const v = new DataView(ihdr.buffer);
  v.setUint32(0, side);
  v.setUint32(4, side);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 0; // grayscale
  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", await zlib(raw)),
    chunk("IEND", new Uint8Array()),
  ];
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** The same code as an SVG document, one path, for "Save as SVG". */
export function svg(modules: boolean[][], border = 4): string {
  const n = modules.length;
  const side = n + border * 2;
  let d = "";
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (!modules[y][x]) continue;
      let w = 1;
      while (x + w < n && modules[y][x + w]) w++;
      d += `M${x + border} ${y + border}h${w}v1h-${w}z`;
      x += w - 1;
    }
  }
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${side} ${side}" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#fff"/><path fill="#000" d="${d}"/></svg>\n`;
}
