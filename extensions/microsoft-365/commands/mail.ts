import {
  action,
  type Context,
  copy,
  detail,
  Icons,
  type Item,
  list,
  open,
  submenu,
  toast,
  updateCommandMetadata,
} from "@backslash/api";
import { type Client, guarded, signOutAction } from "../api.ts";
import {
  mailMarkdown,
  mailMetadata,
  mailSection,
  mailUrl,
  mdEscape,
  type Message,
  plural,
  senderOf,
  shortAgo,
  sortMail,
  unreadPath,
} from "../lib.ts";
import { live, notifyChanged } from "../live.ts";

let unread = 0;
let shown = 0;

async function change(api: Client, m: Message, body: unknown, message: string) {
  await api.send("PATCH", `/me/messages/${encodeURIComponent(m.id)}`, body);
  notifyChanged();
  await toast(message, { style: "success" });
}

async function move(api: Client, m: Message, folder: "archive" | "deleteditems", message: string) {
  await api.send("POST", `/me/messages/${encodeURIComponent(m.id)}/move`, { destinationId: folder });
  notifyChanged();
  await toast(message, { style: "success" });
}

/** The whole message as text (Graph converts HTML bodies when asked). */
async function readMessage(api: Client, m: Message) {
  const full = await api.get<{ body?: { content?: string } }>(
    `/me/messages/${encodeURIComponent(m.id)}?$select=body`,
    { headers: { Prefer: 'outlook.body-content-type="text"' } },
  );
  const body = (full.body?.content ?? "").replace(/\r/g, "").replace(/\n{3,}/g, "\n\n").trim();
  return detail({
    title: m.subject || "(no subject)",
    markdown: `# ${mdEscape(m.subject || "(no subject)")}\n\n${mdEscape(body) || "*Empty message*"}`,
    metadata: mailMetadata(m),
    actions: [
      open(mailUrl(m), "Open in Outlook"),
      action("Mark as Read", () => change(api, m, { isRead: true }, "Marked as read"), { icon: Icons.check }),
      copy(body, "Copy Text", { section: "Copy" }),
    ],
  });
}

function mailItem(api: Client, m: Message, now: Date): Item {
  const from = senderOf(m);
  const received = new Date(m.receivedDateTime);
  const flagged = m.flag?.flagStatus === "flagged";
  return {
    id: m.id,
    title: m.subject?.trim() || "(no subject)",
    subtitle: from.name,
    icon: { source: Icons.mail, tint: m.importance === "high" ? "red" : "blue" },
    section: mailSection(m),
    keywords: [from.address, (m.bodyPreview ?? "").slice(0, 120)],
    accessories: [
      ...(m.hasAttachments ? [{ icon: Icons.file, tooltip: "Attachments" }] : []),
      ...(flagged ? [{ icon: { source: Icons.flag, tint: "orange" as const }, tooltip: "Flagged" }] : []),
      ...(m.importance === "high"
        ? [{ icon: { source: Icons.alert, tint: "red" as const }, tooltip: "Important" }]
        : []),
      { text: shortAgo(received, now), tooltip: received.toLocaleString() },
    ],
    detail: {
      markdown: mailMarkdown(m),
      metadata: mailMetadata(m),
    },
    actions: [
      open(mailUrl(m), "Open in Outlook"),
      action("Mark as Read", () => change(api, m, { isRead: true }, "Marked as read"), {
        icon: Icons.check,
        shortcut: "<Ctrl>r",
      }),
      action("Read Message", () => readMessage(api, m), { icon: Icons.eye }),
      action("Archive", () => move(api, m, "archive", "Archived"), {
        icon: Icons.archive,
        shortcut: "<Ctrl>e",
        section: "Message",
      }),
      action(
        flagged ? "Unflag" : "Flag",
        () =>
          change(
            api,
            m,
            { flag: { flagStatus: flagged ? "notFlagged" : "flagged" } },
            flagged ? "Unflagged" : "Flagged",
          ),
        { icon: Icons.flag, shortcut: "<Ctrl><Shift>f", section: "Message" },
      ),
      submenu("Move to Inbox Tab", [
        action("Focused", () => change(api, m, { inferenceClassification: "focused" }, "Moved to Focused"), {
          icon: Icons.inbox,
        }),
        action("Other", () => change(api, m, { inferenceClassification: "other" }, "Moved to Other"), {
          icon: Icons.inbox,
        }),
      ], { icon: Icons.inbox, section: "Message" }),
      copy(m.subject ?? "", "Copy Subject", { shortcut: "<Ctrl>period", section: "Copy" }),
      ...(from.address ? [copy(from.address, "Copy Sender Address", { section: "Copy" })] : []),
      copy(mailUrl(m), "Copy Link", { shortcut: "<Ctrl><Shift>c", section: "Copy" }),
      action("Delete", () => move(api, m, "deleteditems", "Moved to Deleted Items"), {
        icon: Icons.trash,
        destructive: true,
        confirm: `Delete “${m.subject?.trim() || "(no subject)"}”?`,
        shortcut: "<Ctrl><Shift>Delete",
        section: "Danger",
      }),
    ],
  };
}

export default (ctx: Context) =>
  list({
    placeholder: "Filter unread mail by subject, sender or text…",
    filter: {
      options: [
        { value: "all", title: "All Unread" },
        { value: "focused", title: "Focused" },
        { value: "other", title: "Other" },
      ],
    },
    empty: { title: "Inbox zero", description: "No unread message in your inbox.", icon: Icons.inbox },
    status: (items) =>
      items[0]?.id === "setup"
        ? "Not connected"
        : `${plural(unread, "unread message")}${shown < unread ? ` · ${shown} shown` : ""} · Outlook`,
    actions: [
      open("https://outlook.office.com/mail/", "Open Outlook", { icon: Icons.mail }),
      signOutAction(ctx.preferences, notifyChanged),
    ],
    items: ({ signal, filter }) =>
      live(() =>
        guarded(ctx.preferences, async (api) => {
          const [folder, messages] = await Promise.all([
            api.get<{ unreadItemCount: number }>("/me/mailFolders/inbox?$select=unreadItemCount", { signal }),
            api.get<{ value: Message[] }>(unreadPath(), { signal }),
          ]);
          unread = folder.unreadItemCount;
          updateCommandMetadata({ subtitle: unread ? `${unread} unread` : null }).catch(() => {});
          const now = new Date();
          const picked = sortMail(messages.value).filter((m) =>
            filter === "focused" ? mailSection(m) === "Focused" : filter === "other" ? mailSection(m) === "Other" : true
          );
          shown = picked.length;
          return picked.map((m) => mailItem(api, m, now));
        }), signal),
  });
