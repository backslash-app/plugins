import {
  type Action,
  action,
  close,
  copy,
  Icons,
  type Item,
  list,
  meta,
  type Metadata,
  open,
  submenu,
  toast,
} from "@backslash/api";
import {
  ago,
  describeMedia,
  type Device,
  deviceId,
  formatTime,
  type Media,
  type Status,
  statusText,
  urlMedia,
  VOLUMES,
} from "../lib.ts";
import {
  cachedDevices,
  cast,
  control,
  copiedMedia,
  defaultDevice,
  openNetworkDisplays,
  scan,
  setDefault,
  status,
  stop,
  type Tools,
  tools,
} from "../system.ts";

// The live list wakes up after an action instead of waiting for its next tick.
const changes = new EventTarget();
const changed = () => changes.dispatchEvent(new Event("change"));
function nextChange(signal: AbortSignal, ms: number): Promise<void> {
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

let rescan = false;
let footer = "";

const run = (title: string, fn: () => Promise<string | void>, options: Parameters<typeof action>[2] = {}): Action =>
  action(title, async () => {
    try {
      const said = await fn();
      if (said) await toast(said, { style: "success" });
    } catch (e) {
      await toast((e as Error).message, { style: "failure" });
    }
    changed();
  }, options);

function castAction(d: Device, m: Media, title = `Cast to ${d.name}`, options: Parameters<typeof action>[2] = {}) {
  return action(title, async () => {
    try {
      await toast(`Casting to ${d.name}…`);
      await cast(d, m);
    } catch (e) {
      await toast((e as Error).message, { style: "failure" });
      return;
    }
    return close(`Playing on ${d.name}`);
  }, { icon: Icons.play, ...options });
}

function missingItem(t: Tools): Item {
  return {
    id: "missing",
    title: "Install catt to cast to a Chromecast",
    subtitle: t.go2tv ? "DLNA TVs work through go2tv" : "And go2tv for DLNA TVs",
    icon: { source: Icons.alert, tint: t.go2tv ? "yellow" : "red" },
    detail: {
      markdown: [
        "**catt** casts links, YouTube videos and files to Chromecasts and Google TVs:",
        "",
        "`pipx install catt`",
        "",
        "**go2tv** casts files and links to DLNA TVs (Samsung, LG, Sony…): download it from its GitHub releases, or `go install go2tv.app/go2tv/v2@latest`.",
      ].join("\n"),
    },
    actions: [
      open("https://github.com/skorokithakis/catt#installation", "Open catt's Page"),
      open("https://github.com/alexballas/go2tv", "Open go2tv's Page"),
    ],
  };
}

function mediaItem(m: Media, devices: Device[], preferred?: Device): Item {
  const { title, subtitle } = describeMedia(m);
  const first = devices.find((d) => preferred && deviceId(d) === deviceId(preferred)) ?? devices[0];
  const lines: Metadata[] = [meta.text("What", subtitle)];
  if (m.kind === "file") lines.push(meta.text("File", m.path, { icon: Icons.file }));
  else lines.push(meta.link("Link", title, m.url));
  if (first) lines.push(meta.text("Cast to", first.name, { icon: Icons.monitor }));
  return {
    id: "media",
    title,
    subtitle: first ? `${subtitle} · Enter casts to ${first.name}` : subtitle,
    icon: {
      source: m.kind === "file"
        ? (m.type === "audio" ? Icons.music : m.type === "image" ? Icons.image : Icons.film)
        : m.kind === "url" && m.youtube
        ? Icons.video
        : Icons.link,
      tint: "blue",
    },
    section: "To Cast",
    detail: { metadata: lines },
    actions: [
      ...(first ? [castAction(first, m)] : []),
      ...(devices.length > 1
        ? [submenu("Cast to…", devices.map((d) => castAction(d, m, d.name)), { icon: Icons.monitor })]
        : []),
      ...(m.kind === "url" && first?.kind === "chromecast" && !m.youtube && !m.direct
        ? [action("Cast as Web Page", async () => {
          try {
            await cast(first, m, { site: true });
          } catch (e) {
            await toast((e as Error).message, { style: "failure" });
            return;
          }
          return close(`Showing the page on ${first.name}`);
        }, { icon: Icons.globe })]
        : []),
      ...(m.kind === "url" ? [open(m.url, "Open Link", { shortcut: "<Ctrl>o" })] : [open(m.path, "Open File")]),
    ],
  };
}

function deviceItem(
  d: Device,
  m: Media | undefined,
  st: Status | undefined,
  isDefault: boolean,
  loading: boolean,
): Item {
  const playing = st && !st.idle;
  const state = d.kind === "dlna" ? "DLNA" : st ? statusText(st) : loading ? "…" : "";
  const lines: Metadata[] = [
    meta.text("Type", d.kind === "dlna" ? "DLNA renderer (go2tv)" : "Chromecast (catt)"),
  ];
  if (d.model) lines.push(meta.text("Model", d.model));
  if (d.ip) lines.push(meta.text("Address", d.ip, { icon: Icons.wifi }));
  if (d.url) lines.push(meta.text("Address", d.url, { icon: Icons.wifi }));
  if (st && !st.idle) {
    lines.push(meta.separator());
    if (st.title) lines.push(meta.text("Playing", st.title, { icon: Icons.play }));
    if (st.app) lines.push(meta.text("App", st.app));
    if (st.position !== undefined && st.duration) {
      lines.push(
        meta.progress("Position", st.position / st.duration, `${formatTime(st.position)} / ${formatTime(st.duration)}`),
      );
    }
  }
  if (st?.volume !== undefined) {
    lines.push(meta.progress("Volume", st.volume / 100, st.muted ? "Muted" : `${st.volume} %`));
  }

  const remote: Action[] = d.kind === "chromecast"
    ? [
      run(st?.state === "PAUSED" ? "Play" : "Pause", () => control(d, "play_toggle"), {
        icon: st?.state === "PAUSED" ? Icons.play : Icons.pause,
        shortcut: "<Ctrl>p",
      }),
      run("Stop", async () => {
        await stop(d);
        return `Stopped ${d.name}`;
      }, { icon: Icons.stop, shortcut: "<Ctrl>s" }),
      run("Volume Up", () => control(d, "volumeup", "10"), {
        icon: Icons.plus,
        shortcut: "<Ctrl>Up",
        section: "Volume",
      }),
      run("Volume Down", () => control(d, "volumedown", "10"), {
        icon: Icons.minus,
        shortcut: "<Ctrl>Down",
        section: "Volume",
      }),
      submenu("Set Volume", VOLUMES.map((v) => run(`${v} %`, () => control(d, "volume", String(v)))), {
        icon: Icons.speaker,
        section: "Volume",
      }),
      run(st?.muted ? "Unmute" : "Mute", () => control(d, "volumemute", st?.muted ? "false" : "true"), {
        icon: st?.muted ? Icons.speaker : Icons.speakerOff,
        shortcut: "<Ctrl>m",
        section: "Volume",
      }),
      run("Back 30 Seconds", () => control(d, "rewind", "30"), {
        icon: Icons.previous,
        shortcut: "<Ctrl>Left",
        section: "Seek",
      }),
      run("Forward 30 Seconds", () => control(d, "ffwd", "30"), {
        icon: Icons.next,
        shortcut: "<Ctrl>Right",
        section: "Seek",
      }),
      run("Skip to the End", () => control(d, "skip"), { icon: Icons.next, section: "Seek" }),
    ]
    : [run("Stop Casting", async () => {
      await stop(d);
      return "Stopped";
    }, { icon: Icons.stop, shortcut: "<Ctrl>s" })];

  return {
    id: `device-${deviceId(d)}`,
    title: d.name,
    subtitle: [playing && st?.title ? st.title : "", d.model].filter(Boolean).join(" · ") || undefined,
    icon: { source: Icons.monitor, tint: playing ? "green" : "gray" },
    section: "Devices",
    keywords: [d.model ?? "", d.ip ?? "", "tv", "chromecast", "dlna"],
    accessories: [
      ...(state ? [{ text: state }] : []),
      ...(isDefault ? [{ tag: "default", tooltip: "Used by Cast Copied and Stop Casting" }] : []),
    ],
    detail: { metadata: lines },
    actions: [
      ...(m ? [castAction(d, m, `Cast ${m.kind === "file" ? "File" : "Link"} Here`)] : []),
      ...remote,
      action("Use by Default", async () => {
        await setDefault(d);
        changed();
      }, { icon: Icons.pin, section: "Device" }),
      ...(d.ip ? [copy(d.ip, "Copy Address", { section: "Device" })] : []),
    ],
  };
}

function mirrorItem(t: Tools): Item | undefined {
  if (!t.networkDisplays) return undefined;
  return {
    id: "mirror",
    title: "Mirror Your Screen",
    subtitle: "GNOME Network Displays: Miracast TVs and Chromecasts",
    icon: { source: Icons.window, tint: "purple" },
    section: "Screen",
    actions: [run("Open Network Displays", () => openNetworkDisplays(t.networkDisplays!), { icon: Icons.external })],
  };
}

function scanningItem(): Item {
  return {
    id: "scanning",
    title: "Looking for TVs on your network…",
    icon: { source: Icons.hourglass, tint: "blue" },
    section: "Devices",
  };
}

function hintItem(): Item {
  return {
    id: "hint",
    title: "Copy a link or a file to cast it",
    subtitle: "A YouTube video, a video link, or a video, song or picture in your file manager",
    icon: { source: Icons.paste, tint: "gray" },
    section: "To Cast",
    detail: {
      markdown:
        "Copy a link in your browser or a file in your file manager, then open **Cast to TV** again.\n\nOr type a link in the search bar when opening the command.",
    },
  };
}

export default list({
  placeholder: "Pick a TV…",
  empty: {
    title: "No TV found",
    description: "Chromecasts and DLNA TVs must be on the same network: Ctrl+R scans again",
    icon: Icons.monitor,
  },
  status: () => footer,
  actions: [action("Scan Again", () => {
    rescan = true;
    changed();
  }, { icon: Icons.refresh, shortcut: "<Ctrl>r" })],
  async *items(ctx) {
    const { signal } = ctx;
    const t = await tools();
    const typed = ctx.query.trim().match(/^https?:\/\/\S+/)?.[0];
    const m = typed ? urlMedia(typed) : await copiedMedia();
    let scanResult = await cachedDevices();
    let scanning: Promise<void> | undefined;
    const statuses = new Map<string, Status | undefined>();
    const build = async (): Promise<Item[]> => {
      const devices = scanResult?.devices ?? [];
      const preferred = await defaultDevice();
      footer = scanning
        ? "Looking for TVs…"
        : scanResult
        ? `${devices.length} device${devices.length === 1 ? "" : "s"} · scanned ${ago(scanResult.at)}`
        : "";
      const mirror = mirrorItem(t);
      return [
        ...(t.catt ? [] : [missingItem(t)]),
        ...(m ? [mediaItem(m, devices, preferred)] : [hintItem()]),
        ...devices.map((d) =>
          deviceItem(
            d,
            m,
            statuses.get(deviceId(d)),
            !!preferred && deviceId(preferred) === deviceId(d),
            d.kind === "chromecast" && !statuses.has(deviceId(d)),
          )
        ),
        ...(scanning && !devices.length ? [scanningItem()] : []),
        ...(mirror ? [mirror] : []),
      ];
    };
    while (!signal.aborted) {
      const fresh = scanResult && Date.now() - scanResult.at < 6 * 3600_000;
      if ((!fresh || rescan) && !scanning && (t.catt || t.go2tv)) {
        rescan = false;
        scanning = scan(t).then((r) => {
          scanResult = r;
        }).catch(() => {}).finally(() => {
          scanning = undefined;
          changed();
        });
      }
      yield await build();
      // What each Chromecast plays, every few seconds.
      const chromecasts = (scanResult?.devices ?? []).filter((d) => d.kind === "chromecast");
      if (chromecasts.length) {
        await Promise.all(chromecasts.map(async (d) => statuses.set(deviceId(d), await status(d))));
        if (signal.aborted) return;
        yield await build();
      }
      await nextChange(signal, scanning ? 1000 : 4000);
    }
  },
});
