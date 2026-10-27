import { assertEquals } from "@std/assert";
import { clock, parseGetAll, player, rank } from "./lib.ts";

const OUT =
  `{"type":"a{sv}","data":[{"PlaybackStatus":{"type":"s","data":"Paused"},"Metadata":{"type":"a{sv}","data":{"xesam:title":{"type":"s","data":"Get Lucky"},"xesam:artist":{"type":"as","data":["Daft Punk","Pharrell"]},"mpris:length":{"type":"x","data":248000000}}},"Volume":{"type":"d","data":0.5},"Position":{"type":"x","data":61000000},"CanGoNext":{"type":"b","data":true}}]}`;

Deno.test("busctl GetAll output", () => {
  const p = player("org.mpris.MediaPlayer2.spotify", parseGetAll(OUT), { Identity: "Spotify" });
  assertEquals(p.title, "Get Lucky");
  assertEquals(p.artist, "Daft Punk, Pharrell");
  assertEquals([p.status, p.volume, clock(p.position), clock(p.length)], ["Paused", 0.5, "1:01", "4:08"]);
});

Deno.test("players without metadata and ordering", () => {
  const idle = player("org.mpris.MediaPlayer2.vlc.instance42", {}, {});
  assertEquals([idle.name, idle.title, idle.status], ["vlc", "Nothing playing", "Stopped"]);
  const playing = { ...idle, status: "Playing" as const };
  assertEquals(rank([idle, playing])[0].status, "Playing");
});
