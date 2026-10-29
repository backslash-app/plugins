// Rows, preset menus, forms and the jobs.

import {
  type Action,
  action,
  copy,
  field,
  form,
  type FormSpec,
  Icons,
  type Item,
  meta,
  type Metadata,
  open,
  pop,
  refresh,
  submenu,
  toast,
} from "@backslash/api";
import {
  ago,
  type AudioFormat,
  channelsName,
  codecName,
  dirname,
  eta,
  extname,
  type Family,
  formatBitrate,
  formatBytes,
  formatDuration,
  GIF_PRESETS,
  installMarkdown,
  type Operation,
  resolutionName,
  TARGET_PRESETS,
  targetBitrate,
  trimRange,
  unavailable,
} from "./lib.ts";
import {
  dismiss,
  expandHome,
  type Job,
  type JobState,
  type MediaFile,
  mediaFile,
  probe,
  start,
  stop,
  tilde,
  type Tools,
} from "./system.ts";

/** Files opened by path, kept for the session. */
export const opened: MediaFile[] = [];

// The list stays live: starting a job or opening a file wakes it up.
const changes = new EventTarget();
export const changed = () => changes.dispatchEvent(new Event("change"));

/** Resolves on the next change, after `ms` if given, or when `signal` aborts. */
export function nextChange(signal: AbortSignal, ms?: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = ms ? setTimeout(() => done(), ms) : undefined;
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

async function launch(op: Operation, files: MediaFile[]): Promise<void> {
  let started = 0;
  const skipped: string[] = [];
  for (const f of files) {
    const why = unavailable(op, f.info);
    if (why) {
      skipped.push(`${f.name}: ${why}`);
      continue;
    }
    try {
      await start(op, f);
      started++;
    } catch (e) {
      await toast(`Couldn't start`, { style: "failure", message: (e as Error).message });
      return;
    }
  }
  if (started) changed();
  if (!started) {
    await toast(skipped.length === 1 ? skipped[0].replace(/^.*?: /, "") : "Nothing to convert", {
      style: "failure",
      message: skipped.length > 1 ? skipped[0] : undefined,
    });
    return;
  }
  await toast(started === 1 ? "Started in the background" : `${started} conversions started`, {
    style: "success",
    message: [skipped.length ? `${skipped.length} skipped` : "", "progress is shown on top"].filter(Boolean).join(
      " · ",
    ),
  });
}

const doing = (op: Operation, files: MediaFile[]) => async () => {
  await launch(op, files);
  return refresh();
};

function trimForm(f: MediaFile): FormSpec {
  const d = f.info?.duration;
  return form({
    title: `Trim ${f.name}`,
    submitTitle: "Trim",
    fields: [
      field.text("start", "Start", { placeholder: "0:00", value: "0:00" }),
      field.text("end", d ? `End (length ${formatDuration(d)})` : "End", {
        placeholder: d ? formatDuration(d) : "1:30",
        value: d ? formatDuration(d) : "",
      }),
      field.checkbox("exact", "Exact cut (re-encodes; otherwise cuts at the nearest keyframes, instantly)", {
        value: false,
      }),
    ],
    async submit(values) {
      let range;
      try {
        range = trimRange(String(values.start ?? ""), String(values.end ?? ""), d);
      } catch (e) {
        await toast((e as Error).message, { style: "failure" });
        return;
      }
      await launch({ kind: "trim", ...range, exact: values.exact === true }, [f]);
      return pop();
    },
  });
}

function targetForm(files: MediaFile[]): FormSpec {
  return form({
    title: "Compress to a Size",
    submitTitle: "Compress",
    fields: [field.text("mb", "Size in MB", { required: true, placeholder: "10", value: "10" })],
    async submit(values) {
      const mb = Number(String(values.mb ?? "").replace(",", ".").replace(/\s*mi?b$/i, ""));
      if (!(mb > 0) || mb > 100_000) {
        await toast("Type a size in MB, like 10", { style: "failure" });
        return;
      }
      await compressTo(mb, files);
      return pop();
    },
  });
}

async function compressTo(mb: number, files: MediaFile[]): Promise<void> {
  const small = files.filter((f) => f.size <= mb * 1024 * 1024);
  const rest = files.filter((f) => !small.includes(f));
  if (!rest.length) {
    await toast(`Already smaller than ${mb} MB`, { style: "info" });
    return;
  }
  for (const f of rest) {
    try {
      targetBitrate(mb, f.info?.duration ?? 0, { audio: (f.info?.audioTracks ?? 0) > 0 });
    } catch (e) {
      await toast(files.length > 1 ? `${f.name}: ${(e as Error).message}` : (e as Error).message, { style: "failure" });
      return;
    }
  }
  await launch({ kind: "target", mb }, rest);
}

/** The presets, as submenus of the action panel. */
export function operations(files: MediaFile[]): Action[] {
  const video = files.some((f) => !f.info || f.info.video);
  const audio = files.some((f) => !f.info || f.info.audioTracks > 0);
  const one = files.length === 1 ? files[0] : undefined;
  const actions: Action[] = [];
  if (video) {
    actions.push(
      submenu("Convert Video", [
        action("MP4 (H.264, AAC)", doing({ kind: "mp4" }, files), { icon: Icons.film }),
        action("WebM (VP9, Opus)", doing({ kind: "webm" }, files), { icon: Icons.film }),
      ], { icon: Icons.film, shortcut: "<Ctrl>t", section: "Convert" }),
    );
  }
  if (audio) {
    actions.push(
      submenu(
        "Convert to Audio",
        ([
          ["mp3", "MP3 (VBR ~190 kb/s)"],
          ["opus", "Opus (128 kb/s)"],
          ["flac", "FLAC (lossless)"],
          ["m4a", "M4A (AAC 192 kb/s)"],
        ] as [AudioFormat, string][]).map(([format, title]) =>
          action(title, doing({ kind: "audio", format }, files), { icon: Icons.music })
        ),
        { icon: Icons.music, shortcut: "<Ctrl>a", section: "Convert" },
      ),
    );
    if (video) {
      actions.push(
        action("Extract Audio (No Re-encoding)", doing({ kind: "extract" }, files), {
          icon: Icons.headphones,
          section: "Convert",
        }),
      );
    }
  }
  if (video) {
    actions.push(
      submenu(
        "Make GIF",
        GIF_PRESETS.map((g) => action(g.title, doing({ kind: "gif", width: g.width, fps: g.fps }, files))),
        { icon: Icons.image, shortcut: "<Ctrl>g", section: "Convert" },
      ),
      submenu("Compress to a Size", [
        ...TARGET_PRESETS.map((mb) =>
          action(`${mb} MB${mb === 8 ? " (Discord)" : ""}`, async () => {
            await compressTo(mb, files);
            return refresh();
          })
        ),
        action("Custom Size…", () => targetForm(files), { icon: Icons.text }),
      ], { icon: Icons.archive, shortcut: "<Ctrl>e", section: "Edit" }),
      submenu("Resize", [
        action("720p", doing({ kind: "resize", height: 720 }, files)),
        action("1080p", doing({ kind: "resize", height: 1080 }, files)),
      ], { icon: Icons.layers, shortcut: "<Ctrl>r", section: "Edit" }),
    );
  }
  if (one) actions.push(action("Trim…", () => trimForm(one), { icon: Icons.timer, section: "Edit" }));
  if (video && audio) {
    actions.push(action("Remove Audio", doing({ kind: "mute" }, files), { icon: Icons.speakerOff, section: "Edit" }));
  }
  return actions;
}

function infoMetadata(f: MediaFile): Metadata[] {
  const i = f.info;
  if (!i) return [];
  const v = i.video;
  const a = i.audio;
  return [
    ...(i.title ? [meta.text("Title", i.title, { icon: Icons.text })] : []),
    ...(i.artist ? [meta.person("Artist", i.artist)] : []),
    ...(v
      ? [meta.tags("Video", [
        codecName(v.codec),
        `${v.width} × ${v.height}`,
        ...(v.fps ? [`${v.fps} fps`] : []),
        ...(v.bitrate ? [formatBitrate(v.bitrate)] : []),
      ])]
      : []),
    ...(a
      ? [meta.tags("Audio", [
        codecName(a.codec),
        ...(channelsName(a.channels, a.layout) ? [channelsName(a.channels, a.layout)] : []),
        ...(a.sampleRate ? [`${(a.sampleRate / 1000).toFixed(1).replace(/\.0$/, "")} kHz`] : []),
        ...(a.bitrate ? [formatBitrate(a.bitrate)] : []),
        ...(a.language ? [a.language] : []),
      ])]
      : []),
    ...(i.audioTracks > 1 ? [meta.text("Audio tracks", i.audioTracks, { icon: Icons.headphones })] : []),
    ...(i.subtitles ? [meta.text("Subtitles", i.subtitles, { icon: Icons.comment })] : []),
    ...(i.container ? [meta.text("Container", i.container, { icon: Icons.box })] : []),
    ...(i.bitrate ? [meta.text("Bitrate", formatBitrate(i.bitrate), { icon: Icons.activity })] : []),
  ];
}

export function mediaItem(f: MediaFile, section: string): Item {
  const i = f.info;
  const v = i?.video;
  const res = v ? resolutionName(v.width, v.height) : undefined;
  const isVideo = !!v || (!i && !/\.(mp3|m4a|aac|opus|ogg|oga|flac|wav|wma|aiff?|ac3|mka|amr)$/i.test(f.name));
  return {
    id: `${section}:${f.path}`,
    title: f.name,
    subtitle: i?.title && i.title !== f.name ? i.title : tilde(dirname(f.path)),
    icon: { source: isVideo ? Icons.film : Icons.music, tint: f.error ? "gray" : isVideo ? "purple" : "pink" },
    section,
    keywords: [extname(f.path), v ? codecName(v.codec) : "", i?.artist ?? ""].filter(Boolean),
    accessories: [
      ...(i?.duration ? [{ text: formatDuration(i.duration), icon: Icons.clock }] : []),
      ...(res ? [{ tag: res }] : []),
      { text: formatBytes(f.size) },
    ],
    detail: {
      stats: [
        ...(i?.duration ? [{ label: "length", value: formatDuration(i.duration) }] : []),
        ...(v ? [{ label: "resolution", value: res! }] : []),
        { label: "size", value: formatBytes(f.size) },
      ],
      markdown: f.error ? `**ffprobe can't read this file.** ${f.error}` : i ? undefined : "_Reading…_",
      metadata: [
        ...infoMetadata(f),
        meta.separator(),
        meta.text("Folder", tilde(dirname(f.path)), { icon: Icons.folder }),
        meta.text("Modified", ago(f.modified), { icon: Icons.clock }),
      ],
    },
    actions: [
      open(f.path, "Play", { icon: Icons.play }),
      ...(f.error ? [] : operations([f])),
      copy(f.path, "Copy Path", { section: "File", shortcut: "<Ctrl><Shift>c" }),
      open(dirname(f.path), "Open Folder", { icon: Icons.folder, section: "File", shortcut: "<Ctrl>o" }),
    ],
  };
}

export function batchItem(files: MediaFile[]): Item {
  const total = files.reduce((s, f) => s + f.size, 0);
  const length = files.reduce((s, f) => s + (f.info?.duration ?? 0), 0);
  return {
    id: "batch",
    title: `All ${files.length} Copied Files`,
    subtitle: "Convert them together, one job each",
    icon: { source: Icons.layers, tint: "purple" },
    section: "Clipboard",
    accessories: [{ text: formatBytes(total) }],
    detail: {
      stats: [
        { label: "files", value: files.length },
        ...(length ? [{ label: "total length", value: formatDuration(length) }] : []),
        { label: "total", value: formatBytes(total) },
      ],
      markdown: files.map((f) => `- ${f.name}${f.info?.duration ? ` (${formatDuration(f.info.duration)})` : ""}`).join(
        "\n",
      ),
    },
    actions: operations(files.filter((f) => !f.error)),
  };
}

// ---------------------------------------------------------------------------
// Jobs

const name = (p: string) => p.split("/").pop() ?? p;

export function jobItem(job: Job, s: JobState): Item {
  const base = {
    id: `job:${job.id}`,
    title: name(job.output),
    section: s.state === "running" ? "Converting" : "Finished",
    keywords: [name(job.input), job.title],
  };
  const file = [
    copy(job.output, "Copy Path", { section: "File", shortcut: "<Ctrl><Shift>c" }),
    open(dirname(job.output), "Open Folder", { icon: Icons.folder, section: "File", shortcut: "<Ctrl>o" }),
  ];
  const forget = action("Dismiss", async () => {
    await dismiss([job.id]);
    return refresh();
  }, { icon: Icons.cross, shortcut: "<Ctrl>d", section: "Job" });
  const common: Metadata[] = [
    meta.text("From", name(job.input), { icon: Icons.file }),
    meta.text("Folder", tilde(dirname(job.output)), { icon: Icons.folder }),
    meta.text("Started", ago(job.started), { icon: Icons.clock }),
  ];
  switch (s.state) {
    case "running": {
      const left = eta(s.fraction, Date.now() - job.started);
      return {
        ...base,
        subtitle: job.title,
        icon: { source: Icons.inProgress, tint: "blue" },
        accessories: [
          ...(s.speed ? [{ text: `${s.speed.toFixed(1)}×`, tooltip: "Speed" }] : []),
          { tag: `${Math.round(s.fraction * 100)} %`, color: "blue" },
        ],
        detail: {
          metadata: [
            meta.progress("Progress", s.fraction),
            ...(left ? [meta.text("Remaining", left, { icon: Icons.hourglass })] : []),
            ...(s.speed ? [meta.text("Speed", `${s.speed.toFixed(2)}× real time`, { icon: Icons.bolt })] : []),
            ...common,
          ],
        },
        actions: [
          open(dirname(job.output), "Open Folder", { icon: Icons.folder }),
          action("Stop", async () => {
            await stop(job);
            await dismiss([job.id]);
            await toast("Stopped", { message: "The unfinished file was removed" });
            return refresh();
          }, { icon: Icons.stop, destructive: true, confirm: "Stop this conversion?", shortcut: "<Ctrl>Delete" }),
        ],
      };
    }
    case "done":
      return {
        ...base,
        subtitle: `Done · from ${name(job.input)}`,
        icon: { source: Icons.done, tint: "green" },
        accessories: [{ text: formatBytes(s.size) }],
        detail: { metadata: [meta.text("Size", formatBytes(s.size), { icon: Icons.drive }), ...common] },
        actions: [open(job.output, "Play", { icon: Icons.play }), ...file, forget],
      };
    case "failed":
      return {
        ...base,
        subtitle: s.error,
        icon: { source: Icons.alert, tint: "red" },
        accessories: [{ tag: "failed", color: "red" }],
        detail: { markdown: `**${job.title} failed.**\n\n\`\`\`\n${s.error}\n\`\`\``, metadata: common },
        actions: [forget, copy(s.error, "Copy Error", { section: "Job" })],
      };
    case "stopped":
      return {
        ...base,
        subtitle: "Stopped before the end",
        icon: { source: Icons.canceled, tint: "gray" },
        detail: { metadata: common },
        actions: [forget],
      };
  }
}

export function clearFinished(ids: string[]): Action {
  return action("Clear Finished", async () => {
    await dismiss(ids);
    return refresh();
  }, { icon: Icons.trash, section: "Job" });
}

// ---------------------------------------------------------------------------
// Setup and hints

export function pathForm(): FormSpec {
  return form({
    title: "Open Video or Audio",
    submitTitle: "Open",
    fields: [field.text("path", "Path", { required: true, placeholder: "~/Videos/clip.mkv" })],
    async submit(values) {
      const path = expandHome(String(values.path ?? ""));
      const f = await mediaFile(path).catch(() => undefined);
      if (!f) {
        await toast(`Can't read ${tilde(path)}`, { style: "failure", message: "Files must be in your home folder" });
        return;
      }
      await probe(f);
      opened.unshift(f);
      changed();
      return pop();
    },
  });
}

export function clipboardHint(): Item {
  return {
    id: "clipboard-hint",
    title: "Copy videos or songs in your file manager",
    subtitle: "They show up here",
    icon: { source: Icons.paste, tint: "gray" },
    section: "Clipboard",
    detail: {
      markdown: [
        "Select videos or audio files in **Files**, **Dolphin**, **Thunar** or **Nemo** and press **Ctrl+C**, then open Media Converter again.",
        "",
        "Conversions run in the background: you can close the launcher, and come back to see their progress.",
        "",
        "Or press **Ctrl+P** to type a path. Your newest videos and songs are below.",
      ].join("\n"),
    },
    actions: [action("Open by Path", () => pathForm(), { icon: Icons.text })],
  };
}

export function missingItem(t: Tools, fam?: Family): Item {
  const what = !t.ffmpeg
    ? "Media Converter works with **ffmpeg** (and ffprobe, which comes with it)."
    : "Conversions run in the background with **systemd-run --user**, which this system doesn't have.";
  return {
    id: "missing",
    title: t.ffmpeg ? "systemd-run is missing" : "Install ffmpeg",
    subtitle: t.ffmpeg ? "Needed to convert in the background" : "Needed to read and convert videos and audio",
    icon: { source: Icons.alert, tint: "orange" },
    section: "Setup",
    detail: { markdown: t.ffmpeg ? what : installMarkdown(what, fam) },
    actions: [action("Check Again", () => refresh(), { icon: Icons.refresh })],
  };
}
