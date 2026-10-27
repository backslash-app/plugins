import { action, type Item, list, refresh } from "@backslash/api";
import { chat, conversations, remove } from "../chat.ts";
import type { Prefs } from "../lib.ts";

const ago = (ms: number) => {
  const m = Math.floor((Date.now() - ms) / 60000);
  return m < 60 ? `${m} min ago` : m < 1440 ? `${Math.floor(m / 60)} h ago` : `${Math.floor(m / 1440)} d ago`;
};

export default list({
  placeholder: "Ask anything…",
  empty: { title: "Ask anything", description: "Type a question, then press Enter" },
  async search(query, { preferences }) {
    const prefs = preferences as Prefs;
    const q = query.trim();
    const items: Item[] = [];
    if (q) {
      items.push({
        id: "ask",
        title: q,
        subtitle: "Ask AI",
        icon: "✨",
        section: "Ask",
        actions: [action("Ask", () => chat(prefs, undefined, q), { icon: "mail-send" })],
      });
    }
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    for (const c of await conversations()) {
      const text = c.messages.map((m) => m.content).join(" ").toLowerCase();
      if (!words.every((w) => text.includes(w))) continue;
      const lastAnswer = [...c.messages].reverse().find((m) => m.role === "assistant")?.content ?? "";
      items.push({
        id: c.id,
        title: c.title,
        subtitle: lastAnswer.replace(/\s+/g, " ").slice(0, 120),
        icon: "💬",
        section: "Conversations",
        accessories: [{ text: ago(c.updated) }],
        actions: [
          action("Open Conversation", () => chat(prefs, c), { icon: "document-open" }),
          ...(q ? [action(`Continue with “${q}”`, () => chat(prefs, c, q), { icon: "mail-reply-sender" })] : []),
          action("Delete", async () => {
            await remove(c.id);
            return refresh();
          }, { destructive: true, confirm: "Delete this conversation?" }),
        ],
      });
    }
    return items;
  },
});
