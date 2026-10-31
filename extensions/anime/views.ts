// Rows, previews and actions of the three commands.

import {
  type Action,
  action,
  copy,
  field,
  form,
  Icons,
  type Item,
  meta,
  open,
  pop,
  refresh,
  toast,
} from "@backslash/api";
import { saveProgress } from "./api.ts";
import {
  aired,
  type Airing,
  behind,
  clock,
  countdown,
  type Entry,
  type Media,
  progressText,
  progressUpdate,
  type Settings,
  tintOf,
} from "./lib.ts";

const STATUS: Record<string, string> = {
  RELEASING: "Airing",
  FINISHED: "Finished",
  NOT_YET_RELEASED: "Not yet aired",
  CANCELLED: "Cancelled",
  HIATUS: "On hiatus",
};

const LIST_STATUS: Record<string, string> = {
  CURRENT: "Watching",
  REPEATING: "Rewatching",
  COMPLETED: "Completed",
  PAUSED: "Paused",
  DROPPED: "Dropped",
  PLANNING: "Planning",
};

function mediaMetadata(m: Media) {
  return [
    ...(m.format ? [meta.text("Format", m.format)] : []),
    ...(m.status
      ? [meta.text("Status", STATUS[m.status] ?? m.status, { color: m.status === "RELEASING" ? "green" : undefined })]
      : []),
    ...(m.episodes ? [meta.text("Episodes", m.episodes)] : []),
    ...(m.chapters ? [meta.text("Chapters", m.chapters)] : []),
    ...(m.season ? [meta.text("Season", m.season, { icon: Icons.calendar })] : []),
    ...(m.studio ? [meta.text("Studio", m.studio)] : []),
    ...(m.score ? [meta.text("Average score", `${m.score} %`, { icon: Icons.star })] : []),
    ...(m.genres.length ? [meta.tags("Genres", m.genres.slice(0, 6))] : []),
    ...(m.titles.length ? [meta.separator(), ...m.titles.slice(0, 2).map((t) => meta.text("Also", t))] : []),
  ];
}

function nextLine(m: Media, now: number): string | undefined {
  return m.next ? `Episode ${m.next.episode} ${countdown(m.next.at, now)}` : undefined;
}

function openActions(m: Media, source: "anilist" | "myanimelist"): Action[] {
  const anilist = source === "anilist" || !m.url.includes("myanimelist")
    ? open(m.url, "Open on AniList", { icon: Icons.globe })
    : undefined;
  const mal = m.malId
    ? open(`https://myanimelist.net/${m.type === "MANGA" ? "manga" : "anime"}/${m.malId}`, "Open on MyAnimeList", {
      icon: Icons.globe,
    })
    : undefined;
  return (source === "myanimelist" ? [mal, anilist] : [anilist, mal]).filter((a): a is Action => !!a);
}

function progressForm(e: Entry, token: string) {
  return form({
    title: `Episodes watched: ${e.media.title}`,
    submitTitle: "Save",
    fields: [
      field.text("progress", `Episode (0–${e.media.episodes ?? "?"})`, { value: String(e.progress), required: true }),
    ],
    async submit(values) {
      const n = Number(values.progress);
      if (!Number.isInteger(n) || n < 0) {
        await toast("Type a whole number of episodes", { style: "failure" });
        return;
      }
      const u = progressUpdate(e, n);
      const saved = await saveProgress(token, e.entryId!, u.progress, u.status);
      await toast(u.status === "COMPLETED" ? `Completed ${e.media.title}` : `Episode ${saved} saved`, {
        style: "success",
      });
      return pop();
    },
  });
}

export function entryItem(e: Entry, s: Settings, extra: Action[], now = Date.now()): Item {
  const m = e.media;
  const todo = behind(e);
  const canSave = e.source === "anilist" && !!s.anilistToken && !!e.entryId;
  const atEnd = !!m.episodes && e.progress >= m.episodes;
  const plusOne = canSave && !atEnd
    ? [action(`Watched Episode ${e.progress + 1}`, async () => {
      const u = progressUpdate(e, e.progress + 1);
      const saved = await saveProgress(s.anilistToken!, e.entryId!, u.progress, u.status);
      await toast(u.status === "COMPLETED" ? `Completed ${m.title}` : `${m.title}: episode ${saved}`, {
        style: "success",
      });
      return refresh();
    }, { icon: Icons.plus, shortcut: "<Ctrl>i" })]
    : [];
  return {
    id: `${e.source}:${m.id}`,
    title: m.title,
    subtitle: [`Ep ${progressText(e)}`, nextLine(m, now)].filter(Boolean).join(" · "),
    icon: m.cover ?? { source: Icons.film, tint: tintOf(m.color) },
    section: todo ? "Ready to watch" : m.next ? "Waiting for the next episode" : "Watching",
    keywords: m.titles,
    accessories: [
      ...(todo
        ? [{
          tag: `${todo} new`,
          color: "green" as const,
          tooltip: `${todo} aired episode${todo === 1 ? "" : "s"} to watch`,
        }]
        : []),
      ...(m.next
        ? [{
          text: countdown(m.next.at, now).replace(/^in /, ""),
          icon: Icons.clock,
          tooltip: `Episode ${m.next.episode} on ${new Date(m.next.at).toLocaleString("en-GB")}`,
        }]
        : []),
      { text: progressText(e), tooltip: "Episodes watched" },
    ],
    detail: {
      image: m.cover,
      stats: [
        { label: "Watched", value: progressText(e) },
        ...(aired(m) !== undefined ? [{ label: "Aired", value: aired(m)! }] : []),
        ...(m.next
          ? [{ label: `Ep ${m.next.episode}`, value: countdown(m.next.at, now), color: "blue" as const }]
          : []),
      ],
      metadata: [
        meta.progress("Progress", m.episodes ? e.progress / m.episodes : 0, progressText(e)),
        meta.text("List", LIST_STATUS[e.status] ?? e.status),
        ...(e.score ? [meta.text("Your score", `${e.score} / 10`, { icon: Icons.starFilled })] : []),
        ...(m.next
          ? [
            meta.text(
              "Next episode",
              `${m.next.episode}, ${
                new Date(m.next.at).toLocaleString("en-GB", {
                  weekday: "short",
                  day: "numeric",
                  month: "short",
                  hour: "2-digit",
                  minute: "2-digit",
                })
              }`,
              { icon: Icons.clock },
            ),
          ]
          : []),
        meta.separator(),
        ...mediaMetadata(m),
      ],
    },
    actions: [
      ...plusOne,
      ...openActions(m, e.source),
      ...(canSave
        ? [
          action("Set Episodes Watched…", () => progressForm(e, s.anilistToken!), {
            icon: Icons.hash,
            shortcut: "<Ctrl>e",
          }),
        ]
        : []),
      copy(m.title, "Copy Title", { section: "Copy" }),
      ...extra,
    ],
  };
}

export function airingItem(
  a: Airing,
  onList: Map<number, Entry>,
  extra: Action[],
  section: string,
  now = Date.now(),
): Item {
  const m = a.media;
  const mine = onList.get(m.id) ?? (m.malId ? onList.get(-m.malId) : undefined);
  const aired = a.at <= now;
  return {
    id: `airing:${a.id}`,
    title: m.title,
    subtitle: `Episode ${a.episode}${m.episodes ? ` of ${m.episodes}` : ""}${m.format ? ` · ${m.format}` : ""}`,
    icon: m.cover ?? { source: Icons.film, tint: tintOf(m.color) },
    section,
    keywords: [...m.titles, ...m.genres],
    accessories: [
      ...(mine ? [{ tag: "On your list", color: "purple" as const, tooltip: `You've watched ${mine.progress}` }] : []),
      { text: clock(a.at), icon: Icons.clock, tooltip: aired ? "Aired" : countdown(a.at, now) },
      ...(aired ? [{ tag: "Aired", color: "gray" as const }] : []),
    ],
    detail: {
      image: m.cover,
      stats: [
        { label: "Episode", value: a.episode },
        {
          label: aired ? "Aired" : "Airs",
          value: aired ? clock(a.at) : countdown(a.at, now),
          color: aired ? "gray" : "blue",
        },
        ...(m.score ? [{ label: "Score", value: `${m.score} %` }] : []),
      ],
      metadata: [
        meta.text(
          "Airs",
          new Date(a.at).toLocaleString("en-GB", {
            weekday: "long",
            day: "numeric",
            month: "long",
            hour: "2-digit",
            minute: "2-digit",
          }),
          { icon: Icons.calendar },
        ),
        ...(mine ? [meta.text("Your progress", progressText(mine), { color: "purple" })] : []),
        meta.separator(),
        ...mediaMetadata(m),
      ],
    },
    actions: [...openActions(m, "anilist"), copy(m.title, "Copy Title"), ...extra],
  };
}

export function mediaItem(m: Media): Item {
  const count = m.type === "MANGA"
    ? (m.chapters ? `${m.chapters} ch.` : undefined)
    : m.episodes
    ? `${m.episodes} ep.`
    : undefined;
  return {
    id: `media:${m.id}`,
    title: m.title,
    subtitle: [m.format, m.season, m.studio].filter(Boolean).join(" · "),
    icon: m.cover ?? { source: m.type === "MANGA" ? Icons.book : Icons.film, tint: tintOf(m.color) },
    keywords: m.titles,
    accessories: [
      ...(m.entry
        ? [{
          tag: LIST_STATUS[m.entry.status] ?? m.entry.status,
          color: "purple" as const,
          tooltip: `Progress ${m.entry.progress}`,
        }]
        : []),
      ...(m.status === "RELEASING" ? [{ tag: "Airing", color: "green" as const }] : []),
      ...(count ? [{ text: count }] : []),
      ...(m.score ? [{ text: `${m.score} %`, icon: Icons.star, tooltip: "Average score" }] : []),
    ],
    detail: {
      image: m.cover,
      markdown: [
        `## ${m.title}`,
        ...(m.native && m.native !== m.title ? [`_${m.native}_`] : []),
        "",
        m.description
          ? (m.description.length > 1200 ? `${m.description.slice(0, 1200)}…` : m.description)
          : "_No description._",
      ].join("\n"),
      metadata: [
        ...(m.next
          ? [meta.text("Next episode", `${m.next.episode}, ${countdown(m.next.at)}`, { icon: Icons.clock })]
          : []),
        ...(m.entry
          ? [
            meta.text("Your list", `${LIST_STATUS[m.entry.status] ?? m.entry.status}, ${m.entry.progress}`, {
              color: "purple",
            }),
          ]
          : []),
        ...mediaMetadata(m),
      ],
    },
    actions: [...openActions(m, "anilist"), copy(m.title, "Copy Title"), copy(m.url, "Copy Link", { section: "Copy" })],
  };
}

export function setupItem(message?: string): Item {
  return {
    id: "setup",
    title: message ?? "Connect your AniList or MyAnimeList",
    subtitle: "Settings → Extensions → Anime",
    icon: { source: Icons.settings, tint: "orange" },
    detail: {
      markdown: [
        "## Your anime list",
        "",
        "**AniList** (recommended, needed to mark episodes watched):",
        "",
        "- the **user name** of a public profile shows your list, or",
        "- a **token** also lets you mark episodes watched: create a client on **anilist.co/settings/developer**",
        "  with the redirect URL `https://anilist.co/api/v2/oauth/pin`, open",
        "  `https://anilist.co/api/v2/oauth/authorize?client_id=<its id>&response_type=token`, and paste the token.",
        "",
        "**MyAnimeList** (read-only): your user name and the **Client ID** of an app created on",
        "**myanimelist.net/apiconfig**.",
      ].join("\n"),
    },
    actions: [
      open("https://anilist.co/settings/developer", "Open AniList Developer Settings", { icon: Icons.key }),
      open("https://myanimelist.net/apiconfig", "Open MyAnimeList API Settings", { icon: Icons.key }),
    ],
  };
}

export function errorItem(e: unknown, source = "AniList"): Item {
  return {
    id: "error",
    title: `Couldn't load ${source}`,
    subtitle: (e as Error).message,
    icon: { source: Icons.alert, tint: "orange" },
  };
}
