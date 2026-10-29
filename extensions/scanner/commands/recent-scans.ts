import { type Context, Icons, list, open } from "@backslash/api";
import { recent, SCANS } from "../system.ts";
import { changes, type Prefs, scanItem } from "../ui.ts";

export default (ctx: Context) =>
  list({
    placeholder: "Filter scans…",
    empty: { title: "No scan yet", description: "Scans are saved in ~/Documents/Scans", icon: Icons.scan },
    actions: [open(SCANS, "Open Scans Folder", { icon: Icons.folder })],
    status: (items) => `${items.length} scan${items.length === 1 ? "" : "s"}`,
    async *items({ signal }) {
      while (!signal.aborted) {
        yield (await recent(200)).map((f) => scanItem(f, ctx.preferences as Prefs));
        await new Promise<void>((resolve) => {
          const done = () => {
            changes.removeEventListener("change", done);
            signal.removeEventListener("abort", done);
            resolve();
          };
          changes.addEventListener("change", done);
          signal.addEventListener("abort", done);
        });
      }
    },
  });
