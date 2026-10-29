import { type Context, Icons, type Item, list, updateCommandMetadata } from "@backslash/api";
import { cachedScanners, NotInstalled, recent, scanners } from "../system.ts";
import { changes, installItem, noScannerItem, type Prefs, scanItem, scannerItem } from "../ui.ts";

/** Waits for a change (a scan saved or trashed) or for the user to leave. */
function nextChange(signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    const done = () => {
      changes.removeEventListener("change", done);
      signal.removeEventListener("abort", done);
      resolve();
    };
    changes.addEventListener("change", done);
    signal.addEventListener("abort", done);
  });
}

export default (ctx: Context) => {
  const prefs = ctx.preferences as Prefs;
  return list({
    placeholder: "Filter scanners and scans…",
    empty: { title: "Nothing here", icon: Icons.scan },
    async *items({ signal }) {
      // Saved scans and the scanners found last time first: discovery takes a few seconds.
      const [cached, files] = await Promise.all([cachedScanners(), recent()]);
      const scans = files.map((f) => scanItem(f, prefs));
      if (cached?.length) yield [...cached.map((s) => scannerItem(s, cached, prefs, true)), ...scans];
      else if (scans.length) yield scans;

      let rows: Item[];
      try {
        const found = await scanners(signal);
        rows = found.length ? found.map((s) => scannerItem(s, found, prefs, false)) : [noScannerItem()];
        updateCommandMetadata({
          subtitle: found.length ? `${found.length} scanner${found.length === 1 ? "" : "s"}` : null,
        }).catch(() => {});
      } catch (e) {
        if (signal.aborted) return;
        rows = e instanceof NotInstalled ? [await installItem()] : [{
          id: "error",
          title: "Couldn't look for scanners",
          subtitle: (e as Error).message,
          icon: { source: Icons.alert, tint: "orange" },
          section: "Scanners",
          actions: [],
        }];
      }
      yield [...rows, ...scans];
      while (!signal.aborted) {
        await nextChange(signal);
        if (signal.aborted) return;
        yield [...rows, ...(await recent()).map((f) => scanItem(f, prefs))];
      }
    },
  });
};
