import { action, type Context, type DetailSpec, replace } from "@backslash/api";
import type { Prefs } from "../lib.ts";
import { copiedText, nothingCopied, toolView } from "../tools.ts";

const LANGUAGES = ["English", "French", "Spanish", "German", "Italian", "Portuguese", "Chinese", "Japanese"];

function translate(prefs: Prefs, text: string, to: string): DetailSpec {
  // Text already in the target language goes to the user's own language.
  const other = [prefs.language?.trim(), "English"].find((l) => l && l.toLowerCase() !== to.toLowerCase());
  const instructions = `Translate the user's text into ${to}.${
    other ? ` If it is already in ${to}, translate it into ${other}.` : ""
  } Keep the formatting. Reply with the translation only.`;
  const others = LANGUAGES.filter((l) => l.toLowerCase() !== to.toLowerCase()).map((l) =>
    action(`Translate into ${l}`, () => replace(translate(prefs, text, l)), { icon: "preferences-desktop-locale" })
  );
  return toolView(prefs, `Translate into ${to}`, instructions, text, others);
}

export default async (ctx: Context) => {
  const prefs = ctx.preferences as Prefs;
  const text = await copiedText();
  return text ? translate(prefs, text, prefs.translate_to?.trim() || "English") : nothingCopied("translate");
};
