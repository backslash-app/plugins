// Movies and shows as launcher items.

import {
  type Accessory,
  type Action,
  action,
  copy,
  Icons,
  type Item,
  meta,
  type Metadata,
  open,
  refresh,
  type Stat,
  toast,
} from "@backslash/api";
import { toggleWatch } from "./api.ts";
import {
  duration,
  imdbUrl,
  longDate,
  plural,
  poster,
  rating,
  ratingColor,
  summaryLine,
  type Title,
  tmdbUrl,
  youtubeUrl,
} from "./lib.ts";

const LANGUAGES = new Intl.DisplayNames(["en"], { type: "language" });
const languageName = (code: string | undefined) => {
  if (!code) return undefined;
  try {
    return LANGUAGES.of(code);
  } catch {
    return code;
  }
};

export function titleMetadata(t: Title, region: string): Metadata[] {
  const lines: Metadata[] = [];
  if (t.genres.length) lines.push(meta.tags("Genres", t.genres.map((g) => ({ text: g, color: "purple" as const }))));
  if (t.date) {
    lines.push(meta.text(t.kind === "movie" ? "Released" : "First aired", longDate(t.date), { icon: Icons.calendar }));
  }
  if (t.kind === "movie" && t.runtime) lines.push(meta.text("Runtime", duration(t.runtime)!, { icon: Icons.clock }));
  if (t.kind === "tv" && t.seasons) {
    lines.push(
      meta.text(
        "Seasons",
        `${plural(t.seasons, "season")}${t.episodes ? ` · ${plural(t.episodes, "episode")}` : ""}${
          t.runtime ? ` · ${t.runtime} min` : ""
        }`,
        { icon: Icons.layers },
      ),
    );
  }
  if (t.nextEpisode) lines.push(meta.text("Next episode", t.nextEpisode, { icon: Icons.calendar }));
  if (t.certification) lines.push(meta.tags(`Rated (${region})`, [t.certification]));
  if (t.directors?.length) {
    lines.push(meta.person(t.kind === "movie" ? "Director" : "Created by", t.directors.slice(0, 3).join(", ")));
  }
  if (t.cast?.length) {
    lines.push(meta.separator());
    t.cast.forEach((c, i) =>
      lines.push(meta.person(i ? "" : "Cast", c.character ? `${c.name} as ${c.character}` : c.name, c.name))
    );
  }
  if (t.watch) {
    lines.push(meta.separator());
    const groups: [string, string[], "green" | "teal" | "blue" | "gray"][] = [
      ["Stream", t.watch.stream, "green"],
      ["Free", t.watch.free, "teal"],
      ["Rent", t.watch.rent, "blue"],
      ["Buy", t.watch.buy, "gray"],
    ];
    for (const [label, names, color] of groups) {
      if (names.length) lines.push(meta.tags(label, names.slice(0, 5).map((text) => ({ text, color }))));
    }
    if (!groups.some(([, names]) => names.length)) lines.push(meta.text("Where to watch", `Nowhere in ${region}`));
  } else if (t.full) {
    lines.push(meta.text("Where to watch", `No streaming service in ${region}`, { icon: Icons.eyeOff }));
  }
  lines.push(meta.separator());
  if (t.network) lines.push(meta.text("Network", t.network, { icon: Icons.monitor }));
  if (t.status) lines.push(meta.text("Status", t.status));
  if (t.originalTitle) lines.push(meta.text("Original title", t.originalTitle));
  const lang = languageName(t.language);
  if (lang) lines.push(meta.text("Language", lang, { icon: Icons.globe }));
  lines.push(meta.link("TMDB", `themoviedb.org/${t.kind}/${t.id}`, tmdbUrl(t)));
  if (t.imdb) lines.push(meta.link("IMDb", t.imdb, imdbUrl(t.imdb)));
  return lines;
}

export function titleItem(t: Title, o: { watched: boolean; region: string; section?: string }): Item {
  const stats: Stat[] = [];
  if (t.rating !== undefined) {
    stats.push({ label: "Rating", value: `★ ${rating(t.rating)}`, color: ratingColor(t.rating) });
  }
  if (t.year) stats.push({ label: "Year", value: t.year });
  if (t.kind === "movie" && t.runtime) stats.push({ label: "Runtime", value: duration(t.runtime)! });
  if (t.kind === "tv" && t.seasons) stats.push({ label: "Seasons", value: t.seasons });

  const accessories: Accessory[] = [];
  if (o.watched && o.section !== "Watchlist") {
    accessories.push({ icon: { source: Icons.bookmark, tint: "yellow" }, tooltip: "In your watchlist" });
  }
  if (t.watch?.stream.length) {
    accessories.push({ tag: t.watch.stream[0], color: "green", tooltip: `Streaming on ${t.watch.stream.join(", ")}` });
  }
  if (t.rating !== undefined) {
    accessories.push({
      text: rating(t.rating),
      icon: { source: Icons.starFilled, tint: ratingColor(t.rating) },
      tooltip: `${rating(t.rating)}/10 from ${t.votes ?? 0} votes`,
    });
  }

  const actions: Action[] = [open(tmdbUrl(t), "Open on TMDB")];
  if (t.trailer) {
    actions.push(
      open(youtubeUrl(t.trailer.key), "Watch Trailer on YouTube", { icon: Icons.play, shortcut: "<Ctrl>t" }),
    );
  }
  if (t.watch?.link) {
    actions.push(open(t.watch.link, `Where to Watch in ${o.region}`, { icon: Icons.monitor, shortcut: "<Ctrl>w" }));
  }
  actions.push(
    action(o.watched ? "Remove from Watchlist" : "Add to Watchlist", async () => {
      const now = await toggleWatch(t);
      await toast(`${t.title} ${now ? "added to" : "removed from"} the watchlist`, { style: "success" });
      return refresh();
    }, { icon: o.watched ? Icons.bookmark : Icons.plus, shortcut: "<Ctrl>s" }),
  );
  if (t.imdb) actions.push(open(imdbUrl(t.imdb), "Open on IMDb", { section: "Open" }));
  if (t.homepage) actions.push(open(t.homepage, "Open Official Website", { section: "Open" }));
  actions.push(
    copy(tmdbUrl(t), "Copy TMDB Link", { section: "Copy", shortcut: "<Ctrl><Shift>c" }),
    copy(t.year ? `${t.title} (${t.year})` : t.title, "Copy Title", { section: "Copy" }),
    ...(t.trailer ? [copy(youtubeUrl(t.trailer.key), "Copy Trailer Link", { section: "Copy" })] : []),
  );

  const md = [
    ...(t.tagline ? [`*${t.tagline}*`, ""] : []),
    t.overview ?? "No overview yet.",
  ];
  return {
    id: `${o.section ?? ""}:${t.kind}:${t.id}`,
    title: t.title,
    subtitle: summaryLine(t),
    section: o.section,
    icon: poster(t.poster, "w92") ?? { source: t.kind === "movie" ? Icons.film : Icons.monitor, tint: "purple" },
    keywords: [...t.genres, t.originalTitle ?? "", t.kind === "movie" ? "movie" : "tv show series"],
    accessories,
    detail: {
      image: poster(t.poster, "w342"),
      stats: stats.length ? stats : undefined,
      markdown: md.join("\n"),
      metadata: titleMetadata(t, o.region),
    },
    actions,
  };
}
