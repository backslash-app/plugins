import { exec, run, toast, updateCommandMetadata } from "@backslash/api";
import { games, saveWishlist, stores as loadStores, wishlist } from "../api.ts";
import { applyCheck, price } from "../lib.ts";

/** A desktop notification, when notify-send is there (the launcher's toasts only show while it is open). */
async function notify(title: string, body: string): Promise<void> {
  await exec("notify-send", ["-a", "Backslash", "-i", "applications-games", title, body]).catch(() => {});
}

export default run(async ({ preferences, signal, launchType }) => {
  const background = launchType === "background";
  const entries = await wishlist();
  if (!entries.length) {
    await updateCommandMetadata({ subtitle: null });
    return background ? undefined : "Your wishlist is empty";
  }
  const [infos, storeList] = await Promise.all([
    games(entries.map((e) => e.gameID), signal),
    loadStores(signal).catch(() => []),
  ]);
  const { entries: updated, hits } = applyCheck(entries, infos);
  await saveWishlist(updated);
  const below = updated.filter((e) => e.alerted !== undefined).length;
  await updateCommandMetadata({ subtitle: below ? `${below} at your price` : null });
  const storeName = (id: string) => storeList.find((s) => s.storeID === id)?.storeName ?? "a store";
  for (const { entry, offer } of hits) {
    const title = `${entry.title}: ${price(offer.price)}`;
    const body = `${offer.savings}% off at ${storeName(offer.storeID)}${
      entry.target ? ` (your target: ${price(entry.target)})` : ""
    }`;
    await toast(title, { message: body, style: "success" });
    if (preferences.notify !== false) await notify(title, body);
  }
  if (background) return;
  return hits.length
    ? `${hits.length} game${hits.length === 1 ? "" : "s"} at your price`
    : "No new deal on your wishlist";
});
