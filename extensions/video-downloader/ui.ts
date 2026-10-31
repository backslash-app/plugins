// Rows of the downloader: the copied video with its qualities, the downloads,
// and what to install.

import {
  type Action,
  action,
  close,
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
  toast,
} from "@backslash/api";
import {
  ago,
  basename,
  type Choice,
  describeChoice,
  dirname,
  type Family,
  fileUri,
  findUrl,
  formatBytes,
  formatCount,
  formatDuration,
  fraction,
  type Info,
  installMarkdown,
  type Option,
  options,
  progressText,
  siteName,
  tilde,
} from "./lib.ts";
import {
  copyFiles,
  dismiss,
  type Download,
  type DownloadState,
  HOME,
  type Prefs,
  retry,
  start,
  stop,
  type Tools,
} from "./system.ts";

// The live list wakes up after an action instead of waiting for its next tick.
const changes = new EventTarget();
export const changed = () => changes.dispatchEvent(new Event("change"));

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

/** Links typed in the URL form, kept while the launcher runs this command. */
export const typed: string[] = [];

export function urlForm(): FormSpec {
  return form({
    title: "Download from a Link",
    submitTitle: "Look Up",
    fields: [field.text("url", "Link", { placeholder: "https://www.youtube.com/watch?v=…", required: true })],
    submit(values) {
      const url = findUrl(String(values.url ?? ""));
      if (!url) throw new Error("That's not a link: paste one starting with https://");
      if (!typed.includes(url)) typed.unshift(url);
      changed();
      return pop();
    },
  });
}

export const urlAction = (): Action =>
  action("Download from Link…", () => urlForm(), { icon: Icons.link, shortcut: "<Ctrl>l" });

export function missingItem(t: Tools, fam?: Family): Item {
  return {
    id: "missing",
    title: t.ytdlp ? "ffmpeg isn't installed" : "yt-dlp isn't installed",
    subtitle: t.ytdlp ? "Needed for the best qualities and MP3" : "It does the downloading",
    icon: { source: Icons.alert, tint: t.ytdlp ? "yellow" : "red" },
    detail: { markdown: installMarkdown({ ytdlp: !t.ytdlp, ffmpeg: !t.ffmpeg }, fam) },
    actions: [open("https://github.com/yt-dlp/yt-dlp/wiki/Installation", "Open Installation Guide")],
  };
}

export function hintItem(): Item {
  return {
    id: "hint",
    title: "Copy the link of a video",
    subtitle: "YouTube, Vimeo, SoundCloud, X, Reddit, Twitch clips and 1,800 more sites",
    icon: { source: Icons.link, tint: "gray" },
    section: "Download",
    detail: {
      markdown: [
        "Copy a video's link in your browser, then open **Download Video** again: its qualities show here.",
        "",
        "Or press **Ctrl+L** to type one.",
      ].join("\n"),
    },
    actions: [urlAction()],
  };
}

export function loadingItem(url: string): Item {
  return {
    id: `loading-${url}`,
    title: "Looking at the link…",
    subtitle: url,
    icon: { source: Icons.hourglass, tint: "blue" },
    section: siteName(url),
    actions: [copy(url, "Copy Link")],
  };
}

export function errorItem(url: string, message: string): Item {
  return {
    id: `error-${url}`,
    title: message,
    subtitle: url,
    icon: { source: Icons.alert, tint: "red" },
    section: siteName(url),
    detail: { markdown: `**${message}**\n\n${url}` },
    actions: [open(url, "Open Link"), urlAction()],
  };
}

function infoLines(info: Info): Metadata[] {
  const lines: Metadata[] = [];
  if (info.uploader) lines.push(meta.person("By", info.uploader));
  if (info.duration) lines.push(meta.text("Length", formatDuration(info.duration), { icon: Icons.clock }));
  if (info.playlist) lines.push(meta.text("Videos", info.playlist.count || "?", { icon: Icons.layers }));
  if (info.uploadDate) lines.push(meta.text("Published", info.uploadDate, { icon: Icons.calendar }));
  if (info.views) lines.push(meta.text("Views", formatCount(info.views), { icon: Icons.eye }));
  lines.push(meta.text("Site", info.site));
  lines.push(meta.link("Link", siteName(info.url), info.url));
  return lines;
}

function folderFor(choice: Choice, p: Prefs): string {
  return choice.kind === "audio" ? p.audioFolder : p.folder;
}

async function begin(info: Info, choice: Choice, p: Prefs) {
  try {
    await start(
      {
        url: info.url,
        title: info.playlist?.title ?? info.title,
        uploader: info.uploader,
        thumbnail: info.thumbnail,
        duration: info.duration,
        playlist: !!info.playlist,
      },
      choice,
      p,
    );
  } catch (e) {
    await toast((e as Error).message, { style: "failure" });
    return;
  }
  changed();
  return close(`Downloading ${describeChoice(choice)} to ${tilde(folderFor(choice, p), HOME)}: you'll be notified`);
}

export function optionItems(info: Info, p: Prefs, hasFfmpeg: boolean): Item[] {
  const opts = options(info, hasFfmpeg);
  const section = info.playlist ? `Playlist · ${info.site}` : info.site;
  const markdown = info.live
    ? "**This is a live stream:** it is recorded from now until it ends or you stop it."
    : undefined;
  return opts.map((o: Option, n) => ({
    id: `option-${info.url}-${o.key}`,
    title: n === 0 && !info.playlist ? info.title : o.title,
    subtitle: n === 0 && !info.playlist ? `${o.title} · ${o.subtitle}` : o.subtitle,
    icon: n === 0 && info.thumbnail
      ? info.thumbnail
      : { source: o.choice.kind === "audio" ? Icons.music : Icons.film, tint: n === 0 ? "blue" : "gray" },
    section,
    accessories: o.size ? [{ text: `~${formatBytes(o.size)}`, tooltip: "Estimated size" }] : undefined,
    keywords: [o.title, o.key, info.title],
    detail: {
      image: info.thumbnail,
      markdown: markdown ?? (n === 0 && info.playlist ? `**${info.playlist.title}**` : `**${info.title}**`),
      metadata: [
        meta.text("Download", `${o.title}${o.size ? ` (~${formatBytes(o.size)})` : ""}`, { icon: Icons.download }),
        meta.text("To", tilde(folderFor(o.choice, p), HOME), { icon: Icons.folder }),
        meta.separator(),
        ...infoLines(info),
      ],
    },
    actions: [
      action(`Download ${o.title.replace(/^Audio Only: /, "")}`, () => begin(info, o.choice, p), {
        icon: Icons.download,
      }),
      open(info.url, "Open Link", { shortcut: "<Ctrl>o" }),
      copy(info.url, "Copy Link", { section: "Copy" }),
      copy(info.title, "Copy Title", { section: "Copy" }),
      ...(info.thumbnail ? [open(info.thumbnail, "Open Thumbnail", { icon: Icons.image })] : []),
      urlAction(),
    ],
  }));
}

// ---------------------------------------------------------------------------
// Downloads

export function downloadItem(d: Download, st: DownloadState, p: Prefs, finished: string[]): Item {
  const quality = describeChoice(d.choice);
  const lines: Metadata[] = [meta.text("Quality", quality)];
  let subtitle: string;
  let icon: Item["icon"];
  const accessories: Item["accessories"] = [];
  const actions: Action[] = [];
  const again = action(st.state === "done" ? "Download Again" : "Retry", async () => {
    try {
      await retry(d, p);
      changed();
    } catch (e) {
      await toast((e as Error).message, { style: "failure" });
    }
  }, { icon: Icons.refresh, shortcut: "<Ctrl>r" });

  if (st.state === "running") {
    const f = fraction(st.progress);
    subtitle = progressText(st.progress);
    icon = { source: Icons.download, tint: "blue" };
    accessories.push({ text: `${Math.round(f * 100)} %` });
    lines.push(meta.progress("Progress", f, subtitle));
    actions.push(
      action("Stop Download", async () => {
        await stop(d);
        changed();
      }, { icon: Icons.stop, destructive: true, confirm: "Stop this download?" }),
      open(d.folder, "Open Folder", { icon: Icons.folder, shortcut: "<Ctrl>f" }),
    );
  } else if (st.state === "done") {
    const main = st.files[0];
    subtitle = st.files.length > 1
      ? `${st.files.length} files · ${quality}`
      : main
      ? `${basename(main)}`
      : `Done · ${quality}`;
    icon = { source: Icons.done, tint: "green" };
    if (st.size) accessories.push({ text: formatBytes(st.size) });
    for (const f of st.files.slice(0, 5)) lines.push(meta.text("File", tilde(f, HOME), { icon: Icons.file }));
    if (st.files.length > 5) lines.push(meta.text("", `and ${st.files.length - 5} more`));
    if (main && st.files.length === 1) actions.push(open(main, "Open", { icon: Icons.play }));
    actions.push(open(main ? dirname(main) : d.folder, "Open Folder", { icon: Icons.folder, shortcut: "<Ctrl>f" }));
    if (st.files.length) {
      actions.push(action(st.files.length > 1 ? "Copy Files" : "Copy File", async () => {
        if (await copyFiles(st.files.map(fileUri))) return close("Copied: paste it in a chat or a folder");
        await toast("Install wl-clipboard or xclip to copy files", { style: "failure" });
      }, { icon: Icons.copy, shortcut: "<Ctrl><Shift>c" }));
      if (main) actions.push(copy(main, "Copy Path", { section: "Copy" }));
    }
    actions.push(again);
  } else if (st.state === "failed") {
    subtitle = st.error;
    icon = { source: Icons.alert, tint: "red" };
    lines.push(meta.text("Error", st.error, { color: "red" }));
    actions.push(again, open(d.url, "Open Link", { shortcut: "<Ctrl>o" }));
  } else {
    subtitle = "Stopped";
    icon = { source: Icons.stop, tint: "gray" };
    actions.push(again);
  }
  lines.push(meta.separator());
  if (d.uploader) lines.push(meta.person("By", d.uploader));
  if (d.duration) lines.push(meta.text("Length", formatDuration(d.duration), { icon: Icons.clock }));
  lines.push(meta.text("Started", new Date(d.started).toLocaleString(), { icon: Icons.calendar }));
  lines.push(meta.link("Link", siteName(d.url), d.url));
  accessories.push({ text: ago(d.started), tooltip: new Date(d.started).toLocaleString() });

  actions.push(
    copy(d.url, "Copy Link", { section: "Copy" }),
    open(d.url, "Open Link", { section: "Link" }),
  );
  if (st.state !== "running") {
    actions.push(action("Remove from History", async () => {
      await dismiss([d.id]);
      changed();
    }, { icon: Icons.trash, section: "History", shortcut: "<Ctrl>d" }));
    if (finished.length > 1) {
      actions.push(action("Clear Finished Downloads", async () => {
        await dismiss(finished);
        changed();
      }, {
        icon: Icons.trash,
        section: "History",
        destructive: true,
        confirm: `Forget ${finished.length} downloads? Files stay`,
      }));
    }
  }
  return {
    id: `download-${d.id}`,
    title: d.title,
    subtitle,
    icon,
    section: st.state === "running" ? "Downloading" : "History",
    tags: [quality],
    accessories,
    detail: { image: d.thumbnail, metadata: lines },
    actions: dedupe(actions),
  };
}

/** One action per title: "Open Link" can be both the error's and the link's. */
function dedupe(actions: Action[]): Action[] {
  const seen = new Set<string>();
  return actions.filter((a) => (seen.has(a.title) ? false : (seen.add(a.title), true)));
}
