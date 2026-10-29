import { clipboard, run } from "@backslash/api";
import { isoWeek, isoWeekStart, localDay, short } from "../lib.ts";

export default run(async () => {
  const w = isoWeek(localDay());
  const start = isoWeekStart(w.year, w.week);
  await clipboard.write(String(w.week));
  return `Week ${w.week} copied · ${short(start, false)} – ${short(start + 6)}`;
});
