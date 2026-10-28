import { Icons, type Item, list } from "@backslash/api";
import { parseFolders } from "../lib.ts";
import { fileSummaries, findSpecFiles, HOME, loadSpec, savedUrls, sourceOf, type Summary } from "../specs.ts";
import { operationItems } from "../views.ts";

interface Prefs {
  folders?: string;
  depth?: number;
}

async function itemsOf(s: Summary, signal: AbortSignal): Promise<Item[]> {
  try {
    const spec = await loadSpec(sourceOf(s), signal);
    const title = String(spec.doc.info?.title ?? "").trim() || s.title;
    return operationItems(spec, `${title} · `).map((i) => ({ ...i, keywords: [...i.keywords ?? [], title] }));
  } catch (e) {
    if (signal.aborted) throw e;
    return [];
  }
}

export default list({
  placeholder: "Search endpoints of every spec by path, summary, method or tag…",
  empty: {
    title: "No endpoint found",
    description: "Open OpenAPI Specs to add a spec URL, or set the folders to scan in the preferences",
    icon: Icons.link,
  },
  status: (items) => `${items.length} endpoints`,
  async *items({ preferences, signal }) {
    const prefs = preferences as Prefs;
    const depth = Math.max(1, Math.min(8, Math.round(Number(prefs.depth) || 4)));
    const found = await findSpecFiles(parseFolders(prefs.folders, HOME), depth, signal);
    const files = (await fileSummaries(found.files)).filter((s) => !s.error).sort((a, b) => b.modified - a.modified);
    const local = (await Promise.all(files.map((s) => itemsOf(s, signal)))).flat();
    yield local;
    const urls = await savedUrls();
    if (!urls.length) return;
    const remote = (await Promise.all(
      urls.map((url) =>
        itemsOf({ uri: url, url, title: new URL(url).host, kind: "", operations: 0, tags: 0, modified: 0 }, signal)
      ),
    )).flat();
    yield [...local, ...remote];
  },
});
