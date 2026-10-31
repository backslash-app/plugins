import { Icons, type Item, list } from "@backslash/api";
import { type Info } from "../lib.ts";
import { clipboardUrl, downloads, type DownloadState, family, info, prefs, state, tools } from "../system.ts";
import {
  changed,
  downloadItem,
  errorItem,
  hintItem,
  loadingItem,
  missingItem,
  nextChange,
  optionItems,
  typed,
  urlAction,
} from "../ui.ts";

let footer = "";

export default list({
  placeholder: "Pick a quality for the copied video…",
  empty: { title: "Nothing to download", description: "Copy a video's link, or press Ctrl+L", icon: Icons.download },
  actions: [urlAction()],
  status: () => footer,
  // The copied link's qualities once yt-dlp has looked at it; downloads refresh every second while one runs.
  async *items(ctx) {
    const { signal } = ctx;
    const p = prefs(ctx);
    const [t, fam, copied] = await Promise.all([tools(), family(), clipboardUrl()]);
    const fromQuery = ctx.query.trim().match(/^https?:\/\//) ? ctx.query.trim() : undefined;
    const looked = new Map<string, Info | Error>();
    const pending = new Set<string>();
    while (!signal.aborted) {
      const urls = [...new Set([...typed, fromQuery, copied].filter((u): u is string => !!u))];
      for (const url of urls) {
        if (looked.has(url) || pending.has(url) || !t.ytdlp) continue;
        pending.add(url);
        info(url, p)
          .then((i) => looked.set(url, i), (e) => looked.set(url, e as Error))
          .finally(() => {
            pending.delete(url);
            changed();
          });
      }
      const list = await downloads();
      const states: DownloadState[] = await Promise.all(list.map(state));
      const running = states.filter((s) => s.state === "running").length;
      const finished = list.filter((_, n) => states[n].state !== "running").map((d) => d.id);
      footer = [running ? `${running} downloading` : "", list.length ? `${list.length} in history` : ""]
        .filter(Boolean).join(" · ") || "yt-dlp";
      const rows = list.map((d, n) => downloadItem(d, states[n], p, finished));
      const items: Item[] = [
        ...(t.ytdlp && t.ffmpeg ? [] : [missingItem(t, fam)]),
        ...rows.filter((r) => r.section === "Downloading"),
        ...urls.flatMap((url) => {
          if (!t.ytdlp) return [];
          const got = looked.get(url);
          if (!got) return [loadingItem(url)];
          if (got instanceof Error) return [errorItem(url, got.message)];
          return optionItems(got, p, t.ffmpeg);
        }),
        ...(urls.length || !t.ytdlp ? [] : [hintItem()]),
        ...rows.filter((r) => r.section !== "Downloading"),
      ];
      yield items;
      await nextChange(signal, running ? 1000 : undefined);
    }
  },
});
