import { run, updateCommandMetadata } from "@backslash/api";
import { pickRandom, prettyName } from "../lib.ts";
import { currentWallpaper, folders, type Prefs, setWallpaper, tilde, wallpapers } from "../system.ts";

// From your folders; the system's wallpapers only when yours are empty.
export default run(async ({ preferences }) => {
  const prefs = preferences as Prefs;
  let pool = await wallpapers(prefs, false);
  if (!pool.length && prefs.system !== false) pool = await wallpapers(prefs, true);
  const current = await currentWallpaper(prefs);
  const pick = pickRandom(pool, (w) => w.path === current);
  if (!pick) throw new Error(`No wallpapers in ${folders(prefs).map(tilde).join(", ")}`);
  await setWallpaper(pick.path, prefs);
  const name = prettyName(pick.name);
  await updateCommandMetadata({ subtitle: name }).catch(() => {});
  return `Wallpaper: ${name}`;
});
