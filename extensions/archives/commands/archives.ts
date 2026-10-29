import { action, Icons, type Item, list } from "@backslash/api";
import { isArchive } from "../lib.ts";
import { clipboardFiles, family, type FileEntry, fileEntry, loadAll, recentArchives, tools } from "../system.ts";
import {
  archiveItem,
  clipboardHint,
  compressItem,
  made,
  madeItem,
  missingToolsItem,
  nextChange,
  opened,
  pathForm,
} from "../ui.ts";

let counts = { archives: 0, others: 0, recent: 0 };

export default list({
  placeholder: "Copied archives to extract, copied files to compress…",
  empty: {
    title: "Nothing to extract or compress",
    description: "Copy files in your file manager",
    icon: Icons.archive,
  },
  actions: [action("Open by Path", () => pathForm(), { icon: Icons.text, shortcut: "<Ctrl>p" })],
  status: () =>
    [
      counts.archives ? `${counts.archives} copied archive${counts.archives === 1 ? "" : "s"}` : "",
      counts.others ? `${counts.others} to compress` : "",
      counts.recent ? `${counts.recent} recent` : "",
    ].filter(Boolean).join(" · ") || "Nothing copied",
  // Files first, then their contents once listed; live after a change.
  async *items({ signal }) {
    const [t, paths, recent, fam] = await Promise.all([tools(), clipboardFiles(), recentArchives(), family()]);
    const copied = (await Promise.all(paths.map(fileEntry))).filter((f): f is FileEntry => !!f);
    const archives = copied.filter((f) => !f.dir && isArchive(f.path));
    const known = new Set(copied.map((f) => f.path));
    const others = recent.filter((f) => !known.has(f.path));
    counts = { archives: archives.length, others: copied.length - archives.length, recent: others.length };
    const anyTool = t.bsdtar || t.sevenZip;
    while (!signal.aborted) {
      const openedArchives = opened.filter((f) => !f.dir && isArchive(f.path));
      const openedOthers = opened.filter((f) => f.dir || !isArchive(f.path));
      const madeArchives = made.filter((f) => !f.dir && isArchive(f.path));
      const items: Item[] = [
        ...(anyTool ? [] : [missingToolsItem(fam)]),
        ...made.map((f) => madeArchives.includes(f) ? archiveItem(f, "Just Made") : madeItem(f)),
        ...openedArchives.map((f) => archiveItem(f, "Opened")),
        ...openedOthers.map((f) => compressItem([f], t, "Opened")),
        // Everything copied can be compressed together, archives included.
        ...(copied.length && copied.length !== archives.length ? [compressItem(copied, t, "Clipboard")] : []),
        ...archives.map((f) => archiveItem(f, "Clipboard")),
        ...(archives.length > 1 ? [compressItem(archives, t, "Clipboard")] : []),
        ...(copied.length ? [] : [clipboardHint()]),
        ...others.map((f) => archiveItem(f, "Recent")),
      ];
      yield items;
      const pending = [...made, ...opened, ...archives, ...others].filter((f) =>
        !f.dir && isArchive(f.path) && !f.read
      );
      if (pending.length) {
        await loadAll(pending, signal);
        continue;
      }
      await nextChange(signal);
    }
  },
});
