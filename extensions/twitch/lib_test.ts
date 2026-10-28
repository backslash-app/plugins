import { assert, assertEquals, assertStringIncludes, assertThrows } from "@std/assert";
import {
  AuthError,
  authFrom,
  boxArtUrl,
  categoryUrl,
  type Channel,
  channelStream,
  chatUrl,
  installCommand,
  liveSubtitle,
  matches,
  osFamily,
  playArgs,
  previewUrl,
  slug,
  sortStreams,
  type Stream,
  twitchError,
  unitArgs,
  uptime,
  viewers,
} from "./lib.ts";
import { categoryItem, channelItem, type Ctx, setupItems, streamItem } from "./views.ts";

const NOW = Date.UTC(2026, 9, 28, 20, 0);

// A /helix/streams/followed entry, as Twitch sends it.
const STREAM: Stream = {
  id: "41375541868",
  user_id: "37402112",
  user_login: "shroud",
  user_name: "shroud",
  game_id: "516575",
  game_name: "VALORANT",
  type: "live",
  title: "ranked grind | !merch",
  viewer_count: 23456,
  started_at: "2026-10-28T17:46:00Z",
  language: "en",
  thumbnail_url: "https://static-cdn.jtvnw.net/previews-ttv/live_user_shroud-{width}x{height}.jpg",
  tags: ["English", "FPS"],
  is_mature: false,
};

const CHANNEL: Channel = {
  id: "37402112",
  broadcaster_login: "shroud",
  display_name: "shroud",
  game_id: "516575",
  game_name: "VALORANT",
  is_live: true,
  thumbnail_url: "https://static-cdn.jtvnw.net/jtv_user_pictures/7ed5e0c6-300x300.png",
  title: "ranked grind",
  started_at: "2026-10-28T17:46:00Z",
  broadcaster_language: "en",
  tags: ["English"],
};

Deno.test("auth: client id always; a pasted token or the secret to sign in", () => {
  assertThrows(() => authFrom({}), AuthError, "Connect");
  assertThrows(() => authFrom({ clientId: "abc" }), AuthError, "Client Secret");
  assertEquals(authFrom({ clientId: " abc ", accessToken: "oauth:tok" }), { clientId: "abc", token: "tok" });
  const p = authFrom({ clientId: "abc", clientSecret: "s" }).provider!;
  assertEquals(p.tokenUrl, "https://id.twitch.tv/oauth2/token");
  assertEquals(p.scopes, ["user:read:follows"]);
  assertEquals(p.redirectPort, 43120);
  assertEquals(authFrom({ clientId: "a", clientSecret: "b", redirectPort: 9000 }).provider!.redirectPort, 9000);
});

Deno.test("errors: expired tokens and client mismatches are sign-in problems", () => {
  const expired = twitchError(401, '{"error":"Unauthorized","status":401,"message":"Invalid OAuth token"}');
  assert(expired instanceof AuthError && expired.kind === "expired");
  const client = twitchError(
    401,
    '{"error":"Unauthorized","status":401,"message":"Client ID and OAuth token do not match"}',
  );
  assert(client instanceof AuthError && client.kind === "setup");
  assertStringIncludes(twitchError(500, "oops").message, "500: oops");
});

Deno.test("pictures: preview sizes with a cache key, box art at a readable size", () => {
  assertEquals(
    previewUrl(STREAM.thumbnail_url, NOW),
    `https://static-cdn.jtvnw.net/previews-ttv/live_user_shroud-640x360.jpg?t=${Math.floor(NOW / 300_000)}`,
  );
  assertEquals(
    boxArtUrl("https://static-cdn.jtvnw.net/ttv-boxart/33214-52x72.jpg"),
    "https://static-cdn.jtvnw.net/ttv-boxart/33214-285x380.jpg",
  );
  assertEquals(
    boxArtUrl("https://static-cdn.jtvnw.net/ttv-boxart/509658-{width}x{height}.jpg"),
    "https://static-cdn.jtvnw.net/ttv-boxart/509658-285x380.jpg",
  );
});

Deno.test("addresses", () => {
  assertEquals(chatUrl("shroud"), "https://www.twitch.tv/popout/shroud/chat?popout=");
  assertEquals(slug("Grand Theft Auto V"), "grand-theft-auto-v");
  assertEquals(slug("Pokémon: Legends Z-A"), "pokemon-legends-z-a");
  assertEquals(categoryUrl("Just Chatting"), "https://www.twitch.tv/directory/category/just-chatting");
});

Deno.test("playback command lines", () => {
  assertEquals(playArgs("streamlink", "shroud", { player: "mpv", quality: "720p60" }), [
    "streamlink",
    "--player=mpv",
    "--twitch-disable-ads",
    "--title",
    "{author} – {title}",
    "https://twitch.tv/shroud",
    "720p60,best",
  ]);
  assertEquals(playArgs("streamlink", "x", { audioOnly: true }).at(-1), "audio_only,worst");
  assertEquals(playArgs("mpv", "shroud"), [
    "mpv",
    "--no-terminal",
    "--force-window=immediate",
    "--ytdl-format=best",
    "--title=shroud",
    "https://www.twitch.tv/shroud",
  ]);
  assertStringIncludes(playArgs("mpv", "x", { quality: "720p60" }).join(" "), "best[height<=?720]/best");
  assertEquals(unitArgs("u", "d", { DISPLAY: ":0" }, ["streamlink"]).slice(-2), ["--setenv=DISPLAY=:0", "streamlink"]);
});

Deno.test("formatting and sorting", () => {
  assertEquals(uptime("2026-10-28T17:46:00Z", NOW), "2 h 14");
  assertEquals(uptime("2026-10-28T19:59:30Z", NOW), "just started");
  assertEquals(uptime("nope", NOW), "");
  assertEquals(viewers(23456), "23.5K viewers");
  assertEquals(liveSubtitle(3), "3 live");
  assertEquals(liveSubtitle(0), null);
  const b = { ...STREAM, user_id: "2", user_name: "Alpha", viewer_count: 10 };
  const c = { ...STREAM, user_id: "3", user_name: "Beta", viewer_count: 10 };
  assertEquals(sortStreams([b, c, STREAM]).map((s) => s.user_name), ["shroud", "Alpha", "Beta"]);
  assert(matches(STREAM, "valo"));
  assert(!matches(STREAM, "minecraft"));
  assertEquals(channelStream({ ...CHANNEL, is_live: false }), undefined);
  assertEquals(channelStream(CHANNEL)?.thumbnail_url, STREAM.thumbnail_url);
  assertEquals(osFamily("ID=fedora"), "fedora");
  assertEquals(installCommand("arch"), "sudo pacman -S streamlink mpv");
});

const CTX: Ctx = { auth: { clientId: "c", token: "t" }, enter: "browser", quality: "best", now: NOW };

Deno.test("stream item: preview, viewers, uptime, avatar, actions", () => {
  const item = streamItem(STREAM, CTX, { avatar: CHANNEL.thumbnail_url, section: "Live Now" });
  assertEquals(item.subtitle, "VALORANT · ranked grind | !merch");
  assertStringIncludes(item.detail!.image!, "live_user_shroud-640x360.jpg");
  assertEquals(item.accessories!.map((a) => a.text ?? a.avatar), ["23.5K", "2 h 14", CHANNEL.thumbnail_url]);
  assertEquals(item.actions!.slice(0, 3).map((a) => a.title), ["Open in Browser", "Play in Player", "Play Audio Only"]);
  assert(item.actions!.some((a) => a.title === "Open Chat"));
  assert(item.actions!.some((a) => a.title === "Copy URL"));
  const player = streamItem(STREAM, { ...CTX, enter: "player" });
  assertEquals(player.actions![0].title, "Play in Player");
});

Deno.test("channel and category items, setup", () => {
  const off = channelItem({ ...CHANNEL, is_live: false }, CTX);
  assertEquals(off.actions![0].title, "Open in Browser");
  assert(!off.actions!.some((a) => a.title.startsWith("Play")));
  const cat = categoryItem(
    { id: "509658", name: "Just Chatting", box_art_url: "https://static-cdn.jtvnw.net/ttv-boxart/509658-52x72.jpg" },
    CTX,
    { rank: 1 },
  );
  assertEquals(cat.subtitle, "#1 on Twitch");
  assertEquals(cat.actions![0].title, "Show Top Streams");
  const setup = setupItems(new AuthError("Connect your Twitch account"), {});
  assertStringIncludes(setup[0].detail!.markdown!, "http://127.0.0.1:43120/callback");
  assertEquals(
    setupItems(new AuthError("expired", "expired"), { accessToken: "x" })[0].subtitle,
    "Paste a new user access token",
  );
});
