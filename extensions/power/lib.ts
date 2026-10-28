// Parsing power profiles (powerprofilesctl, tuned-adm) and batteries (the
// kernel's power_supply class through udevadm, or upower). Pure, tested in
// lib_test.ts.

// ---------------------------------------------------------------------------
// Profiles

export interface Profile {
  /** As the tool names it: "power-saver", "balanced", "throughput-performance". */
  id: string;
  active: boolean;
  description?: string;
  driver?: string;
  /** Why performance is limited, e.g. "lap-detected" or "high-operating-temperature". */
  degraded?: string;
}

/** `powerprofilesctl list`. */
export function parsePowerProfiles(out: string): Profile[] {
  const profiles: Profile[] = [];
  let cur: Profile | undefined;
  for (const line of out.split("\n")) {
    const head = line.match(/^(\*)?\s*([a-z][a-z0-9-]*):\s*$/);
    if (head) {
      cur = { id: head[2], active: !!head[1] };
      profiles.push(cur);
      continue;
    }
    const kv = cur && line.match(/^\s+(\w+):\s*(.*)$/);
    if (!cur || !kv) continue;
    const v = kv[2].trim();
    if (kv[1] === "CpuDriver" || kv[1] === "Driver") cur.driver = cur.driver ? `${v}, ${cur.driver}` : v;
    else if (kv[1] === "PlatformDriver") cur.driver = cur.driver ? `${cur.driver}, ${v}` : v;
    else if (kv[1] === "Degraded" && v !== "no") cur.degraded = v.match(/\((.*)\)/)?.[1] ?? "yes";
  }
  return profiles;
}

/** `tuned-adm list`: "- balanced   - General non-specialized tuned profile". */
export function parseTuned(out: string): Profile[] {
  const active = out.match(/^Current active profile:\s*(\S+)/m)?.[1];
  return out.split("\n").flatMap((line) => {
    const m = line.match(/^-\s+(\S+)(?:\s+-\s+(.*))?$/);
    return m ? [{ id: m[1], active: m[1] === active, description: m[2]?.trim() }] : [];
  });
}

/** "power-saver" → "Power Saver". */
export const profileName = (id: string) =>
  id.split(/[-_]/).map((w) => (w === "ppd" ? "PPD" : w[0].toUpperCase() + w.slice(1))).join(" ");

/** Cycles power-saver → balanced → performance → power-saver (the order the tool lists, otherwise). */
export function nextProfile(profiles: Profile[]): Profile | undefined {
  const order = ["power-saver", "balanced", "performance"];
  const sorted = profiles.every((p) => order.includes(p.id))
    ? [...profiles].sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id))
    : profiles;
  const i = sorted.findIndex((p) => p.active);
  return sorted.length ? sorted[(i + 1) % sorted.length] : undefined;
}

// ---------------------------------------------------------------------------
// Batteries

export interface Battery {
  id: string;
  model?: string;
  manufacturer?: string;
  technology?: string;
  /** Charging, Discharging, Full, Not charging, Unknown. */
  status: string;
  /** 0–100. */
  capacity?: number;
  /** Wh. */
  energyNow?: number;
  energyFull?: number;
  energyDesign?: number;
  /** W, positive. */
  power?: number;
  /** V. */
  voltage?: number;
  cycles?: number;
  /** Seconds to empty (discharging) or to full (charging). */
  timeLeft?: number;
  /** A peripheral (mouse, headset) rather than the computer's own battery. */
  peripheral: boolean;
  kind?: string;
}

export interface PowerState {
  batteries: Battery[];
  /** Whether a charger is plugged in, when the system says. */
  plugged?: boolean;
}

const micro = (v: string | undefined) => (v === undefined || v === "" ? undefined : Number(v) / 1e6);

/** One power_supply's `POWER_SUPPLY_*` properties (uevent) → a battery. */
export function batteryFromUevent(p: Record<string, string>): Battery | undefined {
  const get = (k: string) => p[`POWER_SUPPLY_${k}`];
  if (get("TYPE") !== "Battery" || get("PRESENT") === "0") return undefined;
  const voltage = micro(get("VOLTAGE_NOW"));
  // Some batteries report charge (µAh) instead of energy (µWh): convert with the voltage.
  const design = micro(get("VOLTAGE_MIN_DESIGN")) ?? voltage;
  const fromCharge = (k: string) => {
    const c = micro(get(k));
    return c !== undefined && design ? c * design : undefined;
  };
  const energyNow = micro(get("ENERGY_NOW")) ?? fromCharge("CHARGE_NOW");
  const energyFull = micro(get("ENERGY_FULL")) ?? fromCharge("CHARGE_FULL");
  const energyDesign = micro(get("ENERGY_FULL_DESIGN")) ?? fromCharge("CHARGE_FULL_DESIGN");
  const powerRaw = micro(get("POWER_NOW")) ?? (() => {
    const i = micro(get("CURRENT_NOW"));
    return i !== undefined && voltage ? i * voltage : undefined;
  })();
  const power = powerRaw === undefined ? undefined : Math.abs(powerRaw);
  const status = get("STATUS") ?? "Unknown";
  const capacity = get("CAPACITY") !== undefined
    ? Number(get("CAPACITY"))
    : energyNow !== undefined && energyFull
    ? Math.round((energyNow / energyFull) * 100)
    : undefined;
  const cycles = get("CYCLE_COUNT") !== undefined ? Number(get("CYCLE_COUNT")) : undefined;
  return {
    id: get("NAME") ?? p.DEVPATH?.split("/").pop() ?? "battery",
    model: get("MODEL_NAME")?.trim() || undefined,
    manufacturer: get("MANUFACTURER")?.trim() || undefined,
    technology: get("TECHNOLOGY") && get("TECHNOLOGY") !== "Unknown" ? get("TECHNOLOGY") : undefined,
    status,
    capacity,
    energyNow,
    energyFull,
    energyDesign,
    power: power && power > 0.05 ? power : undefined,
    voltage,
    cycles: cycles && cycles > 0 ? cycles : undefined,
    timeLeft: timeLeft(status, energyNow, energyFull, power),
    peripheral: get("SCOPE") === "Device",
  };
}

/** Hours of energy left (or to fill), as seconds. */
export function timeLeft(status: string, now?: number, full?: number, power?: number): number | undefined {
  if (!power || power < 0.05 || now === undefined) return undefined;
  if (status === "Discharging") return (now / power) * 3600;
  if (status === "Charging" && full !== undefined && full > now) return ((full - now) / power) * 3600;
  return undefined;
}

/** `udevadm info --export-db` → batteries and whether a charger is online. */
export function parseUdevPower(out: string): PowerState {
  const batteries: Battery[] = [];
  let plugged: boolean | undefined;
  for (const block of out.split(/\n\s*\n/)) {
    const props: Record<string, string> = {};
    for (const line of block.split("\n")) {
      if (!line.startsWith("E: ")) continue;
      const eq = line.indexOf("=");
      if (eq > 3) props[line.slice(3, eq)] = line.slice(eq + 1);
    }
    if (props.SUBSYSTEM !== "power_supply") continue;
    const type = props.POWER_SUPPLY_TYPE;
    if ((type === "Mains" || type?.startsWith("USB")) && props.POWER_SUPPLY_SCOPE !== "Device") {
      if (props.POWER_SUPPLY_ONLINE !== undefined) plugged = !!plugged || props.POWER_SUPPLY_ONLINE === "1";
      continue;
    }
    const b = batteryFromUevent(props);
    if (b) batteries.push(b);
  }
  return { batteries, plugged };
}

/** `upower -i <device>` → a battery (fallback where udev isn't readable). */
export function parseUpower(out: string): Battery | undefined {
  const kv: Record<string, string> = {};
  let kind = "";
  for (const line of out.split("\n")) {
    const m = line.match(/^\s+([a-z][a-z -]*?):\s+(.*)$/);
    if (m) kv[m[1]] = m[2].trim();
    else if (/^\s{2}[a-z-]+\s*$/.test(line)) kind = line.trim();
  }
  if (!kind || kind === "line-power" || kv.present === "no") return undefined;
  const n = (k: string) => (kv[k] ? parseFloat(kv[k].replace(",", ".")) : undefined);
  const duration = (k: string) => {
    const m = kv[k]?.replace(",", ".").match(/([\d.]+)\s*(hours?|minutes?|seconds?|days?)/);
    if (!m) return undefined;
    const f = m[2].startsWith("d") ? 86400 : m[2].startsWith("h") ? 3600 : m[2].startsWith("m") ? 60 : 1;
    return Number(m[1]) * f;
  };
  const state = kv.state ?? "unknown";
  const status = state === "fully-charged"
    ? "Full"
    : state === "pending-charge"
    ? "Not charging"
    : state[0].toUpperCase() + state.slice(1);
  return {
    id: kv["native-path"] ?? kind,
    model: kv.model || undefined,
    manufacturer: kv.vendor || undefined,
    technology: kv.technology && kv.technology !== "unknown" ? kv.technology : undefined,
    status,
    capacity: n("percentage"),
    energyNow: n("energy"),
    energyFull: n("energy-full"),
    energyDesign: n("energy-full-design"),
    power: n("energy-rate") || undefined,
    voltage: n("voltage"),
    cycles: n("charge-cycles") && n("charge-cycles")! > 0 ? n("charge-cycles") : undefined,
    timeLeft: duration("time to empty") ?? duration("time to full"),
    peripheral: kv["power supply"] === "no",
    kind,
  };
}

/** energy_full / energy_full_design, 0–1 (can slightly exceed 1 on new batteries). */
export const health = (b: Battery) =>
  b.energyFull && b.energyDesign ? Math.min(1.1, b.energyFull / b.energyDesign) : undefined;

/** 11520 → "3 h 12 min"; 600 → "10 min". */
export function duration(seconds: number): string {
  const total = Math.round(seconds / 60);
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (!h) return `${m} min`;
  return m ? `${h} h ${String(m).padStart(2, "0")} min` : `${h} h`;
}

/** "Discharging · 3 h 12 min left", "Charging · full in 45 min", "Fully charged". */
export function statusLine(b: Battery): string {
  const t = b.timeLeft && b.timeLeft < 86400 * 2 ? duration(b.timeLeft) : undefined;
  if (b.status === "Discharging") return t ? `${t} left` : "On battery";
  if (b.status === "Charging") return t ? `Charging · full in ${t}` : "Charging";
  if (b.status === "Full") return "Fully charged";
  if (b.status === "Not charging") return "Plugged in, not charging";
  return b.status;
}

export const levelColor = (pct: number | undefined): "green" | "yellow" | "orange" | "red" | "gray" =>
  pct === undefined ? "gray" : pct > 50 ? "green" : pct > 25 ? "yellow" : pct > 10 ? "orange" : "red";

/** The root search line: "Balanced · 82 %". */
export function summary(profile: Profile | undefined, b: Battery | undefined): string | null {
  const parts = [
    profile && profileName(profile.id),
    b?.capacity !== undefined && `${Math.round(b.capacity)} %${b.status === "Charging" ? " ⚡" : ""}`,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}

export const watts = (w: number) => `${w.toFixed(w < 10 ? 1 : 0)} W`;
export const wh = (w: number) => `${w.toFixed(1)} Wh`;
