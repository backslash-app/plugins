import { action, clipboard, close, detail, field, form, Icons, meta, replace, storage } from "@backslash/api";
import { languageRule, type Message, type Prefs, provider } from "./lib.ts";
import { canPaste, pasteText } from "./paste.ts";
import { answer } from "./llm.ts";

export interface Conversation {
  id: string;
  title: string;
  messages: Message[];
  updated: number;
}

const MAX = 50;

export const conversations = async (): Promise<Conversation[]> =>
  ((await storage.get("conversations")) ?? []) as unknown as Conversation[];

async function save(c: Conversation) {
  const all = (await conversations()).filter((x) => x.id !== c.id);
  await storage.set("conversations", [c, ...all].slice(0, MAX) as any);
}

export async function remove(id: string) {
  await storage.set("conversations", (await conversations()).filter((c) => c.id !== id) as any);
}

const system = (prefs: Prefs) =>
  `You are a helpful assistant opened from a desktop launcher on Linux. Be direct and concise; use Markdown (short paragraphs, lists, fenced code blocks) when it helps. ${
    languageRule(prefs)
  }`;

const questions = (c: Conversation) => c.messages.filter((m) => m.role === "user").length;

function chatMetadata(prefs: Prefs, c: Conversation) {
  const p = provider(prefs);
  return [
    meta.text("Provider", p.name, { icon: Icons.sparkle, color: "purple" }),
    meta.text("Model", p.model, { icon: Icons.cpu }),
    meta.separator(),
    meta.text("Questions", questions(c), { icon: Icons.comment }),
    meta.text("Updated", new Date(c.updated).toLocaleString(), { icon: Icons.clock }),
  ];
}

/** "**You** question" then the answer, for each turn. */
function transcript(messages: Message[]): string {
  return messages.map((m) => (m.role === "user" ? `> ${m.content.replace(/\n/g, "\n> ")}` : m.content)).join("\n\n");
}

/**
 * A conversation view: asks `question` (if any) after `previous` and streams
 * the answer below the earlier turns.
 */
export function chat(prefs: Prefs, previous: Conversation | undefined, question?: string) {
  const convo: Conversation = previous
    ? { ...previous, messages: [...previous.messages] }
    : { id: crypto.randomUUID(), title: question ?? "", messages: [], updated: Date.now() };
  if (question) convo.messages.push({ role: "user", content: question });
  let last = [...convo.messages].reverse().find((m) => m.role === "assistant")?.content ?? "";

  const followUp = form({
    title: "Follow-up",
    submitTitle: "Ask",
    fields: [field.textArea("question", "Your question", { required: true })],
    submit: (values) => replace(chat(prefs, convo, String(values.question))),
  });

  return detail({
    title: convo.title,
    metadata: chatMetadata(prefs, convo),
    status: `${questions(convo)} question${questions(convo) === 1 ? "" : "s"}`,
    markdown: question
      ? async function* ({ signal }) {
        const before = transcript(convo.messages);
        for await (const text of answer(prefs, system(prefs), convo.messages, signal)) {
          last = text;
          yield `${before}\n\n${text}`;
        }
        convo.messages.push({ role: "assistant", content: last });
        convo.updated = Date.now();
        await save(convo);
      }
      : transcript(convo.messages),
    actions: [
      action("Copy Answer", async () => {
        await clipboard.write(last);
        return close("Answer copied");
      }, { icon: Icons.copy }),
      action("Ask a Follow-up…", () => followUp, { icon: Icons.comment, shortcut: "<Ctrl>r" }),
      ...(canPaste ? [action("Paste Answer", () => pasteText(last), { icon: Icons.paste, shortcut: "<Ctrl>p" })] : []),
      action("Copy Conversation", async () => {
        await clipboard.write(transcript(convo.messages));
        return close("Conversation copied");
      }, { icon: Icons.copy, section: "Copy" }),
    ],
  });
}
