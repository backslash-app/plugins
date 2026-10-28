import { action, Icons, type Item, list } from "@backslash/api";
import { clipboardFiles, family, type ImageFile, imageFile, loadInfo, recentImages, tools } from "../system.ts";
import { batchItem, clipboardHint, imageItem, made, missingMagickItem, nextChange, opened, pathForm } from "../ui.ts";
import { IMAGE } from "../lib.ts";

let counts = { clipboard: 0, recent: 0 };

export default list({
  placeholder: "Pick a picture: copied ones first, then your recent ones…",
  empty: { title: "No pictures", description: "Copy some in your file manager", icon: Icons.image },
  actions: [action("Open Picture by Path", () => pathForm(), { icon: Icons.text, shortcut: "<Ctrl>p" })],
  status: () =>
    [
      counts.clipboard ? `${counts.clipboard} copied` : "",
      counts.recent ? `${counts.recent} recent` : "",
      made.length ? `${made.length} made` : "",
    ].filter(Boolean).join(" · ") || "No pictures",
  // Sizes first, then EXIF details once they are read.
  async *items({ signal }) {
    const [t, copied, recent, fam] = await Promise.all([
      tools(),
      clipboardFiles().then(async (paths) =>
        (await Promise.all(paths.filter((p) => IMAGE.test(p)).map(imageFile))).filter((f): f is ImageFile => !!f)
      ),
      recentImages(),
      family(),
    ]);
    const known = new Set([...made, ...opened, ...copied].map((f) => f.path));
    const others = recent.filter((f) => !known.has(f.path));
    counts = { clipboard: copied.length, recent: others.length };
    const build = (): Item[] => [
      ...(t.magick ? [] : [missingMagickItem(fam)]),
      ...made.map((f) => imageItem(f, "Just Made", t)),
      ...opened.map((f) => imageItem(f, "Opened", t)),
      ...(copied.length > 1 ? [batchItem(copied, t)] : []),
      ...copied.map((f) => imageItem(f, "Clipboard", t)),
      ...(copied.length ? [] : [clipboardHint()]),
      ...others.map((f) => imageItem(f, "Recent", t)),
    ];
    yield build();
    while (!signal.aborted) {
      await loadInfo([...made, ...opened, ...copied, ...others].filter((f) => !f.info), signal);
      yield build();
      await nextChange(signal);
    }
  },
});
