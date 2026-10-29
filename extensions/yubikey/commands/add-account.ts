import { clipboard, type Context } from "@backslash/api";
import { devices, NotInstalled } from "../system.ts";
import { addForm } from "../ui.ts";

// The form opens with the otpauth:// link of the clipboard, when there is one.
export default async (ctx: Context) => {
  const [keys, text] = await Promise.all([
    devices().catch((e) => {
      throw new Error(e instanceof NotInstalled ? "ykman is not installed: install yubikey-manager" : e.message);
    }),
    clipboard.read().catch(() => ""),
  ]);
  if (!keys.length) throw new Error("No YubiKey plugged in");
  const uri = text.trim().startsWith("otpauth://") ? text.trim() : "";
  return addForm(keys, uri, String(ctx.preferences.oathPassword ?? "") || undefined);
};
