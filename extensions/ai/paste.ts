import { clipboard } from "@backslash/api";

/** clipboard.paste came with Backslash 0.4. */
export const canPaste = "paste" in clipboard;

/** Pastes into the app the user was in, closing the launcher. */
export async function pasteText(text: string) {
  await clipboard.paste(text);
}
