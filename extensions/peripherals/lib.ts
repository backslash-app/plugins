// Batteries of mice, keyboards, headsets and gamepads from UPower, Solaar and HeadsetControl.

export type Source = "UPower" | "Solaar" | "HeadsetControl";

export interface Peripheral {
  id: string;
  name: string;
  /** UPower's kind: mouse, keyboard, headset, gaming-input… */
  kind: string;
  /** 0 to 100, when the device reports one. */
  percentage?: number;
  /** A coarse level instead (some mice): low, normal, high, full, critical. */
  level?: string;
  state: "charging" | "discharging" | "full" | "pending" | "off" | "unknown";
  source: Source;
  vendor?: string;
  model?: string;
  serial?: string;
  /** UPower's object path, the device path of Solaar, the USB ids of HeadsetControl. */
  path?: string;
  nativePath?: string;
  bluetooth?: boolean;
  /** Seconds since the device last reported, per UPower. */
  updated?: string;
  rechargeable?: boolean;
  /** HeadsetControl's capabilities: sidetone, lights, inactive time, chatmix… */
  capabilities?: string[];
}

// ---------------------------------------------------------------------------
// Kinds

const KIND_NAMES: Record<string, string> = {
  mouse: "Mouse",
  keyboard: "Keyboard",
  headset: "Headset",
  headphones: "Headphones",
  "other-audio": "Audio Device",
  speakers: "Speakers",
  "gaming-input": "Gamepad",
  pen: "Pen",
  touchpad: "Touchpad",
  tablet: "Tablet",
  phone: "Phone",
  "media-player": "Media Player",
  computer: "Computer",
  ups: "UPS",
  monitor: "Monitor",
  "remote-control": "Remote",
  wearable: "Wearable",
  toy: "Toy",
  printer: "Printer",
  scanner: "Scanner",
  camera: "Camera",
  "bluetooth-generic": "Bluetooth Device",
  battery: "Battery",
  trackball: "Trackball",
  numpad: "Number Pad",
  presenter: "Presenter",
  receiver: "Receiver",
};

export const kindName = (kind: string) =>
  KIND_NAMES[kind] ?? kind.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

/** Solaar's kinds, as UPower names them. */
const SOLAAR_KINDS: Record<string, string> = { trackball: "mouse", touchpad: "touchpad", numpad: "keyboard" };

// ---------------------------------------------------------------------------
// Levels

const LEVEL_PERCENT: Record<string, number> = { critical: 5, low: 20, normal: 55, good: 55, high: 80, full: 100 };

/** The charge to sort and summarize by: the percentage, else the coarse level's middle. */
export function charge(p: Pick<Peripheral, "percentage" | "level">): number | undefined {
  if (p.percentage !== undefined) return p.percentage;
  return p.level ? LEVEL_PERCENT[p.level] : undefined;
}

export type Tint = "red" | "orange" | "yellow" | "green" | "gray";

export function levelTint(p: Pick<Peripheral, "percentage" | "level" | "state">): Tint {
  const c = charge(p);
  if (c === undefined || p.state === "off") return "gray";
  if (c <= 10) return "red";
  if (c <= 25) return "orange";
  if (c <= 50) return "yellow";
  return "green";
}

/** "55 %", or "Low" for coarse levels. */
export function levelText(p: Pick<Peripheral, "percentage" | "level" | "state">): string | undefined {
  if (p.state === "off") return "Off";
  if (p.percentage !== undefined) return `${p.percentage} %`;
  if (p.level) return p.level[0].toUpperCase() + p.level.slice(1);
  return undefined;
}

export const STATE_NAMES: Record<Peripheral["state"], string> = {
  charging: "Charging",
  discharging: "On battery",
  full: "Fully charged",
  pending: "Waiting to charge",
  off: "Off or out of range",
  unknown: "Unknown",
};

function normalizeState(s: string | undefined): Peripheral["state"] {
  const v = (s ?? "").toLowerCase().replace(/^batterystatus\./, "");
  if (/^(re)?charging$|^charge$/.test(v)) return "charging";
  if (/discharg/.test(v)) return "discharging";
  if (/full|fully-charged/.test(v)) return "full";
  if (/pending/.test(v)) return "pending";
  return "unknown";
}

// ---------------------------------------------------------------------------
// UPower: upower --dump

/** Every device of `upower --dump`, the laptop's own battery, AC adapter and summary left out. */
export function parseUpowerDump(text: string): Peripheral[] {
  const out: Peripheral[] = [];
  for (const block of text.split(/^Device: /m).slice(1)) {
    const lines = block.split("\n");
    const path = lines[0].trim();
    const props: Record<string, string> = {};
    let kind = "";
    for (const line of lines.slice(1)) {
      if (/^Daemon:/.test(line)) break;
      const k = /^ {2}([a-z][\w-]*)\s*$/.exec(line);
      if (k) {
        kind = k[1];
        continue;
      }
      const m = /^\s+([\w -]+?):\s+(.*)$/.exec(line);
      if (m) props[m[1].trim()] ??= m[2].trim();
    }
    if (!kind || path.endsWith("/DisplayDevice") || kind === "line-power") continue;
    // The computer's own battery: the Power extension's job.
    if (kind === "battery" && props["power supply"] === "yes") continue;
    if (props.present === "no") continue;

    const pct = /^(\d+(?:\.\d+)?)%(.*)$/.exec(props.percentage ?? "");
    const ignored = pct && /ignored/.test(pct[2]);
    const level = props["battery-level"] && !/^(none|unknown)$/.test(props["battery-level"])
      ? props["battery-level"]
      : undefined;
    const nativePath = props["native-path"];
    const name = props.model || props.vendor || kindName(kind);
    const percentage = pct && !ignored ? Math.round(Number(pct[1])) : undefined;
    out.push({
      id: `upower:${path}`,
      name,
      kind,
      percentage,
      level: percentage === undefined ? level : undefined,
      state: normalizeState(props.state),
      source: "UPower",
      vendor: props.vendor || undefined,
      model: props.model || undefined,
      serial: props.serial || undefined,
      path,
      nativePath,
      bluetooth: /bluez|dev_[0-9A-F]{2}_/i.test(`${nativePath ?? ""} ${path}`),
      updated: /\(([^)]+)\)/.exec(props.updated ?? "")?.[1],
      rechargeable: props.rechargeable ? props.rechargeable === "yes" : undefined,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Solaar (Logitech): solaar show

export function parseSolaar(text: string): Peripheral[] {
  interface Block {
    name: string;
    fields: Record<string, string>;
    battery?: string;
  }
  const blocks: Block[] = [];
  let cur: Block | undefined;
  for (const line of text.split("\n")) {
    if (/^solaar version/i.test(line) || !line.trim()) continue;
    const paired = /^ {2}(\d+): (.+)$/.exec(line);
    if (paired || /^\S/.test(line)) {
      cur = { name: (paired ? paired[2] : line).trim(), fields: {} };
      blocks.push(cur);
      continue;
    }
    if (!cur) continue;
    const battery = /^\s+Battery(?: status)?:?\s*(.*)$/.exec(line);
    if (battery) {
      cur.battery ??= battery[1].trim();
      continue;
    }
    const f = /^\s+([A-Za-z][\w ]*?)\s*:\s*(.*)$/.exec(line);
    if (f && !(f[1] in cur.fields)) cur.fields[f[1]] = f[2].trim();
  }
  return blocks
    .filter((b) => b.fields.Kind)
    .map((b) => {
      const battery = b.battery ?? "";
      const pct = /^(\d+)%/.exec(battery);
      const word = /^(critical|low|good|full|normal|high)\b/i.exec(battery)?.[1].toLowerCase();
      const parts = battery.replace(/\.$/, "").split(/,\s*/);
      const kind = b.fields.Kind.toLowerCase();
      return {
        id: `solaar:${b.fields["Serial number"] ?? b.fields.Serial ?? b.name}`,
        name: b.name,
        kind: SOLAAR_KINDS[kind] ?? kind,
        percentage: pct ? Number(pct[1]) : undefined,
        level: pct ? undefined : word,
        state: /unavailable|offline/i.test(battery) || !battery ? "unknown" : normalizeState(parts[1]),
        source: "Solaar" as const,
        vendor: "Logitech",
        model: b.fields.Codename || undefined,
        serial: b.fields["Serial number"] || b.fields.Serial || undefined,
        path: b.fields["Device path"] && b.fields["Device path"] !== "None" ? b.fields["Device path"] : undefined,
        bluetooth: /bluetooth/i.test(b.fields.Protocol ?? "") || undefined,
      };
    });
}

// ---------------------------------------------------------------------------
// HeadsetControl: headsetcontrol -b -o json (3.x), headsetcontrol -b (2.x)

interface HeadsetJson {
  version?: string;
  device_count?: number;
  devices?: {
    status?: string;
    device?: string;
    vendor?: string;
    product?: string;
    id_vendor?: string;
    id_product?: string;
    capabilities?: string[];
    battery?: { status?: string; level?: number };
  }[];
}

export function parseHeadsetJson(json: string): Peripheral[] {
  const o = JSON.parse(json) as HeadsetJson;
  return (o.devices ?? []).map((d, i) => {
    const status = d.battery?.status ?? "";
    const level = d.battery?.level;
    const state: Peripheral["state"] = status === "BATTERY_CHARGING"
      ? "charging"
      : status === "BATTERY_UNAVAILABLE"
      ? "off"
      : status === "BATTERY_AVAILABLE"
      ? "discharging"
      : "unknown";
    return {
      id: `headsetcontrol:${d.id_vendor ?? ""}:${d.id_product ?? i}`,
      name: d.device || [d.vendor, d.product].filter(Boolean).join(" ") || "Headset",
      kind: "headset",
      percentage: level !== undefined && level >= 0 ? level : undefined,
      state,
      source: "HeadsetControl" as const,
      vendor: d.vendor || undefined,
      model: d.product || undefined,
      path: d.id_vendor && d.id_product
        ? `${d.id_vendor.replace(/^0x/, "")}:${d.id_product.replace(/^0x/, "")}`
        : undefined,
      capabilities: d.capabilities ?? [],
    };
  });
}

/** HeadsetControl 2.x: `Found Logitech G533!` and `Battery: 64%` (or `Charging`, `Unavailable`). */
export function parseHeadsetText(text: string): Peripheral[] {
  const name = /Found (.+?)!/.exec(text)?.[1];
  if (!name) return [];
  const battery = /Battery:\s*(.+)$/m.exec(text)?.[1].trim() ?? "";
  const pct = /^(\d+)%/.exec(battery);
  return [{
    id: `headsetcontrol:${name}`,
    name,
    kind: "headset",
    percentage: pct ? Number(pct[1]) : undefined,
    state: pct
      ? "discharging"
      : /charging/i.test(battery)
      ? "charging"
      : /unavailable/i.test(battery)
      ? "off"
      : "unknown",
    source: "HeadsetControl",
  }];
}

export const SIDETONE_LEVELS: { title: string; value: number }[] = [
  { title: "Off", value: 0 },
  { title: "Low", value: 32 },
  { title: "Medium", value: 64 },
  { title: "High", value: 96 },
  { title: "Maximum", value: 128 },
];

export const has = (p: Peripheral, capability: string) =>
  p.capabilities === undefined || p.capabilities.some((c) => c.toLowerCase() === capability);

// ---------------------------------------------------------------------------
// Together

const GENERIC = /^(wireless|mouse|keyboard|headset|gaming|logitech|bluetooth|the)$/;
const words = (s: string) =>
  new Set(s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter((w) => w && !GENERIC.test(w)));

/** Every word of the shorter name is in the longer one. */
function within(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false;
  const [x, y] = [words(a), words(b)];
  const [small, big] = x.size <= y.size ? [x, y] : [y, x];
  return small.size >= 1 && [...small].every((w) => big.has(w)) && (small.size >= 2 || /\d/.test([...small][0]));
}

/** Whether two names likely describe the same device: "MX Master 3" and "MX Master 3 Wireless Mouse". */
export function sameDevice(a: Peripheral, b: Peripheral): boolean {
  if (a.serial && b.serial && a.serial.toLowerCase() === b.serial.toLowerCase()) return true;
  return within(a.name, b.name) || within(a.model, b.name) || within(a.name, b.model) || within(a.model, b.model);
}

/** UPower first; Solaar and HeadsetControl add what it doesn't know (and their controls). */
export function merge(upower: Peripheral[], solaar: Peripheral[], headsets: Peripheral[]): Peripheral[] {
  const out = [...upower];
  for (const s of solaar) {
    const twin = out.find((u) => sameDevice(u, s));
    if (!twin) out.push(s);
    else if (twin.percentage === undefined && s.percentage !== undefined) {
      Object.assign(twin, { percentage: s.percentage, level: undefined });
    }
  }
  for (const h of headsets) {
    const i = out.findIndex((u) => (u.kind === "headset" || u.kind === "headphones") && sameDevice(u, h));
    // HeadsetControl knows the controls: it replaces UPower's entry.
    if (i >= 0) out.splice(i, 1, { ...out[i], ...h, percentage: h.percentage ?? out[i].percentage });
    else out.push(h);
  }
  return out;
}

/** Low battery first, devices without a level last. */
export function sortByCharge(list: Peripheral[]): Peripheral[] {
  return [...list].sort((a, b) => {
    const ca = a.state === "off" ? undefined : charge(a);
    const cb = b.state === "off" ? undefined : charge(b);
    if (ca === undefined && cb === undefined) return a.name.localeCompare(b.name);
    if (ca === undefined) return 1;
    if (cb === undefined) return -1;
    return ca - cb || a.name.localeCompare(b.name);
  });
}

/** The device lowest on battery, as the root search shows it: "Mouse 12 %". */
export function lowestSummary(list: Peripheral[]): string | undefined {
  const [low] = sortByCharge(
    list.filter((p) => p.state !== "charging" && p.state !== "off" && charge(p) !== undefined),
  );
  if (!low) return undefined;
  return `${kindName(low.kind)} ${levelText(low)}`;
}

/** One line to paste: "MX Master 3 (Mouse): 55 %, on battery". */
export function infoLine(p: Peripheral): string {
  const level = levelText(p);
  return `${p.name} (${kindName(p.kind)})${level ? `: ${level}` : ""}, ${STATE_NAMES[p.state].toLowerCase()}`;
}
