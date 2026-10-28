import type { Context } from "@backslash/api";
import { linkForm, manualForm, type Prefs } from "../ui.ts";

// A copied otpauth:// link opens the link form, filled in; otherwise the secret key form.
export default async (ctx: Context) => {
  const prefs = ctx.preferences as Prefs;
  const query = ctx.query.trim();
  if (/^otpauth(-migration)?:\/\//i.test(query)) return linkForm(prefs, true);
  const links = await linkForm(prefs, true);
  const prefilled = links.fields[0]?.value;
  return prefilled ? links : manualForm(prefs, true);
};
