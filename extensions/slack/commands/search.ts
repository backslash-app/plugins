import { type Context, copy, Icons, type Item, list, meta, open } from "@backslash/api";
import { slack, tokenOf } from "../api.ts";
import { appUrl, cleanText, firstLine, guarded, shortDate, tsDate } from "../lib.ts";

interface Match {
  iid?: string;
  ts: string;
  text: string;
  user?: string;
  username?: string;
  team?: string;
  permalink: string;
  channel: { id: string; name: string; is_im?: boolean; is_mpim?: boolean; is_private?: boolean };
}

let total = 0;

function channelLabel(m: Match): string {
  if (m.channel.is_im) return "Direct message";
  if (m.channel.is_mpim) return "Group message";
  return `#${m.channel.name}`;
}

function matchItem(m: Match): Item {
  const text = cleanText(m.text);
  const when = tsDate(m.ts);
  const where = channelLabel(m);
  const who = m.username || m.user || "Someone";
  return {
    id: m.iid ?? `${m.channel.id}:${m.ts}`,
    title: firstLine(text) || "(attachment)",
    subtitle: where,
    icon: {
      source: m.channel.is_im || m.channel.is_mpim ? Icons.person : m.channel.is_private ? Icons.lock : Icons.comment,
      tint: "blue",
    },
    accessories: [
      { avatar: who, tooltip: who },
      { text: shortDate(when), tooltip: when.toLocaleString("en-GB") },
    ],
    detail: {
      markdown: cleanText(m.text, { links: true }).replace(/\n/g, "  \n") || "_No text: the message has attachments._",
      metadata: [
        meta.person("From", who),
        meta.text("In", where, { icon: m.channel.is_private ? Icons.lock : Icons.hash }),
        meta.text("Sent", when.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }), {
          icon: Icons.clock,
        }),
        meta.separator(),
        meta.link("Link", "Open message", m.permalink),
      ],
    },
    actions: [
      open(m.permalink, "Open Message"),
      ...(m.team ? [open(appUrl(m.team, m.channel.id), "Open Channel in Slack", { icon: Icons.hash })] : []),
      copy(m.permalink, "Copy Link", { shortcut: "<Ctrl><Shift>c", section: "Copy" }),
      copy(text, "Copy Text", { shortcut: "<Ctrl>period", section: "Copy" }),
    ],
  };
}

export default (ctx: Context) =>
  list({
    placeholder: "Search messages: words, in:#channel, from:@someone, before:2026-01-01…",
    filter: {
      options: [
        { value: "score", title: "Best Match" },
        { value: "timestamp", title: "Newest" },
      ],
    },
    empty: {
      title: "Search Slack",
      description: "Type a few words. Slack's modifiers work too: in:#design from:@ada has:link",
      icon: Icons.search,
    },
    status: (items) => items[0]?.id === "setup" ? "Not connected" : total ? `${items.length} of ${total} messages` : "",
    search: (query, { signal, filter }) =>
      guarded(async () => {
        const token = tokenOf(ctx);
        total = 0;
        if (!query.trim()) return [];
        const res = await slack<{ messages: { matches: Match[]; total: number } }>(token, "search.messages", {
          query,
          count: 40,
          sort: filter === "timestamp" ? "timestamp" : "score",
          sort_dir: "desc",
          highlight: false,
        }, signal);
        total = res.messages.total;
        return res.messages.matches.map(matchItem);
      }),
  });
