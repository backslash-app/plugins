import { action, close, type Context, Icons, type Item, list, open } from "@backslash/api";
import { cachedRooms, loadRooms, send, session, SetupError } from "../api.ts";
import { type Room, webClientUrl } from "../lib.ts";
import { messageForm, roomDetail, roomIcon, setupItems } from "../views.ts";

export default (ctx: Context<{ message?: string }>) => {
  const message = String(ctx.args.message ?? "").trim();
  return list({
    title: message ? `Send “${message.length > 40 ? `${message.slice(0, 39)}…` : message}”` : "Send Matrix Message",
    placeholder: "Pick a room or a person…",
    empty: { title: "No room", description: "Join a room in your Matrix client first", icon: Icons.comment },
    async *items({ preferences, signal }) {
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
      const render = (rooms: Room[]): Item[] =>
        rooms.filter((r) => !r.invite).map((room) => ({
          id: room.id,
          title: room.name,
          subtitle: room.encrypted ? "End-to-end encrypted: send from your Matrix client" : room.alias ?? room.topic,
          icon: room.encrypted ? { source: Icons.lock, tint: "gray" as const } : roomIcon(room),
          section: room.direct ? "People" : "Rooms",
          keywords: [room.alias ?? "", room.id].filter(Boolean),
          accessories: room.unread ? [{ tag: String(room.unread), color: "blue" as const }] : [],
          detail: roomDetail(room),
          actions: room.encrypted ? [open(webClientUrl(room, s.web), "Open in Web Client")] : message
            ? [
              action(`Send to ${room.name}`, async () => {
                await send(s, room, message);
                return close(`Sent to ${room.name}`);
              }, { icon: Icons.arrowRight }),
              action("Edit Before Sending", () => messageForm(s, room, undefined, message), { icon: Icons.text }),
            ]
            : [action("Write Message", () => messageForm(s, room), { icon: Icons.comment })],
        }));
      const saved = await cachedRooms(s);
      if (saved) yield render(saved);
      try {
        yield render(await loadRooms(s, signal));
      } catch (e) {
        if (e instanceof SetupError) {
          yield setupItems(e);
          return;
        }
        if (!saved) throw e;
      }
    },
  });
};
