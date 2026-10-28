import { assertEquals, assertStringIncludes, assertThrows } from "@std/assert";
import {
  compact,
  deviceIcon,
  duration,
  errorMessage,
  pickImage,
  plainDescription,
  playBody,
  present,
  provider,
  searchUrl,
  totalDuration,
  type Track,
  trackCount,
} from "./lib.ts";
import { albumItem, playlistItem, trackItem } from "./views.ts";

const ID = "0123456789abcdef0123456789abcdef";

const images = [
  { url: "https://i.scdn.co/image/640", width: 640, height: 640 },
  { url: "https://i.scdn.co/image/300", width: 300, height: 300 },
  { url: "https://i.scdn.co/image/64", width: 64, height: 64 },
];

const track: Track = {
  id: "4uLU6hMCjMI75M1A2tKUQC",
  uri: "spotify:track:4uLU6hMCjMI75M1A2tKUQC",
  name: "Never Gonna Give You Up",
  artists: [{ id: "a1", name: "Rick Astley", uri: "spotify:artist:a1" }],
  album: {
    id: "al1",
    uri: "spotify:album:al1",
    name: "Whenever You Need Somebody",
    artists: [{ id: "a1", name: "Rick Astley", uri: "spotify:artist:a1" }],
    images,
    release_date: "1987-11-12",
  },
  duration_ms: 213573,
  explicit: false,
  popularity: 80,
};

Deno.test("OAuth provider from the user's own app", () => {
  const p = provider({ clientId: ` ${ID} ` });
  assertEquals(p.clientId, ID);
  assertEquals(p.tokenUrl, "https://accounts.spotify.com/api/token");
  assertEquals(p.redirectPort, 43117);
  assertEquals(p.scopes?.includes("user-modify-playback-state"), true);
  assertEquals(provider({ clientId: ID, redirectPort: 8888 }).redirectPort, 8888);
  assertEquals(provider({ clientId: ID, redirectPort: 0 }).redirectPort, undefined);
  assertThrows(() => provider({}), Error, "Client ID");
  assertThrows(() => provider({ clientId: "not-an-id" }), Error, "32 hexadecimal");
});

Deno.test("formatting", () => {
  assertEquals(pickImage(images, "small"), "https://i.scdn.co/image/64");
  assertEquals(pickImage(images, "large"), "https://i.scdn.co/image/640");
  assertEquals(pickImage([{ url: "https://mosaic.scdn.co/x", width: null }], "small"), "https://mosaic.scdn.co/x");
  assertEquals(pickImage(null, "large"), undefined);
  assertEquals([duration(213573), duration(3_725_000), duration(5000)], ["3:34", "1:02:05", "0:05"]);
  assertEquals([totalDuration(45 * 60_000), totalDuration(135 * 60_000)], ["45 min", "2 h 15 min"]);
  assertEquals(compact(1_234_567), "1.2M");
  assertEquals(plainDescription('Best of <a href="spotify:x">80&#x27;s</a> &amp; more'), "Best of 80's & more");
  assertEquals([deviceIcon("Computer"), deviceIcon("Smartphone"), deviceIcon("Unknown")], [
    "bs-monitor",
    "bs-speaker",
    "bs-headphones",
  ]);
  assertEquals(present({ items: [null, { id: "x" }] }), [{ id: "x" }]);
  assertEquals(trackCount({ id: "p", uri: "u", name: "n", items: { total: 3 } }), 3);
});

Deno.test("search URL", () => {
  const all = new URL(searchUrl("daft punk", "all", 8));
  assertEquals(all.searchParams.get("type"), "track,album,artist,playlist");
  assertEquals(all.searchParams.get("q"), "daft punk");
  assertEquals(new URL(searchUrl("x", "album", 20)).searchParams.get("type"), "album");
});

Deno.test("errors are explained", () => {
  assertEquals(
    errorMessage(404, {
      error: { status: 404, message: "Player command failed: No active device found", reason: "NO_ACTIVE_DEVICE" },
    }),
    "No active device: start playing on Spotify somewhere, or pick a device in Play On",
  );
  assertEquals(
    errorMessage(403, { error: { message: "Player command failed: Premium required", reason: "PREMIUM_REQUIRED" } }),
    "Controlling playback needs Spotify Premium",
  );
  assertStringIncludes(
    errorMessage(403, { error: { message: "User not registered in the Developer Dashboard" } }),
    "User Management",
  );
  assertEquals(errorMessage(429, {}, "30"), "Spotify asks to slow down: try again in 30 s");
  assertStringIncludes(errorMessage(401, {}), "sign in");
  assertEquals(errorMessage(500, { error: "server_error" }), "Spotify answered 500: server_error");
});

Deno.test("play requests", () => {
  assertEquals(playBody({ uris: ["spotify:track:1"] }), { uris: ["spotify:track:1"] });
  assertEquals(playBody({ context: "spotify:album:2" }), { context_uri: "spotify:album:2" });
  assertEquals(playBody({ context: "spotify:album:2", offset: "spotify:track:1" }), {
    context_uri: "spotify:album:2",
    offset: { uri: "spotify:track:1" },
  });
});

Deno.test("items: cover art, liked state, actions", () => {
  const item = trackItem(track, { liked: new Set([track.id]), context: "spotify:album:al1" });
  assertEquals([item.title, item.subtitle, item.icon], [
    "Never Gonna Give You Up",
    "Rick Astley",
    "https://i.scdn.co/image/64",
  ]);
  assertEquals(item.detail?.image, "https://i.scdn.co/image/640");
  assertEquals(item.accessories?.[0], {
    icon: { source: "bs-heart-filled", tint: "green" },
    tooltip: "In Liked Songs",
  });
  assertEquals(item.accessories?.at(-1), { text: "3:34" });
  const titles = item.actions?.map((a) => a.title) ?? [];
  assertEquals(titles.slice(0, 4), ["Play", "Add to Queue", "Play On", "Remove from Liked Songs"]);
  assertEquals(titles.includes("Go to Album") && titles.includes("Open in Spotify"), true);
  assertEquals(trackItem(track).actions?.[3].title, "Save to Liked Songs");

  const album = albumItem(track.album!);
  assertEquals(album.accessories, [{ text: "1987" }]);
  assertEquals(album.actions?.[0].title, "Play Album");

  const pl = playlistItem({
    id: "p1",
    uri: "spotify:playlist:p1",
    name: "Road Trip",
    description: "Songs &amp; more",
    images: null,
    owner: { id: "me", display_name: "Me" },
    tracks: { total: 42 },
    collaborative: true,
  });
  assertEquals(pl.icon, { source: "bs-music", tint: "green" });
  assertEquals(pl.detail?.markdown, "Songs & more");
  assertEquals(pl.accessories, [{ tag: "Collaborative" }, { text: "42 tracks" }]);
});
