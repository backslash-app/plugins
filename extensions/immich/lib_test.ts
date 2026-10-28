import { assert, assertEquals } from "@std/assert";
import { parse } from "@std/toml";
import {
  type Asset,
  assetUrl,
  assetView,
  camera,
  dateRange,
  exposure,
  freePath,
  HOSTS,
  isAllowedHost,
  laneGroups,
  type Memory,
  memoryGroups,
  normalizeUrl,
  place,
  shareUrl,
  takenText,
  videoDuration,
} from "./lib.ts";

// `POST /api/search/smart` with withExif, assets.items[0], Immich 1.135.
const PHOTO: Asset = {
  id: "4c8ac5c8-2f33-4b8e-9d2a-0c1d2e3f4a5b",
  type: "IMAGE",
  originalFileName: "IMG_4021.HEIC",
  originalMimeType: "image/heic",
  fileCreatedAt: "2024-07-14T16:32:10.000Z",
  localDateTime: "2024-07-14T18:32:10.000Z",
  isFavorite: true,
  duration: "0:00:00.00000",
  people: [{ id: "p1", name: "Camille" }, { id: "p2", name: "" }],
  exifInfo: {
    make: "Apple",
    model: "iPhone 15 Pro",
    lensModel: "iPhone 15 Pro back triple camera 6.765mm f/1.78",
    fNumber: 1.78,
    exposureTime: "1/1205",
    iso: 80,
    focalLength: 6.765,
    exifImageWidth: 4032,
    exifImageHeight: 3024,
    orientation: "6",
    fileSizeInByte: 2_456_789,
    city: "Paris",
    state: "Île-de-France",
    country: "France",
    latitude: 48.8584,
    longitude: 2.2945,
    description: "Fireworks",
  },
};

const VIDEO: Asset = {
  id: "9d2a0c1d-2e3f-4a5b-8c8a-c5c82f334b8e",
  type: "VIDEO",
  originalFileName: "PXL_20230601.mp4",
  localDateTime: "2023-06-01T09:05:00.000Z",
  duration: "0:01:05.123000",
  exifInfo: { make: "Google", model: "Pixel 7", city: null, country: "Portugal" },
};

Deno.test("hosts match the manifest", async () => {
  const manifest = parse(await Deno.readTextFile(new URL("./backslash.toml", import.meta.url))) as {
    permissions: { net: string[] };
  };
  assertEquals(manifest.permissions.net, HOSTS);
  assert(isAllowedHost("immich"));
  assert(isAllowedHost("photos.duckdns.org"));
  assert(isAllowedHost("192.168.1.20"));
  assert(!isAllowedHost("photos.example.com"));
});

Deno.test("addresses and links", () => {
  assertEquals(normalizeUrl("immich.local"), "http://immich.local:2283");
  assertEquals(normalizeUrl("https://nas.lan/immich/photos/abc-1"), "https://nas.lan/immich");
  assertEquals(normalizeUrl("http://192.168.1.20:2283/api/"), "http://192.168.1.20:2283");
  assertEquals(normalizeUrl(""), "");
  assertEquals(assetUrl("http://i:2283", "x"), "http://i:2283/photos/x");
  assertEquals(shareUrl("http://i:2283", undefined, { key: "k1" }), "http://i:2283/share/k1");
  assertEquals(
    shareUrl("http://i:2283", "https://photos.example.com/", { key: "k1" }),
    "https://photos.example.com/share/k1",
  );
  assertEquals(shareUrl("http://i:2283", "", { key: "k1", slug: "summer" }), "http://i:2283/s/summer");
});

Deno.test("photo details", () => {
  const a = assetView(PHOTO);
  assertEquals(a.place, "Paris, Île-de-France, France");
  assertEquals(a.camera, "Apple iPhone 15 Pro");
  assertEquals(a.exposure, "ƒ/1.8 · 1/1205 s · ISO 80 · 6.8 mm");
  assertEquals(a.dimensions, "3024 × 4032");
  assertEquals(a.people, ["Camille"]);
  assertEquals(a.duration, undefined);
  assertEquals(a.description, "Fireworks");
  assertEquals(a.coords, { lat: 48.8584, lon: 2.2945 });
  // The wall-clock time where it was taken, not shifted to this computer's zone.
  assertEquals(takenText(a.taken), "14 Jul 2024, 18:32");
  assertEquals(takenText(a.taken, false), "14 Jul 2024");

  const v = assetView(VIDEO);
  assertEquals(v.video, true);
  assertEquals(v.duration, "1:05");
  assertEquals(v.place, "Portugal");
  assertEquals(v.camera, "Google Pixel 7");
});

Deno.test("cameras, places, exposure", () => {
  assertEquals(camera({ make: "Canon", model: "Canon EOS R6" }), "Canon EOS R6");
  assertEquals(camera({ make: "NIKON CORPORATION", model: "NIKON Z 6_2" }), "NIKON Z 6_2");
  assertEquals(camera({ make: "SONY", model: "ILCE-7M3" }), "SONY ILCE-7M3");
  assertEquals(camera({}), undefined);
  assertEquals(place({ city: "Monaco", state: "Monaco", country: "Monaco" }), "Monaco");
  assertEquals(place(undefined), undefined);
  assertEquals(exposure({}), undefined);
  assertEquals(videoDuration("1:02:03.5"), "1:02:03");
  assertEquals(videoDuration("0:00:00.000"), undefined);
});

Deno.test("dates of albums", () => {
  assertEquals(dateRange("2024-07-01T10:00:00Z", "2024-07-20T10:00:00Z"), "Jul 2024");
  assertEquals(dateRange("2024-05-01T10:00:00Z", "2024-08-20T10:00:00Z"), "May – Aug 2024");
  assertEquals(dateRange("2023-12-30T10:00:00Z", "2024-01-02T10:00:00Z"), "Dec 2023 – Jan 2024");
  assertEquals(dateRange(undefined, undefined), undefined);
});

Deno.test("memories", () => {
  const now = new Date("2026-10-28T12:00:00Z");
  // `GET /api/memories?for=2026-10-28`.
  const list: Memory[] = [
    {
      id: "m1",
      type: "on_this_day",
      data: { year: 2023 },
      memoryAt: "2023-10-28T00:00:00.000Z",
      showAt: "2026-10-28T00:00:00.000Z",
      hideAt: "2026-10-29T00:00:00.000Z",
      assets: [VIDEO],
    },
    {
      id: "m2",
      type: "on_this_day",
      data: { year: 2025 },
      showAt: "2026-10-28T00:00:00.000Z",
      hideAt: "2026-10-29T00:00:00.000Z",
      assets: [PHOTO],
    },
    { id: "m3", type: "on_this_day", data: { year: 2020 }, hideAt: "2026-10-01T00:00:00.000Z", assets: [PHOTO] },
    { id: "m4", type: "on_this_day", data: { year: 2019 }, assets: [] },
    { id: "m5", type: "birthday", data: { year: 2021, personName: "Camille" }, assets: [PHOTO] },
  ];
  assertEquals(memoryGroups(list, now).map((g) => g.title), [
    "1 year ago · 2025",
    "3 years ago · 2023",
    "Camille's birthday · 2021",
  ]);
  assertEquals(laneGroups([{ yearsAgo: 2, assets: [PHOTO] }, { yearsAgo: 5, assets: [] }], now).map((g) => g.title), [
    "2 years ago · 2024",
  ]);
});

Deno.test("download names", () => {
  const taken = new Set(["/p/IMG_1.jpg"]);
  assertEquals(freePath("/p", "IMG_1.jpg", (p) => taken.has(p)), "/p/IMG_1 (2).jpg");
  assertEquals(freePath("/p", "../x.jpg", (p) => taken.has(p)), "/p/_x.jpg");
});
