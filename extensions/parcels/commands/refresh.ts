import { exec, run, toast, updateCommandMetadata } from "@backslash/api";
import { check, keys, merge, saved } from "../api.ts";
import { isFinal, statusLook, summary } from "../lib.ts";

/** A desktop notification, when notify-send is there (the launcher's toasts only show while it is open). */
async function notify(title: string, body: string): Promise<void> {
  await exec("notify-send", ["-a", "Backslash", "-i", "package-x-generic", title, body]).catch(() => {});
}

export default run(async ({ preferences, signal, launchType }) => {
  const k = keys(preferences);
  const background = launchType === "background";
  if (!k.laposte && !k.track17) {
    if (background) return;
    throw new Error("Add a La Poste or 17TRACK API key in Settings → Extensions → Parcel Tracking");
  }
  const waiting = (await saved()).filter((p) => !(p.tracking && isFinal(p.tracking.status)));
  if (!waiting.length) {
    await updateCommandMetadata({ subtitle: null });
    return background ? undefined : "No parcel on the way";
  }
  const checked = await check(waiting, k, signal);
  const all = await merge(checked.map((c) => c.parcel));
  await updateCommandMetadata({ subtitle: summary(all) });
  const news = checked.filter((c) => c.news);
  for (const { parcel, news: what } of news) {
    const look = statusLook(parcel.tracking!.status);
    const body = what === look.text ? (parcel.tracking!.events[0]?.description ?? what) : what!;
    await toast(`${parcel.label}: ${look.text}`, { message: body, style: look.color === "green" ? "success" : "info" });
    if (preferences.notify !== false) await notify(`${parcel.label}: ${look.text}`, body);
  }
  if (background) return;
  return news.length ? `${news.length} parcel${news.length === 1 ? "" : "s"} updated` : "No news";
});
