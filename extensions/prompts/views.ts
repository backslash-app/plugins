// The forms both commands use: editing a prompt and filling its variables.

import {
  action,
  clipboard,
  close,
  detail,
  field,
  form,
  type FormSpec,
  Icons,
  type Outcome,
  pop,
  toast,
} from "@backslash/api";
import {
  askedVariables,
  builtinValues,
  fieldId,
  fill,
  makePrompt,
  parseTags,
  type Prompt,
  usesClipboard,
  validate,
} from "./lib.ts";
import { addPrompt, recordUse, updatePrompt } from "./store.ts";

/** A fenced block that can't be closed by backticks inside the text. */
export function fenced(text: string): string {
  const longest = Math.max(2, ...(text.match(/`+/g) ?? []).map((t) => t.length));
  const fence = "`".repeat(longest + 1);
  return `${fence}text\n${text}\n${fence}`;
}

export type Delivery = "paste" | "copy" | "preview";

/** The prompt with its built-ins and the given values filled in. */
export async function render(prompt: Prompt, values: Record<string, string>): Promise<string> {
  let clip = "";
  if (usesClipboard(prompt.body)) {
    clip = await clipboard.read().catch(() => "");
    if (!clip.trim()) throw new Error("The clipboard is empty: this prompt inserts what you copied");
  }
  return fill(prompt.body, values, builtinValues(new Date(), clip));
}

/** Pastes or copies the filled prompt and closes the launcher. */
export async function deliver(prompt: Prompt, text: string, how: Delivery): Promise<Outcome> {
  if (how === "preview") {
    return detail({
      title: prompt.title,
      markdown: fenced(text),
      status: `${text.length} characters`,
      actions: [
        action("Paste", () => deliver(prompt, text, "paste"), { icon: Icons.paste }),
        action("Copy", () => deliver(prompt, text, "copy"), { icon: Icons.copy }),
      ],
    });
  }
  await recordUse(prompt.id);
  if (how === "paste") {
    await clipboard.paste(text);
    return close();
  }
  await clipboard.write(text);
  return close(`Copied “${prompt.title}”`);
}

/** Asks for the prompt's variables, or delivers it right away when it has none. */
export async function use(prompt: Prompt, how: Delivery): Promise<Outcome> {
  const vars = askedVariables(prompt.body);
  if (!vars.length) return deliver(prompt, await render(prompt, {}), how);
  return fillForm(prompt, how);
}

export function fillForm(prompt: Prompt, how: Delivery): FormSpec {
  const vars = askedVariables(prompt.body);
  return form({
    title: prompt.title,
    submitTitle: how === "paste" ? "Paste" : how === "copy" ? "Copy" : "Preview",
    fields: vars.map((v) =>
      (v.multiline ? field.textArea : field.text)(fieldId(v.name), v.label, {
        value: v.default ?? "",
        required: v.default === undefined,
        placeholder: v.default ? `Default: ${v.default}` : undefined,
      })
    ),
    async submit(values) {
      const byName: Record<string, string> = {};
      for (const v of vars) byName[v.name] = String(values[fieldId(v.name)] ?? "");
      return deliver(prompt, await render(prompt, byName), how);
    },
  });
}

/**
 * The add / edit form. `existing` edits it; without it, a new prompt is saved.
 * `back` goes back to the list afterwards instead of closing the launcher.
 */
export function promptForm(
  existing?: Prompt,
  initial: { title?: string; body?: string; back?: boolean } = {},
): FormSpec {
  return form({
    title: existing ? `Edit “${existing.title}”` : "Add Prompt",
    submitTitle: existing ? "Save" : "Add Prompt",
    fields: [
      field.text("title", "Title", {
        required: true,
        value: existing?.title ?? initial.title ?? "",
        placeholder: "Code Review",
      }),
      field.textArea("body", "Prompt", {
        required: true,
        value: existing?.body ?? initial.body ?? "",
        placeholder: "Review this {{language|TypeScript}} code:\n\n{{code}}",
      }),
      field.text("tags", "Tags", { value: existing?.tags.join(", ") ?? "", placeholder: "code, review" }),
      field.checkbox("pinned", "Pin to the top", { value: existing?.pinned ?? false }),
    ],
    async submit(values) {
      const title = String(values.title ?? "");
      const body = String(values.body ?? "");
      const problem = validate(title, body);
      if (problem) {
        await toast(problem, { style: "failure" });
        return;
      }
      const tags = parseTags(String(values.tags ?? ""));
      const pinned = values.pinned === true;
      if (existing) {
        await updatePrompt(existing.id, (p) => ({
          ...p,
          title: title.trim(),
          body: body.replace(/\s+$/, ""),
          tags,
          pinned,
          updated: Date.now(),
        }));
        await toast(`Saved “${title.trim()}”`, { style: "success" });
        return pop();
      }
      await addPrompt(makePrompt({ title, body, tags, pinned }, Date.now()));
      const n = askedVariables(body).length;
      if (initial.back) {
        await toast(`Added “${title.trim()}”`, { style: "success" });
        return pop();
      }
      return close(`Added “${title.trim()}”${n ? ` with ${n} variable${n === 1 ? "" : "s"}` : ""}`);
    },
  });
}
