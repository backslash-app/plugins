import { action, Icons, type Item, list } from "@backslash/api";
import { isMedia } from "../lib.ts";
import {
  clipboardFiles,
  family,
  jobs,
  type JobState,
  type MediaFile,
  mediaFile,
  probeAll,
  recentMedia,
  state,
  tools,
} from "../system.ts";
import {
  batchItem,
  clearFinished,
  clipboardHint,
  jobItem,
  mediaItem,
  missingItem,
  nextChange,
  opened,
  pathForm,
} from "../ui.ts";

let counts = { running: 0, copied: 0, recent: 0 };

export default list({
  placeholder: "Pick a video or song: copied ones first, then your recent ones…",
  empty: { title: "No videos or songs", description: "Copy some in your file manager", icon: Icons.film },
  actions: [action("Open by Path", () => pathForm(), { icon: Icons.text, shortcut: "<Ctrl>p" })],
  status: () =>
    [
      counts.running ? `${counts.running} converting` : "",
      counts.copied ? `${counts.copied} copied` : "",
      counts.recent ? `${counts.recent} recent` : "",
    ].filter(Boolean).join(" · ") || "Nothing to convert",
  // Files first, then their details once probed; refreshed every second while a job runs.
  async *items({ signal }) {
    const [t, paths, recent, fam] = await Promise.all([tools(), clipboardFiles(), recentMedia(), family()]);
    const copied = (await Promise.all(paths.filter(isMedia).map(mediaFile))).filter((f): f is MediaFile => !!f);
    const known = new Set(copied.map((f) => f.path));
    const others = recent.filter((f) => !known.has(f.path));
    while (!signal.aborted) {
      const list = await jobs();
      const states: JobState[] = await Promise.all(list.map(state));
      const running = states.filter((s) => s.state === "running").length;
      const finished = list.filter((_, n) => states[n].state !== "running").map((j) => j.id);
      counts = { running, copied: copied.length, recent: others.length };
      const jobRows = list.map((j, n) => {
        const item = jobItem(j, states[n]);
        return finished.length > 1 && states[n].state !== "running"
          ? { ...item, actions: [...(item.actions ?? []), clearFinished(finished)] }
          : item;
      });
      const items: Item[] = [
        ...(t.ffmpeg && t.systemdRun ? [] : [missingItem(t, fam)]),
        ...jobRows.filter((r) => r.section === "Converting"),
        ...opened.map((f) => mediaItem(f, "Opened")),
        ...(copied.length > 1 ? [batchItem(copied)] : []),
        ...copied.map((f) => mediaItem(f, "Clipboard")),
        ...(copied.length ? [] : [clipboardHint()]),
        ...jobRows.filter((r) => r.section !== "Converting"),
        ...others.map((f) => mediaItem(f, "Recent")),
      ];
      yield items;
      const pending = [...opened, ...copied, ...others].filter((f) => !f.info && !f.error);
      if (pending.length && t.ffprobe) {
        await probeAll(pending, signal);
        continue;
      }
      await nextChange(signal, running ? 1000 : undefined);
    }
  },
});
