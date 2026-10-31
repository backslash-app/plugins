// Frigate's /api/config, /api/stats and /api/events as plain data. Pure, tested in lib_test.ts.

import { type Color, Icons } from "@backslash/api";

export interface RawCameraConfig {
  enabled?: boolean;
  friendly_name?: string | null;
  detect?: { enabled?: boolean; width?: number; height?: number; fps?: number };
  record?: { enabled?: boolean };
  snapshots?: { enabled?: boolean };
  audio?: { enabled?: boolean };
  objects?: { track?: string[] };
  ui?: { order?: number; dashboard?: boolean };
  zones?: Record<string, unknown>;
}

export interface RawConfig {
  cameras?: Record<string, RawCameraConfig>;
}

export interface RawCameraStats {
  camera_fps?: number;
  process_fps?: number;
  skipped_fps?: number;
  detection_fps?: number;
  detection_enabled?: boolean | number;
  pid?: number;
  capture_pid?: number | null;
}

export interface RawStats {
  cameras?: Record<string, RawCameraStats>;
  service?: { version?: string; uptime?: number; latest_version?: string };
  detectors?: Record<string, { inference_speed?: number }>;
}

export interface Camera {
  name: string;
  title: string;
  enabled: boolean;
  detecting: boolean;
  recording: boolean;
  snapshots: boolean;
  /** Frames per second coming from the camera; 0 when the stream is down. */
  fps?: number;
  detectionFps?: number;
  skippedFps?: number;
  objects: string[];
  zones: string[];
  resolution?: string;
  order: number;
}

export interface RawEvent {
  id: string;
  camera: string;
  label: string;
  sub_label?: string | [string, number] | null;
  top_score?: number | null;
  score?: number | null;
  start_time: number;
  end_time?: number | null;
  has_clip?: boolean;
  has_snapshot?: boolean;
  retain_indefinitely?: boolean;
  zones?: string[];
  data?: { top_score?: number; score?: number; type?: string; description?: string | null } | null;
}

export interface Event {
  id: string;
  camera: string;
  label: string;
  subLabel?: string;
  /** 0 to 1. */
  score?: number;
  /** Unix ms. */
  start: number;
  end?: number;
  hasClip: boolean;
  hasSnapshot: boolean;
  retained: boolean;
  zones: string[];
  description?: string;
}

/** `front_door` → `Front Door`. */
export function prettyName(name: string): string {
  return name.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()).trim();
}

export function parseCameras(config: RawConfig | undefined, stats: RawStats | undefined): Camera[] {
  return Object.entries(config?.cameras ?? {}).map(([name, c], i): Camera => {
    const s = stats?.cameras?.[name];
    return {
      name,
      title: c.friendly_name || prettyName(name),
      enabled: c.enabled !== false,
      // Stats reflect a toggle made at runtime; the config only what is in the file.
      detecting: s?.detection_enabled !== undefined ? Boolean(s.detection_enabled) : c.detect?.enabled !== false,
      recording: Boolean(c.record?.enabled),
      snapshots: Boolean(c.snapshots?.enabled),
      fps: s?.camera_fps,
      detectionFps: s?.detection_fps,
      skippedFps: s?.skipped_fps,
      objects: c.objects?.track ?? ["person"],
      zones: Object.keys(c.zones ?? {}),
      resolution: c.detect?.width && c.detect?.height ? `${c.detect.width}×${c.detect.height}` : undefined,
      order: c.ui?.order ?? 1000 + i,
    };
  }).sort((a, b) => a.order - b.order || a.title.localeCompare(b.title));
}

export function parseEvents(list: RawEvent[]): Event[] {
  return (Array.isArray(list) ? list : []).filter((e) => e?.id && e.camera).map((e) => {
    const sub = Array.isArray(e.sub_label) ? e.sub_label[0] : e.sub_label;
    const score = e.data?.top_score ?? e.top_score ?? e.data?.score ?? e.score ?? undefined;
    return {
      id: e.id,
      camera: e.camera,
      label: e.label,
      subLabel: sub || undefined,
      score: typeof score === "number" ? score : undefined,
      start: Math.round(e.start_time * 1000),
      end: e.end_time ? Math.round(e.end_time * 1000) : undefined,
      hasClip: Boolean(e.has_clip),
      hasSnapshot: Boolean(e.has_snapshot),
      retained: Boolean(e.retain_indefinitely),
      zones: e.zones ?? [],
      description: e.data?.description || undefined,
    };
  }).sort((a, b) => b.start - a.start);
}

/** The newest event of each camera. */
export function latestByCamera(events: Event[]): Map<string, Event> {
  const out = new Map<string, Event>();
  for (const e of events) {
    const seen = out.get(e.camera);
    if (!seen || seen.start < e.start) out.set(e.camera, e);
  }
  return out;
}

export const GROUPS: Record<string, string[]> = {
  people: ["person", "face"],
  vehicles: ["car", "motorcycle", "bicycle", "truck", "bus", "boat", "license_plate", "train", "airplane"],
  animals: [
    "dog",
    "cat",
    "bird",
    "horse",
    "sheep",
    "cow",
    "bear",
    "deer",
    "fox",
    "raccoon",
    "squirrel",
    "rabbit",
    "goat",
    "elephant",
    "zebra",
    "giraffe",
  ],
};

export function inGroup(label: string, group: string | undefined): boolean {
  if (!group || group === "all") return true;
  return GROUPS[group]?.includes(label) ?? false;
}

export function labelIcon(label: string): string {
  if (GROUPS.people.includes(label)) return Icons.person;
  if (GROUPS.vehicles.includes(label)) return Icons.arrowRight;
  if (GROUPS.animals.includes(label)) return Icons.leaf;
  if (label === "package") return Icons.box;
  return Icons.eye;
}

export function labelColor(label: string): Color {
  if (GROUPS.people.includes(label)) return "blue";
  if (GROUPS.vehicles.includes(label)) return "purple";
  if (GROUPS.animals.includes(label)) return "green";
  return "orange";
}

/** "Person (Ada)", "Car". */
export function eventTitle(e: Event): string {
  const label = prettyName(e.label);
  return e.subLabel ? `${label} (${e.subLabel})` : label;
}

/** Camera health from its frame rate: down (0 fps), detecting, or not. */
export function cameraLook(c: Camera): { label: string; color: Color } {
  if (!c.enabled) return { label: "Disabled", color: "gray" };
  if (c.fps !== undefined && c.fps < 0.1) return { label: "No signal", color: "red" };
  if (!c.detecting) return { label: "Detection off", color: "orange" };
  return { label: "Detecting", color: "green" };
}

// ---------------------------------------------------------------------------
// Formatting

export function ago(ms: number | undefined, now = Date.now()): string {
  if (!ms) return "";
  const s = Math.round((now - ms) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export function duration(ms: number | undefined): string {
  if (ms === undefined || ms < 0) return "";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return m < 60 ? `${m}m ${s % 60}s` : `${Math.floor(m / 60)}h ${m % 60}m`;
}

export const percent = (score: number | undefined) => score === undefined ? "" : `${Math.round(score * 100)} %`;

export function fps(value: number | undefined): string {
  if (value === undefined) return "";
  return `${value >= 10 ? Math.round(value) : value.toFixed(1)} fps`;
}

/** Frigate's version without the build hash: "0.14.1-f4f3cfa" → "0.14.1". */
export const version = (v: string | undefined) => v?.split("-")[0];

/** The file name of a live snapshot, per camera and minute-ish moment, so a fresh one is never mistaken for a stale one. */
export function snapshotName(camera: string, at: number): string {
  return `${camera.replace(/[^\w-]/g, "_")}-${Math.floor(at / 1000)}.jpg`;
}

/** The camera a cached snapshot file belongs to, and when it was taken. */
export function parseSnapshotName(file: string): { camera: string; at: number } | undefined {
  const m = /^(.+)-(\d+)\.jpg$/.exec(file);
  return m ? { camera: m[1], at: Number(m[2]) * 1000 } : undefined;
}

/** Frigate's camera and event ids are safe in a path; anything else is refused. */
export const safeId = (id: string) => /^[\w.-]+$/.test(id);
