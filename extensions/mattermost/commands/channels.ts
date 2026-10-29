import { action, type Context, Icons, list, toast, updateCommandMetadata } from "@backslash/api";
import { type Chat, chatOf } from "../api.ts";
import { type Channel, sortChannels, unreadSummary } from "../lib.ts";
import { live, notifyChanged } from "../live.ts";
import { channelItem, guarded } from "../views.ts";

let status = "";
let shown: Channel[] = [];

export default (ctx: Context) => {
  const markAllRead = action("Mark All as Read", async () => {
    const chat: Chat = chatOf(ctx.preferences);
    const unread = shown.filter((c) => c.unread > 0 || c.mentions > 0);
    await Promise.all(unread.map((c) => chat.markRead(c)));
    notifyChanged();
    await toast(`${unread.length} conversation${unread.length === 1 ? "" : "s"} marked as read`, { style: "success" });
  }, {
    icon: Icons.check,
    shortcut: "<Ctrl><Shift>m",
    section: "Chat",
    confirm: "Mark every conversation as read?",
  });
  return list({
    placeholder: "Filter channels, streams and people…",
    filter: {
      options: [{ value: "unread", title: "Unread" }, { value: "all", title: "All" }, {
        value: "people",
        title: "People",
      }],
      default: "unread",
    },
    empty: {
      title: "All caught up",
      description: "Nothing unread: pick All to see every conversation",
      icon: Icons.comment,
    },
    status: (items) => items[0]?.id === "setup" ? "Not connected" : status,
    actions: [markAllRead, action("Reload", () => notifyChanged(), { icon: Icons.refresh, shortcut: "<Ctrl>r" })],
    items: ({ signal, filter }) =>
      live(() =>
        guarded(async () => {
          const chat = chatOf(ctx.preferences);
          const channels = sortChannels(await chat.channels(signal));
          shown = channels;
          status = `${chat.name} · ${unreadSummary(channels)}`;
          const unread = channels.filter((c) => (c.unread > 0 && !c.muted) || c.mentions > 0).length;
          updateCommandMetadata({ subtitle: unread ? `${unread} unread` : null }).catch(() => {});
          const keep = filter === "all"
            ? () => true
            : filter === "people"
            ? (c: Channel) => c.kind === "direct" || c.kind === "group"
            : (c: Channel) => (c.unread > 0 && !c.muted) || c.mentions > 0;
          const markRead = ctx.preferences.markReadOnOpen !== false;
          return channels.filter(keep).map((c) => {
            const item = channelItem(chat, c, markRead);
            return { ...item, actions: [...item.actions ?? [], markAllRead] };
          });
        }), signal),
  });
};
