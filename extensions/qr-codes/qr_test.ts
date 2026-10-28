import { assert, assertEquals, assertThrows } from "@std/assert";
import { capacity, dataCodewords, encode, modeFor, TooLong } from "./qr.ts";
import { crc32, png, svg } from "./png.ts";

// Reference symbols made by python-qrcode 8.0 (single segment, same mask and
// version), every one of them also decoded by zxing-cpp from our PNG output.
// The modules are row by row, dark = 1, after a leading 1 digit, in hex.
const FIXTURES = [
  {
    text: "HELLO WORLD",
    ecc: "M",
    mask: 0,
    version: 1,
    hex: "1fe2bfc17106e8abb7455dbabaec13907faafe00000aa4893c48447f4b1eb3ae4f53a805117f825904c68bacbfdd1a8aebdd" +
      "30438bfed708",
  },
  {
    text: "01234567890123456789",
    ecc: "H",
    mask: 1,
    version: 2,
    hex: "1fe0cbfc145106ea68bb75cf5dbae9aec171d07faaafe00c50027875f78c74251ca673323656a7369cb2654e36df3d0400fb" +
      "cebc4fd804cc43fa66af05751aba13fedd1a8b2ea369704ecc6fe40558",
  },
  {
    text: "https://example.com/?q=backslash&lang=fr",
    ecc: "Q",
    mask: 6,
    version: 4,
    hex: "1fe64863fc1646b506e989b2bb75a72d5dba8b6a2ec11d34d07faaaaafe012a32005eca796d18f78f8723e439cbedb71b2e6" +
      "da6568a1f68688a930d7110b12900e19d034b99fc6cd689154c9c4c55a1a40a1de5fa9a8d542a6068c27a6a8fc7088e46a4d" +
      "674f8f900592045bf9ffeea905a0671fbab9bdf95d4415eb6e9812c6705c6847ffe0ee1f80",
  },
  {
    text: "Bonjour, \u00e7a va ? \u00c9lodie \u20ac \u65e5\u672c",
    ecc: "L",
    mask: 2,
    version: 3,
    hex: "1fe2d3bfc1538506e836ebb75d4a5dba407aec16c1107faaaafe00e7100fbd0d5524979f5d2e98369c11909b226b702c6205" +
      "1fdf9e2e594ae7ef9c631406e8f7172e3c1bd513259c1b87ebaff0070944bfae1ea904a5d12bab16fa5d577e7eea987c5051" +
      "a792fe8b64a0",
  },
  {
    text: "a".repeat(300),
    ecc: "M",
    mask: 1,
    version: 13,
    hex: "1fee80ccc92aeaafbfc10a2cc89912112106ea4026ee3ddddd8bb7406b91a0aaaaa95dba2b0cadfaaaaaaaec15aecf845111" +
      "11107faaaaaaaaaaaaaafe001eec4b111121000a31cb313faaabab12828af989068aaaaa863a2af93cb6f77736bba1efc0aa" +
      "11111c1af79ca372daaaaad2d865af1a906aaaaba862e2ac83cb77777b6bb91ed8caa1111201af69cb852daaaabb2d869af1" +
      "7904aaaaaa86282ae23caf777736b391ec8caa0111d01a769cbf52da2aacb2de69af1b9066aabaab5282b703cb1777f37b39" +
      "1e8ccaa1111101af69cbe52daaaaab2da69ac0f906aaaaaa86282af63cb7777736a391e0ecaa101d101a5684be52daa2cab2" +
      "de69ac0f906a6baaa86283bf624b717f736e792ecec6a1111101a7f9cfe58faaaaabfdec51c0fc46aaaaa4466a73f65eb777" +
      "776aa110ecef9111c1111a6f867e53faac2aafde49280f9d2ab6aa286cb69f63dd779776aa6bd4cec8a1111134a6303fe53a" +
      "aaaaab75e4b280f9d2aaaaa286caebf6bdb777776aa6b17cec881d10134a6f22ee13aacaa2b75e2b248f952baa6a286eaeff" +
      "73bd7f7176aa6355fe4ba1111134a6e82fe52eaaaaab75e6624cf9e2aaaa8286caefefbdd77776eaa6855fa88ad111034a63" +
      "02fcb3acaaaa375e0e248d9d3aaaa6284faef9bbddf77716aa6b55f288a2111134ae282fcb3abaaaab75c0e24b99d2aaa8a2" +
      "86bcee81bdd7776f6ab0255be88a1111134a9a82bb33faaaaabfd8062689946aaaaac47faef83bab777776ab04557c8b1121" +
      "1111aba029b33fabaaabfddd224899aaaa8aa442eaff03bf7776f72af04693c891111112a8fe8adb2eaaaaaabdc8",
  },
  {
    text: "mask test 5",
    ecc: "M",
    mask: 5,
    version: 1,
    hex: "1fe23fc16906eb4bb75e5dba0aec11907faafe0100082b67542d9108b9c4b3ae4b988004657f9c150445eba320dd24c2e8fa" +
      "704704feff10",
  },
];

const bitsOf = (hex: string) => [...hex].map((h) => parseInt(h, 16).toString(2).padStart(4, "0")).join("").slice(4);

Deno.test("matches the reference symbols bit for bit", () => {
  for (const f of FIXTURES) {
    const qr = encode(f.text, { ecc: f.ecc as "L", mask: f.mask, boost: false });
    assertEquals([qr.version, qr.mask, qr.ecc], [f.version, f.mask, f.ecc], f.text);
    const expected = bitsOf(f.hex).slice(0, qr.size * qr.size);
    assertEquals(qr.modules.map((r) => r.map((b) => (b ? "1" : "0")).join("")).join(""), expected, f.text);
  }
});

Deno.test("modes, versions and capacity", () => {
  assertEquals(modeFor("0123"), "numeric");
  assertEquals(modeFor("HELLO WORLD $%*+-./:"), "alphanumeric");
  assertEquals(modeFor("Hello"), "byte");
  assertEquals(dataCodewords(1, "M"), 16);
  assertEquals(dataCodewords(40, "L"), 2956);
  assertEquals(capacity("byte", "L"), 2953);
  assertEquals(capacity("numeric", "L"), 7089);
  assertEquals(capacity("alphanumeric", "H"), 1852);
  assertEquals(encode("x".repeat(2953), { ecc: "L" }).version, 40);
  assertThrows(() => encode("x".repeat(2954), { ecc: "L" }), TooLong);
  // Boosting raises the level while it fits in the same version.
  assertEquals(encode("HELLO WORLD", { ecc: "L" }).ecc, "Q");
  assertEquals(encode("HELLO WORLD", { ecc: "L", boost: false }).ecc, "L");
});

Deno.test("structure: finders, timing, dark module, version info", () => {
  const qr = encode("https://backslash.app", { ecc: "M" });
  const m = qr.modules;
  const n = qr.size;
  for (const [x, y] of [[0, 0], [n - 7, 0], [0, n - 7]]) {
    for (let i = 0; i < 7; i++) assert(m[y][x + i] && m[y + 6][x + i] && m[y + i][x] && m[y + i][x + 6]);
    assert(!m[y + 1][x + 1] && m[y + 3][x + 3]);
  }
  for (let i = 8; i < n - 8; i++) assertEquals(m[6][i], i % 2 === 0);
  assert(m[n - 8][8], "dark module");
  // Version 7 and up carry their version twice; 000111 110010 010100 for 7.
  const v7 = encode("x".repeat(100), { ecc: "M", minVersion: 7 });
  assertEquals(v7.version, 7);
  let bits = "";
  for (let i = 17; i >= 0; i--) bits += v7.modules[Math.floor(i / 3)][v7.size - 11 + (i % 3)] ? "1" : "0";
  assertEquals(bits, "000111110010010100");
});

Deno.test("automatic mask is deterministic and valid", () => {
  const a = encode("Bonjour, ça va ?");
  const b = encode("Bonjour, ça va ?");
  assertEquals(a.mask, b.mask);
  assert(a.mask >= 0 && a.mask <= 7);
});

Deno.test("PNG output", async () => {
  assertEquals((crc32(new TextEncoder().encode("IEND")) ^ 0xffffffff) >>> 0, 0xae426082);
  const qr = encode("HELLO WORLD", { ecc: "M", mask: 0, boost: false });
  const data = await png(qr.modules, { scale: 3, border: 4 });
  assertEquals([...data.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const view = new DataView(data.buffer, data.byteOffset);
  assertEquals(new TextDecoder().decode(data.subarray(12, 16)), "IHDR");
  const side = (21 + 8) * 3;
  assertEquals([view.getUint32(16), view.getUint32(20)], [side, side]);
  // Inflate IDAT and check a few pixels: the quiet zone is white, the finder's corner black.
  const idatLen = view.getUint32(33);
  assertEquals(new TextDecoder().decode(data.subarray(37, 41)), "IDAT");
  const stream = new Blob([data.slice(41, 41 + idatLen) as BlobPart]).stream().pipeThrough(
    new DecompressionStream("deflate"),
  );
  const raw = new Uint8Array(await new Response(stream).arrayBuffer());
  assertEquals(raw.length, (side + 1) * side);
  const px = (x: number, y: number) => raw[y * (side + 1) + 1 + x];
  assertEquals(px(0, 0), 255);
  assertEquals(px(12, 12), 0);
  assertEquals(px(12 + 3, 12 + 3), 255);
  assertEquals(new TextDecoder().decode(data.subarray(data.length - 8, data.length - 4)), "IEND");
});

Deno.test("SVG output", () => {
  const s = svg(encode("A", { mask: 0 }).modules);
  assert(s.startsWith("<?xml") && s.includes('viewBox="0 0 29 29"') && s.includes("M4 4h7v1h-7z"));
});
