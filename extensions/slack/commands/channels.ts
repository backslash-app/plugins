import { type Context, copy, Icons, type Item, list, meta, type Metadata, open } from "@backslash/api";
import { conversations, slack, tokenOf, users as loadUsers, whoAmI } from "../api.ts";
import {
  appUrl,
  avatarOf,
  cleanText,
  type Conversation,
  conversationTitle,
  guarded,
  isUseful,
  kindColor,
  kindOf,
  personName,
  sortConversations,
  unreadOf,
  type User,
  webUrl,
} from "../lib.ts";

const SECTIONS = { channel: "Channels", private: "Channels", group: "Group Messages", dm: "Direct Messages" };

let counts = { channels: 0, dms: 0, unread: 0 };

function conversationItem(
  c: Conversation,
  users: Map<string, User>,
  team: { id: string; url: string; me: string },
): Item {
  const kind = kindOf(c);
  const title = conversationTitle(c, users, team.me);
  const person = kind === "dm" ? users.get(c.user ?? "") : undefined;
  const picture = avatarOf(person);
  const unread = unreadOf(c);
  const topic = cleanText(c.topic?.value?.trim() || c.purpose?.value?.trim() || "");
  const web = webUrl(team.url, c.id);
  const lines: Metadata[] = [
    meta.text(
      "Type",
      {
        channel: "Public channel",
        private: "Private channel",
        group: "Group message",
        dm: "Direct message",
      }[kind],
      { icon: kind === "private" ? Icons.lock : kind === "channel" ? Icons.hash : Icons.person },
    ),
  ];
  if (person) {
    lines.push(meta.person("With", person.profile?.real_name || personName(person), picture));
    if (person.profile?.title) lines.push(meta.text("Title", person.profile.title));
  }
  if (c.num_members) lines.push(meta.text("Members", c.num_members, { icon: Icons.person }));
  if (unread !== undefined) {
    lines.push(meta.text("Unread", unread, { icon: Icons.inbox, color: unread ? "blue" : undefined }));
  }
  if (c.is_ext_shared) lines.push(meta.text("Shared", "With another organization", { icon: Icons.globe }));
  if (c.created) {
    lines.push(meta.text("Created", new Date(c.created * 1000).toLocaleDateString("en", { dateStyle: "medium" })));
  }
  lines.push(meta.separator(), meta.link("Link", web.replace(/^https:\/\//, ""), web));
  return {
    id: c.id,
    title,
    subtitle: topic ? topic.split("\n")[0] : undefined,
    icon: picture ?? {
      source: kind === "private" ? Icons.lock : kind === "channel" ? Icons.hash : Icons.person,
      tint: kindColor[kind],
    },
    section: SECTIONS[kind],
    keywords: [c.name ?? "", person?.name ?? "", person?.real_name ?? ""].filter(Boolean),
    accessories: [
      ...(c.is_ext_shared ? [{ icon: Icons.globe, tooltip: "Shared with another organization" }] : []),
      ...(unread ? [{ tag: String(unread), color: "blue" as const, tooltip: "Unread" }] : []),
    ],
    detail: {
      markdown: [
        c.topic?.value && `**Topic:** ${cleanText(c.topic.value, { links: true })}`,
        c.purpose?.value && cleanText(c.purpose.value, { links: true }),
      ]
        .filter(Boolean).join("\n\n") || undefined,
      metadata: lines,
    },
    actions: [
      open(appUrl(team.id, c.id), "Open in Slack", { icon: Icons.hash }),
      open(web, "Open in Browser", { icon: Icons.globe }),
      copy(web, "Copy Link", { shortcut: "<Ctrl><Shift>c", section: "Copy" }),
      copy(kind === "dm" || kind === "group" ? title : `<#${c.id}>`, "Copy Mention", { section: "Copy" }),
      copy(c.id, "Copy Channel ID", { shortcut: "<Ctrl>period", section: "Copy" }),
    ],
  };
}

export default (ctx: Context) =>
  list({
    placeholder: "Jump to a channel or a person…",
    filter: {
      options: [
        { value: "all", title: "All" },
        { value: "channels", title: "Channels" },
        { value: "dms", title: "Direct Messages" },
      ],
    },
    empty: { title: "No conversation here", icon: Icons.hash },
    status: (items) =>
      items[0]?.id === "setup" ? "Not connected" : [
        `${counts.channels} channel${counts.channels === 1 ? "" : "s"}`,
        `${counts.dms} direct message${counts.dms === 1 ? "" : "s"}`,
        counts.unread ? `${counts.unread} with unread` : "",
      ].filter(Boolean).join(" · "),
    items: ({ signal, filter }) =>
      guarded(async () => {
        const token = tokenOf(ctx);
        const [me, convos] = await Promise.all([whoAmI(token, signal), conversations(token, signal)]);
        const needsPeople = convos.some((c) => c.is_im);
        // Without users:read, direct messages show the person's ID.
        const people = needsPeople ? await loadUsers(token, signal).catch(() => new Map<string, User>()) : new Map();
        // Members missing from users.list (other workspaces of a shared channel).
        const missing = convos.filter((c) => c.is_im && c.user && !people.has(c.user)).slice(0, 15);
        await Promise.all(missing.map(async (c) => {
          const res = await slack<{ user: User }>(token, "users.info", { user: c.user }, signal).catch(() => undefined);
          if (res) people.set(res.user.id, res.user);
        }));
        const shown = sortConversations(convos.filter((c) => isUseful(c, people)), people);
        counts = {
          channels: shown.filter((c) => !c.is_im && !c.is_mpim).length,
          dms: shown.filter((c) => c.is_im || c.is_mpim).length,
          unread: shown.filter((c) => (unreadOf(c) ?? 0) > 0).length,
        };
        const team = { id: me.team_id, url: me.url, me: me.user };
        return shown
          .filter((c) =>
            filter === "channels" ? !c.is_im && !c.is_mpim : filter === "dms" ? c.is_im || c.is_mpim : true
          )
          .map((c) => conversationItem(c, people, team));
      }),
  });
