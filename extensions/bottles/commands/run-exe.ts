import { clipboard } from "@backslash/api";
import { isWindowsProgram, pathFromClipboard } from "../lib.ts";
import { bottles, HOME, prefixes } from "../system.ts";
import { runForm } from "../ui.ts";

// The form opens with the program copied in the file manager, when there is one.
export default async () => {
  const [found, wine, text] = await Promise.all([bottles(), prefixes(), clipboard.read().catch(() => "")]);
  const path = pathFromClipboard(text, HOME);
  return runForm(found.bottles, wine, path && isWindowsProgram(path) ? path : "");
};
