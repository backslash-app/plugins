import {
  action,
  copy,
  field,
  form,
  Icons,
  type Item,
  list,
  meta,
  type Metadata,
  open,
  pop,
  storage,
  toast,
} from "@backslash/api";
import { api, type App, apps, each, errorItems, SetupError, setupItem } from "../api.ts";
import {
  addBody,
  type Artist,
  fromLookup,
  type Kind,
  type LookupResult,
  type Movie,
  plural,
  type Series,
  webUrl,
} from "../lib.ts";
import { iconFor, searchAction } from "../views.ts";

interface Profile {
  id: number;
  name: string;
}
interface RootFolder {
  path: string;
  freeSpace?: number;
  accessible?: boolean;
}
type Defaults = {
  quality?: number;
  root?: string;
  monitor?: string | null;
  search?: boolean;
};

const LOOKUP: Record<Kind, string> = { sonarr: "/series/lookup", radarr: "/movie/lookup", lidarr: "/artist/lookup" };
const ADD: Record<Kind, string> = { sonarr: "/series", radarr: "/movie", lidarr: "/artist" };
const SECTION: Record<Kind, string> = { sonarr: "Series", radarr: "Movies", lidarr: "Artists" };

const SONARR_MONITOR = [
  { value: "all", title: "All episodes" },
  { value: "future", title: "Future episodes" },
  { value: "missing", title: "Missing episodes" },
  { value: "existing", title: "Existing episodes" },
  { value: "firstSeason", title: "First season" },
  { value: "latestSeason", title: "Latest season" },
  { value: "pilot", title: "Pilot episode" },
  { value: "none", title: "None" },
];
const RADARR_AVAILABILITY = [
  { value: "released", title: "Released" },
  { value: "inCinemas", title: "In cinemas" },
  { value: "announced", title: "Announced" },
];

const gb = (n?: number) => n ? `${Math.round(n / 1e9)} GB free` : "";

/** Profiles and folders barely change: loaded once per session. */
const options = new Map<
  string,
  Promise<{ quality: Profile[]; roots: RootFolder[]; language?: number; metadata?: Profile[] }>
>();
function loadOptions(app: App) {
  const key = `${app.base}|${app.key}`;
  if (!options.has(key)) {
    const p = (async () => {
      const [quality, roots, languages, metadata] = await Promise.all([
        api<Profile[]>(app, "/qualityprofile"),
        api<RootFolder[]>(app, "/rootfolder"),
        // Sonarr v3 needs a language profile; v4 dropped them.
        app.kind === "sonarr" ? api<Profile[]>(app, "/languageprofile").catch(() => undefined) : undefined,
        app.kind === "lidarr" ? api<Profile[]>(app, "/metadataprofile") : undefined,
      ]);
      return { quality, roots, language: languages?.[0]?.id, metadata };
    })();
    p.catch(() => options.delete(key));
    options.set(key, p);
  }
  return options.get(key)!;
}

async function addForm(app: App, r: LookupResult) {
  const o = await loadOptions(app);
  if (!o.quality.length) throw new Error(`${app.title} has no quality profile: create one in Settings → Profiles`);
  if (!o.roots.length) throw new Error(`${app.title} has no root folder: add one in Settings → Media Management`);
  const saved = (await storage.get<Defaults>(`defaults:${app.kind}`).catch(() => undefined)) ?? {};
  const quality = o.quality.some((q) => q.id === saved.quality) ? saved.quality! : o.quality[0].id;
  const root = o.roots.some((f) => f.path === saved.root) ? saved.root! : o.roots[0].path;
  const fields = [
    field.dropdown("quality", "Quality profile", o.quality.map((q) => ({ value: String(q.id), title: q.name })), {
      value: String(quality),
    }),
    field.dropdown(
      "root",
      "Root folder",
      o.roots.map((f) => ({ value: f.path, title: [f.path, gb(f.freeSpace)].filter(Boolean).join(" · ") })),
      { value: root },
    ),
  ];
  if (app.kind === "sonarr") {
    fields.push(field.dropdown("monitor", "Monitor", SONARR_MONITOR, { value: saved.monitor || "all" }));
  } else if (app.kind === "radarr") {
    fields.push(
      field.dropdown("monitor", "Minimum availability", RADARR_AVAILABILITY, { value: saved.monitor || "released" }),
    );
  } else if (o.metadata?.length) {
    fields.push(
      field.dropdown("metadata", "Metadata profile", o.metadata.map((m) => ({ value: String(m.id), title: m.name }))),
    );
  }
  fields.push(
    field.checkbox("monitored", "Monitored", { value: true }),
    field.checkbox("search", app.kind === "sonarr" ? "Search for missing episodes" : "Start search", {
      value: saved.search ?? true,
    }),
  );
  return form({
    title: `Add ${r.title}${r.year ? ` (${r.year})` : ""} to ${app.title}`,
    submitTitle: `Add to ${app.title}`,
    fields,
    async submit(values) {
      const choice = {
        qualityProfileId: Number(values.quality),
        rootFolderPath: String(values.root),
        monitored: values.monitored !== false,
        search: values.search === true,
        monitor: values.monitor ? String(values.monitor) : undefined,
        languageProfileId: o.language,
        metadataProfileId: values.metadata ? Number(values.metadata) : o.metadata?.[0]?.id,
      };
      await api(app, ADD[app.kind], { method: "POST", body: addBody(app.kind, r.raw, choice) });
      await storage.set(`defaults:${app.kind}`, {
        quality: choice.qualityProfileId,
        root: choice.rootFolderPath,
        monitor: choice.monitor ?? null,
        search: choice.search,
      }).catch(() => {});
      await toast(`Added ${r.title} to ${app.title}${choice.search ? ", searching" : ""}`, { style: "success" });
      return pop();
    },
  });
}

function resultItem(app: App, r: LookupResult): Item {
  const inLibrary = r.libraryId !== undefined;
  const metadata: Metadata[] = [];
  if (r.year) metadata.push(meta.text("Year", r.year, { icon: Icons.calendar }));
  if (r.network) metadata.push(meta.text(r.kind === "sonarr" ? "Network" : "Studio", r.network, { icon: Icons.radio }));
  if (r.seasons) metadata.push(meta.text("Seasons", r.seasons, { icon: Icons.layers }));
  if (r.runtime) metadata.push(meta.text("Runtime", `${r.runtime} min`, { icon: Icons.clock }));
  if (r.status) metadata.push(meta.text("Status", r.status[0].toUpperCase() + r.status.slice(1), { icon: Icons.info }));
  if (r.rating) metadata.push(meta.text("Rating", r.rating.toFixed(1), { icon: Icons.star }));
  if (r.genres?.length) metadata.push(meta.tags("Genres", r.genres.slice(0, 4)));
  metadata.push(
    meta.text("Library", inLibrary ? `In ${app.title}` : "Not added", {
      icon: inLibrary ? Icons.done : Icons.todo,
      color: inLibrary ? "green" : undefined,
    }),
  );
  const add = action(`Add to ${app.title}…`, () => addForm(app, r), { icon: Icons.plus });
  const page = open(webUrl(app.base, r.kind, r.slug), `Open in ${app.title}`, { icon: Icons.external });
  return {
    id: r.id,
    title: r.title,
    subtitle: [r.year, r.network].filter(Boolean).join(" · "),
    icon: iconFor(r.kind, r.poster),
    section: SECTION[r.kind],
    keywords: [app.title, ...(r.genres ?? [])],
    accessories: inLibrary
      ? [{ tag: "In library", color: "green" }]
      : r.seasons
      ? [{ text: plural(r.seasons, "season") }]
      : [],
    detail: {
      image: r.poster,
      markdown: r.overview ?? "",
      metadata,
    },
    actions: inLibrary
      ? [
        page,
        ...searchAction(
          app,
          r.kind === "radarr" ? { movie: r.libraryId } : r.kind === "sonarr" ? { series: r.libraryId } : {},
        ),
        copy(r.title, "Copy Title", { section: "Copy" }),
      ]
      : [add, copy(r.title, "Copy Title", { section: "Copy" })],
  };
}

export default list({
  placeholder: "Search a series, movie or artist to add…",
  empty: {
    title: "Type a title",
    description: "Sonarr, Radarr and Lidarr look it up on TheTVDB, TMDB and MusicBrainz",
    icon: Icons.search,
  },
  async search(query, { preferences, signal }) {
    let list: App[];
    try {
      list = apps(preferences);
    } catch (e) {
      if (e instanceof SetupError) return [setupItem(e)];
      throw e;
    }
    const term = query.trim();
    if (term.length < 2) return [];
    const r = await each(list, async (app) => {
      const found = await api<(Series | Movie | Artist)[]>(app, LOOKUP[app.kind], { signal, query: { term } });
      return (found ?? []).slice(0, 15).map((x) => fromLookup(app.kind, x));
    });
    if (signal.aborted) return [];
    return [
      ...errorItems(r.errors),
      ...r.ok.flatMap(([app, results]) => results.map((x) => resultItem(app, x))),
    ];
  },
});
