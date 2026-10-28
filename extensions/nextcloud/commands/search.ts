import { copy, Icons, type Item, list, open } from "@backslash/api";
import { ocs, type Server, server, SetupError, setupItem } from "../api.ts";
import {
  absoluteUrl,
  type Provider,
  providerGlyph,
  searchableProviders,
  type SearchEntry,
  type SearchResult,
} from "../lib.ts";

const PER_PROVIDER = 6;

let providers: { base: string; list: Provider[] } | undefined;

async function loadProviders(s: Server, signal: AbortSignal): Promise<Provider[]> {
  if (providers?.base === s.base) return providers.list;
  const list = searchableProviders(await ocs<Provider[]>(s, "/ocs/v2.php/search/providers", { signal }));
  providers = { base: s.base, list };
  return list;
}

function entryItem(s: Server, p: Provider, e: SearchEntry, i: number): Item {
  const url = absoluteUrl(s.base, e.resourceUrl);
  const actions = url
    ? [
      open(url, "Open in Nextcloud", { icon: Icons.external }),
      copy(url, "Copy Link", { section: "Copy" }),
      copy(e.title, "Copy Title", { section: "Copy" }),
    ]
    : [copy(e.title, "Copy Title")];
  return {
    id: `${p.id}:${url ?? e.title}:${i}`,
    title: e.title || "(untitled)",
    subtitle: e.subline || undefined,
    icon: providerGlyph(p.id),
    section: p.name,
    keywords: [p.name],
    detail: {
      markdown: [`### ${e.title}`, e.subline ? `\n${e.subline}` : ""].join("\n"),
    },
    actions,
  };
}

let footer = "";

export default list({
  placeholder: "Search files, notes, cards, conversations, events…",
  empty: {
    title: "Search your Nextcloud",
    description: "Type at least two letters: every app's unified search answers",
    icon: Icons.search,
  },
  status: () => footer,
  async search(query, { preferences, signal }) {
    let s: Server;
    try {
      s = server(preferences);
    } catch (e) {
      if (e instanceof SetupError) return [setupItem(e)];
      throw e;
    }
    const term = query.trim();
    let list: Provider[];
    try {
      list = await loadProviders(s, signal);
    } catch (e) {
      if (e instanceof SetupError) return [setupItem(e)];
      throw e;
    }
    if (term.length < 2) {
      footer = `${list.length} apps searchable`;
      return [];
    }
    const results = await Promise.all(list.map(async (p) => {
      try {
        const r = await ocs<SearchResult>(
          s,
          `/ocs/v2.php/search/providers/${encodeURIComponent(p.id)}/search?term=${
            encodeURIComponent(term)
          }&limit=${PER_PROVIDER}`,
          { signal, timeout: 10_000 },
        );
        return { p, entries: r?.entries ?? [] };
      } catch (e) {
        if (e instanceof SetupError && e.kind === "auth") throw e;
        return { p, entries: [] as SearchEntry[] };
      }
    })).catch((e) => e as SetupError);
    if (results instanceof SetupError) return [setupItem(results)];
    if (signal.aborted) return [];
    const found = results.filter((r) => r.entries.length);
    const count = found.reduce((n, r) => n + r.entries.length, 0);
    footer = count ? `${count} results in ${found.map((r) => r.p.name).join(", ")}` : "No results";
    return found.flatMap((r) => r.entries.map((e, i) => entryItem(s, r.p, e, i)));
  },
});
