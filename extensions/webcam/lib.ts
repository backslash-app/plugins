// v4l2-ctl output (devices, capabilities, controls, formats), control names
// and steps, and the ffmpeg snapshot command. No I/O here.

export interface Device {
  name: string;
  /** `usb-0000:00:14.0-1`, `platform:…`. */
  bus: string;
  /** /dev/video* nodes, in order; the first one is usually the camera itself. */
  nodes: string[];
}

/**
 * `v4l2-ctl --list-devices`:
 *
 * ```
 * HD Pro Webcam C920 (usb-0000:00:14.0-1):
 * 	/dev/video0
 * 	/dev/video1
 * 	/dev/media0
 * ```
 */
export function parseDevices(text: string): Device[] {
  const out: Device[] = [];
  let cur: Device | undefined;
  for (const line of text.split("\n")) {
    if (!line.trim() || /^Cannot open device/i.test(line)) continue;
    if (/^\S/.test(line)) {
      const m = /^(.*?)\s*\(([^()]*)\):\s*$/.exec(line) ?? /^(.*?):\s*$/.exec(line);
      cur = m ? { name: m[1].trim(), bus: m[2] ?? "", nodes: [] } : undefined;
      if (cur) out.push(cur);
    } else if (cur) {
      const node = line.trim();
      if (/^\/dev\/video\d+$/.test(node)) cur.nodes.push(node);
    }
  }
  return out.filter((d) => d.nodes.length);
}

export interface Info {
  driver?: string;
  card?: string;
  capture: boolean;
}

/** `v4l2-ctl -d /dev/video0 --info`: the driver and whether this node captures video (not metadata). */
export function parseInfo(text: string): Info {
  const driver = /Driver name\s*:\s*(.+)/.exec(text)?.[1]?.trim();
  const card = /Card type\s*:\s*(.+)/.exec(text)?.[1]?.trim();
  // Device Caps tells what this node does; Capabilities is the whole device.
  const block = /Device Caps\s*:[^\n]*\n((?:[ \t]{2,}.*\n?)*)/.exec(text)?.[1] ??
    /Capabilities\s*:[^\n]*\n((?:[ \t]{2,}.*\n?)*)/.exec(text)?.[1] ?? "";
  const capture = block.split("\n").some((l) => /^\s*Video Capture( Multiplanar)?\s*$/.test(l));
  return { driver, card, capture };
}

export type ControlType = "int" | "bool" | "menu" | "intmenu" | "button" | "int64" | "bitmask" | "string" | string;

export interface Control {
  name: string;
  type: ControlType;
  section: string;
  min?: number;
  max?: number;
  step?: number;
  default?: number;
  value?: number;
  /** For menus, the label of the current value. */
  valueLabel?: string;
  flags: string[];
  menu: { value: number; label: string }[];
}

/**
 * `v4l2-ctl -d /dev/video0 --list-ctrls-menus`:
 *
 * ```
 * User Controls
 *
 *                      brightness 0x00980900 (int)    : min=0 max=255 step=1 default=128 value=128
 *         white_balance_automatic 0x0098090c (bool)   : default=1 value=1
 *            power_line_frequency 0x00980918 (menu)   : min=0 max=2 default=2 value=2 (60 Hz)
 * 				0: Disabled
 * 				1: 50 Hz
 * ```
 *
 * Older versions omit the hex id; `flags=inactive` marks a control its
 * automatic mode overrides.
 */
export function parseControls(text: string): Control[] {
  const out: Control[] = [];
  let section = "Controls";
  let last: Control | undefined;
  for (const raw of text.split("\n")) {
    const line = raw.replace(/\s+$/, "");
    if (!line.trim()) continue;
    const ctrl = /^\s*([a-z0-9_]+)\s+(?:0x[0-9a-f]+\s+)?\(([\w-]+)\)\s*:\s*(.*)$/i.exec(line);
    if (ctrl) {
      let rest = ctrl[3];
      const flags = /flags=(.*)$/.exec(rest);
      if (flags) rest = rest.slice(0, flags.index);
      const label = /value=-?\d+\s+\((.*)\)/.exec(rest)?.[1];
      const kv: Record<string, number> = {};
      for (const m of rest.matchAll(/(\w+)=(-?\d+|0x[0-9a-f]+)/gi)) kv[m[1]] = Number(m[2]);
      last = {
        name: ctrl[1],
        type: ctrl[2],
        section,
        min: kv.min,
        max: kv.max,
        step: kv.step,
        default: kv.default,
        value: kv.value,
        valueLabel: label,
        flags: flags ? flags[1].split(/[,\s]+/).filter(Boolean) : [],
        menu: [],
      };
      out.push(last);
      continue;
    }
    const item = /^\s+(-?\d+):\s*(.+)$/.exec(line);
    if (item && last && (last.type === "menu" || last.type === "intmenu")) {
      last.menu.push({ value: Number(item[1]), label: item[2].trim() });
      continue;
    }
    if (/^\S/.test(line)) {
      section = line.trim();
      last = undefined;
    }
  }
  for (const c of out) {
    if (c.menu.length && c.value !== undefined && !c.valueLabel) {
      c.valueLabel = c.menu.find((m) => m.value === c.value)?.label;
    }
  }
  return out;
}

const NAMES: Record<string, string> = {
  brightness: "Brightness",
  contrast: "Contrast",
  saturation: "Saturation",
  hue: "Hue",
  gamma: "Gamma",
  gain: "Gain",
  sharpness: "Sharpness",
  backlight_compensation: "Backlight Compensation",
  power_line_frequency: "Power Line Frequency",
  white_balance_automatic: "Auto White Balance",
  white_balance_temperature_auto: "Auto White Balance",
  white_balance_temperature: "White Balance",
  auto_exposure: "Auto Exposure",
  exposure_auto: "Auto Exposure",
  exposure_time_absolute: "Exposure",
  exposure_absolute: "Exposure",
  exposure_dynamic_framerate: "Lower Frame Rate in the Dark",
  exposure_auto_priority: "Lower Frame Rate in the Dark",
  focus_absolute: "Focus",
  focus_automatic_continuous: "Autofocus",
  focus_auto: "Autofocus",
  zoom_absolute: "Zoom",
  pan_absolute: "Pan",
  tilt_absolute: "Tilt",
  privacy: "Privacy Shutter",
  led1_mode: "LED",
  hue_automatic: "Auto Hue",
};

/** `exposure_time_absolute` → "Exposure"; unknown ones title-cased. */
export function niceName(name: string): string {
  return NAMES[name] ??
    name.replace(/_absolute$/, "").split("_").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

/** The controls people look for first, in this order; the others after. */
const ORDER = [
  "brightness",
  "contrast",
  "saturation",
  "sharpness",
  "auto_exposure",
  "exposure_auto",
  "exposure_time_absolute",
  "exposure_absolute",
  "gain",
  "focus_automatic_continuous",
  "focus_auto",
  "focus_absolute",
  "zoom_absolute",
  "white_balance_automatic",
  "white_balance_temperature_auto",
  "white_balance_temperature",
  "backlight_compensation",
  "power_line_frequency",
];

export function sortControls(list: Control[]): Control[] {
  const rank = (c: Control) => {
    const i = ORDER.indexOf(c.name);
    return i < 0 ? ORDER.length : i;
  };
  return [...list].sort((a, b) => rank(a) - rank(b));
}

/**
 * The automatic mode that overrides a control, and the value that turns it
 * off: exposure under auto_exposure (1 = manual), focus under autofocus,
 * white balance under auto white balance.
 */
export function autoPartner(name: string, all: Control[]): { control: Control; manual: number } | undefined {
  const pairs: Record<string, [string, number][]> = {
    exposure_time_absolute: [["auto_exposure", 1], ["exposure_auto", 1]],
    exposure_absolute: [["exposure_auto", 1], ["auto_exposure", 1]],
    focus_absolute: [["focus_automatic_continuous", 0], ["focus_auto", 0]],
    white_balance_temperature: [["white_balance_automatic", 0], ["white_balance_temperature_auto", 0]],
    gain: [],
  };
  for (const [partner, manual] of pairs[name] ?? []) {
    const control = all.find((c) => c.name === partner);
    if (control) return { control, manual };
  }
  return undefined;
}

export const isInactive = (c: Control) => c.flags.includes("inactive");
export const isReadOnly = (c: Control) => c.flags.some((f) => f === "read-only" || f === "disabled");

/** A step that moves the value visibly: about a twentieth of the range, a multiple of the control's step. */
export function coarseStep(c: Control): number {
  const step = c.step && c.step > 0 ? c.step : 1;
  if (c.min === undefined || c.max === undefined) return step;
  const twentieth = (c.max - c.min) / 20;
  return Math.max(step, Math.round(twentieth / step) * step);
}

export function clamp(c: Control, v: number): number {
  let x = v;
  if (c.min !== undefined) x = Math.max(c.min, x);
  if (c.max !== undefined) x = Math.min(c.max, x);
  const step = c.step && c.step > 0 ? c.step : 1;
  const base = c.min ?? 0;
  return base + Math.round((x - base) / step) * step;
}

/** 0 to 1 within the control's range. */
export function ratio(c: Control): number | undefined {
  if (c.value === undefined || c.min === undefined || c.max === undefined || c.max === c.min) return undefined;
  return (c.value - c.min) / (c.max - c.min);
}

/** What the row shows: "128", "on", "Aperture Priority Mode". */
export function displayValue(c: Control): string {
  if (c.type === "bool") return c.value ? "on" : "off";
  if (c.valueLabel) return c.valueLabel;
  return c.value === undefined ? "—" : String(c.value);
}

/** The next menu entry after the current one (wrapping), to cycle with Enter. */
export function nextMenuValue(c: Control): number | undefined {
  if (!c.menu.length) return undefined;
  const i = c.menu.findIndex((m) => m.value === c.value);
  return c.menu[(i + 1) % c.menu.length].value;
}

/** A value typed by the user, checked against the range. */
export function parseValue(c: Control, text: string): number {
  const t = text.trim().toLowerCase();
  if (c.type === "bool") {
    if (["1", "on", "true", "yes"].includes(t)) return 1;
    if (["0", "off", "false", "no"].includes(t)) return 0;
    throw new Error("Type on or off");
  }
  const menu = c.menu.find((m) => m.label.toLowerCase() === t);
  if (menu) return menu.value;
  if (!/^-?\d+$/.test(t)) throw new Error(`“${text}” is not a whole number`);
  const v = Number(t);
  if ((c.min !== undefined && v < c.min) || (c.max !== undefined && v > c.max)) {
    throw new Error(`${niceName(c.name)} goes from ${c.min} to ${c.max}`);
  }
  if (c.menu.length && !c.menu.some((m) => m.value === v)) throw new Error(`${v} is not one of the choices`);
  return v;
}

// ---------------------------------------------------------------------------
// Formats

export interface Format {
  fourcc: string;
  description: string;
  sizes: { width: number; height: number; fps: number[] }[];
}

/**
 * `v4l2-ctl -d /dev/video0 --list-formats-ext`:
 *
 * ```
 * 	[1]: 'MJPG' (Motion-JPEG, compressed)
 * 		Size: Discrete 1920x1080
 * 			Interval: Discrete 0.033s (30.000 fps)
 * ```
 */
export function parseFormats(text: string): Format[] {
  const out: Format[] = [];
  let cur: Format | undefined;
  let size: Format["sizes"][number] | undefined;
  for (const line of text.split("\n")) {
    const f = /^\s*\[\d+\]:\s*'([^']+)'\s*\(([^)]*)\)/.exec(line);
    if (f) {
      cur = { fourcc: f[1].trim(), description: f[2].trim(), sizes: [] };
      out.push(cur);
      size = undefined;
      continue;
    }
    const s = /^\s*Size:\s*\w+\s+(\d+)x(\d+)/.exec(line);
    if (s && cur) {
      size = { width: Number(s[1]), height: Number(s[2]), fps: [] };
      cur.sizes.push(size);
      continue;
    }
    const i = /^\s*Interval:.*\(([\d.]+) fps\)/.exec(line);
    if (i && size) size.fps.push(Number(i[1]));
  }
  return out;
}

export interface Capture {
  /** ffmpeg's -input_format: mjpeg, yuyv422… */
  inputFormat?: string;
  size?: string;
}

const FFMPEG_FORMAT: Record<string, string> = { MJPG: "mjpeg", YUYV: "yuyv422", H264: "h264", NV12: "nv12" };

/**
 * What to ask the camera for: the requested size when it can do it
 * (MJPEG preferred), else its largest MJPEG size, else its largest size.
 */
export function bestCapture(formats: Format[], wanted?: string): Capture {
  const area = (s: { width: number; height: number }) => s.width * s.height;
  const usable = formats.filter((f) => FFMPEG_FORMAT[f.fourcc] && f.sizes.length);
  if (!usable.length) return wanted ? { size: wanted } : {};
  const ordered = [...usable].sort((a, b) => Number(b.fourcc === "MJPG") - Number(a.fourcc === "MJPG"));
  if (wanted) {
    for (const f of ordered) {
      if (f.sizes.some((s) => `${s.width}x${s.height}` === wanted)) {
        return { inputFormat: FFMPEG_FORMAT[f.fourcc], size: wanted };
      }
    }
    return { size: wanted };
  }
  const f = ordered[0];
  const biggest = [...f.sizes].sort((a, b) => area(b) - area(a))[0];
  return { inputFormat: FFMPEG_FORMAT[f.fourcc], size: `${biggest.width}x${biggest.height}` };
}

/** "1920x1080", "1920×1080", "1080p" → "1920x1080"; empty → undefined. */
export function parseResolution(text: string): string | undefined {
  const t = text.trim().toLowerCase();
  if (!t) return undefined;
  const p =
    ({ "480p": "640x480", "720p": "1280x720", "1080p": "1920x1080", "1440p": "2560x1440", "4k": "3840x2160" } as Record<
      string,
      string
    >)[t];
  if (p) return p;
  const m = /^(\d{2,5})\s*[x×*]\s*(\d{2,5})$/.exec(t);
  if (!m) throw new Error(`“${text}” is not a resolution: write it like 1920x1080`);
  return `${m[1]}x${m[2]}`;
}

/** The largest size of each format, for the preview: "MJPG 1920×1080 · YUYV 640×480". */
export function formatSummary(formats: Format[]): string {
  return formats.filter((f) => f.sizes.length).map((f) => {
    const b = [...f.sizes].sort((x, y) => y.width * y.height - x.width * x.height)[0];
    return `${f.fourcc} ${b.width}×${b.height}`;
  }).join(" · ");
}

// ---------------------------------------------------------------------------
// Snapshots

const pad = (n: number) => String(n).padStart(2, "0");

/** `webcam-2026-10-31_14-05-09.jpg`, sortable. */
export function snapshotName(d: Date): string {
  return `webcam-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${
    pad(d.getMinutes())
  }-${pad(d.getSeconds())}.jpg`;
}

/**
 * One JPEG from the camera. The first frames are often dark while the
 * automatic exposure settles: `select` skips `skip` of them.
 */
export function ffmpegArgs(device: string, out: string, capture: Capture, skip = 10): string[] {
  return [
    "-hide_banner",
    "-loglevel",
    "error",
    "-f",
    "v4l2",
    ...(capture.inputFormat ? ["-input_format", capture.inputFormat] : []),
    ...(capture.size ? ["-video_size", capture.size] : []),
    "-i",
    device,
    ...(skip > 0 ? ["-vf", `select=gte(n\\,${Math.round(skip)})`] : []),
    "-frames:v",
    "1",
    "-q:v",
    "2",
    "-update",
    "1",
    "-y",
    out,
  ];
}

/** ffmpeg and v4l2-ctl errors, said for people. */
export function explain(message: string): string {
  const m = message.replace(/^[\w.-]+ exited with \d+: /, "").trim();
  if (/Device or resource busy/i.test(m)) return "The camera is in use by another app: close it and try again";
  if (/Permission denied/i.test(m)) {
    return "No permission to use the camera: add yourself to the video group (sudo usermod -aG video $USER), then sign in again";
  }
  if (/No such file or directory|Cannot open device/i.test(m)) return "The camera is gone: is it still plugged in?";
  if (/Inappropriate ioctl|not a capture device|Not a video capture device/i.test(m)) {
    return "This video node doesn't capture images: pick the camera's first /dev/video device";
  }
  if (/Invalid argument|Could not set video options|unsupported/i.test(m)) {
    return "The camera can't do that resolution: clear it in the preferences to use its largest one";
  }
  if (/Numerical result out of range|ERANGE/i.test(m)) return "That value is out of the control's range";
  if (/Input\/output error|EIO|Broken pipe/i.test(m)) {
    return "The camera stopped answering: unplug it and plug it back in";
  }
  return m.split("\n").filter(Boolean).pop() ?? m;
}

/** 14:05, today; or 31 Oct 2026, 14:05. */
export function formatTime(ms: number, now = Date.now()): string {
  const d = new Date(ms);
  const time = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  if (new Date(now).toDateString() === d.toDateString()) return `${time}, today`;
  return `${d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}, ${time}`;
}
