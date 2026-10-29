import { action, Icons, type Item, list } from "@backslash/api";
import { basename, dirname, followRenames, plural, readRules } from "../lib.ts";
import { clipboardFiles, fileInfos, lastBatch, savedRules, tilde } from "../system.ts";
import { clipboardHint, nextChange, quickRenames, rulesForm, undoItem } from "../ui.ts";

let count = 0;

export default list({
  placeholder: "Copied files to rename…",
  empty: { title: "Nothing to rename", description: "Copy files in your file manager", icon: Icons.text },
  status: () => (count ? `${plural(count, "file")} copied · Enter to pick the rules` : "No files copied"),
  async *items({ signal }) {
    const paths = await clipboardFiles();
    while (!signal.aborted) {
      const [batch, saved] = await Promise.all([lastBatch(), savedRules()]);
      // The clipboard still holds the old names of files renamed here.
      const files = await fileInfos(followRenames(paths, batch?.renames));
      count = files.length;
      const rules = readRules(saved);
      const open = action(`Rename ${plural(files.length, "File")}…`, () => rulesForm(files, rules), {
        icon: Icons.text,
      });
      const actions = [open, quickRenames(files)];
      const folders = new Set(files.map((f) => dirname(f.path)));
      const items: Item[] = [
        ...(files.length
          ? [{
            id: "all",
            title: `Rename ${plural(files.length, "Copied File")}`,
            subtitle: folders.size === 1 ? tilde([...folders][0]) : `In ${folders.size} folders`,
            icon: { source: Icons.layers, tint: "purple" as const },
            section: "Clipboard",
            detail: {
              stats: [
                { label: "files", value: files.filter((f) => !f.dir).length },
                ...(files.some((f) => f.dir) ? [{ label: "folders", value: files.filter((f) => f.dir).length }] : []),
              ],
              markdown: files.slice(0, 80).map((f) => `- ${basename(f.path)}${f.dir ? "/" : ""}`).join("\n") +
                (files.length > 80 ? `\n- … and ${files.length - 80} more` : ""),
            },
            actions,
          }]
          : [clipboardHint()]),
        ...(batch ? [undoItem(batch)] : []),
        ...files.map((f): Item => ({
          id: f.path,
          title: basename(f.path),
          subtitle: tilde(dirname(f.path)),
          icon: { source: f.dir ? Icons.folder : Icons.file, tint: "gray" },
          section: "Files",
          accessories: f.mtime ? [{ text: new Date(f.mtime).toLocaleDateString() }] : [],
          actions,
        })),
      ];
      yield items;
      await nextChange(signal);
    }
  },
});
