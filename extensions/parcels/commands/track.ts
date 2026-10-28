import { run } from "@backslash/api";
import { add, check, keys, merge, SetupError } from "../api.ts";
import { carrier, statusLook, validNumber } from "../lib.ts";

export default run<{ number: string; label?: string }>(async ({ args, preferences, signal }) => {
  const number = String(args.number ?? "");
  if (!validNumber(number)) throw new Error("Not a tracking number: it has 5 to 40 letters and digits");
  const k = keys(preferences);
  if (!k.laposte && !k.track17) {
    throw new SetupError("Add a La Poste or 17TRACK API key in Settings → Extensions → Parcel Tracking");
  }
  const parcel = await add(number, String(args.label ?? "").trim());
  const [c] = await check([parcel], k, signal);
  if (c) await merge([c.parcel]);
  const t = c?.parcel.tracking;
  const who = t?.carrier || carrier(parcel.carrier).name;
  if (!t) return `Tracking ${parcel.label} (${who}): ${c?.parcel.error ?? "no news yet"}`;
  return `${parcel.label} (${who}): ${t.events[0]?.description ?? statusLook(t.status).text}`;
});
