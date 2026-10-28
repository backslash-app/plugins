// Rows and forms shared by Matrix Rooms and Send Matrix Message.

import {
  type Action,
  action,
  close,
  copy,
  field,
  form,
  Icons,
  type Item,
  meta,
  open,
  refresh,
  toast,
} from "@backslash/api";
import { join, leave, markRead, send, type Session, SetupError } from "./api.ts";
import { age, matrixToUrl, type Room, webClientUrl } from "./lib.ts";

export function setupItems(e: SetupError): Item[] {
  return [{
    id: "setup",
    title: e.message,
    subtitle: "Settings → Extensions → Matrix",
    icon: { source: Icons.key, tint: "orange" },
    detail: {
      markdown: [
        "## Connect your Matrix account",
        "",
        "1. In **Element** (web or desktop): **Settings → Help & About → Advanced → Access Token**:",
        "   click to reveal it and copy it.",
        "2. In **Settings → Extensions → Matrix → Configure**, paste it as **Access token** and set your",
        "   **Homeserver** (`matrix.org`, `mozilla.org`, `chat.example.com`…: the part after `:` in your",
        "   user id works, the real address is found through `.well-known`).",
        "",
        "The token acts as that Element session: logging out of it in Element revokes it. Keep it secret.",
        "",
        "**End-to-end encrypted rooms**: their messages can't be read or sent here (Backslash has no",
        "encryption keys). They show as _Encrypted message_; open them in your client.",
      ].join("\n"),
    },
    actions: [open("https://app.element.io/#/home", "Open Element", { icon: Icons.external })],
  }];
}

export async function guarded(load: () => Promise<Item[]>): Promise<Item[]> {
  try {
    return await load();
  } catch (e) {
    if (e instanceof SetupError) return setupItems(e);
    throw e;
  }
}

export function messageForm(s: Session, room: Room, replyTo?: string, initial = "") {
  return form({
    title: `${replyTo ? "Reply in" : "Message to"} ${room.name}`,
    submitTitle: "Send",
    fields: [field.textArea("body", "Message", {
      required: true,
      placeholder: `Message ${room.name}…`,
      ...(initial ? { value: initial } : {}),
    })],
    async submit(values) {
      const body = String(values.body ?? "").trim();
      if (!body) throw new Error("Write a message first");
      await send(s, room, body, replyTo);
      return close(`Sent to ${room.name}`);
    },
  });
}

export function roomIcon(room: Room) {
  if (room.invite) return { source: Icons.mail, tint: "purple" as const };
  if (room.highlights > 0) return { source: room.direct ? Icons.person : Icons.hash, tint: "red" as const };
  if (room.unread > 0) return { source: room.direct ? Icons.person : Icons.hash, tint: "blue" as const };
  return { source: room.direct ? Icons.person : Icons.hash, tint: "gray" as const };
}

export function roomDetail(room: Room) {
  const last = room.last;
  return {
    markdown: [
      `### ${room.name}`,
      ...(room.topic ? ["", `_${room.topic}_`] : []),
      "",
      room.invite
        ? `${room.inviter ?? "Someone"} invited you${room.direct ? " to a direct chat" : ""}.`
        : last
        ? last.encrypted
          ? `**${last.senderName}** · ${
            age(last.ts)
          }\n\n> _Encrypted message_: end-to-end encrypted rooms can only be read in a client that has your keys (Element, FluffyChat…).`
          : `**${last.senderName}** · ${age(last.ts)}\n\n${last.text.split("\n").map((l) => `> ${l}`).join("\n")}`
        : "_No message yet._",
    ].join("\n"),
    metadata: [
      ...(room.unread
        ? [
          meta.text("Unread", String(room.unread), {
            icon: Icons.bell,
            color: room.highlights ? "red" as const : "blue" as const,
          }),
        ]
        : []),
      ...(room.highlights ? [meta.text("Mentions", String(room.highlights), { icon: Icons.alert, color: "red" })] : []),
      meta.text("Type", room.invite ? "Invitation" : room.direct ? "Direct chat" : "Room", {
        icon: room.direct ? Icons.person : Icons.hash,
      }),
      meta.text("Encryption", room.encrypted ? "End-to-end encrypted" : "Not encrypted", {
        icon: room.encrypted ? Icons.lock : Icons.globe,
        color: room.encrypted ? "green" : undefined,
      }),
      ...(room.members ? [meta.text("Members", String(room.members), { icon: Icons.person })] : []),
      meta.separator(),
      ...(room.alias ? [meta.text("Alias", room.alias, { icon: Icons.hash })] : []),
      meta.text("Room ID", room.id, { icon: Icons.key }),
      meta.link("Link", "matrix.to", matrixToUrl(room)),
    ],
  };
}

export function roomActions(s: Session, room: Room): Action[] {
  const web = webClientUrl(room, s.web);
  if (room.invite) {
    return [
      action("Accept Invitation", async () => {
        await join(s, room);
        await toast(`Joined ${room.name}`, { style: "success" });
        return refresh();
      }, { icon: Icons.check }),
      open(web, "Open in Web Client", { shortcut: "<Ctrl>o" }),
      action("Decline Invitation", async () => {
        await leave(s, room);
        await toast(`Declined ${room.name}`);
        return refresh();
      }, { icon: Icons.cross, destructive: true, confirm: `Decline the invitation to ${room.name}?` }),
    ];
  }
  return [
    open(web, "Open in Web Client", { icon: Icons.external }),
    open(matrixToUrl(room), "Open matrix.to Link", { icon: Icons.link, shortcut: "<Ctrl>o" }),
    ...(room.encrypted ? [] : [
      action("Reply", () => messageForm(s, room, room.last?.eventId), {
        icon: Icons.comment,
        shortcut: "<Ctrl>r",
        section: "Room",
      }),
      action("Send Message", () => messageForm(s, room), {
        icon: Icons.arrowRight,
        shortcut: "<Ctrl>n",
        section: "Room",
      }),
    ]),
    ...(room.unread && room.last
      ? [action("Mark as Read", async () => {
        await markRead(s, room);
        await toast(`${room.name} marked as read`, { style: "success" });
        return refresh();
      }, { icon: Icons.check, shortcut: "<Ctrl>m", section: "Room" })]
      : []),
    copy(room.alias ?? room.id, room.alias ? "Copy Alias" : "Copy Room ID", {
      shortcut: "<Ctrl><Shift>c",
      section: "Copy",
    }),
    ...(room.alias ? [copy(room.id, "Copy Room ID", { section: "Copy" })] : []),
    copy(matrixToUrl(room), "Copy matrix.to Link", { shortcut: "<Ctrl><Shift>l", section: "Copy" }),
    ...(room.last && !room.last.encrypted ? [copy(room.last.text, "Copy Last Message", { section: "Copy" })] : []),
  ];
}

export function roomItem(s: Session, room: Room, section?: string): Item {
  const last = room.last;
  return {
    id: room.id,
    title: room.name,
    subtitle: room.invite
      ? `Invited by ${room.inviter ?? "someone"}`
      : last
      ? `${room.direct && last.senderName !== "You" ? "" : `${last.senderName}: `}${last.text}`
      : room.topic,
    icon: roomIcon(room),
    section: section ?? (room.invite ? "Invitations" : room.unread ? "Unread" : room.direct ? "People" : "Rooms"),
    keywords: [room.alias ?? "", room.id, room.topic ?? "", last?.senderName ?? ""].filter(Boolean),
    accessories: [
      ...(room.encrypted
        ? [{ icon: { source: Icons.lock, tint: "gray" as const }, tooltip: "End-to-end encrypted" }]
        : []),
      ...(room.highlights ? [{ tag: `@${room.highlights}`, color: "red" as const, tooltip: "Mentions" }] : []),
      ...(room.unread && !room.highlights
        ? [{ tag: String(room.unread), color: "blue" as const, tooltip: "Unread" }]
        : []),
      ...(room.invite ? [{ tag: "Invite", color: "purple" as const }] : []),
      ...(last ? [{ text: age(last.ts), tooltip: new Date(last.ts).toLocaleString("en-GB") }] : []),
    ],
    detail: roomDetail(room),
    actions: roomActions(s, room),
  };
}
