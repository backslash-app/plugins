import { action, Icons, type Item, list, refresh, toast, updateCommandMetadata } from "@backslash/api";
import { cachedRooms, loadRooms, markRead, session, SetupError } from "../api.ts";
import type { Room } from "../lib.ts";
import { roomItem, setupItems } from "../views.ts";

let status = "";

function summary(rooms: Room[]): string {
  const unread = rooms.filter((r) => r.unread > 0).length;
  const mentions = rooms.reduce((n, r) => n + r.highlights, 0);
  const invites = rooms.filter((r) => r.invite).length;
  return [
    `${rooms.filter((r) => !r.invite).length} rooms`,
    ...(unread ? [`${unread} unread`] : []),
    ...(mentions ? [`${mentions} mention${mentions === 1 ? "" : "s"}`] : []),
    ...(invites ? [`${invites} invitation${invites === 1 ? "" : "s"}`] : []),
  ].join(" · ");
}

const markAllRead = action("Mark All as Read", async ({ preferences }) => {
  const s = await session(preferences);
  const rooms = (await cachedRooms(s) ?? []).filter((r) => r.unread > 0 && r.last);
  await Promise.all(rooms.map((r) => markRead(s, r)));
  await toast(`${rooms.length} room${rooms.length === 1 ? "" : "s"} marked as read`, { style: "success" });
  return refresh();
}, { icon: Icons.check, shortcut: "<Ctrl><Shift>m", section: "Matrix" });

export default list({
  placeholder: "Filter rooms and people…",
  filter: {
    options: [{ value: "all", title: "All" }, { value: "unread", title: "Unread" }, {
      value: "people",
      title: "People",
    }],
    default: "all",
  },
  empty: { title: "Nothing here", description: "No room matches: try All", icon: Icons.comment },
  status: (items) => items[0]?.id === "setup" ? "Not connected" : status,
  actions: [markAllRead],
  async *items({ preferences, filter, signal }) {
    const pick = (rooms: Room[]) =>
      rooms.filter((r) => filter === "unread" ? r.unread > 0 || r.invite : filter === "people" ? r.direct : true);
    let s;
    try {
      s = await session(preferences, signal);
    } catch (e) {
      if (e instanceof SetupError) {
        yield setupItems(e);
        return;
      }
      throw e;
    }
    const render = (rooms: Room[]): Item[] => {
      status = summary(rooms);
      return pick(rooms).map((r) => {
        const item = roomItem(s, r);
        return { ...item, actions: [...(item.actions ?? []), markAllRead] };
      });
    };
    const saved = await cachedRooms(s);
    if (saved) yield render(saved);
    try {
      const rooms = await loadRooms(s, signal);
      const unread = rooms.filter((r) => r.unread > 0).length;
      updateCommandMetadata({ subtitle: unread ? `${unread} unread` : null }).catch(() => {});
      yield render(rooms);
    } catch (e) {
      if (e instanceof SetupError) {
        yield setupItems(e);
        return;
      }
      // Offline: the rooms of last time are still worth showing.
      if (saved && (e as Error).name !== "AbortError") {
        await toast("Couldn't reach the homeserver", { style: "failure", message: (e as Error).message });
        return;
      }
      throw e;
    }
  },
});
