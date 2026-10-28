// Home Assistant entities as launcher items: state, icon, attributes, and the services to call.

import {
  type Accessory,
  type Action,
  action,
  type Color,
  type Context,
  copy,
  Icons,
  type Item,
  meta,
  type Metadata,
  open,
  refresh,
  type Stat,
  submenu,
  toast,
} from "@backslash/api";
import { ha, type Server, server } from "./api.ts";

export interface Entity {
  entity_id: string;
  state: string;
  attributes: Record<string, any>;
  last_changed: string;
  last_updated: string;
}

export const domainOf = (e: Pick<Entity, "entity_id">) => e.entity_id.split(".")[0];
export const nameOf = (e: Entity) => String(e.attributes.friendly_name ?? e.entity_id);
/** Scenes and buttons are "unknown" until first used: that is not a problem. */
const STATELESS = ["scene", "button", "input_button"];
const unavailable = (e: Entity) =>
  e.state === "unavailable" || (e.state === "unknown" && !STATELESS.includes(domainOf(e)));

// ---------------------------------------------------------------------------
// Domains

/** Sections, in this order; `kind` decides the filter they appear in. */
export const DOMAINS: Record<string, { title: string; kind: "control" | "sensor" | "other" }> = {
  light: { title: "Lights", kind: "control" },
  switch: { title: "Switches", kind: "control" },
  input_boolean: { title: "Toggles", kind: "control" },
  fan: { title: "Fans", kind: "control" },
  cover: { title: "Covers", kind: "control" },
  climate: { title: "Climate", kind: "control" },
  media_player: { title: "Media Players", kind: "control" },
  lock: { title: "Locks", kind: "control" },
  vacuum: { title: "Vacuums", kind: "control" },
  scene: { title: "Scenes", kind: "control" },
  script: { title: "Scripts", kind: "control" },
  automation: { title: "Automations", kind: "control" },
  button: { title: "Buttons", kind: "control" },
  input_button: { title: "Buttons", kind: "control" },
  sensor: { title: "Sensors", kind: "sensor" },
  binary_sensor: { title: "Binary Sensors", kind: "sensor" },
  weather: { title: "Weather", kind: "sensor" },
  person: { title: "People", kind: "other" },
  device_tracker: { title: "Devices", kind: "other" },
};

const ORDER = Object.keys(DOMAINS);

export function sectionOf(e: Entity): string {
  const domain = domainOf(e);
  return DOMAINS[domain]?.title ?? domain.split("_").map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");
}

export function matchesFilter(e: Entity, filter: string | undefined): boolean {
  const kind = DOMAINS[domainOf(e)]?.kind ?? "other";
  if (filter === "sensors") return kind === "sensor";
  if (filter === "all") return true;
  return kind === "control";
}

/** By section, then by name. */
export function sortEntities(entities: Entity[]): Entity[] {
  const rank = (e: Entity) => {
    const i = ORDER.indexOf(domainOf(e));
    return i === -1 ? ORDER.length : i;
  };
  return [...entities].sort((a, b) =>
    rank(a) - rank(b) || sectionOf(a).localeCompare(sectionOf(b)) || nameOf(a).localeCompare(nameOf(b))
  );
}

// ---------------------------------------------------------------------------
// Looks

const brightnessPct = (e: Entity) =>
  typeof e.attributes.brightness === "number" ? Math.round(e.attributes.brightness / 255 * 100) : undefined;

const unit = (e: Entity) => String(e.attributes.unit_of_measurement ?? "");

function withUnit(value: string | number, u: string): string {
  if (!u) return String(value);
  return u === "%" || u.startsWith("°") ? `${value}${u === "%" ? "%" : ` ${u}`}` : `${value} ${u}`;
}

const BINARY: Record<string, [string, string]> = {
  door: ["Open", "Closed"],
  window: ["Open", "Closed"],
  garage_door: ["Open", "Closed"],
  opening: ["Open", "Closed"],
  motion: ["Detected", "Clear"],
  occupancy: ["Detected", "Clear"],
  presence: ["Home", "Away"],
  moisture: ["Wet", "Dry"],
  smoke: ["Detected", "Clear"],
  gas: ["Detected", "Clear"],
  carbon_monoxide: ["Detected", "Clear"],
  safety: ["Unsafe", "Safe"],
  problem: ["Problem", "OK"],
  battery: ["Low", "Normal"],
  connectivity: ["Connected", "Disconnected"],
  lock: ["Unlocked", "Locked"],
  plug: ["Plugged in", "Unplugged"],
  running: ["Running", "Not running"],
  update: ["Update available", "Up to date"],
};

const capitalize = (s: string) => s.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

/** "On · 70%", "21.5 °C", "Heating · 19.5 → 21 °", "Playing · Daft Punk – One More Time". */
export function stateText(e: Entity): string {
  const a = e.attributes;
  if (e.state === "unavailable") return "Unavailable";
  if (e.state === "unknown" && !STATELESS.includes(domainOf(e))) return "Unknown";
  switch (domainOf(e)) {
    case "light": {
      const pct = brightnessPct(e);
      return e.state === "on" && pct !== undefined ? `On · ${pct}%` : capitalize(e.state);
    }
    case "cover":
      return typeof a.current_position === "number" && e.state === "open"
        ? `Open · ${a.current_position}%`
        : capitalize(e.state);
    case "climate": {
      const action = a.hvac_action ? capitalize(a.hvac_action) : capitalize(e.state);
      if (e.state === "off") return "Off";
      const now = a.current_temperature != null ? `${a.current_temperature}°` : "";
      const target = a.temperature != null
        ? `${a.temperature}°`
        : a.target_temp_low != null
        ? `${a.target_temp_low}–${a.target_temp_high}°`
        : "";
      return [action, [now, target].filter(Boolean).join(" → ")].filter(Boolean).join(" · ");
    }
    case "media_player": {
      const what = [a.media_artist, a.media_title].filter(Boolean).join(" – ");
      return what && ["playing", "paused"].includes(e.state) ? `${capitalize(e.state)} · ${what}` : capitalize(e.state);
    }
    case "sensor": {
      const n = Number(e.state);
      const value = Number.isFinite(n) && e.state.trim() !== ""
        ? String(Math.round(n * 100) / 100)
        : a.device_class === "timestamp"
        ? new Date(e.state).toLocaleString("en", { dateStyle: "medium", timeStyle: "short" })
        : e.state;
      return withUnit(value, unit(e));
    }
    case "binary_sensor": {
      const words = BINARY[a.device_class ?? ""] ?? ["On", "Off"];
      return e.state === "on" ? words[0] : words[1];
    }
    case "scene":
      return "Scene";
    case "script":
      return e.state === "on" ? "Running" : "Script";
    case "automation":
      return e.state === "on" ? "Enabled" : "Disabled";
    case "button":
    case "input_button":
      return "Button";
    case "person":
    case "device_tracker":
      return e.state === "home" ? "Home" : e.state === "not_home" ? "Away" : capitalize(e.state);
    case "weather":
      return [
        capitalize(e.state.replace("partlycloudy", "partly cloudy").replace("clear-night", "clear")),
        a.temperature != null ? `${a.temperature}${a.temperature_unit ?? "°"}` : "",
      ].filter(Boolean).join(" · ");
    default:
      return withUnit(capitalize(e.state), unit(e));
  }
}

type Look = { source: string; tint: Color };

function sensorIcon(e: Entity): Look {
  const n = Number(e.state);
  switch (e.attributes.device_class) {
    case "temperature":
      return { source: Icons.thermometer, tint: "orange" };
    case "humidity":
    case "moisture":
      return { source: Icons.droplet, tint: "blue" };
    case "battery":
      return { source: Icons.battery, tint: n <= 20 ? "red" : n <= 50 ? "orange" : "green" };
    case "power":
    case "energy":
    case "current":
    case "voltage":
    case "apparent_power":
      return { source: Icons.bolt, tint: "yellow" };
    case "illuminance":
      return { source: Icons.sun, tint: "yellow" };
    case "carbon_dioxide":
    case "pm25":
    case "pm10":
    case "aqi":
    case "volatile_organic_compounds":
      return { source: Icons.wind, tint: "teal" };
    case "timestamp":
    case "duration":
      return { source: Icons.clock, tint: "gray" };
    case "signal_strength":
      return { source: Icons.wifi, tint: "gray" };
    default:
      return { source: Icons.activity, tint: "gray" };
  }
}

function binaryIcon(e: Entity): Look {
  const on = e.state === "on";
  switch (e.attributes.device_class) {
    case "door":
    case "window":
    case "garage_door":
    case "opening":
      return { source: Icons.window, tint: on ? "orange" : "gray" };
    case "motion":
    case "occupancy":
    case "presence":
      return { source: on ? Icons.eye : Icons.eyeOff, tint: on ? "orange" : "gray" };
    case "moisture":
      return { source: Icons.droplet, tint: on ? "blue" : "gray" };
    case "smoke":
    case "gas":
    case "carbon_monoxide":
    case "safety":
    case "problem":
      return { source: Icons.alert, tint: on ? "red" : "green" };
    case "connectivity":
      return { source: on ? Icons.wifi : Icons.wifiOff, tint: on ? "green" : "red" };
    case "battery":
      return { source: Icons.battery, tint: on ? "red" : "green" };
    case "plug":
    case "power":
      return { source: Icons.plug, tint: on ? "green" : "gray" };
    case "lock":
      return { source: Icons.lock, tint: on ? "orange" : "green" };
    default:
      return { source: Icons.dot, tint: on ? "green" : "gray" };
  }
}

const WEATHER: Record<string, string> = {
  sunny: Icons.sun,
  "clear-night": Icons.moon,
  partlycloudy: Icons.cloudSun,
  cloudy: Icons.cloud,
  rainy: Icons.cloudRain,
  pouring: Icons.cloudRain,
  lightning: Icons.bolt,
  "lightning-rainy": Icons.bolt,
  snowy: Icons.snowflake,
  "snowy-rainy": Icons.snowflake,
  windy: Icons.wind,
  "windy-variant": Icons.wind,
  fog: Icons.cloud,
};

export function entityIcon(e: Entity): Look {
  const on = e.state === "on";
  const look = ((): Look => {
    switch (domainOf(e)) {
      case "light":
        return { source: Icons.lightbulb, tint: on ? "yellow" : "gray" };
      case "switch":
      case "input_boolean":
        return { source: Icons.power, tint: on ? "green" : "gray" };
      case "fan":
        return { source: Icons.wind, tint: on ? "teal" : "gray" };
      case "cover":
        return e.state === "opening"
          ? { source: Icons.arrowUp, tint: "teal" }
          : e.state === "closing"
          ? { source: Icons.arrowDown, tint: "teal" }
          : { source: Icons.window, tint: e.state === "open" ? "teal" : "gray" };
      case "climate": {
        const action = e.attributes.hvac_action ?? e.state;
        const tint: Color = /heat/.test(action)
          ? "orange"
          : /cool/.test(action)
          ? "blue"
          : action === "off"
          ? "gray"
          : "teal";
        return { source: Icons.thermometer, tint };
      }
      case "media_player": {
        const tint: Color = e.state === "playing" ? "green" : e.state === "paused" ? "yellow" : "gray";
        const source = e.attributes.device_class === "tv"
          ? Icons.monitor
          : e.attributes.device_class === "speaker"
          ? Icons.speaker
          : Icons.music;
        return { source, tint };
      }
      case "lock":
        return {
          source: Icons.lock,
          tint: e.state === "locked" ? "green" : e.state === "jammed" ? "red" : "orange",
        };
      case "vacuum":
        return { source: Icons.cycle, tint: e.state === "cleaning" ? "green" : e.state === "error" ? "red" : "gray" };
      case "scene":
        return { source: Icons.sparkle, tint: "purple" };
      case "script":
        return { source: Icons.terminal, tint: on ? "orange" : "blue" };
      case "automation":
        return { source: Icons.bolt, tint: on ? "yellow" : "gray" };
      case "button":
      case "input_button":
        return { source: Icons.dottedCircle, tint: "blue" };
      case "sensor":
        return sensorIcon(e);
      case "binary_sensor":
        return binaryIcon(e);
      case "weather":
        return { source: WEATHER[e.state] ?? Icons.cloudSun, tint: "blue" };
      case "person":
      case "device_tracker":
        return { source: Icons.person, tint: e.state === "home" ? "green" : "gray" };
      case "sun":
        return { source: e.state === "above_horizon" ? Icons.sun : Icons.moon, tint: "yellow" };
      case "update":
        return { source: Icons.download, tint: on ? "orange" : "gray" };
      case "camera":
        return { source: Icons.camera, tint: "gray" };
      case "zone":
        return { source: Icons.pin, tint: "gray" };
      default:
        return { source: Icons.dot, tint: on ? "green" : "gray" };
    }
  })();
  return unavailable(e) ? { ...look, tint: "gray" } : look;
}

// ---------------------------------------------------------------------------
// Detail panel

const SKIP = new Set([
  "friendly_name",
  "icon",
  "entity_picture",
  "supported_features",
  "supported_color_modes",
  "attribution",
  "restored",
  "editable",
  "id",
  "context_id",
  "entity_id",
  "unit_of_measurement",
  "device_class",
  "state_class",
  "hs_color",
  "rgb_color",
  "xy_color",
  "rgbw_color",
  "rgbww_color",
  "min_mireds",
  "max_mireds",
  "color_temp",
  "forecast",
  "media_content_id",
  "media_position_updated_at",
  "user_id",
  "device_trackers",
]);

function attributeValue(key: string, v: unknown): string | undefined {
  if (v == null || v === "") return undefined;
  if (Array.isArray(v)) return v.length && v.length <= 12 ? v.map(String).join(", ") : undefined;
  if (typeof v === "object") return undefined;
  if (key === "brightness" && typeof v === "number") return `${Math.round(v / 255 * 100)}%`;
  if (key === "volume_level" && typeof v === "number") return `${Math.round(v * 100)}%`;
  if (key === "color_temp_kelvin") return `${v} K`;
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v)) {
    return new Date(v).toLocaleString("en", { dateStyle: "medium", timeStyle: "short" });
  }
  return String(v);
}

/** The attributes worth reading, as metadata lines. */
export function attributeLines(e: Entity): Metadata[] {
  return Object.entries(e.attributes)
    .filter(([k]) => !SKIP.has(k))
    .map(([k, v]) => [k, attributeValue(k, v)] as const)
    .filter(([, v]) => v !== undefined)
    .slice(0, 16)
    .map(([k, v]) => meta.text(capitalize(k), v!));
}

export function entityStats(e: Entity): Stat[] {
  const a = e.attributes;
  switch (domainOf(e)) {
    case "light": {
      const pct = brightnessPct(e);
      return [
        { label: "state", value: capitalize(e.state), color: e.state === "on" ? "yellow" : undefined },
        ...(pct !== undefined && e.state === "on" ? [{ label: "brightness", value: `${pct}%` }] : []),
        ...(a.color_temp_kelvin ? [{ label: "white", value: `${a.color_temp_kelvin} K` }] : []),
      ];
    }
    case "climate":
      return [
        ...(a.current_temperature != null ? [{ label: "now", value: `${a.current_temperature}°` }] : []),
        ...(a.temperature != null ? [{ label: "target", value: `${a.temperature}°`, color: "orange" as Color }] : []),
        ...(a.current_humidity != null ? [{ label: "humidity", value: `${a.current_humidity}%` }] : []),
        { label: "mode", value: capitalize(e.state) },
      ];
    case "cover":
      return [
        { label: "state", value: capitalize(e.state) },
        ...(typeof a.current_position === "number" ? [{ label: "position", value: `${a.current_position}%` }] : []),
      ];
    case "media_player":
      return [
        { label: "state", value: capitalize(e.state), color: e.state === "playing" ? "green" : undefined },
        ...(typeof a.volume_level === "number"
          ? [{ label: "volume", value: `${Math.round(a.volume_level * 100)}%` }]
          : []),
      ];
    case "sensor":
      return [{ label: (a.device_class ? capitalize(a.device_class) : "value").toLowerCase(), value: stateText(e) }];
    default:
      return [];
  }
}

/** Since when, in words: "5 min ago", "3 h ago", "2 days ago". */
export function changedAgo(iso: string, now = new Date()): string {
  const s = Math.max(0, (now.getTime() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)} h ago`;
  const days = Math.floor(s / 86_400);
  return `${days} day${days > 1 ? "s" : ""} ago`;
}

export function entityMetadata(e: Entity): Metadata[] {
  const look = entityIcon(e);
  return [
    meta.text("State", stateText(e), { icon: look.source, color: look.tint }),
    meta.text("Entity", e.entity_id, { icon: Icons.hash }),
    ...(e.attributes.device_class ? [meta.text("Class", capitalize(e.attributes.device_class))] : []),
    ...attributeLines(e).length ? [meta.separator(), ...attributeLines(e)] : [],
    meta.separator(),
    meta.text("Changed", changedAgo(e.last_changed), { icon: Icons.clock }),
  ];
}

/** Artwork of what a media player plays (a path on the server, signed by a token in the URL). */
export function pictureOf(e: Entity, base: string): string | undefined {
  const pic = e.attributes.entity_picture;
  if (typeof pic !== "string" || domainOf(e) !== "media_player") return undefined;
  return pic.startsWith("/") ? `${base}${pic}` : pic;
}

// ---------------------------------------------------------------------------
// Services

export async function callService(
  s: Server,
  domain: string,
  service: string,
  data: Record<string, unknown>,
): Promise<void> {
  await ha(s, `/services/${domain}/${service}`, { method: "POST", body: data });
}

/** Feature bits of covers and media players. */
const COVER = { OPEN: 1, CLOSE: 2, SET_POSITION: 4, STOP: 8 };
const MEDIA = { PAUSE: 1, VOLUME_SET: 4, VOLUME_MUTE: 8, PREVIOUS: 16, NEXT: 32, TURN_ON: 128, TURN_OFF: 256 };
const has = (e: Entity, bit: number) => ((e.attributes.supported_features ?? 0) & bit) !== 0;

export const BRIGHTNESS = [10, 25, 50, 75, 100];
export const WHITES = [{ title: "Warm", kelvin: 2700 }, { title: "Neutral", kelvin: 4000 }, {
  title: "Cool",
  kelvin: 6500,
}];

/** Targets around the current one, within the device's range. */
export function temperatureSteps(e: Entity): number[] {
  const a = e.attributes;
  const step = Number(a.target_temp_step ?? 0.5) || 0.5;
  const current = Number(a.temperature ?? a.current_temperature ?? 20);
  const min = Number(a.min_temp ?? 7), max = Number(a.max_temp ?? 35);
  const round = (n: number) => Math.round(n / step) * step;
  const values = [-2, -1, -step, step, 1, 2].map((d) => round(current + d)).filter((t) => t >= min && t <= max);
  return [...new Set(values)].sort((x, y) => x - y);
}

export function entityActions(e: Entity, ctx: Context, s: Server = server(ctx.preferences)): Action[] {
  const domain = domainOf(e);
  const name = nameOf(e);
  const id = e.entity_id;
  const run =
    (title: string, svcDomain: string, service: string, data: Record<string, unknown> = {}, message = title) =>
    async () => {
      await callService(s, svcDomain, service, { entity_id: id, ...data });
      await toast(`${name}: ${message}`, { style: "success" });
      return refresh();
    };
  const svc = (
    title: string,
    service: string,
    o: {
      data?: Record<string, unknown>;
      icon?: string;
      shortcut?: string;
      confirm?: string;
      message?: string;
      destructive?: boolean;
    } = {},
  ) =>
    action(title, run(title, domain, service, o.data, o.message), {
      icon: o.icon,
      shortcut: o.shortcut,
      confirm: o.confirm,
      destructive: o.destructive,
      section: "Control",
    });
  const actions: Action[] = [];
  const toggles = () => {
    actions.push(
      svc("Toggle", "toggle", { icon: Icons.power, message: e.state === "on" ? "off" : "on" }),
      svc("Turn On", "turn_on", { icon: Icons.power, shortcut: "<Ctrl>Up", message: "on" }),
      svc("Turn Off", "turn_off", { icon: Icons.power, shortcut: "<Ctrl>Down", message: "off" }),
    );
  };

  if (!unavailable(e)) {
    switch (domain) {
      case "light":
        toggles();
        actions.push(submenu(
          "Brightness",
          BRIGHTNESS.map((pct) =>
            action(`${pct}%`, run(`${pct}%`, "light", "turn_on", { brightness_pct: pct }, `${pct}%`), {
              icon: Icons.lightbulb,
            })
          ),
          { icon: Icons.sun, shortcut: "<Ctrl>b", section: "Control" },
        ));
        if ((e.attributes.supported_color_modes ?? []).some((m: string) => /color_temp|hs|rgb|xy/.test(m))) {
          actions.push(submenu(
            "White",
            WHITES.map((w) =>
              action(
                w.title,
                run(w.title, "light", "turn_on", { color_temp_kelvin: w.kelvin }, w.title.toLowerCase()),
                {
                  icon: Icons.lightbulb,
                },
              )
            ),
            { icon: Icons.palette, section: "Control" },
          ));
        }
        break;
      case "switch":
      case "input_boolean":
      case "fan":
      case "humidifier":
      case "siren":
        toggles();
        break;
      case "automation":
        actions.push(
          svc("Trigger", "trigger", { icon: Icons.play, message: "triggered" }),
          svc(e.state === "on" ? "Disable" : "Enable", e.state === "on" ? "turn_off" : "turn_on", {
            icon: Icons.power,
            message: e.state === "on" ? "disabled" : "enabled",
          }),
        );
        break;
      case "cover":
        if (e.state !== "open" && has(e, COVER.OPEN)) actions.push(svc("Open", "open_cover", { icon: Icons.arrowUp }));
        if (e.state !== "closed" && has(e, COVER.CLOSE)) {
          actions.push(svc("Close", "close_cover", { icon: Icons.arrowDown }));
        }
        if (e.state === "open" && has(e, COVER.OPEN)) actions.push(svc("Open", "open_cover", { icon: Icons.arrowUp }));
        if (has(e, COVER.STOP)) actions.push(svc("Stop", "stop_cover", { icon: Icons.stop }));
        if (has(e, COVER.SET_POSITION)) {
          actions.push(submenu(
            "Position",
            [0, 25, 50, 75, 100].map((p) =>
              action(`${p}%`, run(`${p}%`, "cover", "set_cover_position", { position: p }, `${p}%`), {
                icon: Icons.window,
              })
            ),
            { icon: Icons.window, shortcut: "<Ctrl>b", section: "Control" },
          ));
        }
        break;
      case "climate": {
        actions.push(submenu(
          "Target Temperature",
          temperatureSteps(e).map((t) =>
            action(`${t}°`, run(`${t}°`, "climate", "set_temperature", { temperature: t }, `${t}°`), {
              icon: Icons.thermometer,
            })
          ),
          { icon: Icons.thermometer, shortcut: "<Ctrl>t", section: "Control" },
        ));
        const modes: string[] = e.attributes.hvac_modes ?? [];
        if (modes.length) {
          actions.push(submenu(
            "Mode",
            modes.map((m) =>
              action(capitalize(m), run(m, "climate", "set_hvac_mode", { hvac_mode: m }, capitalize(m)), {
                icon: m === "off" ? Icons.power : Icons.thermometer,
              })
            ),
            { icon: Icons.settings, shortcut: "<Ctrl>m", section: "Control" },
          ));
        }
        if (e.state !== "off" && modes.includes("off")) {
          actions.push(
            svc("Turn Off", "set_hvac_mode", { data: { hvac_mode: "off" }, icon: Icons.power, message: "off" }),
          );
        }
        break;
      }
      case "media_player": {
        const off = e.state === "off" || e.state === "standby";
        if (!off) {
          actions.push(svc(e.state === "playing" ? "Pause" : "Play", "media_play_pause", {
            icon: e.state === "playing" ? Icons.pause : Icons.play,
            message: e.state === "playing" ? "paused" : "playing",
          }));
          if (has(e, MEDIA.NEXT)) {
            actions.push(svc("Next", "media_next_track", { icon: Icons.next, shortcut: "<Ctrl>Right" }));
          }
          if (has(e, MEDIA.PREVIOUS)) {
            actions.push(svc("Previous", "media_previous_track", { icon: Icons.previous, shortcut: "<Ctrl>Left" }));
          }
          if (has(e, MEDIA.VOLUME_SET)) {
            actions.push(submenu(
              "Volume",
              [0, 20, 40, 60, 80, 100].map((v) =>
                action(`${v}%`, run(`${v}%`, "media_player", "volume_set", { volume_level: v / 100 }, `volume ${v}%`), {
                  icon: Icons.speaker,
                })
              ),
              { icon: Icons.speaker, shortcut: "<Ctrl>v", section: "Control" },
            ));
          }
          if (has(e, MEDIA.VOLUME_MUTE)) {
            const muted = e.attributes.is_volume_muted === true;
            actions.push(svc(muted ? "Unmute" : "Mute", "volume_mute", {
              data: { is_volume_muted: !muted },
              icon: muted ? Icons.speaker : Icons.speakerOff,
              message: muted ? "unmuted" : "muted",
            }));
          }
        }
        if (off && has(e, MEDIA.TURN_ON)) actions.push(svc("Turn On", "turn_on", { icon: Icons.power, message: "on" }));
        if (!off && has(e, MEDIA.TURN_OFF)) {
          actions.push(svc("Turn Off", "turn_off", { icon: Icons.power, message: "off" }));
        }
        break;
      }
      case "lock":
        if (e.state === "locked") {
          actions.push(
            svc("Unlock", "unlock", {
              icon: Icons.lock,
              confirm: `Unlock ${name}?`,
              destructive: true,
              message: "unlocked",
            }),
          );
        } else actions.push(svc("Lock", "lock", { icon: Icons.lock, message: "locked" }));
        break;
      case "vacuum":
        actions.push(
          e.state === "cleaning"
            ? svc("Pause", "pause", { icon: Icons.pause, message: "paused" })
            : svc("Start Cleaning", "start", { icon: Icons.play, message: "cleaning" }),
          svc("Return to Dock", "return_to_base", { icon: Icons.home, message: "returning" }),
        );
        break;
      case "scene":
        actions.push(svc("Activate", "turn_on", { icon: Icons.sparkle, message: "activated" }));
        break;
      case "script":
        actions.push(svc("Run", "turn_on", { icon: Icons.play, message: "started" }));
        if (e.state === "on") actions.push(svc("Stop", "turn_off", { icon: Icons.stop, message: "stopped" }));
        break;
      case "button":
      case "input_button":
        actions.push(svc("Press", "press", { icon: Icons.dottedCircle, message: "pressed" }));
        break;
    }
  }
  actions.push(
    open(`${s.base}/history?entity_id=${encodeURIComponent(id)}`, "Open History", {
      icon: Icons.history,
      section: "Home Assistant",
    }),
    open(`${s.base}/config/entities?search=${encodeURIComponent(id)}`, "Open Entity Settings", {
      icon: Icons.settings,
      section: "Home Assistant",
    }),
    copy(id, "Copy Entity ID", { shortcut: "<Ctrl>period", section: "Copy" }),
    copy(stateText(e), "Copy State", { shortcut: "<Ctrl><Shift>c", section: "Copy" }),
  );
  return actions;
}

export function entityItem(e: Entity, ctx: Context, s: Server = server(ctx.preferences)): Item {
  const accessories: Accessory[] = [];
  if (domainOf(e) === "automation" && e.attributes.last_triggered) {
    accessories.push({ icon: Icons.bolt, text: changedAgo(e.attributes.last_triggered), tooltip: "Last triggered" });
  } else {
    accessories.push({ text: changedAgo(e.last_changed), tooltip: "Last changed" });
  }
  return {
    id: e.entity_id,
    title: nameOf(e),
    subtitle: stateText(e),
    icon: entityIcon(e),
    section: sectionOf(e),
    keywords: [e.entity_id, domainOf(e), e.attributes.device_class ?? "", e.state].filter(Boolean),
    accessories,
    detail: {
      image: pictureOf(e, s.base),
      stats: entityStats(e),
      metadata: entityMetadata(e),
    },
    actions: entityActions(e, ctx, s),
  };
}

/** "3 lights on". */
export function lightsOn(entities: Entity[]): string | null {
  const n = entities.filter((e) => domainOf(e) === "light" && e.state === "on").length;
  return n ? `${n} light${n === 1 ? "" : "s"} on` : null;
}
