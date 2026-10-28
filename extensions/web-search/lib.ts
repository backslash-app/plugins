// Web search logic: engines, !bangs, suggestion parsing and search history.

export interface Engine {
  id: string;
  name: string;
  /** `%s` is replaced by the encoded query. */
  url: string;
  home: string;
}

export const ENGINES: Engine[] = [
  { id: "duckduckgo", name: "DuckDuckGo", url: "https://duckduckgo.com/?q=%s", home: "https://duckduckgo.com" },
  { id: "google", name: "Google", url: "https://www.google.com/search?q=%s", home: "https://www.google.com" },
  { id: "brave", name: "Brave Search", url: "https://search.brave.com/search?q=%s", home: "https://search.brave.com" },
  {
    id: "startpage",
    name: "Startpage",
    url: "https://www.startpage.com/do/search?q=%s",
    home: "https://www.startpage.com",
  },
  { id: "kagi", name: "Kagi", url: "https://kagi.com/search?q=%s", home: "https://kagi.com" },
  { id: "ecosia", name: "Ecosia", url: "https://www.ecosia.org/search?q=%s", home: "https://www.ecosia.org" },
  { id: "qwant", name: "Qwant", url: "https://www.qwant.com/?q=%s", home: "https://www.qwant.com" },
  { id: "bing", name: "Bing", url: "https://www.bing.com/search?q=%s", home: "https://www.bing.com" },
];

/** The engine a preference names ("Google", "brave", "kagi"); DuckDuckGo by default. */
export function engineOf(pref: unknown): Engine {
  const p = String(pref ?? "").toLowerCase().replace(/[^a-z]/g, "");
  return ENGINES.find((e) => e.id === p || e.name.toLowerCase().replace(/[^a-z]/g, "") === p) ??
    ENGINES.find((e) => p && e.id.startsWith(p)) ?? ENGINES[0];
}

export interface Bang {
  /** Without the "!": "g", "yt". */
  trigger: string;
  name: string;
  url: string;
  home: string;
  category: string;
  aliases?: string[];
}

const b = (trigger: string, name: string, url: string, home: string, category: string, aliases: string[] = []) => ({
  trigger,
  name,
  url,
  home,
  category,
  aliases,
});

export const BANGS: Bang[] = [
  // Search engines
  b("g", "Google", "https://www.google.com/search?q=%s", "https://www.google.com", "Search", ["google"]),
  b("ddg", "DuckDuckGo", "https://duckduckgo.com/?q=%s", "https://duckduckgo.com", "Search", ["d"]),
  b("brave", "Brave Search", "https://search.brave.com/search?q=%s", "https://search.brave.com", "Search"),
  b("sp", "Startpage", "https://www.startpage.com/do/search?q=%s", "https://www.startpage.com", "Search"),
  b("kagi", "Kagi", "https://kagi.com/search?q=%s", "https://kagi.com", "Search"),
  b("b", "Bing", "https://www.bing.com/search?q=%s", "https://www.bing.com", "Search", ["bing"]),
  b("img", "Google Images", "https://www.google.com/search?tbm=isch&q=%s", "https://images.google.com", "Search", [
    "gi",
    "images",
  ]),
  b("news", "Google News", "https://news.google.com/search?q=%s", "https://news.google.com", "Search", ["gn"]),
  b("scholar", "Google Scholar", "https://scholar.google.com/scholar?q=%s", "https://scholar.google.com", "Search"),
  b("maps", "Google Maps", "https://www.google.com/maps/search/%s", "https://www.google.com/maps", "Maps", ["gm"]),
  b("osm", "OpenStreetMap", "https://www.openstreetmap.org/search?query=%s", "https://www.openstreetmap.org", "Maps"),
  // Knowledge
  b(
    "w",
    "Wikipedia",
    "https://en.wikipedia.org/wiki/Special:Search?search=%s",
    "https://en.wikipedia.org",
    "Knowledge",
    [
      "wiki",
      "wen",
    ],
  ),
  b(
    "wfr",
    "Wikipédia (français)",
    "https://fr.wikipedia.org/wiki/Special:Search?search=%s",
    "https://fr.wikipedia.org",
    "Knowledge",
  ),
  b(
    "wde",
    "Wikipedia (Deutsch)",
    "https://de.wikipedia.org/wiki/Special:Search?search=%s",
    "https://de.wikipedia.org",
    "Knowledge",
  ),
  b(
    "wes",
    "Wikipedia (español)",
    "https://es.wikipedia.org/wiki/Special:Search?search=%s",
    "https://es.wikipedia.org",
    "Knowledge",
  ),
  b(
    "wt",
    "Wiktionary",
    "https://en.wiktionary.org/wiki/Special:Search?search=%s",
    "https://en.wiktionary.org",
    "Knowledge",
  ),
  b("wa", "Wolfram|Alpha", "https://www.wolframalpha.com/input?i=%s", "https://www.wolframalpha.com", "Knowledge"),
  b("imdb", "IMDb", "https://www.imdb.com/find/?q=%s", "https://www.imdb.com", "Knowledge"),
  b(
    "ud",
    "Urban Dictionary",
    "https://www.urbandictionary.com/define.php?term=%s",
    "https://www.urbandictionary.com",
    "Knowledge",
  ),
  // Translation
  b(
    "deepl",
    "DeepL Translator",
    "https://www.deepl.com/translator#auto/en/%s",
    "https://www.deepl.com/translator",
    "Translation",
  ),
  b(
    "gt",
    "Google Translate",
    "https://translate.google.com/?sl=auto&text=%s",
    "https://translate.google.com",
    "Translation",
    [
      "translate",
    ],
  ),
  b("wr", "WordReference", "https://www.wordreference.com/enfr/%s", "https://www.wordreference.com", "Translation"),
  b(
    "larousse",
    "Larousse",
    "https://www.larousse.fr/dictionnaires/francais/%s",
    "https://www.larousse.fr",
    "Translation",
  ),
  // Developers
  b("gh", "GitHub", "https://github.com/search?q=%s&type=repositories", "https://github.com", "Developers", ["github"]),
  b("so", "Stack Overflow", "https://stackoverflow.com/search?q=%s", "https://stackoverflow.com", "Developers"),
  b(
    "mdn",
    "MDN Web Docs",
    "https://developer.mozilla.org/en-US/search?q=%s",
    "https://developer.mozilla.org",
    "Developers",
  ),
  b("caniuse", "Can I use", "https://caniuse.com/?search=%s", "https://caniuse.com", "Developers"),
  b("npm", "npm", "https://www.npmjs.com/search?q=%s", "https://www.npmjs.com", "Developers"),
  b("jsr", "JSR", "https://jsr.io/packages?search=%s", "https://jsr.io", "Developers"),
  b("crates", "crates.io", "https://crates.io/search?q=%s", "https://crates.io", "Developers", ["crate"]),
  b("docs", "Docs.rs", "https://docs.rs/releases/search?query=%s", "https://docs.rs", "Developers", ["docsrs"]),
  b("rust", "Rust std", "https://doc.rust-lang.org/std/?search=%s", "https://doc.rust-lang.org/std", "Developers"),
  b("pypi", "PyPI", "https://pypi.org/search/?q=%s", "https://pypi.org", "Developers", ["pip"]),
  b("py", "Python docs", "https://docs.python.org/3/search.html?q=%s", "https://docs.python.org/3", "Developers"),
  b("go", "Go packages", "https://pkg.go.dev/search?q=%s", "https://pkg.go.dev", "Developers"),
  b("dh", "Docker Hub", "https://hub.docker.com/search?q=%s", "https://hub.docker.com", "Developers", ["docker"]),
  b("hn", "Hacker News", "https://hn.algolia.com/?q=%s", "https://news.ycombinator.com", "Developers"),
  // Linux
  b("aw", "ArchWiki", "https://wiki.archlinux.org/index.php?search=%s", "https://wiki.archlinux.org", "Linux", [
    "archwiki",
  ]),
  b("aur", "AUR", "https://aur.archlinux.org/packages?K=%s", "https://aur.archlinux.org", "Linux"),
  b("archpkg", "Arch packages", "https://archlinux.org/packages/?q=%s", "https://archlinux.org/packages", "Linux", [
    "ap",
  ]),
  b("flathub", "Flathub", "https://flathub.org/apps/search?q=%s", "https://flathub.org", "Linux", ["fh"]),
  b("nix", "Nix packages", "https://search.nixos.org/packages?query=%s", "https://search.nixos.org", "Linux", [
    "nixpkgs",
  ]),
  b(
    "debian",
    "Debian packages",
    "https://packages.debian.org/search?keywords=%s",
    "https://packages.debian.org",
    "Linux",
    [
      "deb",
    ],
  ),
  b(
    "ubuntu",
    "Ubuntu packages",
    "https://packages.ubuntu.com/search?keywords=%s",
    "https://packages.ubuntu.com",
    "Linux",
  ),
  // Media and social
  b("yt", "YouTube", "https://www.youtube.com/results?search_query=%s", "https://www.youtube.com", "Media", [
    "youtube",
  ]),
  b("r", "Reddit", "https://www.reddit.com/search/?q=%s", "https://www.reddit.com", "Media", ["reddit"]),
  b("x", "X (Twitter)", "https://x.com/search?q=%s", "https://x.com", "Media", ["tw", "twitter"]),
  b("li", "LinkedIn", "https://www.linkedin.com/search/results/all/?keywords=%s", "https://www.linkedin.com", "Media"),
  b("spotify", "Spotify", "https://open.spotify.com/search/%s", "https://open.spotify.com", "Media", ["spot"]),
  // Shopping
  b("amazon", "Amazon", "https://www.amazon.com/s?k=%s", "https://www.amazon.com", "Shopping", ["a"]),
  b("afr", "Amazon.fr", "https://www.amazon.fr/s?k=%s", "https://www.amazon.fr", "Shopping", ["amazonfr"]),
  b("ebay", "eBay", "https://www.ebay.com/sch/i.html?_nkw=%s", "https://www.ebay.com", "Shopping"),
  b("lbc", "leboncoin", "https://www.leboncoin.fr/recherche?text=%s", "https://www.leboncoin.fr", "Shopping"),
];

/** The bang a trigger names, "!tw" finding X through its alias. */
export function findBang(trigger: string, bangs = BANGS): Bang | undefined {
  const t = trigger.toLowerCase();
  return bangs.find((x) => x.trigger === t) ?? bangs.find((x) => x.aliases?.includes(t));
}

/** Bangs whose trigger or name starts with a prefix, for "!y" → YouTube. */
export function completeBang(prefix: string, bangs = BANGS): Bang[] {
  const p = prefix.toLowerCase();
  const score = (x: Bang) =>
    x.trigger === p ? 0 : x.trigger.startsWith(p) ? 1 : x.aliases?.some((a) => a.startsWith(p)) ? 2 : 3;
  return bangs
    .filter((x) => !p || score(x) < 3 || x.name.toLowerCase().split(/[\s(|.]+/).some((w) => w.startsWith(p)))
    .sort((x, y) => score(x) - score(y) || x.trigger.length - y.trigger.length);
}

export interface Parsed {
  /** The words searched, without the bang. */
  terms: string;
  bang?: Bang;
  /** A "!xyz" typed that is no known bang (or still being typed). */
  partialBang?: string;
}

/** "!yt lofi", "lofi !yt", "lofi yt!" all search YouTube for "lofi". */
export function parseQuery(query: string, bangs = BANGS): Parsed {
  const words = query.trim().split(/\s+/).filter(Boolean);
  for (let i = 0; i < words.length; i++) {
    const m = /^!(\S+)$/.exec(words[i]) ?? /^(\S+)!$/.exec(words[i]);
    if (!m) continue;
    const terms = [...words.slice(0, i), ...words.slice(i + 1)].join(" ");
    const bang = findBang(m[1], bangs);
    if (bang) return { terms, bang };
    if (words[i].startsWith("!")) return { terms, partialBang: m[1] };
  }
  if (words.length === 1 && words[0] === "!") return { terms: "", partialBang: "" };
  return { terms: words.join(" ") };
}

/** `%s` replaced by the query, encoded the way the site expects (spaces as `+` in query strings). */
export function fill(template: string, terms: string): string {
  const inQuery = template.indexOf("?") !== -1 && template.indexOf("?") < template.indexOf("%s");
  const encoded = inQuery ? encodeURIComponent(terms).replace(/%20/g, "+") : encodeURIComponent(terms);
  return template.replace("%s", encoded);
}

export function searchUrl(parsed: Parsed, engine: Engine): string {
  if (parsed.bang) return parsed.terms ? fill(parsed.bang.url, parsed.terms) : parsed.bang.home;
  return fill(engine.url, parsed.terms);
}

/** A query that is an address: "example.com", "https://deno.com/x", "localhost:8000". */
export function asUrl(query: string): string | undefined {
  const q = query.trim();
  if (!q || /\s/.test(q)) return undefined;
  if (/^https?:\/\/\S+$/i.test(q)) return q;
  if (/^localhost(:\d+)?(\/\S*)?$/i.test(q)) return `http://${q}`;
  if (/^([a-z0-9-]+\.)+[a-z]{2,24}(:\d+)?(\/\S*)?$/i.test(q) && !/^\d+(\.\d+)+$/.test(q)) return `https://${q}`;
  return undefined;
}

// ---------------------------------------------------------------------------
// Suggestions

export type SuggestSource = "duckduckgo" | "google";

export function suggestUrl(source: SuggestSource, terms: string): string {
  const q = encodeURIComponent(terms);
  return source === "google"
    ? `https://suggestqueries.google.com/complete/search?client=firefox&q=${q}`
    : `https://duckduckgo.com/ac/?q=${q}&kl=wt-wt`;
}

/** Reads DuckDuckGo's `[{ phrase }]`, or the OpenSearch `["q", ["a", "b"]]` of Google and DuckDuckGo's `type=list`. */
export function parseSuggestions(body: unknown, terms: string, max = 8): string[] {
  let out: string[] = [];
  if (Array.isArray(body)) {
    if (body.length >= 2 && typeof body[0] === "string" && Array.isArray(body[1])) {
      out = body[1].filter((s): s is string => typeof s === "string");
    } else {
      out = body
        .map((x) => (x && typeof x === "object" && "phrase" in x ? String((x as { phrase: unknown }).phrase) : ""))
        .filter(Boolean);
    }
  }
  const seen = new Set([terms.trim().toLowerCase()]);
  return out.filter((s) => {
    const k = s.trim().toLowerCase();
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  }).slice(0, max);
}

// ---------------------------------------------------------------------------
// History

// A type, not an interface: storage only takes JSON-compatible types.
export type HistoryEntry = {
  /** The query as typed, bang included. */
  query: string;
  at: number;
  count: number;
};

export const HISTORY_MAX = 60;

/** Moves the query to the top, counting how often it was searched. */
export function remember(history: HistoryEntry[], query: string, now = Date.now()): HistoryEntry[] {
  const q = query.trim();
  if (!q) return history;
  const old = history.find((h) => h.query.toLowerCase() === q.toLowerCase());
  const rest = history.filter((h) => h !== old);
  return [{ query: q, at: now, count: (old?.count ?? 0) + 1 }, ...rest].slice(0, HISTORY_MAX);
}

export function forget(history: HistoryEntry[], query: string): HistoryEntry[] {
  return history.filter((h) => h.query !== query);
}

/** Entries matching every word typed, most recent first. */
export function matchHistory(history: HistoryEntry[], query: string): HistoryEntry[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return history.filter((h) => words.every((w) => h.query.toLowerCase().includes(w)));
}

/** "now", "5m", "3h", "2d", "4w". */
export function ago(ms: number, now = Date.now()): string {
  const m = Math.floor((now - ms) / 60000);
  if (m < 1) return "now";
  if (m < 60) return `${m}m`;
  if (m < 1440) return `${Math.floor(m / 60)}h`;
  if (m < 10080) return `${Math.floor(m / 1440)}d`;
  return `${Math.floor(m / 10080)}w`;
}

export const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
};
