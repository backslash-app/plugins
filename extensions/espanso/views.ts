// The form adding a match, shared by Espanso Matches and Add Espanso Match.

import { close, field, form, toast } from "@backslash/api";
import { espansoPaths } from "./api.ts";
import { appendMatch } from "./lib.ts";

/** The file new matches go to: a name in the match folder (`backslash.yml` by default). */
export function targetFile(prefs: Record<string, unknown>, matchDir: string): string {
  let name = String(prefs.file ?? "").trim() || "backslash.yml";
  name = name.replace(/^.*\/match\//, "").replace(/^\/+/, "");
  if (name.includes("..") || !/\.ya?ml$/i.test(name)) {
    throw new Error("The match file must be a .yml name, like backslash.yml");
  }
  return `${matchDir}/${name}`;
}

export function addForm(prefs: Record<string, unknown>, initial: { trigger?: string; replace?: string } = {}) {
  return form({
    title: "New Espanso Match",
    submitTitle: "Add Match",
    fields: [
      field.text("trigger", "Trigger", { required: true, placeholder: ":sig", value: initial.trigger ?? ":" }),
      field.textArea("replace", "Replace with", {
        required: true,
        placeholder: "Best regards,\nAda — {{date}} works with a date variable named date",
        value: initial.replace,
      }),
      field.text("label", "Label", { placeholder: "Shown in espanso's search bar (optional)" }),
      field.checkbox("word", "Only as a whole word", { value: false }),
    ],
    async submit(values) {
      const trigger = String(values.trigger ?? "").trim();
      const replace = String(values.replace ?? "");
      if (!trigger || trigger === ":") throw new Error("Type a trigger, like :sig");
      if (!replace) throw new Error("Type the text the trigger expands to");
      const { match } = await espansoPaths();
      const file = targetFile(prefs, match);
      let text = "";
      try {
        text = await Deno.readTextFile(file);
      } catch (e) {
        if (!(e instanceof Deno.errors.NotFound)) throw e;
      }
      const next = appendMatch(text, {
        trigger,
        replace,
        label: String(values.label ?? "").trim() || undefined,
        word: values.word === true,
      });
      await Deno.mkdir(match, { recursive: true });
      await Deno.writeTextFile(file, next);
      await toast(`${trigger} added to ${file.split("/").pop()}`, {
        style: "success",
        message: "Espanso picks up the change by itself",
      });
      return close(`${trigger} added`);
    },
  });
}
