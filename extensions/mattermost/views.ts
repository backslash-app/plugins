// Rows, the conversation view and the message form.

import { type Action, action, copy, field, form, Icons, type Item, list, meta, open, pop, toast } from "@backslash/api";
import type { Chat } from "./api.ts";
import { age, type Channel, type Message, oneLine, sectionOf, SetupError } from "./lib.ts";
import { live, notifyChanged } from "./live.ts";

export function setupItems(e: SetupError): Item[] {
  return [{
    id: "setup",
    title: e.message,
    subtitle: "Settings → Extensions → Mattermost & Zulip",
    icon: { source: Icons.key, tint: "orange" },
    detail: {
      markdown: [
        "## Connect your team chat",
        "",
        "Set **Service** to `mattermost` or `zulip` (or leave it empty), the **Server address** you open",
        "in the browser, then:",
        "",
        "- **Mattermost**: a **personal access token** from **Profile → Security → Personal Access",
        "  Tokens → Create Token** (an administrator may have to allow them in **System Console →",
        "  Integrations → Integration Management**).",
        "- **Zulip**: your account's **email** and its **API key** from **Personal settings → Account &",
        "  privacy → API key → Manage your API key**.",
      ].join("\n"),
    },
    actions: [
      open("https://docs.mattermost.com/integrations-guide/personal-access-tokens.html", "Open Mattermost Docs", {
        icon: Icons.book,
      }),
      open("https://zulip.com/api/api-keys", "Open Zulip Docs", { icon: Icons.book }),
    ],
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

function channelIcon(c: Channel) {
  const source = c.kind === "direct"
    ? Icons.person
    : c.kind === "group"
    ? Icons.person
    : c.kind === "private"
    ? Icons.lock
    : Icons.hash;
  const tint = c.mentions > 0 ? "red" as const : c.unread > 0 && !c.muted ? "blue" as const : "gray" as const;
  return { source, tint };
}

const where = (chat: Chat, c: Channel) =>
  c.kind === "direct" || c.kind === "group" ? c.name : chat.id === "zulip" ? `#${c.name}` : `~${c.name}`;

export function messageForm(chat: Chat, c: Channel, replyTo?: Message, after: "pop" | "stay" = "pop") {
  const topic = chat.id === "zulip" && c.kind === "stream";
  return form({
    title: replyTo ? `Reply to ${replyTo.author} in ${where(chat, c)}` : `Message ${where(chat, c)}`,
    submitTitle: "Send",
    fields: [
      ...(topic
        ? [field.text("topic", "Topic", { value: replyTo?.topic ?? c.lastTopic ?? "", placeholder: "general chat" })]
        : []),
      field.textArea("body", "Message", { required: true, placeholder: `Message ${where(chat, c)}…` }),
    ],
    async submit(values) {
      const text = String(values.body ?? "").trim();
      if (!text) throw new Error("Write a message first");
      await chat.send(c, text, { replyTo, topic: topic ? String(values.topic ?? "") : undefined });
      notifyChanged();
      await toast(`Sent to ${where(chat, c)}`, { style: "success" });
      return after === "pop" ? pop() : undefined;
    },
  });
}

function markReadAction(chat: Chat, c: Channel): Action {
  return action("Mark as Read", async () => {
    await chat.markRead(c);
    notifyChanged();
    await toast(`${where(chat, c)} marked as read`, { style: "success" });
  }, { icon: Icons.check, shortcut: "<Ctrl>m", section: "Conversation" });
}

function messageItem(chat: Chat, c: Channel, m: Message): Item {
  return {
    id: m.id,
    title: oneLine(m.text) || "(attachment)",
    subtitle: m.author,
    icon: m.mine
      ? { source: Icons.arrowRight, tint: "gray" }
      : { source: Icons.comment, tint: m.unread ? "blue" : "gray" },
    section: m.topic ? `Topic: ${m.topic}` : undefined,
    keywords: [m.author, m.topic ?? ""].filter(Boolean),
    accessories: [
      ...(m.rootId ? [{ icon: Icons.comment, tooltip: "In a thread" }] : []),
      ...(m.replies ? [{ text: `${m.replies}`, icon: Icons.comment, tooltip: "Replies" }] : []),
      ...(m.unread ? [{ tag: "new", color: "blue" as const }] : []),
      { avatar: m.author, tooltip: m.author },
      { text: age(m.at), tooltip: new Date(m.at).toLocaleString("en-GB") },
    ],
    detail: {
      markdown: `**${m.author}** · ${new Date(m.at).toLocaleString("en-GB")}${m.edited ? " · _edited_" : ""}${
        m.topic ? `\n\n_Topic: ${m.topic}_` : ""
      }\n\n${m.text}`,
      metadata: [
        meta.person("From", m.author),
        meta.text("Sent", new Date(m.at).toLocaleString("en-GB"), { icon: Icons.clock }),
        ...(m.topic ? [meta.text("Topic", m.topic, { icon: Icons.hash })] : []),
        ...(m.url ? [meta.link("Link", "Open in browser", m.url)] : []),
      ],
    },
    actions: [
      action(chat.id === "zulip" ? "Reply in Topic" : "Reply in Thread", () => messageForm(chat, c, m), {
        icon: Icons.comment,
      }),
      action("New Message…", () => messageForm(chat, c), { icon: Icons.arrowRight, shortcut: "<Ctrl>n" }),
      copy(m.text, "Copy Message", { shortcut: "<Ctrl><Shift>c", section: "Message" }),
      ...(m.url ? [open(m.url, "Open Message in Browser", { shortcut: "<Ctrl>o", section: "Message" })] : []),
      open(c.url, `Open ${where(chat, c)} in Browser`, { icon: Icons.external, section: "Conversation" }),
      markReadAction(chat, c),
    ],
  };
}

/** The last messages of a conversation, newest first; opening it marks it read when asked to. */
export function conversation(chat: Chat, c: Channel, markRead: boolean) {
  let status = "";
  let marked = false;
  return list({
    title: where(chat, c),
    placeholder: `Filter messages in ${where(chat, c)}…`,
    empty: { title: "No message yet", description: "Press Ctrl+N to write the first one", icon: Icons.comment },
    status: () => status,
    actions: [action("New Message…", () => messageForm(chat, c), { icon: Icons.arrowRight, shortcut: "<Ctrl>n" })],
    items: ({ signal }) =>
      live(() =>
        guarded(async () => {
          const messages = await chat.messages(c, signal);
          const unread = messages.filter((m) => m.unread).length;
          status = `${messages.length} recent message${messages.length === 1 ? "" : "s"}${
            unread ? ` · ${unread} new` : ""
          }`;
          if (markRead && !marked && (c.unread > 0 || c.mentions > 0)) {
            marked = true;
            chat.markRead(c).then(() => notifyChanged()).catch(() => {});
          }
          return messages.map((m) => messageItem(chat, c, m));
        }), signal),
  });
}

export function channelItem(chat: Chat, c: Channel, markRead: boolean): Item {
  const last = c.last;
  return {
    id: c.id,
    title: where(chat, c),
    subtitle: last
      ? `${c.kind === "direct" && !last.mine ? "" : `${last.author}: `}${oneLine(last.text, 90)}`
      : c.topic,
    icon: channelIcon(c),
    section: sectionOf(c),
    keywords: [c.name, c.team?.displayName ?? "", c.topic ?? "", c.lastTopic ?? ""].filter(Boolean),
    accessories: [
      ...(c.muted ? [{ icon: { source: Icons.bellOff, tint: "gray" as const }, tooltip: "Muted" }] : []),
      ...(c.mentions ? [{ tag: `@${c.mentions}`, color: "red" as const, tooltip: "Mentions" }] : []),
      ...(c.unread && !c.mentions ? [{ tag: String(c.unread), color: "blue" as const, tooltip: "Unread" }] : []),
      ...(c.team ? [{ text: c.team.displayName, tooltip: "Team" }] : []),
      ...(c.lastAt ? [{ text: age(c.lastAt), tooltip: new Date(c.lastAt).toLocaleString("en-GB") }] : []),
    ],
    detail: {
      markdown: [
        `### ${where(chat, c)}`,
        ...(c.topic ? ["", `_${oneLine(c.topic, 300)}_`] : []),
        "",
        last
          ? `**${last.author}** · ${age(last.at)}${last.topic ? ` · ${last.topic}` : ""}\n\n${
            last.text.split("\n").map((l) => `> ${l}`).join("\n")
          }`
          : "_Press Enter to read the last messages._",
      ].join("\n"),
      metadata: [
        ...(c.unread ? [meta.text("Unread", String(c.unread), { icon: Icons.bell, color: "blue" })] : []),
        ...(c.mentions ? [meta.text("Mentions", String(c.mentions), { icon: Icons.alert, color: "red" })] : []),
        meta.text(
          "Type",
          {
            channel: "Public channel",
            private: "Private channel",
            direct: "Direct message",
            group: "Group message",
            stream: "Stream",
          }[c.kind],
          { icon: channelIcon(c).source },
        ),
        ...(c.team ? [meta.text("Team", c.team.displayName, { icon: Icons.person })] : []),
        ...(c.lastTopic ? [meta.text("Last topic", c.lastTopic, { icon: Icons.hash })] : []),
        ...(c.muted ? [meta.text("Notifications", "Muted", { icon: Icons.bellOff })] : []),
        meta.separator(),
        meta.link(chat.name, "Open in browser", c.url),
      ],
    },
    actions: [
      action("Read Messages", () => conversation(chat, c, markRead), { icon: Icons.comment }),
      action(
        last && !last.mine ? `Reply to ${last.author}` : "Send Message…",
        () => messageForm(chat, c, last && !last.mine ? last : undefined, "pop"),
        {
          icon: Icons.arrowRight,
        },
      ),
      ...(c.unread || c.mentions ? [markReadAction(chat, c)] : []),
      open(c.url, "Open in Browser", { shortcut: "<Ctrl>o", section: "Conversation" }),
      copy(c.url, "Copy Link", { shortcut: "<Ctrl><Shift>c", section: "Conversation" }),
      ...(last ? [copy(last.text, "Copy Last Message", { section: "Conversation" })] : []),
    ],
  };
}
