// Talking to PipeWire or PulseAudio through pactl, or WirePlumber's wpctl when pactl is missing.

import {
  clampVolume,
  type Device,
  pactlVersion,
  parseDevices,
  parseInfoDefault,
  parseMute,
  parseStreams,
  parseWpctlStatus,
  parseWpctlVolume,
  type Stream,
  supportsJson,
  wpDevice,
} from "./lib.ts";

/** Runs a program in English (pactl's text output is translated otherwise). */
export async function sh(program: string, args: string[], stdin?: string): Promise<string> {
  const child = new Deno.Command(program, {
    args,
    env: { LC_ALL: "C" },
    stdin: stdin === undefined ? "null" : "piped",
    stdout: "piped",
    stderr: "piped",
    signal: AbortSignal.timeout(15_000),
  }).spawn();
  if (stdin !== undefined) {
    const w = child.stdin.getWriter();
    await w.write(new TextEncoder().encode(stdin));
    await w.close();
  }
  const { code, stdout, stderr } = await child.output();
  const text = (b: Uint8Array) => new TextDecoder().decode(b).trim();
  if (code !== 0) {
    const err = text(stderr) || text(stdout);
    if (/Connection refused|Connection failure|failed to connect|Could not connect/i.test(err)) {
      throw new Error("The sound server is not running: start PipeWire (pipewire-pulse) or PulseAudio");
    }
    throw new Error(err || `${program} exited with ${code}`);
  }
  return text(stdout);
}

const missing = (e: unknown) => e instanceof Deno.errors.NotFound || e instanceof Deno.errors.NotCapable;

export type Backend = { kind: "pactl"; json: boolean } | { kind: "wpctl" };

let detected: Backend | undefined;

/** pactl with JSON (PulseAudio 16+), pactl's text output, or wpctl. */
export async function backend(): Promise<Backend> {
  if (detected) return detected;
  try {
    const version = pactlVersion(await sh("pactl", ["--version"]));
    return (detected = { kind: "pactl", json: supportsJson(version) });
  } catch (e) {
    if (!missing(e)) throw e;
  }
  try {
    await sh("wpctl", ["--help"]);
    return (detected = { kind: "wpctl" });
  } catch (e) {
    if (!missing(e)) throw e;
  }
  throw new Error("Neither pactl nor wpctl is installed: install pipewire-pulse (or pulseaudio-utils) or wireplumber");
}

/** `pactl list <what>`, as JSON when this pactl can, falling back to the text output. */
async function pactlList(b: Backend & { kind: "pactl" }, what: string): Promise<{ text: string; json: boolean }> {
  if (b.json) {
    try {
      return { text: await sh("pactl", ["-f", "json", "list", what]), json: true };
    } catch (e) {
      if (!/format|unrecognized|invalid option|unknown option/i.test((e as Error).message)) throw e;
      b.json = false;
    }
  }
  return { text: await sh("pactl", ["list", what]), json: false };
}

async function pactlDefaults(): Promise<{ sink: string; source: string }> {
  const info = await sh("pactl", ["info"]);
  return { sink: parseInfoDefault(info, "Sink"), source: parseInfoDefault(info, "Source") };
}

export interface Snapshot {
  backend: Backend;
  sources: Device[];
  sinks: Device[];
  streams: Stream[];
}

async function wpctlSnapshot(b: Backend, withStreams: boolean): Promise<Snapshot> {
  const status = parseWpctlStatus(await sh("wpctl", ["status"]));
  const streams = withStreams
    ? await Promise.all(status.streams.map(async (s): Promise<Stream> => {
      const v = parseWpctlVolume(await sh("wpctl", ["get-volume", String(s.id)]).catch(() => ""));
      return {
        index: s.id,
        kind: s.kind,
        app: s.app,
        deviceName: s.target,
        volume: v.volume,
        muted: v.muted,
        corked: false,
      };
    }))
    : [];
  return { backend: b, sources: status.sources.map(wpDevice), sinks: status.sinks.map(wpDevice), streams };
}

/** Devices, and the applications' streams if asked. */
export async function snapshot(withStreams: boolean): Promise<Snapshot> {
  const b = await backend();
  if (b.kind === "wpctl") return wpctlSnapshot(b, withStreams);
  const [defaults, sources, sinks, inputs, outputs] = await Promise.all([
    pactlDefaults(),
    pactlList(b, "sources"),
    pactlList(b, "sinks"),
    withStreams ? pactlList(b, "sink-inputs") : undefined,
    withStreams ? pactlList(b, "source-outputs") : undefined,
  ]);
  return {
    backend: b,
    sources: parseDevices(sources.text, sources.json, defaults.source),
    sinks: parseDevices(sinks.text, sinks.json, defaults.sink),
    streams: [
      ...(inputs ? parseStreams(inputs.text, inputs.json, "playback") : []),
      ...(outputs ? parseStreams(outputs.text, outputs.json, "recording") : []),
    ],
  };
}

// --- Microphones ---------------------------------------------------------------

export async function setDefaultSource(d: Device) {
  const b = await backend();
  if (b.kind === "wpctl") await sh("wpctl", ["set-default", String(d.index)]);
  else await sh("pactl", ["set-default-source", d.name]);
}

export async function setSourceMute(d: Device, muted: boolean) {
  const b = await backend();
  if (b.kind === "wpctl") await sh("wpctl", ["set-mute", String(d.index), muted ? "1" : "0"]);
  else await sh("pactl", ["set-source-mute", d.name, muted ? "1" : "0"]);
}

export async function setSourceVolume(d: Device, volume: number) {
  const v = clampVolume(volume);
  const b = await backend();
  if (b.kind === "wpctl") await sh("wpctl", ["set-volume", String(d.index), (v / 100).toFixed(2)]);
  else await sh("pactl", ["set-source-volume", d.name, `${v}%`]);
}

export async function setSourcePort(d: Device, port: string) {
  await sh("pactl", ["set-source-port", d.name, port]);
}

/** Mutes or unmutes the default microphone; true when it is now muted. */
export async function toggleDefaultMic(): Promise<boolean> {
  const b = await backend();
  if (b.kind === "wpctl") {
    await sh("wpctl", ["set-mute", "@DEFAULT_AUDIO_SOURCE@", "toggle"]);
    return parseWpctlVolume(await sh("wpctl", ["get-volume", "@DEFAULT_AUDIO_SOURCE@"])).muted;
  }
  await sh("pactl", ["set-source-mute", "@DEFAULT_SOURCE@", "toggle"]);
  return parseMute(await sh("pactl", ["get-source-mute", "@DEFAULT_SOURCE@"]));
}

// --- Streams -------------------------------------------------------------------

export async function setStreamVolume(s: Stream, volume: number) {
  const v = clampVolume(volume);
  const b = await backend();
  if (b.kind === "wpctl") await sh("wpctl", ["set-volume", String(s.index), (v / 100).toFixed(2)]);
  else {await sh("pactl", [
      s.kind === "playback" ? "set-sink-input-volume" : "set-source-output-volume",
      String(s.index),
      `${v}%`,
    ]);}
}

export async function setStreamMute(s: Stream, muted: boolean) {
  const b = await backend();
  if (b.kind === "wpctl") await sh("wpctl", ["set-mute", String(s.index), muted ? "1" : "0"]);
  else {
    await sh("pactl", [
      s.kind === "playback" ? "set-sink-input-mute" : "set-source-output-mute",
      String(s.index),
      muted ? "1" : "0",
    ]);
  }
}

/** Moves a stream to another output (or input); pactl only. */
export async function moveStream(s: Stream, device: Device) {
  await sh("pactl", [s.kind === "playback" ? "move-sink-input" : "move-source-output", String(s.index), device.name]);
}
