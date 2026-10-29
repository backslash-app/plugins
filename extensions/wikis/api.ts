// Outline (Bearer API key), BookStack (Token id:secret), Wiki.js (GraphQL, Bearer API key)
// and Confluence Cloud (Basic email:API token) behind one interface.

import {
  basicAuth,
  bookStackContent,
  type BookStackPage,
  type BookStackResult,
  cleanOutline,
  type Config,
  configured,
  confluenceContent,
  confluenceCql,
  type ConfluencePage,
  type ConfluenceResult,
  type Content,
  fromBookStack,
  fromBookStackPage,
  fromConfluence,
  fromOutline,
  fromWikiJs,
  graphqlError,
  isAllowedHost,
  ORDER,
  type OutlineDocument,
  type OutlineSearchResult,
  type Page,
  SetupError,
  type WikiId,
  WIKIJS_PAGE,
  WIKIJS_RECENT,
  WIKIJS_SEARCH,
  wikiJsContent,
  type WikiJsPage,
  type WikiJsResult,
  WIKIS,
} from "./lib.ts";

export { SetupError };

export interface Wiki {
  id: WikiId;
  name: string;
  base: string;
  search(query: string, signal?: AbortSignal): Promise<Page[]>;
  recent(signal?: AbortSignal): Promise<Page[]>;
  content(page: Page, signal?: AbortSignal): Promise<Content>;
}

type Init = { method?: string; body?: unknown; signal?: AbortSignal; accept?: string };

function caller(wiki: WikiId, base: string, auth: string) {
  const name = WIKIS[wiki];
  let host: string;
  try {
    host = new URL(base).hostname;
  } catch {
    throw new SetupError(`${name}: “${base}” is not an address`, wiki);
  }
  if (!isAllowedHost(host)) {
    throw new SetupError(
      `${name}: ${host} is outside the hosts this extension may reach (a server on your network or Tailscale)`,
      wiki,
    );
  }
  return async <T>(path: string, o: Init = {}): Promise<T> => {
    const timeout = AbortSignal.timeout(20_000);
    let res: Response;
    try {
      res = await fetch(`${base}${path}`, {
        method: o.method ?? (o.body === undefined ? "GET" : "POST"),
        signal: o.signal ? AbortSignal.any([o.signal, timeout]) : timeout,
        headers: {
          Authorization: auth,
          Accept: o.accept ?? "application/json",
          ...(o.body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        body: o.body === undefined ? undefined : JSON.stringify(o.body),
      });
    } catch (e) {
      if (o.signal?.aborted) throw e;
      if (e instanceof Deno.errors.NotCapable || e instanceof Deno.errors.PermissionDenied) {
        throw new SetupError(`${name}: ${host} is outside the hosts this extension may reach`, wiki);
      }
      throw new Error(`${name} is unreachable at ${new URL(base).host}: ${(e as Error).message}`);
    }
    if (res.status === 401 || res.status === 403) {
      await res.body?.cancel();
      throw new SetupError(`${name} refused the credentials: check them in Settings → Extensions → Wikis`, wiki);
    }
    const text = await res.text().catch(() => "");
    if (!res.ok) {
      let message = "";
      try {
        const j = JSON.parse(text);
        message = String(j.message ?? j.error?.message ?? j.error ?? "");
      } catch {
        message = /^\s*</.test(text) ? "" : text.slice(0, 160);
      }
      if (res.status === 404) throw new Error(`${name} has no ${path.split("?")[0]}: is the address right?`);
      throw new Error(`${name} answered ${res.status}${message ? `: ${message}` : ""}`);
    }
    if (o.accept && o.accept !== "application/json") return text as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      // A login page instead of JSON: a proxy in front of the wiki, or the wrong address.
      throw new Error(`${name} didn't answer with JSON at ${base}: is the address right?`);
    }
  };
}

// ---------------------------------------------------------------------------

function outline(c: NonNullable<Config["outline"]>): Wiki {
  const call = caller("outline", c.base, `Bearer ${c.token}`);
  let names: Promise<Map<string, string>> | undefined;
  const collections = (signal?: AbortSignal) =>
    names ??= call<{ data: { id: string; name: string }[] }>("/api/collections.list", { body: { limit: 100 }, signal })
      .then((r) => new Map(r.data.map((x) => [x.id, x.name])))
      .catch(() => new Map());
  return {
    id: "outline",
    name: WIKIS.outline,
    base: c.base,
    async search(query, signal) {
      const [r, cs] = await Promise.all([
        call<{ data: OutlineSearchResult[] }>("/api/documents.search", { body: { query, limit: 25 }, signal }),
        collections(signal),
      ]);
      return r.data.map((x) => fromOutline(x.document, c.base, cs, x.context));
    },
    async recent(signal) {
      const [r, cs] = await Promise.all([
        call<{ data: OutlineDocument[] }>("/api/documents.list", {
          body: { sort: "updatedAt", direction: "DESC", limit: 25 },
          signal,
        }),
        collections(signal),
      ]);
      return r.data.map((d) => fromOutline(d, c.base, cs));
    },
    async content(page, signal) {
      const { data } = await call<{ data: OutlineDocument }>("/api/documents.info", { body: { id: page.id }, signal });
      return {
        markdown: cleanOutline(data.text ?? ""),
        updated: data.updatedAt,
        author: data.updatedBy?.name ?? undefined,
      };
    },
  };
}

function bookstack(c: NonNullable<Config["bookstack"]>): Wiki {
  const call = caller("bookstack", c.base, `Token ${c.id}:${c.secret}`);
  let names: Promise<Map<number, string>> | undefined;
  const books = (signal?: AbortSignal) =>
    names ??= call<{ data: { id: number; name: string }[] }>("/api/books?count=500", { signal })
      .then((r) => new Map(r.data.map((b) => [b.id, b.name])))
      .catch(() => new Map());
  return {
    id: "bookstack",
    name: WIKIS.bookstack,
    base: c.base,
    async search(query, signal) {
      const qs = new URLSearchParams({ query: `${query} {type:page}`, count: "25" });
      const [r, bs] = await Promise.all([
        call<{ data: BookStackResult[] }>(`/api/search?${qs}`, { signal }),
        books(signal),
      ]);
      return r.data.filter((x) => x.type === "page").map((x) => fromBookStack(x, bs));
    },
    async recent(signal) {
      const [r, bs] = await Promise.all([
        call<{ data: BookStackPage[] }>("/api/pages?sort=-updated_at&count=25", { signal }),
        books(signal),
      ]);
      return r.data.map((p) => fromBookStackPage(p, c.base, bs));
    },
    async content(page, signal) {
      return bookStackContent(await call<BookStackPage>(`/api/pages/${page.id}`, { signal }), c.base);
    },
  };
}

function wikijs(c: NonNullable<Config["wikijs"]>): Wiki {
  const call = caller("wikijs", c.base, `Bearer ${c.token}`);
  const gql = async <T>(query: string, variables: Record<string, unknown>, signal?: AbortSignal): Promise<T> => {
    const r = await call<{ data?: T; errors?: { message?: string }[] }>("/graphql", {
      body: { query, variables },
      signal,
    });
    const error = graphqlError(r.errors);
    if (error) {
      if (/refused the API key/.test(error)) throw new SetupError(error, "wikijs");
      throw new Error(`Wiki.js: ${error}`);
    }
    return r.data as T;
  };
  return {
    id: "wikijs",
    name: WIKIS.wikijs,
    base: c.base,
    async search(query, signal) {
      const d = await gql<{ pages: { search: { results: WikiJsResult[] } } }>(WIKIJS_SEARCH, { q: query }, signal);
      return (d.pages?.search?.results ?? []).map((r) => fromWikiJs(r, c.base));
    },
    async recent(signal) {
      const d = await gql<{ pages: { list: WikiJsResult[] } }>(WIKIJS_RECENT, {}, signal);
      return (d.pages?.list ?? []).map((r) => fromWikiJs(r, c.base));
    },
    async content(page, signal) {
      const [locale, ...path] = page.id.split("/");
      const d = await gql<{ pages: { singleByPath: WikiJsPage | null } }>(
        WIKIJS_PAGE,
        { path: path.join("/"), locale },
        signal,
      );
      if (!d.pages?.singleByPath) throw new Error("Wiki.js doesn't have this page any more");
      return wikiJsContent(d.pages.singleByPath, c.base);
    },
  };
}

function confluence(c: NonNullable<Config["confluence"]>): Wiki {
  const call = caller("confluence", c.base, basicAuth(c.email, c.token));
  const search = async (query: string, signal?: AbortSignal) => {
    const qs = new URLSearchParams({ cql: confluenceCql(query), limit: "25" });
    const r = await call<{ results: ConfluenceResult[] }>(`/wiki/rest/api/search?${qs}`, { signal });
    return r.results.map((x) => fromConfluence(x, c.base)).filter((p): p is Page => !!p);
  };
  return {
    id: "confluence",
    name: WIKIS.confluence,
    base: c.base,
    search,
    recent: (signal) => search("", signal),
    async content(page, signal) {
      const p = await call<ConfluencePage>(
        `/wiki/rest/api/content/${page.id}?expand=body.storage,version,metadata.labels`,
        { signal },
      );
      return confluenceContent(p, c.base);
    },
  };
}

// ---------------------------------------------------------------------------

/** The wikis set up in the preferences, in a fixed order; one that can't be built reports why. */
export function wikisOf(prefs: Record<string, unknown>): { wikis: Wiki[]; problems: SetupError[] } {
  const c = configured(prefs);
  const wikis: Wiki[] = [];
  const problems: SetupError[] = [];
  const build: Record<WikiId, () => Wiki | undefined> = {
    outline: () => c.outline && outline(c.outline),
    bookstack: () => c.bookstack && bookstack(c.bookstack),
    wikijs: () => c.wikijs && wikijs(c.wikijs),
    confluence: () => c.confluence && confluence(c.confluence),
  };
  for (const id of ORDER) {
    try {
      const w = build[id]();
      if (w) wikis.push(w);
    } catch (e) {
      if (e instanceof SetupError) problems.push(e);
      else throw e;
    }
  }
  return { wikis, problems };
}
