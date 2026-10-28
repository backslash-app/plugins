import { assertEquals, assertThrows } from "@std/assert";
import {
  canWriteAvif,
  command,
  describe,
  exifDate,
  formatBytes,
  imageSize,
  installCommand,
  mapLink,
  MissingTool,
  outputFor,
  outputPath,
  parseExiftool,
  parseFileList,
  parseGeometry,
  parseIdentify,
  sizeChange,
  type Tools,
  validQuality,
} from "./lib.ts";

Deno.test("files copied in a file manager", () => {
  // Nautilus / Dolphin: text/uri-list, CRLF separated.
  assertEquals(
    parseFileList("file:///home/ada/Pictures/Vacances%20%C3%A9t%C3%A9.jpg\r\nfile:///home/ada/Downloads/a.png\r\n"),
    ["/home/ada/Pictures/Vacances été.jpg", "/home/ada/Downloads/a.png"],
  );
  // GNOME's x-special/gnome-copied-files.
  assertEquals(parseFileList("copy\nfile:///tmp/x.webp"), ["/tmp/x.webp"]);
  // Comments, other hosts, duplicates, plain paths and ~.
  assertEquals(
    parseFileList(
      "# comment\nfile://otherhost/x.jpg\nfile://localhost/a.jpg\n/b.jpg\n/b.jpg\n~/c.jpg\nhello",
      "/home/ada",
    ),
    ["/a.jpg", "/b.jpg", "/home/ada/c.jpg"],
  );
  assertEquals(parseFileList(""), []);
});

Deno.test("output names never overwrite", () => {
  const taken = new Set(["/p/photo-1920px.jpg", "/p/photo-1920px-2.jpg"]);
  const exists = (p: string) => taken.has(p);
  assertEquals(outputPath("/p/photo.jpg", "-1920px", undefined, exists), "/p/photo-1920px-3.jpg");
  assertEquals(outputPath("/p/photo.jpg", "", "webp", exists), "/p/photo.webp");
  // Converting to the same format never writes over the input.
  assertEquals(outputPath("/p/photo.png", "", "png", () => false), "/p/photo-2.png");
  assertEquals(outputFor({ kind: "resize", geometry: "50%", label: "50pct" }, "/a/b.JPEG"), {
    suffix: "-50pct",
    ext: "jpg",
  });
  assertEquals(outputFor({ kind: "convert", format: "avif" }, "/a/b.png"), { suffix: "", ext: "avif" });
  assertEquals(outputFor({ kind: "compress", quality: 70 }, "/a/b.webp"), { suffix: "-q70", ext: "webp" });
  assertEquals(outputFor({ kind: "strip" }, "/a/b.jpg").suffix, "-clean");
});

Deno.test("custom sizes and quality", () => {
  assertEquals(parseGeometry("50%"), { geometry: "50%", label: "50pct" });
  assertEquals(parseGeometry(" 1600 px"), { geometry: "1600x1600>", label: "1600px" });
  assertEquals(parseGeometry("1600x900"), { geometry: "1600x900>", label: "1600x900" });
  assertEquals(parseGeometry("x720"), { geometry: "x720>", label: "h720" });
  assertEquals(parseGeometry("800x"), { geometry: "800x>", label: "800x" });
  assertThrows(() => parseGeometry("big"), Error, "50%");
  assertThrows(() => parseGeometry("0%"), Error, "percentage");
  assertEquals(validQuality("75"), 75);
  assertThrows(() => validQuality("101"), Error, "1 to 100");
  assertThrows(() => validQuality("7.5"), Error);
});

const IM7: Tools = { magick: "magick", exiftool: true, cwebp: false, avifenc: false, magickAvif: true };
const IM6: Tools = { magick: "convert", exiftool: false, cwebp: true, avifenc: true, magickAvif: false };
const NONE: Tools = { exiftool: false, cwebp: false, avifenc: false, magickAvif: false };

Deno.test("command lines", () => {
  assertEquals(command({ kind: "resize", geometry: "1920x1920>", label: "1920px" }, "/a.jpg", "/a-1920px.jpg", IM7), [
    "magick",
    ["/a.jpg", "-auto-orient", "-resize", "1920x1920>", "/a-1920px.jpg"],
  ]);
  assertEquals(command({ kind: "convert", format: "jpg" }, "/a.png", "/a.jpg", IM6), [
    "convert",
    ["/a.png", "-auto-orient", "-background", "white", "-flatten", "-quality", "85", "/a.jpg"],
  ]);
  assertEquals(command({ kind: "convert", format: "png" }, "/a.webp", "/a.png", IM7), [
    "magick",
    ["/a.webp[0]", "-auto-orient", "/a.png"],
  ]);
  // AVIF: avifenc when ImageMagick has no AVIF writer.
  assertEquals(command({ kind: "convert", format: "avif" }, "/a.jpg", "/a.avif", IM6), [
    "avifenc",
    ["-q", "60", "--", "/a.jpg", "/a.avif"],
  ]);
  assertEquals(command({ kind: "convert", format: "avif", quality: 50 }, "/a.jpg", "/a.avif", IM7)[1], [
    "/a.jpg",
    "-auto-orient",
    "-quality",
    "50",
    "/a.avif",
  ]);
  assertThrows(
    () => command({ kind: "convert", format: "avif" }, "/a.jpg", "/a.avif", { ...IM6, avifenc: false }),
    MissingTool,
    "avifenc",
  );
  assertEquals(command({ kind: "convert", format: "webp" }, "/a.png", "/a.webp", { ...NONE, cwebp: true }), [
    "cwebp",
    ["-q", "85", "/a.png", "-o", "/a.webp"],
  ]);
  assertEquals(command({ kind: "compress", quality: 70 }, "/a.jpg", "/a-q70.jpg", IM7)[1], [
    "/a.jpg",
    "-quality",
    "70",
    "/a-q70.jpg",
  ]);
  assertEquals(command({ kind: "compress", quality: 70 }, "/a.png", "/a-q70.png", IM7)[1].slice(1, 3), [
    "-define",
    "png:compression-level=9",
  ]);
  assertEquals(command({ kind: "rotate", degrees: 270 }, "/a.jpg", "/b.jpg", IM7)[1], [
    "/a.jpg",
    "-auto-orient",
    "-rotate",
    "270",
    "/b.jpg",
  ]);
  assertEquals(command({ kind: "flip", axis: "horizontal" }, "/a.jpg", "/b.jpg", IM7)[1][2], "-flop");
  // exiftool keeps the pixels, the color profile and the orientation.
  assertEquals(command({ kind: "strip" }, "/a.jpg", "/a-clean.jpg", IM7), [
    "exiftool",
    ["-q", "-all=", "-tagsFromFile", "@", "-ColorSpaceTags", "-Orientation", "-o", "/a-clean.jpg", "/a.jpg"],
  ]);
  assertEquals(command({ kind: "strip" }, "/a.jpg", "/a-clean.jpg", IM6)[1], [
    "/a.jpg",
    "-auto-orient",
    "-strip",
    "/a-clean.jpg",
  ]);
  assertThrows(() => command({ kind: "strip" }, "/a.jpg", "/b.jpg", NONE), MissingTool, "ImageMagick");
  assertEquals(describe({ kind: "rotate", degrees: 90 }), "Rotated 90°");
  assertEquals(describe({ kind: "flip", axis: "vertical" }), "Flipped vertically");
});

Deno.test("AVIF support from magick -list format", () => {
  assertEquals(canWriteAvif("     AVIF  HEIC      rw+   AV1 Image File Format (1.17.6)"), true);
  assertEquals(canWriteAvif("     AVIF            r--   AV1 Image File Format (1.17.6)"), false);
  assertEquals(canWriteAvif("     WEBP* WEBP      rw+   WebP Image Format"), false);
});

Deno.test("identify output", () => {
  const line = [
    "JPEG",
    "4032",
    "3024",
    "sRGB",
    "8",
    "92",
    "Undefined",
    "Apple",
    "iPhone 13 Pro",
    "2026:07:14 18:32:05",
    "1/250",
    "15/10",
    "50",
    "57/10",
    "45/1, 55/1, 3093/100",
    "N",
    "6/1, 7/1, 4230/100",
    "E",
    "17.5.1",
    "6",
  ].join("\t");
  const i = parseIdentify(`${line}\n`);
  assertEquals([i.format, i.width, i.height, i.colorspace, i.depth, i.quality, i.alpha], [
    "JPEG",
    4032,
    3024,
    "sRGB",
    8,
    92,
    false,
  ]);
  assertEquals(i.camera, "Apple iPhone 13 Pro");
  assertEquals([i.exposure, i.aperture, i.iso, i.focal], ["1/250 s", "ƒ/1.5", 50, "5.7 mm"]);
  assertEquals(i.gps!.lat.toFixed(4), "45.9253");
  assertEquals(i.gps!.lon.toFixed(4), "6.1284");
  assertEquals(i.orientation, 6);
  // A GIF: one line per frame, no EXIF.
  const gif = parseIdentify(
    "GIF\t300\t200\tsRGB\t8\t0\tBlend\t\t\t\t\t\t\t\t\t\t\t\t\t\nGIF\t300\t200\tsRGB\t8\t0\tBlend\n",
  );
  assertEquals([gif.frames, gif.alpha, gif.camera, gif.gps], [2, true, undefined, undefined]);
  assertEquals(exifDate("2026:07:14 18:32:05")?.getHours(), 18);
  assertEquals(exifDate("nope"), undefined);
});

Deno.test("exiftool output", () => {
  const json = JSON.stringify([
    {
      SourceFile: "/home/ada/Pictures/DSC_0042.JPG",
      FileType: "JPEG",
      ImageWidth: 6000,
      ImageHeight: 4000,
      Make: "NIKON CORPORATION",
      Model: "NIKON Z 6_2",
      LensModel: "NIKKOR Z 24-70mm f/4 S",
      DateTimeOriginal: "2026:05:02 09:12:44",
      ExposureTime: 0.004,
      FNumber: 8,
      ISO: 200,
      FocalLength: 35,
      GPSLatitude: -33.8568,
      GPSLongitude: 151.2153,
      Orientation: 1,
      ColorSpace: 1,
    },
    {
      SourceFile: "/home/ada/Downloads/logo.png",
      FileType: "PNG",
      ImageWidth: 512,
      ImageHeight: 512,
      BitsPerSample: 8,
    },
  ]);
  const m = parseExiftool(json);
  const a = m.get("/home/ada/Pictures/DSC_0042.JPG")!;
  assertEquals(a.camera, "NIKON Z 6_2");
  assertEquals([a.exposure, a.aperture, a.iso, a.focal], ["1/250 s", "ƒ/8", 200, "35 mm"]);
  assertEquals(a.gps, { lat: -33.8568, lon: 151.2153 });
  assertEquals(a.colorspace, "sRGB");
  assertEquals(m.get("/home/ada/Downloads/logo.png")!.depth, 8);
  assertEquals(parseExiftool("oops").size, 0);
  // Canon writes the brand in Make only.
  const canon = parseExiftool(JSON.stringify([{ SourceFile: "/x", Make: "Canon", Model: "EOS R6" }])).get("/x")!;
  assertEquals(canon.camera, "Canon EOS R6");
  assertEquals(
    mapLink({ lat: 45.92532, lon: 6.12843 }),
    "https://www.openstreetmap.org/?mlat=45.92532&mlon=6.12843#map=15/45.92532/6.12843",
  );
});

Deno.test("sizes", () => {
  const png = new Uint8Array(24);
  png.set([
    0x89,
    0x50,
    0x4e,
    0x47,
    0x0d,
    0x0a,
    0x1a,
    0x0a,
    0,
    0,
    0,
    13,
    0x49,
    0x48,
    0x44,
    0x52,
    0,
    0,
    2,
    0,
    0,
    0,
    1,
    0,
  ]);
  assertEquals(imageSize(png), { width: 512, height: 256 });
  assertEquals(formatBytes(2_500_000), "2.4 MB");
  assertEquals(sizeChange(1000, 380), "−62 %");
  assertEquals(sizeChange(1000, 1100), "+10 %");
  assertEquals(sizeChange(1000, 1001), "same size");
  assertEquals(
    installCommand(["imagemagick", "exiftool"], "debian"),
    "sudo apt install imagemagick libimage-exiftool-perl",
  );
  assertEquals(installCommand(["imagemagick"], "fedora"), "sudo dnf install ImageMagick");
});
