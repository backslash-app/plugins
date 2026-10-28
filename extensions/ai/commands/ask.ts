import { action, Icons, type Item, list, meta, refresh } from "@backslash/api";
import { chat, type Conversation, conversations, remove } from "../chat.ts";
import type { Prefs } from "../lib.ts";
import { modelName } from "../llm.ts";

const short = (ms: number) => {
  const m = Math.floor((Date.now() - ms) / 60000);
  return m < 1 ? "now" : m < 60 ? `${m}m` : m < 1440 ? `${Math.floor(m / 60)}h` : `${Math.floor(m / 1440)}d`;
};

/** Today, Yesterday, This Week, Older: like the clipboard history. */
export function when(ms: number, now = new Date()): string {
  const day = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (ms >= day) return "Today";
  if (ms >= day - 86_400_000) return "Yesterday";
  if (ms >= day - 6 * 86_400_000) return "This Week";
  return "Older";
}

const oneLine = (s: string) => s.replace(/[#*_`>]/g, "").replace(/\s+/g, " ").trim();

function conversationItem(prefs: Prefs, c: Conversation, q: string): Item {
  const lastAnswer = [...c.messages].reverse().find((m) => m.role === "assistant")?.content ?? "";
  const lastQuestion = [...c.messages].reverse().find((m) => m.role === "user")?.content ?? "";
  const questions = c.messages.filter((m) => m.role === "user").length;
  return {
    id: c.id,
    title: c.title,
    subtitle: oneLine(lastAnswer).slice(0, 80),
    icon: { source: Icons.comment, tint: "purple" },
    section: when(c.updated),
    accessories: [
      ...(questions > 1 ? [{ icon: Icons.comment, text: String(questions), tooltip: `${questions} questions` }] : []),
      { text: short(c.updated), tooltip: new Date(c.updated).toLocaleString() },
    ],
    detail: {
      markdown: `> ${oneLine(lastQuestion).slice(0, 200)}\n\n${
        lastAnswer.length > 1200 ? `${lastAnswer.slice(0, 1200)}…` : lastAnswer
      }`,
      metadata: [
        meta.text("Questions", questions, { icon: Icons.comment }),
        meta.text("Updated", new Date(c.updated).toLocaleString(), { icon: Icons.clock }),
      ],
    },
    actions: [
      action("Open Conversation", () => chat(prefs, c), { icon: Icons.comment }),
      ...(q ? [action(`Continue with “${q}”`, () => chat(prefs, c, q), { icon: Icons.arrowRight })] : []),
      action("Delete Conversation", async () => {
        await remove(c.id);
        return refresh();
      }, { icon: Icons.trash, destructive: true, confirm: "Delete this conversation?", section: "Danger" }),
    ],
  };
}

let count = 0;

export default list({
  placeholder: "Ask anything…",
  empty: { title: "Ask anything", description: "Type a question, then press Enter", icon: Icons.sparkle },
  status: () => `${count} conversation${count === 1 ? "" : "s"}`,
  async search(query, { preferences }) {
    const prefs = preferences as Prefs;
    const q = query.trim();
    const items: Item[] = [];
    if (q) {
      let model = "";
      try {
        model = modelName(prefs);
      } catch { /* shown when asking */ }
      items.push({
        id: "ask",
        title: q,
        subtitle: "Ask AI",
        icon: { source: Icons.sparkle, tint: "purple" },
        section: "Ask",
        accessories: model ? [{ tag: model }] : [],
        actions: [action("Ask", () => chat(prefs, undefined, q), { icon: Icons.sparkle })],
      });
    }
    const all = await conversations();
    count = all.length;
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    for (const c of all) {
      const text = c.messages.map((m) => m.content).join(" ").toLowerCase();
      if (words.every((w) => text.includes(w))) items.push(conversationItem(prefs, c, q));
    }
    return items;
  },
});
