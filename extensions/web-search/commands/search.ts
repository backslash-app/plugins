import {
  type Action,
  action,
  close,
  copy,
  Icons,
  type Item,
  list,
  meta,
  openExternal,
  refresh,
  storage,
  submenu,
} from "@backslash/api";
import {
  ago,
  asUrl,
  type Bang,
  BANGS,
  completeBang,
  type Engine,
  engineOf,
  ENGINES,
  fill,
  forget,
  type HistoryEntry,
  hostOf,
  matchHistory,
  type Parsed,
  parseQuery,
  parseSuggestions,
  remember,
  searchUrl,
  type SuggestSource,
  suggestUrl,
} from "../lib.ts";

const KEY = "history";

async function history(): Promise<HistoryEntry[]> {
  const h = await storage.get<HistoryEntry[]>(KEY).catch(() => undefined);
  return Array.isArray(h) ? h : [];
}

/** Opens the URL and records the query, unless history is off. */
function go(
  url: string,
  query: string,
  title: string,
  keep: boolean,
  options: { shortcut?: string; section?: string; icon?: string } = {},
): Action {
  return action(title, async () => {
    if (keep && query.trim()) await storage.set(KEY, remember(await history(), query));
    await openExternal(url);
    return close();
  }, { icon: Icons.external, ...options });
}

/** "Search with Google, Kagi…" for the same words. */
function otherEngines(terms: string, current: Engine, keep: boolean): Action {
  return submenu(
    "Search With",
    ENGINES.filter((e) => e.id !== current.id).map((e) =>
      go(fill(e.url, terms), terms, e.name, keep, { icon: Icons.search })
    ),
    { icon: Icons.search, shortcut: "<Ctrl>e", section: "Search" },
  );
}

async function suggestions(source: SuggestSource, terms: string, signal: AbortSignal): Promise<string[] | undefined> {
  try {
    const res = await fetch(suggestUrl(source, terms), { signal, headers: { Accept: "application/json" } });
    if (!res.ok) return undefined;
    return parseSuggestions(await res.json(), terms);
  } catch (e) {
    if (signal.aborted) throw e;
    console.error(`suggestions: ${e}`);
    return undefined;
  }
}

function bangItem(bang: Bang, terms: string, keep: boolean, section: string): Item {
  const url = terms ? fill(bang.url, terms) : bang.home;
  return {
    id: `bang:${bang.trigger}`,
    title: terms ? `Search ${bang.name} for “${terms}”` : bang.name,
    subtitle: terms ? hostOf(url) : `!${bang.trigger} · ${hostOf(bang.home)}`,
    icon: { source: Icons.bolt, tint: "orange" },
    section,
    keywords: [bang.trigger, ...(bang.aliases ?? []), bang.category],
    accessories: [{ tag: `!${bang.trigger}`, color: "orange" }, { text: bang.category }],
    detail: {
      metadata: [
        meta.text("Bang", `!${bang.trigger}`, { icon: Icons.bolt, color: "orange" }),
        ...(bang.aliases?.length ? [meta.tags("Also", bang.aliases.map((a) => `!${a}`))] : []),
        meta.text("Site", bang.name, { icon: Icons.globe }),
        meta.link("Opens", hostOf(url), url),
        meta.text("Category", bang.category),
      ],
    },
    actions: [
      terms
        ? go(url, `!${bang.trigger} ${terms}`, `Search ${bang.name}`, keep)
        : go(bang.home, "", `Open ${bang.name}`, false),
      copy(url, "Copy URL", { shortcut: "<Ctrl><Shift>c", section: "Copy" }),
      copy(`!${bang.trigger}`, "Copy Bang", { section: "Copy" }),
    ],
  };
}

let footer = "";

export default list({
  placeholder: "Search the web… (!g, !yt, !gh, !w and 50 other bangs)",
  empty: {
    title: "Type to search the web",
    description: "Prefix with a !bang to search a site directly",
    icon: Icons.globe,
  },
  status: () => footer,
  async search(query, { preferences, signal }) {
    const engine = engineOf(preferences.engine);
    const keep = preferences.history !== false;
    const source: SuggestSource = engine.id === "google" ? "google" : "duckduckgo";
    const all = keep ? await history() : [];
    const q = query.trim();
    const items: Item[] = [];

    if (!q) {
      footer = `${engine.name} · ${all.length} recent search${all.length === 1 ? "" : "es"}`;
      for (const h of all.slice(0, 25)) items.push(historyItem(h, engine, keep, "Recent Searches"));
      if (!all.length) {
        for (const t of ["g", "yt", "gh", "w", "aw", "mdn", "maps", "deepl"]) {
          const bang = BANGS.find((x) => x.trigger === t)!;
          items.push(bangItem(bang, "", keep, "Popular Bangs"));
        }
      }
      return items;
    }

    const parsed = parseQuery(q);

    // "!" or "!yo": complete the bang.
    if (parsed.partialBang !== undefined && !parsed.bang) {
      const found = completeBang(parsed.partialBang);
      footer = found.length ? `${found.length} bang${found.length === 1 ? "" : "s"}` : "Unknown bang";
      for (const bang of found) items.push(bangItem(bang, parsed.terms, keep, "Bangs"));
      if (!found.length && parsed.terms) {
        items.push(searchItem(parsed.terms, engine, keep, `Search ${engine.name}`));
      }
      return items;
    }

    const url = asUrl(q);
    if (url) {
      items.push({
        id: "url",
        title: `Open ${hostOf(url)}`,
        subtitle: url,
        icon: { source: Icons.link, tint: "blue" },
        section: "Address",
        actions: [go(url, "", "Open in Browser", false), copy(url, "Copy URL", { shortcut: "<Ctrl><Shift>c" })],
      });
    }

    if (parsed.bang) {
      items.push(bangItem(parsed.bang, parsed.terms, keep, `!${parsed.bang.trigger} · ${parsed.bang.name}`));
    } else items.push(searchItem(parsed.terms, engine, keep, url ? "Search" : engine.name));

    const words = parsed.terms;
    const suggested = preferences.suggestions === false || !words ? [] : await suggestions(source, words, signal);
    for (const s of suggested ?? []) {
      const target: Parsed = { terms: s, bang: parsed.bang };
      const full = parsed.bang ? `!${parsed.bang.trigger} ${s}` : s;
      items.push({
        id: `s:${s}`,
        title: s,
        icon: { source: Icons.search, tint: "gray" },
        section: "Suggestions",
        accessories: parsed.bang ? [{ tag: `!${parsed.bang.trigger}`, color: "orange" }] : [],
        actions: [
          go(
            searchUrl(target, engine),
            full,
            parsed.bang ? `Search ${parsed.bang.name}` : `Search ${engine.name}`,
            keep,
          ),
          ...(parsed.bang ? [] : [otherEngines(s, engine, keep)]),
          copy(s, "Copy Suggestion", { shortcut: "<Ctrl><Shift>c", section: "Copy" }),
        ],
      });
    }

    const recent = matchHistory(all, q).filter((h) => h.query.toLowerCase() !== q.toLowerCase()).slice(0, 8);
    for (const h of recent) items.push(historyItem(h, engine, keep, "Recent Searches"));

    footer = suggested === undefined
      ? `${engine.name} · suggestions unavailable (offline?)`
      : `${engine.name} · suggestions from ${source === "google" ? "Google" : "DuckDuckGo"}`;
    return items;
  },
});

function searchItem(terms: string, engine: Engine, keep: boolean, section: string): Item {
  const url = fill(engine.url, terms);
  return {
    id: "search",
    title: terms,
    subtitle: `Search ${engine.name}`,
    icon: { source: Icons.search, tint: "blue" },
    section,
    accessories: [{ text: hostOf(engine.home) }],
    actions: [
      go(url, terms, `Search ${engine.name}`, keep),
      otherEngines(terms, engine, keep),
      copy(url, "Copy Search URL", { shortcut: "<Ctrl><Shift>c", section: "Copy" }),
    ],
  };
}

function historyItem(h: HistoryEntry, engine: Engine, keep: boolean, section: string): Item {
  const parsed = parseQuery(h.query);
  const url = searchUrl(parsed, engine);
  return {
    id: `h:${h.query}`,
    title: h.query,
    subtitle: parsed.bang ? parsed.bang.name : undefined,
    icon: { source: Icons.history, tint: "gray" },
    section,
    accessories: [
      ...(h.count > 1 ? [{ text: `${h.count}×`, tooltip: `Searched ${h.count} times` }] : []),
      { text: ago(h.at), tooltip: new Date(h.at).toLocaleString() },
    ],
    actions: [
      go(url, h.query, parsed.bang ? `Search ${parsed.bang.name}` : `Search ${engine.name}`, keep),
      ...(parsed.bang ? [] : [otherEngines(parsed.terms, engine, keep)]),
      copy(h.query, "Copy Query", { shortcut: "<Ctrl><Shift>c", section: "Copy" }),
      action("Remove from History", async () => {
        await storage.set(KEY, forget(await history(), h.query));
        return refresh();
      }, { icon: Icons.trash, destructive: true, section: "History", shortcut: "<Ctrl>Delete" }),
      action("Clear Search History", async () => {
        await storage.set(KEY, []);
        return refresh();
      }, {
        icon: Icons.trash,
        destructive: true,
        confirm: "Clear all recent searches?",
        section: "History",
        shortcut: "<Ctrl><Shift>Delete",
      }),
    ],
  };
}
