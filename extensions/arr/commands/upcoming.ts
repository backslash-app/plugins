import { copy, Icons, type Item, list, meta, type Metadata, open, updateCommandMetadata } from "@backslash/api";
import { api, type App, apps, each, errorItems, SetupError, setupItem } from "../api.ts";
import {
  type Album,
  APPS,
  type CalendarEntry,
  dayLabel,
  type Episode,
  fromAlbum,
  fromEpisode,
  fromMovie,
  type Kind,
  missingLine,
  missingMovies,
  type Movie,
  sortCalendar,
  startOfDay,
  timeOf,
  webUrl,
} from "../lib.ts";
import { iconFor, loadPosters, searchAction } from "../views.ts";

const DAYS = 14;

async function calendar(app: App, start: number, end: number, signal: AbortSignal): Promise<CalendarEntry[]> {
  const query = { start: new Date(start).toISOString(), end: new Date(end).toISOString(), unmonitored: false };
  if (app.kind === "sonarr") {
    const eps = await api<Episode[]>(app, "/calendar", { signal, query: { ...query, includeSeries: true } });
    return eps.map(fromEpisode);
  }
  if (app.kind === "radarr") {
    const movies = await api<Movie[]>(app, "/calendar", { signal, query });
    return movies.flatMap((m) => fromMovie(m, start, end));
  }
  const albums = await api<Album[]>(app, "/calendar", { signal, query: { ...query, includeArtist: true } });
  return albums.map(fromAlbum);
}

/** Monitored and missing: Sonarr episodes, Radarr movies (counted from the library before v5), Lidarr albums. */
async function missing(app: App, signal: AbortSignal): Promise<number> {
  try {
    const r = await api<{ totalRecords?: number }>(app, "/wanted/missing", {
      signal,
      query: { page: 1, pageSize: 1, monitored: true },
    });
    return r?.totalRecords ?? 0;
  } catch (e) {
    if (app.kind !== "radarr" || (e instanceof SetupError && e.kind !== "url")) throw e;
    return missingMovies(await api<Movie[]>(app, "/movie", { signal }));
  }
}

function entryItem(app: App, e: CalendarEntry, poster?: string): Item {
  const day = dayLabel(e.date);
  const when = e.hasTime ? `${day}, ${timeOf(e.date)}` : day;
  const metadata: Metadata[] = [
    meta.text(e.label, when, { icon: Icons.calendar }),
    meta.text("Status", e.hasFile ? "Downloaded" : e.date > Date.now() ? "Not aired yet" : "Missing", {
      icon: e.hasFile ? Icons.done : Icons.todo,
      color: e.hasFile ? "green" : e.date > Date.now() ? undefined : "orange",
    }),
  ];
  if (e.finale) metadata.push(meta.tags("Finale", [{ text: e.finale, color: "purple" }]));
  if (e.network) metadata.push(meta.text(e.kind === "sonarr" ? "Network" : "Studio", e.network, { icon: Icons.radio }));
  if (e.runtime) metadata.push(meta.text("Runtime", `${e.runtime} min`, { icon: Icons.clock }));
  if (e.genres?.length) metadata.push(meta.tags("Genres", e.genres.slice(0, 4)));
  metadata.push(meta.link("In", APPS[e.kind].title, webUrl(app.base, e.kind, e.slug)));

  const accessories: Item["accessories"] = [];
  if (e.hasFile) accessories.push({ icon: { source: Icons.check, tint: "green" }, tooltip: "Downloaded" });
  if (e.finale) accessories.push({ tag: "Finale", color: "purple" });
  else if (e.label.includes("premiere")) accessories.push({ tag: "Premiere", color: "blue" });
  accessories.push({ text: e.hasTime ? timeOf(e.date) : e.kind === "radarr" ? e.label.replace(" release", "") : "" });

  return {
    id: e.id,
    title: e.title,
    subtitle: e.what,
    icon: iconFor(e.kind, poster),
    section: day,
    keywords: [APPS[e.kind].title, e.label, e.network ?? ""],
    accessories: accessories.filter((a) => a.text !== "" || a.icon || a.tag),
    detail: {
      image: poster,
      markdown: [`### ${e.title}`, "", `**${e.what}**`, "", e.overview ?? ""].join("\n"),
      metadata,
    },
    actions: [
      open(webUrl(app.base, e.kind, e.slug), `Open in ${APPS[e.kind].title}`, { icon: Icons.external }),
      ...(e.hasFile ? [] : searchAction(app, {
        episode: e.kind === "sonarr" ? e.itemId : undefined,
        movie: e.kind === "radarr" ? e.itemId : undefined,
        album: e.kind === "lidarr" ? e.itemId : undefined,
      })),
      copy(e.title, "Copy Title", { section: "Copy" }),
      copy(`${e.title} ${e.what}`, "Copy Title and Episode", { section: "Copy" }),
    ],
  };
}

let footer = "";

export default list({
  placeholder: "Filter upcoming episodes, movies and albums…",
  filter: {
    options: [
      { value: "all", title: "All" },
      { value: "sonarr", title: "Episodes" },
      { value: "radarr", title: "Movies" },
      { value: "lidarr", title: "Albums" },
    ],
    default: "all",
  },
  empty: {
    title: "Nothing coming up",
    description: `No monitored episode, movie or album in the next ${DAYS} days`,
    icon: Icons.calendar,
  },
  status: () => footer,
  async *items({ preferences, signal, filter }) {
    let list: App[];
    try {
      list = apps(preferences);
    } catch (e) {
      if (e instanceof SetupError) {
        yield [setupItem(e)];
        return;
      }
      throw e;
    }
    const shown = filter && filter !== "all" ? list.filter((a) => a.kind === filter) : list;
    const start = startOfDay(Date.now());
    const end = start + DAYS * 86_400_000;
    const [cal, miss] = await Promise.all([
      each(shown, (app) => calendar(app, start, end, signal)),
      each(list, (app) => missing(app, signal)),
    ]);
    const counts: Partial<Record<Kind, number>> = Object.fromEntries(miss.ok.map(([a, n]) => [a.kind, n]));
    const line = missingLine(counts);
    updateCommandMetadata({ subtitle: line ?? null }).catch(() => {});
    const entries = cal.ok.flatMap(([app, es]) => es.map((e) => [app, e] as [App, CalendarEntry]));
    const sorted = sortCalendar(entries.map(([, e]) => e));
    const appOf = new Map(entries.map(([a, e]) => [e, a]));
    footer = [
      `${sorted.length} in the next ${DAYS} days`,
      line,
    ].filter(Boolean).join(" · ");
    const errors = errorItems([...cal.errors]);
    const rows = (pics?: Map<CalendarEntry, string>) => [
      ...errors,
      ...sorted.map((e) => entryItem(appOf.get(e)!, e, pics?.get(e))),
    ];
    yield rows();
    if (!sorted.length) return;
    yield rows(await loadPosters(entries, signal));
  },
});
