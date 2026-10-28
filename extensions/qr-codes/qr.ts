// A QR Code encoder (ISO/IEC 18004), model 2, versions 1 to 40: numeric,
// alphanumeric and byte (UTF-8) modes, the four error correction levels and
// automatic mask selection. Checked against segno's output in qr_test.ts.

export type Ecc = "L" | "M" | "Q" | "H";

const ECC_ORDER: Ecc[] = ["L", "M", "Q", "H"];
/** The two format bits of each level. */
const ECC_BITS: Record<Ecc, number> = { L: 1, M: 0, Q: 3, H: 2 };

// Index 0 is padding; versions 1 to 40.
const ECC_CODEWORDS_PER_BLOCK: Record<Ecc, number[]> = {
  L: [
    -1,
    7,
    10,
    15,
    20,
    26,
    18,
    20,
    24,
    30,
    18,
    20,
    24,
    26,
    30,
    22,
    24,
    28,
    30,
    28,
    28,
    28,
    28,
    30,
    30,
    26,
    28,
    30,
    30,
    30,
    30,
    30,
    30,
    30,
    30,
    30,
    30,
    30,
    30,
    30,
    30,
  ],
  M: [
    -1,
    10,
    16,
    26,
    18,
    24,
    16,
    18,
    22,
    22,
    26,
    30,
    22,
    22,
    24,
    24,
    28,
    28,
    26,
    26,
    26,
    26,
    28,
    28,
    28,
    28,
    28,
    28,
    28,
    28,
    28,
    28,
    28,
    28,
    28,
    28,
    28,
    28,
    28,
    28,
    28,
  ],
  Q: [
    -1,
    13,
    22,
    18,
    26,
    18,
    24,
    18,
    22,
    20,
    24,
    28,
    26,
    24,
    20,
    30,
    24,
    28,
    28,
    26,
    30,
    28,
    30,
    30,
    30,
    30,
    28,
    30,
    30,
    30,
    30,
    30,
    30,
    30,
    30,
    30,
    30,
    30,
    30,
    30,
    30,
  ],
  H: [
    -1,
    17,
    28,
    22,
    16,
    22,
    28,
    26,
    26,
    24,
    28,
    24,
    28,
    22,
    24,
    24,
    30,
    28,
    28,
    26,
    28,
    30,
    24,
    30,
    30,
    30,
    30,
    30,
    30,
    30,
    30,
    30,
    30,
    30,
    30,
    30,
    30,
    30,
    30,
    30,
    30,
  ],
};

const NUM_BLOCKS: Record<Ecc, number[]> = {
  L: [
    -1,
    1,
    1,
    1,
    1,
    1,
    2,
    2,
    2,
    2,
    4,
    4,
    4,
    4,
    4,
    6,
    6,
    6,
    6,
    7,
    8,
    8,
    9,
    9,
    10,
    12,
    12,
    12,
    13,
    14,
    15,
    16,
    17,
    18,
    19,
    19,
    20,
    21,
    22,
    24,
    25,
  ],
  M: [
    -1,
    1,
    1,
    1,
    2,
    2,
    4,
    4,
    4,
    5,
    5,
    5,
    8,
    9,
    9,
    10,
    10,
    11,
    13,
    14,
    16,
    17,
    17,
    18,
    20,
    21,
    23,
    25,
    26,
    28,
    29,
    31,
    33,
    35,
    37,
    38,
    40,
    43,
    45,
    47,
    49,
  ],
  Q: [
    -1,
    1,
    1,
    2,
    2,
    4,
    4,
    6,
    6,
    8,
    8,
    8,
    10,
    12,
    16,
    12,
    17,
    16,
    18,
    21,
    20,
    23,
    23,
    25,
    27,
    29,
    34,
    34,
    35,
    38,
    40,
    43,
    45,
    48,
    51,
    53,
    56,
    59,
    62,
    65,
    68,
  ],
  H: [
    -1,
    1,
    1,
    2,
    4,
    4,
    4,
    5,
    6,
    8,
    8,
    11,
    11,
    16,
    16,
    18,
    16,
    19,
    21,
    25,
    25,
    25,
    34,
    30,
    32,
    35,
    37,
    40,
    42,
    45,
    48,
    51,
    54,
    57,
    60,
    63,
    66,
    70,
    74,
    77,
    81,
  ],
};

export type Mode = "numeric" | "alphanumeric" | "byte";

const MODE_BITS: Record<Mode, number> = { numeric: 0x1, alphanumeric: 0x2, byte: 0x4 };
const ALPHANUMERIC = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:";

/** Bits of the character count, by mode, for versions 1–9, 10–26 and 27–40. */
function countBits(mode: Mode, version: number): number {
  const i = version <= 9 ? 0 : version <= 26 ? 1 : 2;
  return { numeric: [10, 12, 14], alphanumeric: [9, 11, 13], byte: [8, 16, 16] }[mode][i];
}

/** Modules available for data and error correction (everything but the function patterns). */
function rawDataModules(version: number): number {
  let result = (16 * version + 128) * version + 64;
  if (version >= 2) {
    const align = Math.floor(version / 7) + 2;
    result -= (25 * align - 10) * align - 55;
    if (version >= 7) result -= 36;
  }
  return result;
}

/** Data codewords (8 bits) of a version and level. */
export function dataCodewords(version: number, ecc: Ecc): number {
  return Math.floor(rawDataModules(version) / 8) - ECC_CODEWORDS_PER_BLOCK[ecc][version] * NUM_BLOCKS[ecc][version];
}

// ---------------------------------------------------------------------------
// Reed–Solomon over GF(256), polynomial 0x11d

function gfMultiply(x: number, y: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z & 0xff;
}

/** The generator polynomial of the given degree, highest coefficient (1) left out. */
function rsDivisor(degree: number): number[] {
  const result = new Array<number>(degree).fill(0);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < result.length; j++) {
      result[j] = gfMultiply(result[j], root);
      if (j + 1 < result.length) result[j] ^= result[j + 1];
    }
    root = gfMultiply(root, 0x02);
  }
  return result;
}

function rsRemainder(data: number[], divisor: number[]): number[] {
  const result = divisor.map(() => 0);
  for (const b of data) {
    const factor = b ^ (result.shift() as number);
    result.push(0);
    divisor.forEach((coef, i) => (result[i] ^= gfMultiply(coef, factor)));
  }
  return result;
}

// ---------------------------------------------------------------------------
// Data

export function modeFor(text: string): Mode {
  if (/^\d*$/.test(text)) return "numeric";
  if ([...text].every((c) => ALPHANUMERIC.includes(c))) return "alphanumeric";
  return "byte";
}

function pushBits(bits: number[], value: number, length: number) {
  for (let i = length - 1; i >= 0; i--) bits.push((value >>> i) & 1);
}

interface Segment {
  mode: Mode;
  count: number;
  bits: number[];
}

function segment(text: string, mode: Mode): Segment {
  const bits: number[] = [];
  if (mode === "numeric") {
    for (let i = 0; i < text.length; i += 3) {
      const chunk = text.slice(i, i + 3);
      pushBits(bits, Number(chunk), chunk.length * 3 + 1);
    }
    return { mode, count: text.length, bits };
  }
  if (mode === "alphanumeric") {
    for (let i = 0; i + 1 < text.length; i += 2) {
      pushBits(bits, ALPHANUMERIC.indexOf(text[i]) * 45 + ALPHANUMERIC.indexOf(text[i + 1]), 11);
    }
    if (text.length % 2) pushBits(bits, ALPHANUMERIC.indexOf(text[text.length - 1]), 6);
    return { mode, count: text.length, bits };
  }
  const bytes = new TextEncoder().encode(text);
  for (const b of bytes) pushBits(bits, b, 8);
  return { mode, count: bytes.length, bits };
}

const segmentBits = (s: Segment, version: number) => 4 + countBits(s.mode, version) + s.bits.length;

// ---------------------------------------------------------------------------
// The symbol

export interface QrCode {
  version: number;
  ecc: Ecc;
  mask: number;
  mode: Mode;
  size: number;
  /** modules[y][x], true = dark. */
  modules: boolean[][];
}

export class TooLong extends Error {}

export interface EncodeOptions {
  ecc?: Ecc;
  /** 0 to 7; chosen by penalty when left out. */
  mask?: number;
  mode?: Mode;
  minVersion?: number;
  /** Raise the error correction level when it fits in the same version. Default true. */
  boost?: boolean;
}

export function encode(text: string, o: EncodeOptions = {}): QrCode {
  const mode = o.mode ?? modeFor(text);
  const seg = segment(text, mode);
  let ecc = o.ecc ?? "M";
  let version = Math.max(1, o.minVersion ?? 1);
  for (;; version++) {
    if (version > 40) throw new TooLong(`Too long for a QR code: ${new TextEncoder().encode(text).length} bytes`);
    const bits = segmentBits(seg, version);
    if (seg.count < 2 ** countBits(mode, version) && bits <= dataCodewords(version, ecc) * 8) break;
  }
  if (o.boost !== false) {
    for (const higher of ECC_ORDER.slice(ECC_ORDER.indexOf(ecc) + 1)) {
      if (segmentBits(seg, version) <= dataCodewords(version, higher) * 8) ecc = higher;
    }
  }

  // Header, data, terminator, byte alignment, pad bytes.
  const capacity = dataCodewords(version, ecc) * 8;
  const bits: number[] = [];
  pushBits(bits, MODE_BITS[mode], 4);
  pushBits(bits, seg.count, countBits(mode, version));
  bits.push(...seg.bits);
  pushBits(bits, 0, Math.min(4, capacity - bits.length));
  pushBits(bits, 0, (8 - (bits.length % 8)) % 8);
  for (let pad = 0xec; bits.length < capacity; pad ^= 0xec ^ 0x11) pushBits(bits, pad, 8);
  const data: number[] = [];
  for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));

  const codewords = interleave(data, version, ecc);
  const qr = new Matrix(version);
  qr.drawFunctionPatterns(ecc);
  qr.drawCodewords(codewords);

  let mask = o.mask ?? -1;
  if (mask < 0) {
    let best = Infinity;
    for (let m = 0; m < 8; m++) {
      qr.applyMask(m);
      qr.drawFormat(ecc, m);
      const p = qr.penalty();
      if (p < best) [best, mask] = [p, m];
      qr.applyMask(m); // XOR again: undone
    }
  }
  qr.applyMask(mask);
  qr.drawFormat(ecc, mask);
  return { version, ecc, mask, mode, size: qr.size, modules: qr.modules };
}

/** Splits into blocks, adds each block's error correction, interleaves. */
function interleave(data: number[], version: number, ecc: Ecc): number[] {
  const numBlocks = NUM_BLOCKS[ecc][version];
  const blockEcc = ECC_CODEWORDS_PER_BLOCK[ecc][version];
  const raw = Math.floor(rawDataModules(version) / 8);
  const numShort = numBlocks - (raw % numBlocks);
  const shortLen = Math.floor(raw / numBlocks);
  const divisor = rsDivisor(blockEcc);
  const blocks: number[][] = [];
  for (let i = 0, k = 0; i < numBlocks; i++) {
    const dat = data.slice(k, k + shortLen - blockEcc + (i < numShort ? 0 : 1));
    k += dat.length;
    const block = [...dat, ...rsRemainder(dat, divisor)];
    // Short blocks get a gap so that every block has the same length while interleaving.
    if (i < numShort) block.splice(shortLen - blockEcc, 0, -1);
    blocks.push(block);
  }
  const result: number[] = [];
  for (let i = 0; i < blocks[0].length; i++) {
    for (const b of blocks) if (b[i] !== -1) result.push(b[i]);
  }
  return result;
}

class Matrix {
  readonly size: number;
  readonly modules: boolean[][];
  private readonly isFunction: boolean[][];

  constructor(readonly version: number) {
    this.size = version * 4 + 17;
    this.modules = Array.from({ length: this.size }, () => new Array<boolean>(this.size).fill(false));
    this.isFunction = Array.from({ length: this.size }, () => new Array<boolean>(this.size).fill(false));
  }

  private set(x: number, y: number, dark: boolean) {
    this.modules[y][x] = dark;
    this.isFunction[y][x] = true;
  }

  alignmentPositions(): number[] {
    const v = this.version;
    if (v === 1) return [];
    const count = Math.floor(v / 7) + 2;
    const step = v === 32 ? 26 : Math.ceil((v * 4 + 4) / (count * 2 - 2)) * 2;
    const result = [6];
    for (let pos = this.size - 7; result.length < count; pos -= step) result.splice(1, 0, pos);
    return result;
  }

  drawFunctionPatterns(ecc: Ecc) {
    for (let i = 0; i < this.size; i++) {
      this.set(6, i, i % 2 === 0);
      this.set(i, 6, i % 2 === 0);
    }
    this.finder(3, 3);
    this.finder(this.size - 4, 3);
    this.finder(3, this.size - 4);
    const align = this.alignmentPositions();
    const n = align.length;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        if (!((i === 0 && j === 0) || (i === 0 && j === n - 1) || (i === n - 1 && j === 0))) {
          this.alignment(align[i], align[j]);
        }
      }
    }
    this.drawFormat(ecc, 0); // reserves the area; drawn again once the mask is known
    this.drawVersion();
  }

  private finder(x: number, y: number) {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const d = Math.max(Math.abs(dx), Math.abs(dy));
        const xx = x + dx, yy = y + dy;
        if (xx >= 0 && xx < this.size && yy >= 0 && yy < this.size) this.set(xx, yy, d !== 2 && d !== 4);
      }
    }
  }

  private alignment(x: number, y: number) {
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) this.set(x + dx, y + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }
  }

  drawFormat(ecc: Ecc, mask: number) {
    const data = (ECC_BITS[ecc] << 3) | mask;
    let rem = data;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const bits = ((data << 10) | rem) ^ 0x5412;
    const bit = (i: number) => ((bits >>> i) & 1) !== 0;
    for (let i = 0; i <= 5; i++) this.set(8, i, bit(i));
    this.set(8, 7, bit(6));
    this.set(8, 8, bit(7));
    this.set(7, 8, bit(8));
    for (let i = 9; i < 15; i++) this.set(14 - i, 8, bit(i));
    for (let i = 0; i < 8; i++) this.set(this.size - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i++) this.set(8, this.size - 15 + i, bit(i));
    this.set(8, this.size - 8, true); // the dark module
  }

  private drawVersion() {
    if (this.version < 7) return;
    let rem = this.version;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const bits = (this.version << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const dark = ((bits >>> i) & 1) !== 0;
      const a = this.size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      this.set(a, b, dark);
      this.set(b, a, dark);
    }
  }

  /** The zigzag from the bottom right, two columns at a time, skipping the vertical timing line. */
  drawCodewords(codewords: number[]) {
    let i = 0;
    const total = codewords.length * 8;
    for (let right = this.size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let vert = 0; vert < this.size; vert++) {
        for (let j = 0; j < 2; j++) {
          const x = right - j;
          const upward = ((right + 1) & 2) === 0;
          const y = upward ? this.size - 1 - vert : vert;
          if (!this.isFunction[y][x] && i < total) {
            this.modules[y][x] = ((codewords[i >>> 3] >>> (7 - (i & 7))) & 1) !== 0;
            i++;
          }
        }
      }
    }
  }

  applyMask(mask: number) {
    for (let y = 0; y < this.size; y++) {
      for (let x = 0; x < this.size; x++) {
        if (this.isFunction[y][x]) continue;
        let invert: boolean;
        switch (mask) {
          case 0:
            invert = (x + y) % 2 === 0;
            break;
          case 1:
            invert = y % 2 === 0;
            break;
          case 2:
            invert = x % 3 === 0;
            break;
          case 3:
            invert = (x + y) % 3 === 0;
            break;
          case 4:
            invert = (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
            break;
          case 5:
            invert = ((x * y) % 2) + ((x * y) % 3) === 0;
            break;
          case 6:
            invert = (((x * y) % 2) + ((x * y) % 3)) % 2 === 0;
            break;
          case 7:
            invert = (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
            break;
          default:
            throw new RangeError("Mask must be 0 to 7");
        }
        if (invert) this.modules[y][x] = !this.modules[y][x];
      }
    }
  }

  /** The four penalty rules of the standard; lower is better. */
  penalty(): number {
    const n = this.size;
    const m = this.modules;
    let result = 0;
    // Rule 1 (runs of 5+ same color) and rule 3 (finder-like patterns), on rows then columns.
    for (const vertical of [false, true]) {
      for (let a = 0; a < n; a++) {
        let runColor = false;
        let run = 0;
        const history = [0, 0, 0, 0, 0, 0, 0];
        for (let b = 0; b < n; b++) {
          const dark = vertical ? m[b][a] : m[a][b];
          if (dark === runColor) {
            run++;
            if (run === 5) result += 3;
            else if (run > 5) result++;
          } else {
            this.addHistory(run, history, n);
            if (!runColor) result += this.finderLike(history) * 40;
            runColor = dark;
            run = 1;
          }
        }
        result += this.finderTerminate(runColor, run, history, n) * 40;
      }
    }
    // Rule 2: 2×2 blocks.
    for (let y = 0; y < n - 1; y++) {
      for (let x = 0; x < n - 1; x++) {
        const c = m[y][x];
        if (c === m[y][x + 1] && c === m[y + 1][x] && c === m[y + 1][x + 1]) result += 3;
      }
    }
    // Rule 4: balance of dark modules.
    const dark = m.reduce((s, row) => s + row.filter(Boolean).length, 0);
    const total = n * n;
    const k = Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1;
    result += k * 10;
    return result;
  }

  private addHistory(run: number, history: number[], n: number) {
    if (history[0] === 0) run += n; // the light border before the row
    history.pop();
    history.unshift(run);
  }

  private finderLike(h: number[]): number {
    const u = h[1];
    const core = u > 0 && h[2] === u && h[3] === u * 3 && h[4] === u && h[5] === u;
    return (core && h[0] >= u * 4 && h[6] >= u ? 1 : 0) + (core && h[6] >= u * 4 && h[0] >= u ? 1 : 0);
  }

  private finderTerminate(color: boolean, run: number, history: number[], n: number): number {
    if (color) {
      this.addHistory(run, history, n);
      run = 0;
    }
    run += n;
    this.addHistory(run, history, n);
    return this.finderLike(history);
  }
}

/** The largest text of each mode that fits at a level (version 40). */
export function capacity(mode: Mode, ecc: Ecc): number {
  const bits = dataCodewords(40, ecc) * 8 - 4 - countBits(mode, 40);
  if (mode === "numeric") return Math.floor(bits / 10) * 3 + (bits % 10 >= 7 ? 2 : bits % 10 >= 4 ? 1 : 0);
  if (mode === "alphanumeric") return Math.floor(bits / 11) * 2 + (bits % 11 >= 6 ? 1 : 0);
  return Math.floor(bits / 8);
}
