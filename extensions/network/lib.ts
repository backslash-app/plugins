// Parsing nmcli, bluetoothctl, pactl and tailscale output. Pure, tested in lib_test.ts.

/** Splits a `nmcli -t` line on unescaped colons and unescapes `\:` and `\\`. */
export function nmcliFields(line: string): string[] {
  const fields: string[] = [];
  let cur = "";
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === "\\" && i + 1 < line.length) cur += line[++i];
    else if (c === ":") {
      fields.push(cur);
      cur = "";
    } else cur += c;
  }
  fields.push(cur);
  return fields;
}

export interface Wifi {
  ssid: string;
  signal: number;
  security: string;
  active: boolean;
}

/** `nmcli -t -f IN-USE,SSID,SIGNAL,SECURITY device wifi list`: strongest per SSID. */
export function parseWifi(out: string): Wifi[] {
  const best = new Map<string, Wifi>();
  for (const line of out.split("\n").filter(Boolean)) {
    const [inUse, ssid, signal, security] = nmcliFields(line);
    if (!ssid) continue; // hidden networks
    const w = {
      ssid,
      signal: Number(signal) || 0,
      security: security === "--" ? "" : security ?? "",
      active: inUse === "*",
    };
    const seen = best.get(ssid);
    if (!seen || w.active || (!seen.active && w.signal > seen.signal)) best.set(ssid, w);
  }
  return [...best.values()].sort((a, b) => Number(b.active) - Number(a.active) || b.signal - a.signal);
}

export interface Connection {
  name: string;
  type: string;
  device: string;
}

/** `nmcli -t -f NAME,TYPE,DEVICE connection show`. */
export function parseConnections(out: string): Connection[] {
  return out.split("\n").filter(Boolean).map((line) => {
    const [name, type, device] = nmcliFields(line);
    return { name, type, device: device ?? "" };
  });
}

export const bars = (
  signal: number,
) => (signal >= 75 ? "▂▄▆█" : signal >= 50 ? "▂▄▆_" : signal >= 25 ? "▂▄__" : "▂___");

export interface Device {
  mac: string;
  name: string;
  icon: string;
  paired: boolean;
  connected: boolean;
  battery?: number;
}

/** `bluetoothctl devices` → MAC and name. */
export function parseDevices(out: string): { mac: string; name: string }[] {
  return out.split("\n").flatMap((line) => {
    const m = line.match(/^Device ([0-9A-F:]{17}) (.*)$/i);
    return m ? [{ mac: m[1], name: m[2] }] : [];
  });
}

/** `bluetoothctl info <mac>`. */
export function parseInfo(mac: string, out: string): Device {
  const field = (k: string) => out.match(new RegExp(`^\\s*${k}: (.*)$`, "m"))?.[1]?.trim();
  const battery = field("Battery Percentage")?.match(/\((\d+)\)/)?.[1];
  return {
    mac,
    name: field("Alias") ?? field("Name") ?? mac,
    icon: field("Icon") ?? "bluetooth",
    paired: field("Paired") === "yes",
    connected: field("Connected") === "yes",
    battery: battery ? Number(battery) : undefined,
  };
}

export interface AudioDevice {
  name: string;
  description: string;
  kind: "output" | "input";
  isDefault: boolean;
  muted: boolean;
}

/** `pactl -f json list sinks|sources`, monitors excluded. */
export function parseAudio(json: string, kind: "output" | "input", defaultName: string): AudioDevice[] {
  return (JSON.parse(json) as any[])
    .filter((d) => !(kind === "input" && (d.monitor_of_sink || String(d.name).endsWith(".monitor"))))
    .map((d) => ({
      name: d.name,
      description: d.description || d.name,
      kind,
      isDefault: d.name === defaultName,
      muted: Boolean(d.mute),
    }));
}

export interface Tailscale {
  running: boolean;
  host: string;
  ip?: string;
  tailnet?: string;
}

/** `tailscale status --json`. */
export function parseTailscale(json: string): Tailscale {
  const s = JSON.parse(json);
  return {
    running: s.BackendState === "Running",
    host: s.Self?.HostName ?? "this device",
    ip: s.Self?.TailscaleIPs?.[0],
    tailnet: s.CurrentTailnet?.Name,
  };
}
