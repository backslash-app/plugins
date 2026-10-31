// Rows of the OBS views: outputs, scenes and audio inputs, with their actions.

import {
  type Action,
  action,
  close,
  type Context,
  copy,
  Icons,
  type Item,
  meta,
  type Metadata,
  open,
  openExternal,
  submenu,
  toast,
} from "@backslash/api";
import type { ObsClient } from "./api.ts";
import {
  type AudioInput,
  audioKind,
  basename,
  dirname,
  dropped,
  formatBytes,
  formatDb,
  formatDuration,
  kindLabel,
  NOT_RUNNING,
  type Scene,
  SPECIAL_NAMES,
  type Status,
  tilde,
} from "./lib.ts";
import { HOME, lastRecording, obsDesktopFile, setLastRecording, startObs, toggleRecording } from "./system.ts";

// The live list wakes up after an action instead of waiting for its next tick.
const changes = new EventTarget();
export const changed = () => changes.dispatchEvent(new Event("change"));

export function nextChange(signal: AbortSignal, ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => done(), ms);
    const done = () => {
      clearTimeout(timer);
      changes.removeEventListener("change", done);
      signal.removeEventListener("abort", done);
      resolve();
    };
    changes.addEventListener("change", done);
    signal.addEventListener("abort", done);
  });
}

/** Runs a request from an action: a toast says what went wrong, the list refreshes. */
function act(title: string, fn: () => Promise<string | void>, options: Parameters<typeof action>[2] = {}): Action {
  return action(title, async () => {
    try {
      const said = await fn();
      if (said) await toast(said, { style: "success" });
    } catch (e) {
      await toast((e as Error).message, { style: "failure" });
    }
    changed();
  }, options);
}

// ---------------------------------------------------------------------------
// Not connected

export async function offlineItem(message: string, ctx: Pick<Context, "preferences">): Promise<Item> {
  const refused = /password/i.test(message);
  const offline = message === NOT_RUNNING;
  const installed = offline ? !!(await obsDesktopFile()) : false;
  const steps = [
    `**${message}**`,
    "",
    "To connect Backslash:",
    "",
    "1. In OBS, open **Tools → WebSocket Server Settings**.",
    "2. Tick **Enable WebSocket server** (port 4455 by default).",
    "3. With **Enable Authentication** on, click **Show Connect Info** and copy the password into **Settings → Extensions → OBS Studio**.",
    "",
    `Backslash connects to \`${String(ctx.preferences.url || "ws://localhost:4455")}\`.`,
  ];
  return {
    id: "offline",
    title: refused ? "OBS refused the password" : offline ? "OBS isn't reachable" : "Can't talk to OBS",
    subtitle: offline ? "Start OBS, and turn on its WebSocket server" : message,
    icon: { source: refused ? Icons.key : Icons.plug, tint: refused ? "orange" : "red" },
    detail: { markdown: steps.join("\n") },
    actions: [
      ...(installed
        ? [act("Start OBS", async () => {
          await startObs();
          return "Starting OBS…";
        }, { icon: Icons.play })]
        : []),
      action("Try Again", () => {
        changed();
      }, { icon: Icons.refresh, shortcut: "<Ctrl>r" }),
    ],
  };
}

// ---------------------------------------------------------------------------
// Outputs

function statsLines(st: Status): Metadata[] {
  const s = st.stats;
  const lines: Metadata[] = [];
  if (s.fps !== undefined) lines.push(meta.text("Frame rate", `${s.fps.toFixed(1)} fps`));
  if (s.cpu !== undefined) lines.push(meta.text("CPU", `${s.cpu.toFixed(1)} %`, { icon: Icons.cpu }));
  if (s.memory !== undefined) lines.push(meta.text("Memory", `${Math.round(s.memory)} MB`));
  const render = dropped(s.renderSkipped, s.renderTotal);
  if (render) lines.push(meta.text("Render lag", render, { color: "orange" }));
  if (s.disk !== undefined) {
    lines.push(meta.text("Free disk", formatBytes(s.disk * 1024 * 1024), { icon: Icons.drive }));
  }
  return lines;
}

export async function recordingItem(obs: ObsClient, st: Status): Promise<Item> {
  const r = st.record;
  const last = await lastRecording();
  const state = !r.active ? "Not recording" : r.paused ? "Paused" : "Recording";
  const actions: Action[] = [
    act(r.active ? "Stop Recording" : "Start Recording", async () => {
      const res = await toggleRecording(obs);
      return res.active ? "Recording started" : `Recording saved${res.path ? `: ${basename(res.path)}` : ""}`;
    }, { icon: r.active ? Icons.stop : Icons.dottedCircle }),
  ];
  if (r.active) {
    actions.push(act(r.paused ? "Resume Recording" : "Pause Recording", async () => {
      await obs.request(r.paused ? "ResumeRecord" : "PauseRecord");
    }, { icon: r.paused ? Icons.play : Icons.pause, shortcut: "<Ctrl>p" }));
    actions.push(act("Split Recording File", async () => {
      await obs.request("SplitRecordFile");
      return "Recording continues in a new file";
    }, { icon: Icons.layers }));
  }
  if (last) {
    actions.push(open(last, "Open Last Recording", { icon: Icons.film, shortcut: "<Ctrl>o" }));
    actions.push(open(dirname(last), "Show Recordings Folder", { icon: Icons.folder, shortcut: "<Ctrl>f" }));
  } else {
    actions.push(act("Open Recordings Folder", async () => {
      const res = await obs.request("GetRecordDirectory");
      if (res.recordDirectory) await openExternal(String(res.recordDirectory));
    }, { icon: Icons.folder, shortcut: "<Ctrl>f" }));
  }
  if (last) actions.push(copy(last, "Copy Last Recording Path", { section: "Copy" }));
  const lines: Metadata[] = [
    meta.text("State", state, { color: r.active ? (r.paused ? "yellow" : "red") : undefined }),
  ];
  if (r.active) {
    lines.push(meta.text("Length", formatDuration(r.duration), { icon: Icons.clock }));
    lines.push(meta.text("Size", formatBytes(r.bytes)));
  }
  if (last) lines.push(meta.text("Last recording", tilde(last, HOME), { icon: Icons.film }));
  lines.push(meta.separator(), ...statsLines(st));
  return {
    id: "record",
    title: "Recording",
    subtitle: r.active ? `${state} · ${formatDuration(r.duration)} · ${formatBytes(r.bytes)}` : "Not recording",
    icon: {
      source: r.paused ? Icons.pause : Icons.dottedCircle,
      tint: r.active ? (r.paused ? "yellow" : "red") : "gray",
    },
    section: "Outputs",
    keywords: ["record", "enregistrer", "rec"],
    tags: r.active ? [r.paused ? "PAUSED" : "REC"] : undefined,
    detail: { metadata: lines },
    actions,
  };
}

export function streamingItem(obs: ObsClient, st: Status): Item {
  const s = st.stream;
  const drop = dropped(s.skippedFrames, s.totalFrames);
  const state = !s.active ? "Offline" : s.reconnecting ? "Reconnecting…" : "Live";
  const lines: Metadata[] = [
    meta.text("State", state, { color: s.active ? (s.reconnecting ? "orange" : "red") : undefined }),
  ];
  if (s.active) {
    lines.push(meta.text("Live for", formatDuration(s.duration), { icon: Icons.clock }));
    lines.push(meta.text("Sent", formatBytes(s.bytes), { icon: Icons.upload }));
    if (s.congestion !== undefined) {
      lines.push(meta.progress("Congestion", s.congestion, `${Math.round(s.congestion * 100)} %`));
    }
    if (drop) lines.push(meta.text("Dropped frames", `${s.skippedFrames} (${drop})`, { color: "orange" }));
  }
  lines.push(meta.separator(), ...statsLines(st));
  return {
    id: "stream",
    title: "Streaming",
    subtitle: s.active
      ? [state, formatDuration(s.duration), drop ? `${drop} dropped` : ""].filter(Boolean).join(" · ")
      : "Offline",
    icon: { source: Icons.radio, tint: s.active ? (s.reconnecting ? "orange" : "red") : "gray" },
    section: "Outputs",
    keywords: ["stream", "live", "twitch", "youtube", "diffuser", "direct"],
    tags: s.active ? ["LIVE"] : undefined,
    detail: { metadata: lines },
    actions: [
      act(
        s.active ? "Stop Streaming" : "Start Streaming",
        async () => {
          await obs.request(s.active ? "StopStream" : "StartStream");
          return s.active ? "Stream ended" : "Going live…";
        },
        s.active
          ? { icon: Icons.stop, destructive: true, confirm: "End the stream?" }
          : { icon: Icons.radio, confirm: "Go live now?" },
      ),
    ],
  };
}

export function virtualCamItem(obs: ObsClient, active: boolean): Item {
  return {
    id: "vcam",
    title: "Virtual Camera",
    subtitle: active ? "On: video calls can pick “OBS Virtual Camera”" : "Off",
    icon: { source: Icons.camera, tint: active ? "green" : "gray" },
    section: "Outputs",
    keywords: ["webcam", "camera", "caméra", "virtual cam", "visio"],
    tags: active ? ["ON"] : undefined,
    actions: [
      act(active ? "Stop Virtual Camera" : "Start Virtual Camera", async () => {
        await obs.request(active ? "StopVirtualCam" : "StartVirtualCam");
      }, { icon: active ? Icons.stop : Icons.camera }),
    ],
  };
}

export function replayBufferItem(obs: ObsClient, active: boolean): Item {
  const save = act("Save Replay", async () => {
    await obs.request("SaveReplayBuffer");
    // OBS writes the file just after answering.
    await new Promise((r) => setTimeout(r, 800));
    const res = await obs.request("GetLastReplayBufferReplay").catch(() => ({} as Record<string, unknown>));
    const path = typeof res.savedReplayPath === "string" ? res.savedReplayPath : undefined;
    await setLastRecording(path);
    return path ? `Replay saved: ${basename(path)}` : "Replay saved";
  }, { icon: Icons.download });
  const toggle = act(active ? "Stop Replay Buffer" : "Start Replay Buffer", async () => {
    await obs.request(active ? "StopReplayBuffer" : "StartReplayBuffer");
  }, { icon: active ? Icons.stop : Icons.history });
  return {
    id: "replay",
    title: "Replay Buffer",
    subtitle: active ? "Recording the last moments: Enter saves them" : "Off",
    icon: { source: Icons.history, tint: active ? "green" : "gray" },
    section: "Outputs",
    keywords: ["replay", "clip", "instant replay", "rediffusion"],
    tags: active ? ["ON"] : undefined,
    actions: active ? [save, toggle] : [toggle],
  };
}

// ---------------------------------------------------------------------------
// Scenes

export function sceneItem(
  obs: ObsClient,
  scene: Scene,
  st: Pick<Status, "current" | "preview">,
  screenshot?: string,
  closeAfter = false,
): Item {
  const live = scene.name === st.current;
  const preview = scene.name === st.preview && !live;
  return {
    id: `scene-${scene.uuid ?? scene.name}`,
    title: scene.name,
    subtitle: live ? "On air" : preview ? "In preview (Studio Mode)" : undefined,
    icon: { source: live ? Icons.done : Icons.window, tint: live ? "red" : preview ? "green" : "gray" },
    section: "Scenes",
    keywords: ["scene", "scène"],
    tags: live ? ["LIVE"] : preview ? ["PREVIEW"] : undefined,
    detail: screenshot ? { image: screenshot } : undefined,
    actions: [
      action(live ? "Already On Air" : "Switch to Scene", async () => {
        try {
          if (!live) await obs.request("SetCurrentProgramScene", { sceneName: scene.name });
        } catch (e) {
          await toast((e as Error).message, { style: "failure" });
          return;
        }
        changed();
        if (closeAfter) return close(`On air: ${scene.name}`);
      }, { icon: Icons.window }),
      act("Show in Preview", async () => {
        await obs.request("SetCurrentPreviewScene", { sceneName: scene.name });
      }, { icon: Icons.eye, section: "Studio Mode" }),
      copy(scene.name, "Copy Scene Name", { section: "Copy" }),
    ],
  };
}

// ---------------------------------------------------------------------------
// Audio

const VOLUMES = [0, -3, -6, -10, -15, -20, -30];

/** dB → OBS's own fader position (cubic), 0 to 1. */
export function faderPosition(db?: number): number {
  if (db === undefined || !Number.isFinite(db)) return 0;
  return Math.max(0, Math.min(1, Math.cbrt(10 ** (db / 20))));
}

export function audioItem(obs: ObsClient, input: AudioInput): Item {
  const kind = audioKind(input.kind, input.special);
  const icon = input.muted
    ? Icons.speakerOff
    : kind === "mic"
    ? Icons.mic
    : kind === "media"
    ? Icons.music
    : Icons.speaker;
  const db = formatDb(input.db);
  const lines: Metadata[] = [
    meta.text("State", input.muted ? "Muted" : "On", { color: input.muted ? "red" : "green" }),
    meta.text("Type", input.special ? SPECIAL_NAMES[input.special] ?? kindLabel(input.kind) : kindLabel(input.kind)),
  ];
  if (db) lines.push(meta.progress("Volume", faderPosition(input.db), db));
  return {
    id: `input-${input.name}`,
    title: input.name,
    subtitle: input.muted
      ? "Muted"
      : kind === "mic"
      ? "Microphone"
      : kind === "desktop"
      ? "Desktop audio"
      : kindLabel(input.kind),
    icon: { source: icon, tint: input.muted ? "red" : "green" },
    section: "Audio",
    keywords: ["mute", "unmute", "audio", "micro", "son", "couper le son", "muet"],
    accessories: db
      ? [
        { text: input.muted ? "" : db, tooltip: "Volume" },
        ...(input.muted ? [{ tag: "MUTED", color: "red" as const }] : []),
      ]
      : undefined,
    detail: { metadata: lines },
    actions: [
      act(input.muted ? "Unmute" : "Mute", async () => {
        const res = await obs.request("ToggleInputMute", { inputName: input.name });
        return `${input.name} ${res.inputMuted ? "muted" : "unmuted"}`;
      }, { icon: input.muted ? Icons.speaker : Icons.speakerOff }),
      submenu(
        "Set Volume",
        VOLUMES.map((v) =>
          act(formatDb(v), async () => {
            await obs.request("SetInputVolume", { inputName: input.name, inputVolumeDb: v });
          })
        ),
        { icon: Icons.speaker, shortcut: "<Ctrl>v" },
      ),
      copy(input.name, "Copy Input Name", { section: "Copy" }),
    ],
  };
}
