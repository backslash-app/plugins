import { action, Icons, type Item, list } from "@backslash/api";
import {
  clipboardFiles,
  family,
  isImage,
  isPdf,
  loadAll,
  mergeList,
  type PdfFile,
  pdfFile,
  recentPdfs,
  tools,
} from "../system.ts";
import {
  clipboardHint,
  imagesToPdfItem,
  made,
  mergeBatchItem,
  missingToolsItem,
  nextChange,
  opened,
  pathForm,
  pdfItem,
} from "../ui.ts";
import merge from "./merge.ts";

let counts = { copied: 0, recent: 0, merging: 0 };

export default list({
  placeholder: "Pick a PDF: copied ones first, then your recent ones…",
  empty: { title: "No PDFs", description: "Copy some in your file manager", icon: Icons.file },
  actions: [
    action("Open PDF by Path", () => pathForm(), { icon: Icons.text, shortcut: "<Ctrl>p" }),
    action("Show Merge List", (ctx) => merge(ctx), { icon: Icons.layers, shortcut: "<Ctrl>l" }),
  ],
  status: () =>
    [
      counts.copied ? `${counts.copied} copied` : "",
      counts.recent ? `${counts.recent} recent` : "",
      counts.merging ? `${counts.merging} to merge` : "",
    ].filter(Boolean).join(" · ") || "No PDFs",
  // Files first, then pages, titles and previews once they are read; live after a change.
  async *items({ signal }) {
    const [t, copiedPaths, recent, fam] = await Promise.all([tools(), clipboardFiles(), recentPdfs(), family()]);
    const copied = (await Promise.all(copiedPaths.filter(isPdf).map(pdfFile))).filter((f): f is PdfFile => !!f);
    const images = copiedPaths.filter(isImage);
    const known = new Set(copied.map((f) => f.path));
    const others = recent.filter((f) => !known.has(f.path));
    const any = t.qpdf || t.gs || t.pdftk || t.pdfinfo || t.pdfunite;
    while (!signal.aborted) {
      const merging = await mergeList();
      counts = { copied: copied.length, recent: others.length, merging: merging.length };
      const shownMade = made.filter((f) => !known.has(f.path));
      const items: Item[] = [
        ...(any ? [] : [missingToolsItem(fam)]),
        ...(merging.length
          ? [{
            id: "merge-list",
            title: `Merge List: ${merging.length} PDF${merging.length === 1 ? "" : "s"}`,
            subtitle: "Reorder, then merge",
            icon: { source: Icons.layers, tint: "purple" as const },
            section: "Merge",
            detail: { markdown: merging.map((p, n) => `${n + 1}. ${p.split("/").pop()}`).join("\n") },
            actions: [action("Show Merge List", (ctx) => merge(ctx), { icon: Icons.layers })],
          }]
          : []),
        ...shownMade.map((f) => pdfItem(f, "Just Made", t, merging)),
        ...opened.map((f) => pdfItem(f, "Opened", t, merging)),
        ...(copied.length > 1 ? [mergeBatchItem(copied)] : []),
        ...(images.length ? [imagesToPdfItem(images, t)] : []),
        ...copied.map((f) => pdfItem(f, "Clipboard", t, merging)),
        ...(copied.length || images.length ? [] : [clipboardHint()]),
        ...others.map((f) => pdfItem(f, "Recent", t, merging)),
      ];
      yield items;
      const pending = [...made, ...opened, ...copied, ...others].filter((f) => !f.info);
      if (pending.length) {
        await loadAll(pending, signal);
        continue;
      }
      await nextChange(signal);
    }
  },
});
