import type { Context } from "@backslash/api";
import { cachedScanners, NotInstalled, scanners } from "../system.ts";
import { type Prefs, scanForm } from "../ui.ts";

// The scanners found last time open the form at once; otherwise SANE looks for them first.
export default async (ctx: Context) => {
  let found = await cachedScanners();
  if (!found?.length) {
    found = await scanners(ctx.signal).catch((e) => {
      throw e instanceof NotInstalled ? new Error("scanimage is not installed: install SANE (sane-utils)") : e;
    });
  }
  return await scanForm(found, ctx.preferences as Prefs);
};
