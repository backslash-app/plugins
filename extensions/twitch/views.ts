// Streams, channels, categories and setup as launcher items.

import {
  type Accessory,
  type Action,
  action,
  close,
  copy,
  Icons,
  type Item,
  list,
  type ListSpec,
  meta,
  open,
  refresh,
  toast,
} from "@backslash/api";
import { NoPlayer, play, streamsIn } from "./api.ts";
import {
  type Auth,
  type AuthError,
  boxArtUrl,
  type Category,
  categoryUrl,
  type Channel,
  channelUrl,
  chatUrl,
  compact,
  CONSOLE_URL,
  DEFAULT_PORT,
  type Family,
  installCommand,
  previewUrl,
  SCOPES,
  type Stream,
  uptime,
  viewers,
} from "./lib.ts";

export interface Ctx {
  auth: Auth;
  /** What Enter does on a stream. */
  enter: "browser" | "player";
  quality: string;
  now?: number;
}

function playAction(login: string, c: Ctx, audioOnly = false): Action {
  return action(audioOnly ? "Play Audio Only" : "Play in Player", async () => {
    try {
      const tool = await play(login, { audioOnly, quality: c.quality });
      return close(`Opening ${login} in ${tool}`);
    } catch (e) {
      if (e instanceof NoPlayer) {
        await toast(e.message, { style: "failure", message: "Enter opens the stream in the browser" });
        return;
      }
      throw e;
    }
  }, { icon: audioOnly ? Icons.headphones : Icons.play, shortcut: audioOnly ? "<Ctrl><Shift>p" : "<Ctrl>p" });
}

function channelActions(login: string, c: Ctx, live: boolean, extra: Action[] = []): Action[] {
  const browser = open(channelUrl(login), "Open in Browser", { icon: Icons.globe, shortcut: "<Ctrl>o" });
  const actions: Action[] = live
    ? (c.enter === "player" ? [playAction(login, c), browser] : [browser, playAction(login, c)])
    : [browser];
  if (live) actions.push(playAction(login, c, true));
  actions.push(
    open(chatUrl(login), "Open Chat", { icon: Icons.comment, shortcut: "<Ctrl>t" }),
    ...extra,
    copy(channelUrl(login), "Copy URL", { section: "Copy", shortcut: "<Ctrl><Shift>c" }),
    copy(login, "Copy Channel Name", { section: "Copy" }),
  );
  return actions;
}

export function categoryView(cat: Pick<Category, "id" | "name" | "box_art_url">, c: Ctx): ListSpec {
  return list({
    title: cat.name,
    placeholder: `Filter ${cat.name} streams…`,
    empty: { title: `Nobody is streaming ${cat.name}`, icon: Icons.video },
    status: (items) => `${items.length} live in ${cat.name}`,
    async items({ signal }) {
      const streams = await streamsIn(c.auth, cat.id, signal);
      return streams.map((s, i) => streamItem(s, c, { section: i < 5 ? "Top Streams" : "Live" }));
    },
    actions: [open(categoryUrl(cat.name), "Open Category in Browser", { icon: Icons.globe })],
  });
}

export function streamItem(s: Stream, c: Ctx, o: { section?: string; avatar?: string } = {}): Item {
  const now = c.now ?? Date.now();
  const up = uptime(s.started_at, now);
  const accessories: Accessory[] = [];
  if (s.viewer_count) {
    accessories.push({
      text: compact(s.viewer_count),
      icon: { source: Icons.eye, tint: "red" },
      tooltip: viewers(s.viewer_count),
    });
  }
  if (up) accessories.push({ text: up, icon: Icons.clock, tooltip: "Live for" });
  accessories.push({ avatar: o.avatar ?? s.user_name, tooltip: s.user_name });
  const tags = (s.tags ?? []).slice(0, 5);
  return {
    id: `stream:${s.user_id}:${o.section ?? ""}`,
    title: s.user_name,
    subtitle: [s.game_name, s.title].filter(Boolean).join(" · "),
    section: o.section,
    icon: { source: Icons.video, tint: "purple" },
    keywords: [s.user_login, s.game_name, ...tags],
    accessories,
    detail: {
      image: previewUrl(s.thumbnail_url, now),
      markdown: `**${s.title.replace(/[*_`[\]]/g, "\\$&")}**`,
      stats: [
        ...(s.viewer_count ? [{ label: "Viewers", value: compact(s.viewer_count), color: "red" as const }] : []),
        ...(up ? [{ label: "Uptime", value: up }] : []),
      ],
      metadata: [
        meta.person("Channel", s.user_name, o.avatar),
        ...(s.game_name ? [meta.text("Playing", s.game_name, { icon: Icons.gamepad })] : []),
        ...(s.language ? [meta.text("Language", s.language.toUpperCase(), { icon: Icons.globe })] : []),
        ...(tags.length ? [meta.tags("Tags", tags.map((t) => ({ text: t, color: "purple" as const })))] : []),
        ...(s.is_mature ? [meta.tags("Audience", [{ text: "Mature", color: "red" }])] : []),
        meta.separator(),
        meta.link("Channel", `twitch.tv/${s.user_login}`, channelUrl(s.user_login)),
      ],
    },
    actions: channelActions(
      s.user_login,
      c,
      true,
      s.game_id
        ? [action(`More ${s.game_name}`, () => categoryView({ id: s.game_id, name: s.game_name, box_art_url: "" }, c), {
          icon: Icons.gamepad,
          shortcut: "<Ctrl>g",
        })]
        : [],
    ),
  };
}

/** An offline channel of the search results. */
export function channelItem(ch: Channel, c: Ctx): Item {
  return {
    id: `channel:${ch.id}`,
    title: ch.display_name,
    subtitle: ch.game_name ? `Offline · last streamed ${ch.game_name}` : "Offline",
    section: "Channels",
    icon: ch.thumbnail_url || { source: Icons.person, tint: "gray" },
    keywords: [ch.broadcaster_login],
    accessories: [{ tag: "Offline", color: "gray" }],
    detail: {
      image: ch.thumbnail_url || undefined,
      markdown: ch.title ? `Last title: **${ch.title.replace(/[*_`[\]]/g, "\\$&")}**` : "",
      metadata: [
        meta.person("Channel", ch.display_name, ch.thumbnail_url || undefined),
        ...(ch.game_name ? [meta.text("Category", ch.game_name, { icon: Icons.gamepad })] : []),
        ...(ch.broadcaster_language ? [meta.text("Language", ch.broadcaster_language.toUpperCase())] : []),
        meta.link("Channel", `twitch.tv/${ch.broadcaster_login}`, channelUrl(ch.broadcaster_login)),
      ],
    },
    actions: channelActions(ch.broadcaster_login, c, false),
  };
}

export function categoryItem(cat: Category, c: Ctx, o: { section?: string; rank?: number } = {}): Item {
  const art = cat.box_art_url ? boxArtUrl(cat.box_art_url) : undefined;
  return {
    id: `category:${cat.id}`,
    title: cat.name,
    subtitle: o.rank ? `#${o.rank} on Twitch` : undefined,
    section: o.section,
    icon: art ?? { source: Icons.gamepad, tint: "purple" },
    detail: { image: art, metadata: [meta.text("Category", cat.name, { icon: Icons.gamepad })] },
    actions: [
      action("Show Top Streams", () => categoryView(cat, c), { icon: Icons.video }),
      open(categoryUrl(cat.name), "Open in Browser", { shortcut: "<Ctrl>o" }),
      copy(categoryUrl(cat.name), "Copy URL", { section: "Copy", shortcut: "<Ctrl><Shift>c" }),
    ],
  };
}

// ---------------------------------------------------------------------------
// Setup

const SETTINGS = "**Settings → Extensions → Twitch → Configure**";

export function setupItems(error: AuthError, prefs: Record<string, unknown>): Item[] {
  if (error.kind === "expired") {
    return [{
      id: "setup",
      title: error.message,
      subtitle: prefs.accessToken ? "Paste a new user access token" : "Sign in again in the browser",
      icon: { source: Icons.key, tint: "orange" },
      detail: {
        markdown: prefs.accessToken
          ? `## Token expired\n\nUser access tokens last a few hours to a few weeks. Create a new one and paste it in ${SETTINGS}.`
          : "## Signed out\n\nPress Enter to sign in again.",
      },
      actions: [action("Try Again", () => refresh(), { icon: Icons.refresh })],
    }];
  }
  const port = Number(prefs.redirectPort) || DEFAULT_PORT;
  return [{
    id: "setup",
    title: error.message,
    subtitle: "Twitch signs in through an app of your own",
    icon: { source: Icons.key, tint: "orange" },
    detail: {
      markdown: [
        "## Connect Twitch",
        "",
        "Twitch only lets desktop apps sign in with an app you register (free, a minute):",
        "",
        "1. Open the **Twitch developer console → Register Your Application** (Enter).",
        "2. Name it *Backslash*, category *Application Integration*, client type **Confidential**, and add",
        `   the OAuth redirect URL \`http://127.0.0.1:${port}/callback\` (what Backslash sends).`,
        "3. Copy its **Client ID**, then **New Secret**, to " + SETTINGS + ".",
        "4. Open **Twitch** again: your browser asks you to allow access, then the launcher comes back.",
        "",
        "### Or paste a token",
        "",
        "If the console refuses that address, use the official Twitch CLI: add the redirect URL",
        "`http://localhost:3000` to the app, run `twitch configure` (same Client ID and secret), then",
        `\`twitch token -u -s '${SCOPES.join(" ")}'\`, and paste the user access token in ${SETTINGS}`,
        "(keep the Client ID). Tokens expire: paste a new one when asked.",
      ].join("\n"),
    },
    actions: [
      open(CONSOLE_URL, "Open Twitch Developer Console", { icon: Icons.key }),
      open("https://dev.twitch.tv/docs/cli/token-command/", "Twitch CLI Token Command"),
    ],
  }];
}

export function noPlayerItem(family: Family | undefined): Item {
  const cmd = installCommand(family);
  return {
    id: "no-player",
    title: "Install streamlink to watch here",
    subtitle: family ? cmd : "Streams open in the browser meanwhile",
    section: "Setup",
    icon: { source: Icons.alert, tint: "orange" },
    detail: {
      markdown: [
        "## Watch without the browser",
        "",
        "**streamlink** plays Twitch streams in **mpv** (or VLC), without ads where possible.",
        "mpv with yt-dlp works too.",
        "",
        "```",
        cmd,
        "```",
      ].join("\n"),
    },
    actions: family
      ? [copy(cmd, "Copy Install Command")]
      : [open("https://streamlink.github.io/install.html", "Install streamlink")],
  };
}
