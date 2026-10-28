import {
  action,
  close,
  copy,
  Icons,
  type Item,
  list,
  open,
  openExternal,
  refresh,
  toast,
  updateCommandMetadata,
} from "@backslash/api";
import { api, countStatus, guarded, type Server, server } from "../api.ts";

import { ago, type Notification, notificationIcon, notificationMeta, notificationUrl, subjectNumber } from "../lib.ts";

/** The server shown in the footer. */
let host = "";

function notificationItem(n: Notification, t: Server): Item {
  const number = subjectNumber(n);
  const markRead = action("Mark as Read", async () => {
    await api(t, `/notifications/threads/${n.id}?to-status=read`, { method: "PATCH" });
    return refresh();
  }, { icon: Icons.check, shortcut: "<Ctrl>r" });
  const markUnread = action("Mark as Unread", async () => {
    await api(t, `/notifications/threads/${n.id}?to-status=unread`, { method: "PATCH" });
    return refresh();
  }, { icon: Icons.dot, shortcut: "<Ctrl>u" });
  const pin = action(n.pinned ? "Unpin" : "Pin", async () => {
    await api(t, `/notifications/threads/${n.id}?to-status=${n.pinned ? "read" : "pinned"}`, { method: "PATCH" });
    return refresh();
  }, { icon: Icons.pin, shortcut: "<Ctrl>p" });
  return {
    id: String(n.id),
    title: n.subject.title,
    subtitle: `${n.repository.full_name}${number ? ` #${number}` : ""}`,
    icon: notificationIcon(n),
    section: n.pinned ? "Pinned" : n.unread ? "Unread" : "Read",
    keywords: [n.repository.full_name, n.subject.type],
    accessories: [
      ...(n.unread ? [{ icon: { source: Icons.dot, tint: "blue" as const }, tooltip: "Unread" }] : []),
      { text: ago(n.updated_at), tooltip: "Updated" },
    ],
    detail: { metadata: notificationMeta(n) },
    actions: [
      // Opening a notification on the web marks it read there too.
      action("Open in Browser", async () => {
        await openExternal(notificationUrl(n, t.base));
        if (n.unread) {
          await api(t, `/notifications/threads/${n.id}?to-status=read`, { method: "PATCH" }).catch(() => {});
        }
        return close();
      }, { icon: Icons.external }),
      n.unread ? markRead : markUnread,
      pin,
      open(`${t.base}/${n.repository.full_name}`, "Open Repository", { icon: Icons.repository }),
      copy(notificationUrl(n, t.base), "Copy URL", { shortcut: "<Ctrl><Shift>c", section: "Copy" }),
      action("Mark All as Read", async () => {
        await api(t, "/notifications?to-status=read&status-types=unread", { method: "PUT" });
        await toast("All notifications marked as read", { style: "success" });
        return refresh();
      }, { icon: Icons.check, confirm: "Mark every notification as read?", section: "All" }),
    ],
  };
}

export default list({
  placeholder: "Filter notifications by title or repository…",
  filter: { options: [{ value: "unread", title: "Unread" }, { value: "all", title: "All" }] },
  empty: { title: "You're all caught up", description: "No notification here.", icon: "bs-inbox" },
  status: (items) => countStatus(items, "notification", host),
  items: ({ preferences, signal, filter }) =>
    guarded(async () => {
      const t = server(preferences);
      host = t.host;
      const all = filter === "all";
      const types = all
        ? "status-types=unread&status-types=pinned&status-types=read"
        : "status-types=unread&status-types=pinned";
      const list = await api<Notification[]>(t, `/notifications?${types}&limit=50`, { signal });
      const unread = list.filter((n) => n.unread).length;
      updateCommandMetadata({ subtitle: unread ? `${unread} unread` : null }).catch(() => {});
      const order = (n: Notification) => (n.pinned ? 0 : n.unread ? 1 : 2);
      return [...list].sort((a, b) => order(a) - order(b) || b.updated_at.localeCompare(a.updated_at))
        .map((n) => notificationItem(n, t));
    }),
});
