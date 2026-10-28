import { type Context, Icons, type Item, list, storage } from "@backslash/api";
import { posters, type Server, serversFrom } from "../api.ts";
import { type MediaItem, type MediaType, playerChoice } from "../lib.ts";
import { distro, findPlayer } from "../player.ts";
import { type Ctx, mediaItem, noPlayerItem, problemItem, serverErrorItem, setupItems } from "../views.ts";

const FILTERS: Record<string, MediaType[] | undefined> = {
  all: undefined,
  movies: ["movie"],
  shows: ["series", "season", "episode"],
  music: ["album", "track", "artist"],
};

/** A random id per installation, so the servers list Backslash as one device. */
async function deviceId(): Promise<string> {
  const saved = await storage.get<string>("deviceId").catch(() => undefined);
  if (typeof saved === "string" && saved) return saved;
  const id = `backslash-${crypto.randomUUID()}`;
  await storage.set("deviceId", id).catch(() => {});
  return id;
}

let status = "";

export default async (ctx: Context) => {
  const { servers, problems } = serversFrom(ctx.preferences, await deviceId());
  const c: Ctx = { players: playerChoice(ctx.preferences.player), multi: servers.length > 1 };
  const player = findPlayer(c.players);
  const connected = new Map<Server, Promise<void>>();
  const connect = (s: Server, signal: AbortSignal) => {
    let p = connected.get(s);
    if (!p) {
      p = s.connect(signal);
      p.catch(() => connected.delete(s));
      connected.set(s, p);
    }
    return p;
  };
  return list({
    placeholder: "Search movies, series, episodes and albums…",
    filter: {
      options: [
        { value: "all", title: "All" },
        { value: "movies", title: "Movies" },
        { value: "shows", title: "Shows" },
        { value: "music", title: "Music" },
      ],
    },
    empty: { title: "Nothing found", description: "Try another title", icon: Icons.film },
    status: () => status,
    async search(query, { signal, filter }) {
      const head: Item[] = problems.map(problemItem);
      if (!servers.length) {
        status = "Not connected";
        return [...head, ...(problems.length ? [] : setupItems())];
      }
      if (!await player) head.push(noPlayerItem(await distro()));
      const types = FILTERS[filter ?? "all"];
      const keep = (i: MediaItem) => !types || types.includes(i.type);
      const q = query.trim();
      const rows: { server: Server; item: MediaItem; section: string }[] = [];
      const errors: Item[] = [];
      await Promise.all(servers.map(async (s) => {
        try {
          await connect(s, signal);
          const suffix = c.multi ? ` · ${s.product}` : "";
          if (q) {
            for (const item of (await s.search(q, signal)).filter(keep)) {
              rows.push({ server: s, item, section: `Results${suffix}` });
            }
            return;
          }
          const [resume, next, latest] = await Promise.all([
            s.continueWatching(signal),
            types && !types.includes("episode") && !types.includes("movie") ? [] : s.nextUp(signal),
            s.recentlyAdded(signal),
          ]);
          for (const item of resume.filter(keep)) rows.push({ server: s, item, section: `Continue Watching${suffix}` });
          for (const item of next.filter(keep)) rows.push({ server: s, item, section: `Next Up${suffix}` });
          for (const item of latest.filter(keep)) rows.push({ server: s, item, section: `Recently Added${suffix}` });
        } catch (e) {
          if (signal.aborted) throw e;
          errors.push(serverErrorItem(s, e));
        }
      }));
      // Sections in a stable order: by kind, then server.
      const order = ["Continue Watching", "Next Up", "Recently Added", "Results"];
      rows.sort((a, b) =>
        order.findIndex((o) => a.section.startsWith(o)) - order.findIndex((o) => b.section.startsWith(o)) ||
        a.section.localeCompare(b.section)
      );
      const pics = await posters(rows, { signal, deadline: q ? 2000 : 3000 });
      status = [
        servers.map((s) => s.name).join(" · "),
        q ? `${rows.length} result${rows.length === 1 ? "" : "s"}` : "",
        errors.length ? `${errors.length} failed` : "",
      ].filter(Boolean).join(" · ");
      return [
        ...head,
        ...errors,
        ...rows.map((r) => mediaItem(r.server, r.item, pics.get(r.item), c, { section: r.section, showType: !!q })),
      ];
    },
  });
};
