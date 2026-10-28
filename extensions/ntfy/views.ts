// The compose form and the subscribed topics, shared by the commands.

import { close, field, form, type FormSpec, storage, toast } from "@backslash/api";
import { type Config, send, SetupError, type Target } from "./api.ts";
import { parsePriority, parseTags, PRIORITIES, validTopic } from "./lib.ts";

export async function topics(): Promise<string[]> {
  return (await storage.get<string[]>("topics")) ?? [];
}

export async function saveTopics(list: string[]): Promise<void> {
  await storage.set("topics", [...new Set(list)]);
}

/** The default topic, then the subscribed ones. */
export async function allTopics(c: Config): Promise<string[]> {
  return [...new Set([...(c.topic ? [c.topic] : []), ...await topics()])];
}

export async function composeForm(c: Config, preset?: { target?: string; message?: string }): Promise<FormSpec> {
  const names = await allTopics(c);
  const canGotify = !!(c.gotify && c.appToken);
  const targets = [
    ...names.map((t) => ({ value: `ntfy:${t}`, title: `ntfy · ${t}` })),
    ...(canGotify ? [{ value: "gotify", title: "Gotify" }] : []),
    { value: "other", title: "Another ntfy topic…" },
  ];
  return form({
    title: "Send Push Notification",
    submitTitle: "Send",
    fields: [
      field.textArea("message", "Message", { required: true, value: preset?.message ?? "" }),
      field.text("title", "Title", { placeholder: "Optional" }),
      field.dropdown("target", "Send to", targets, { value: preset?.target ?? targets[0].value }),
      field.text("topic", "Other topic", { placeholder: "Only for “Another ntfy topic…”" }),
      field.dropdown("priority", "Priority", PRIORITIES.map((p) => ({ value: p.value, title: p.title })), {
        value: "3",
      }),
      field.text("tags", "Tags", { placeholder: "warning, backup (emoji shortcodes become emojis)" }),
      field.text("click", "Link", { placeholder: "Optional: opened when the notification is tapped" }),
    ],
    async submit(values) {
      const message = String(values.message ?? "").trim();
      if (!message) throw new Error("Write a message first");
      let target: Target;
      const choice = String(values.target ?? "");
      if (choice === "gotify") target = { kind: "gotify" };
      else if (choice === "other") {
        const topic = String(values.topic ?? "").trim();
        const problem = validTopic(topic);
        if (problem) throw new Error(problem);
        target = { kind: "ntfy", topic };
      } else if (choice.startsWith("ntfy:")) target = { kind: "ntfy", topic: choice.slice(5) };
      else throw new SetupError("Set a default ntfy topic in Settings, or pick “Another ntfy topic…”");
      const click = String(values.click ?? "").trim() || undefined;
      if (click && !/^(https?|mailto|geo|ntfy):/i.test(click)) {
        throw new Error("The link must be a full URL (https://…)");
      }
      const where = await send(c, target, {
        message,
        title: String(values.title ?? "").trim() || undefined,
        priority: parsePriority(String(values.priority ?? "")),
        tags: parseTags(String(values.tags ?? "")),
        click,
      });
      await toast(`Sent to ${where}`, { style: "success" });
      return close(`Sent to ${where}`);
    },
  });
}
