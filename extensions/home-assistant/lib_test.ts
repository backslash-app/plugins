import { assertEquals } from "@std/assert";
import { parse } from "@std/toml";
import type { Context } from "@backslash/api";
import { AuthError, guarded, HOSTS, isAllowedHost, normalizeUrl, server } from "./api.ts";
import {
  type Entity,
  entityIcon,
  entityItem,
  entityStats,
  lightsOn,
  matchesFilter,
  pictureOf,
  sectionOf,
  sortEntities,
  stateText,
  temperatureSteps,
} from "./lib.ts";

const ctx: Context = {
  args: {},
  preferences: { url: "http://homeassistant.local:8123", token: "eyJ0" },
  query: "",
  signal: new AbortController().signal,
};

const T = new Date(Date.now() - 5 * 60_000).toISOString();
const entity = (entity_id: string, state: string, attributes: Record<string, unknown> = {}): Entity => ({
  entity_id,
  state,
  attributes: { friendly_name: entity_id.split(".")[1].replace(/_/g, " "), ...attributes },
  last_changed: T,
  last_updated: T,
});

// Shaped like `GET /api/states`.
const kitchen = entity("light.kitchen", "on", {
  friendly_name: "Kitchen",
  brightness: 179,
  color_mode: "color_temp",
  color_temp_kelvin: 3000,
  supported_color_modes: ["color_temp"],
  supported_features: 40,
});
const thermostat = entity("climate.living_room", "heat", {
  friendly_name: "Living Room",
  hvac_modes: ["off", "heat", "auto"],
  current_temperature: 19.5,
  temperature: 21,
  min_temp: 7,
  max_temp: 30,
  target_temp_step: 0.5,
  hvac_action: "heating",
});
const blinds = entity("cover.bedroom_blinds", "open", {
  current_position: 40,
  supported_features: 15,
  device_class: "blind",
});
const speaker = entity("media_player.living_room", "playing", {
  friendly_name: "Living Room Speaker",
  media_title: "One More Time",
  media_artist: "Daft Punk",
  volume_level: 0.35,
  is_volume_muted: false,
  entity_picture: "/api/media_player_proxy/media_player.living_room?token=abc&cache=1",
  supported_features: 152_511,
  device_class: "speaker",
});
const temperature = entity("sensor.outdoor_temperature", "12.345", {
  unit_of_measurement: "°C",
  device_class: "temperature",
  state_class: "measurement",
});
const door = entity("binary_sensor.front_door", "on", { device_class: "door" });
const scene = entity("scene.movie_night", "2026-10-27T20:00:00+00:00", { friendly_name: "Movie Night" });

Deno.test("hosts match the manifest and Deno's rules", async () => {
  const manifest = parse(await Deno.readTextFile(new URL("./backslash.toml", import.meta.url))) as {
    permissions: { net: string[] };
  };
  assertEquals(manifest.permissions.net, HOSTS);
  const yes = [
    "homeassistant.local",
    "localhost",
    "192.168.1.20",
    "10.0.0.7",
    "172.20.3.4",
    "100.101.102.103",
    "ha.tail1234.ts.net",
    "abc.ui.nabu.casa",
    "home.duckdns.org",
    "pi.lan",
  ];
  const no = ["ha.example.com", "172.32.0.1", "8.8.8.8", "100.128.0.1", "evil.com"];
  assertEquals(yes.filter((h) => !isAllowedHost(h)), []);
  assertEquals(no.filter((h) => isAllowedHost(h)), []);
});

Deno.test("addresses", () => {
  assertEquals(normalizeUrl("homeassistant.local:8123/"), "http://homeassistant.local:8123");
  assertEquals(normalizeUrl("https://abc.ui.nabu.casa/lovelace/0"), "https://abc.ui.nabu.casa");
  assertEquals(normalizeUrl("http://192.168.1.20:8123/api"), "http://192.168.1.20:8123");
  assertEquals(server(ctx.preferences).base, "http://homeassistant.local:8123");
  let error: AuthError | undefined;
  try {
    server({ url: "https://ha.example.com", token: "t" });
  } catch (e) {
    error = e as AuthError;
  }
  assertEquals(error?.kind, "host");
});

Deno.test("states in words", () => {
  assertEquals(stateText(kitchen), "On · 70%");
  assertEquals(stateText({ ...kitchen, state: "off" }), "Off");
  assertEquals(stateText(thermostat), "Heating · 19.5° → 21°");
  assertEquals(stateText(blinds), "Open · 40%");
  assertEquals(stateText(speaker), "Playing · Daft Punk – One More Time");
  assertEquals(stateText(temperature), "12.35 °C");
  assertEquals(stateText(entity("sensor.battery", "87", { unit_of_measurement: "%" })), "87%");
  assertEquals(stateText(door), "Open");
  assertEquals(stateText(entity("binary_sensor.hall_motion", "off", { device_class: "motion" })), "Clear");
  assertEquals(stateText(scene), "Scene");
  assertEquals(stateText(entity("switch.fan", "unavailable")), "Unavailable");
});

Deno.test("icons", () => {
  assertEquals(entityIcon(kitchen), { source: "bs-lightbulb", tint: "yellow" });
  assertEquals(entityIcon({ ...kitchen, state: "off" }).tint, "gray");
  assertEquals(entityIcon(thermostat), { source: "bs-thermometer", tint: "orange" });
  assertEquals(entityIcon(temperature).source, "bs-thermometer");
  assertEquals(entityIcon(entity("sensor.phone_battery", "15", { device_class: "battery" })), {
    source: "bs-battery",
    tint: "red",
  });
  assertEquals(entityIcon(door), { source: "bs-window", tint: "orange" });
  assertEquals(entityIcon(scene), { source: "bs-sparkle", tint: "purple" });
  assertEquals(entityIcon(entity("light.porch", "unavailable")).tint, "gray");
});

Deno.test("filters, sections and order", () => {
  const all = [temperature, scene, door, speaker, blinds, thermostat, kitchen, entity("sun.sun", "above_horizon")];
  assertEquals(sortEntities(all.filter((e) => matchesFilter(e, "controls"))).map(sectionOf), [
    "Lights",
    "Covers",
    "Climate",
    "Media Players",
    "Scenes",
  ]);
  assertEquals(all.filter((e) => matchesFilter(e, "sensors")).map((e) => e.entity_id), [
    "sensor.outdoor_temperature",
    "binary_sensor.front_door",
  ]);
  assertEquals(sortEntities(all).map(sectionOf).at(-1), "Sun");
  assertEquals(lightsOn(all), "1 light on");
  assertEquals(lightsOn([temperature]), null);
});

Deno.test("light: toggle first, brightness and white presets", () => {
  const item = entityItem(kitchen, ctx);
  const titles = item.actions?.map((a) => a.title);
  assertEquals(titles?.slice(0, 5), ["Toggle", "Turn On", "Turn Off", "Brightness", "White"]);
  const brightness = item.actions?.[3] as { actions: { title: string }[] };
  assertEquals(brightness.actions.map((a) => a.title), ["10%", "25%", "50%", "75%", "100%"]);
  assertEquals(item.detail?.stats, [
    { label: "state", value: "On", color: "yellow" },
    { label: "brightness", value: "70%" },
    { label: "white", value: "3000 K" },
  ]);
  const meta = item.detail?.metadata?.map((m) => [m.label, m.value]) ?? [];
  assertEquals(meta.slice(0, 2), [["State", "On · 70%"], ["Entity", "light.kitchen"]]);
  assertEquals(meta.some(([l, v]) => l === "Brightness" && v === "70%"), true);
  assertEquals(meta.some(([l]) => l === "Supported color modes" || l === "Friendly name"), false);
});

Deno.test("other domains' actions", () => {
  const first = (e: Entity) => entityItem(e, ctx).actions?.map((a) => a.title).slice(0, 4);
  assertEquals(first(thermostat), ["Target Temperature", "Mode", "Turn Off", "Open History"]);
  assertEquals(temperatureSteps(thermostat), [19, 20, 20.5, 21.5, 22, 23]);
  assertEquals(first(blinds), ["Close", "Open", "Stop", "Position"]);
  assertEquals(first(speaker), ["Pause", "Next", "Previous", "Volume"]);
  assertEquals(first(scene)?.[0], "Activate");
  // Never activated yet.
  assertEquals(first({ ...scene, state: "unknown" })?.[0], "Activate");
  assertEquals(stateText({ ...scene, state: "unknown" }), "Scene");
  assertEquals(first(entity("script.good_night", "off"))?.[0], "Run");
  const lock = entityItem(entity("lock.front_door", "locked"), ctx).actions?.[0];
  assertEquals([lock?.title, lock?.destructive, lock?.confirm], ["Unlock", true, "Unlock front door?"]);
  assertEquals(first(temperature), ["Open History", "Open Entity Settings", "Copy Entity ID", "Copy State"]);
  assertEquals(first(entity("light.porch", "unavailable"))?.[0], "Open History");
});

Deno.test("media artwork from the server", () => {
  assertEquals(
    pictureOf(speaker, "http://homeassistant.local:8123"),
    "http://homeassistant.local:8123/api/media_player_proxy/media_player.living_room?token=abc&cache=1",
  );
  assertEquals(entityStats(speaker).map((s) => s.value), ["Playing", "35%"]);
});

Deno.test("a rejected token becomes a setup row with a link to the profile", async () => {
  const items = await guarded(() =>
    Promise.reject(new AuthError("Home Assistant rejected the access token", "http://homeassistant.local:8123"))
  );
  assertEquals(items[0].id, "setup");
  assertEquals(
    (items[0].actions?.[0] as { target: string }).target,
    "http://homeassistant.local:8123/profile/security",
  );
});
