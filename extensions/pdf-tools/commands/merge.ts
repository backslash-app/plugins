import { action, type Context, Icons, list, toast } from "@backslash/api";
import { formatBytes, move } from "../lib.ts";
import { loadAll, mergeList, type PdfFile, pdfFile, setMergeList, tilde } from "../system.ts";
import { changed, mergeFiles, nextChange } from "../ui.ts";

let total = { files: 0, pages: 0 };

// The PDFs to merge, in order: move them up and down, then merge.
export default (_ctx?: Context) =>
  list({
    title: "Merge List",
    placeholder: "PDFs to merge, in order…",
    empty: {
      title: "The merge list is empty",
      description: "In PDF Tools, press Ctrl+M on a PDF to add it",
      icon: Icons.layers,
    },
    status: () => (total.files ? `${total.files} PDFs · ${total.pages} pages · Ctrl+Enter merges` : "Nothing to merge"),
    async *items({ signal }) {
      const cache = new Map<string, PdfFile>();
      while (!signal.aborted) {
        const paths = await mergeList();
        const files: PdfFile[] = [];
        for (const p of paths) {
          const f = cache.get(p) ?? (await pdfFile(p));
          if (f) {
            cache.set(p, f);
            files.push(f);
          }
        }
        await loadAll(files, signal);
        total = { files: files.length, pages: files.reduce((s, f) => s + (f.info?.pages ?? 0), 0) };
        const update = async (next: string[]) => {
          await setMergeList(next);
          changed();
        };
        const mergeAll = action(`Merge ${files.length} PDFs`, async () => {
          if (await mergeFiles(files.map((f) => f.path))) await update([]);
        }, { icon: Icons.layers, shortcut: "<Ctrl>Return" });
        yield files.map((f, n) => ({
          id: f.path,
          title: `${n + 1}. ${f.name}`,
          subtitle: tilde(f.path.split("/").slice(0, -1).join("/")),
          icon: { source: Icons.file, tint: "red" as const },
          accessories: [
            ...(f.info?.pages ? [{ text: `${f.info.pages} p.` }] : []),
            { text: formatBytes(f.size) },
          ],
          detail: {
            image: f.preview,
            stats: [{ label: "position", value: `${n + 1} of ${files.length}` }, {
              label: "pages",
              value: f.info?.pages ?? "?",
            }],
          },
          actions: [
            mergeAll,
            action("Move Up", () => update(move(paths, n, -1)), {
              icon: Icons.arrowUp,
              shortcut: "<Ctrl><Shift>Up",
              section: "Order",
            }),
            action("Move Down", () => update(move(paths, n, 1)), {
              icon: Icons.arrowDown,
              shortcut: "<Ctrl><Shift>Down",
              section: "Order",
            }),
            action("Move to Top", () => update([f.path, ...paths.filter((p) => p !== f.path)]), {
              icon: Icons.arrowUp,
              section: "Order",
            }),
            action("Remove from List", () => update(paths.filter((p) => p !== f.path)), {
              icon: Icons.minus,
              shortcut: "<Ctrl>Delete",
              section: "List",
            }),
            action("Clear List", async () => {
              await update([]);
              await toast("Merge list cleared");
            }, { icon: Icons.trash, destructive: true, confirm: "Remove every PDF from the list?", section: "List" }),
          ],
        }));
        await nextChange(signal);
      }
    },
  });
