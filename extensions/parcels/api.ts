// La Poste "Suivi v2" (Colissimo, Chronopost, letters) and 17TRACK v2.2 (every other carrier),
// and the saved parcels.

import { Icons, type Item, open, storage } from "@backslash/api";
import {
  carrier,
  change,
  cleanNumber,
  detectCarrier,
  from17,
  fromLaPoste,
  isFinal,
  type LaPosteResponse,
  type Parcel,
  type Track17,
  type Tracking,
} from "./lib.ts";

export const HOSTS = ["api.laposte.fr", "api.17track.net"];

const LAPOSTE = "https://api.laposte.fr/suivi/v2/idships";
const TRACK17 = "https://api.17track.net/track/v2.2";

export const LAPOSTE_KEY_URL = "https://developer.laposte.fr/products/suivi/latest";
export const TRACK17_KEY_URL = "https://api.17track.net/en/admin/settings";

export class SetupError extends Error {}

export interface Keys {
  laposte?: string;
  track17?: string;
}

export const keys = (preferences: Record<string, unknown>): Keys => ({
  laposte: String(preferences.laposteKey ?? "").trim() || undefined,
  track17: String(preferences.track17Key ?? "").trim() || undefined,
});

const aborted = (e: unknown) => e instanceof DOMException && (e.name === "AbortError" || e.name === "TimeoutError");

async function call(service: string, url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (e) {
    if (aborted(e)) throw e;
    throw new Error(`${service} can't be reached: check your connection`);
  }
}

// ---------------------------------------------------------------------------
// La Poste

export async function laPoste(number: string, key: string, signal?: AbortSignal): Promise<Tracking> {
  const res = await call("La Poste", `${LAPOSTE}/${encodeURIComponent(number)}?lang=en_GB`, {
    signal,
    headers: { "X-Okapi-Key": key, Accept: "application/json" },
  });
  if (res.status === 401 || res.status === 403) {
    throw new SetupError("La Poste refused the API key: check it in Settings");
  }
  if (res.status === 429) throw new Error("Too many requests to La Poste: try again in a minute");
  const body = await res.json().catch(() => undefined) as LaPosteResponse | undefined;
  if (!body) throw new Error(`La Poste answered ${res.status}`);
  if (res.status === 404 || !body.shipment) {
    throw new Error(body.returnMessage || "La Poste doesn't know this number yet");
  }
  return fromLaPoste(body);
}

// ---------------------------------------------------------------------------
// 17TRACK

interface Answer17<T> {
  code: number;
  data?: {
    accepted?: T[];
    rejected?: { number: string; error?: { code: number; message: string } }[];
    errors?: { code: number; message: string }[];
  };
}

/** Already registered: not an error. */
const ALREADY_REGISTERED = -18019901;
/** Registered, but the carrier has not answered yet. */
const NO_INFO_YET = [-18019909, -18019910];

async function post17<T>(path: string, key: string, body: unknown, signal?: AbortSignal): Promise<Answer17<T>> {
  const res = await call("17TRACK", `${TRACK17}${path}`, {
    method: "POST",
    signal,
    headers: { "17token": key, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (res.status === 401) throw new SetupError("17TRACK refused the API key: check it in Settings");
  if (res.status === 429) throw new Error("Too many requests to 17TRACK: try again in a minute");
  const answer = await res.json().catch(() => undefined) as Answer17<T> | undefined;
  if (!res.ok || !answer) throw new Error(`17TRACK answered ${res.status}`);
  if (answer.code !== 0) {
    const message = answer.data?.errors?.[0]?.message ?? `error ${answer.code}`;
    if (/token|key|auth/i.test(message)) throw new SetupError(`17TRACK refused the API key (${message})`);
    throw new Error(`17TRACK: ${message}`);
  }
  return answer;
}

/** Starts tracking a number (each one counts against the 17TRACK quota once). */
export async function register17(numbers: string[], key: string, signal?: AbortSignal): Promise<void> {
  const answer = await post17("/register", key, numbers.map((number) => ({ number })), signal);
  const rejected = (answer.data?.rejected ?? []).filter((r) => r.error?.code !== ALREADY_REGISTERED);
  if (rejected.length) throw new Error(`17TRACK refused ${rejected[0].number}: ${rejected[0].error?.message}`);
}

/** Up to 40 numbers per call. Pending numbers come back as "not found yet". */
export async function info17(numbers: string[], key: string, signal?: AbortSignal): Promise<Map<string, Tracking>> {
  const out = new Map<string, Tracking>();
  for (let i = 0; i < numbers.length; i += 40) {
    const chunk = numbers.slice(i, i + 40);
    const answer = await post17<Track17>("/gettrackinfo", key, chunk.map((number) => ({ number })), signal);
    for (const t of answer.data?.accepted ?? []) out.set(t.number, from17(t));
    for (const r of answer.data?.rejected ?? []) {
      if (r.error && NO_INFO_YET.includes(r.error.code)) {
        out.set(r.number, { status: "pending", carrier: "", events: [] });
      }
    }
  }
  return out;
}

export async function delete17(number: string, key: string): Promise<void> {
  await post17("/deletetrack", key, [{ number }], AbortSignal.timeout(8000)).catch(() => {});
}

// ---------------------------------------------------------------------------
// Checking parcels

/** La Poste's own API when its key is set and the number is theirs, 17TRACK otherwise. */
export function source(p: Parcel, k: Keys): "laposte" | "17track" {
  if (carrier(p.carrier).laposte && k.laposte) return "laposte";
  if (k.track17) return "17track";
  if (k.laposte) return "laposte";
  throw new SetupError("Add a La Poste or 17TRACK API key in Settings to track parcels");
}

export interface Checked {
  parcel: Parcel;
  /** What changed since the previous check. */
  news?: string;
}

/** Checks parcels: La Poste ones one by one, the others in one 17TRACK call. Errors stay on the parcel. */
export async function check(parcels: Parcel[], k: Keys, signal?: AbortSignal): Promise<Checked[]> {
  const via17 = parcels.filter((p) => source(p, k) === "17track");
  const viaPoste = parcels.filter((p) => source(p, k) === "laposte");
  const done = (p: Parcel, t: Tracking): Checked => ({
    parcel: { ...p, tracking: t, checked: Date.now(), error: undefined },
    news: change(p.tracking, t),
  });
  const failed = (p: Parcel, e: unknown): Checked => {
    if (aborted(e) || e instanceof SetupError) throw e;
    return { parcel: { ...p, error: (e as Error).message } };
  };
  const poste = Promise.all(viaPoste.map(async (p) => {
    try {
      return done(p, await laPoste(p.number, k.laposte!, signal));
    } catch (e) {
      // A La Poste number it doesn't know may be another carrier's: 17TRACK can tell.
      if (k.track17 && !(e instanceof SetupError) && !aborted(e)) via17.push(p);
      else return failed(p, e);
      return undefined;
    }
  }));
  const first = (await poste).filter((c): c is Checked => !!c);
  if (!via17.length) return first;
  try {
    const unregistered = via17.filter((p) => !p.registered).map((p) => p.number);
    if (unregistered.length) await register17(unregistered, k.track17!, signal);
    const found = await info17(via17.map((p) => p.number), k.track17!, signal);
    return [
      ...first,
      ...via17.map((p) => {
        const t = found.get(p.number);
        const parcel = { ...p, registered: true };
        return t ? done(parcel, t) : failed(parcel, new Error("17TRACK has no news of this number yet"));
      }),
    ];
  } catch (e) {
    return [...first, ...via17.map((p) => failed(p, e))];
  }
}

// ---------------------------------------------------------------------------
// Storage

type Json = Parameters<typeof storage.set>[1];

export const saved = async (): Promise<Parcel[]> => ((await storage.get("parcels")) ?? []) as unknown as Parcel[];

async function save(parcels: Parcel[]): Promise<void> {
  await storage.set("parcels", parcels as unknown as Json);
}

/** Replaces the checked parcels, keeping parcels added or removed meanwhile as they are. */
export async function merge(checked: Parcel[]): Promise<Parcel[]> {
  const byNumber = new Map(checked.map((p) => [p.number, p]));
  const all = (await saved()).map((p) => {
    const c = byNumber.get(p.number);
    return c ? { ...c, label: p.label } : p;
  });
  await save(all);
  return all;
}

export async function add(number: string, label: string): Promise<Parcel> {
  const n = cleanNumber(number);
  const all = await saved();
  const existing = all.find((p) => p.number === n);
  if (existing) {
    if (label && label !== existing.label) await rename(n, label);
    return { ...existing, label: label || existing.label };
  }
  const parcel: Parcel = { number: n, label: label || n, carrier: detectCarrier(n).id, added: Date.now() };
  await save([parcel, ...all]);
  return parcel;
}

export async function rename(number: string, label: string): Promise<void> {
  await save((await saved()).map((p) => (p.number === number ? { ...p, label: label || p.number } : p)));
}

export async function remove(p: Parcel, k: Keys): Promise<void> {
  await save((await saved()).filter((s) => s.number !== p.number));
  if (p.registered && k.track17) await delete17(p.number, k.track17);
}

export async function removeDelivered(k: Keys): Promise<number> {
  const all = await saved();
  const gone = all.filter((p) => p.tracking && isFinal(p.tracking.status));
  await save(all.filter((p) => !gone.includes(p)));
  if (k.track17) await Promise.all(gone.filter((p) => p.registered).map((p) => delete17(p.number, k.track17!)));
  return gone.length;
}

export function setupItem(e: SetupError): Item {
  return {
    id: "setup",
    title: e.message,
    subtitle: "La Poste for Colissimo, Chronopost and letters; 17TRACK for UPS, DHL, FedEx, Amazon…",
    icon: { source: Icons.key, tint: "orange" },
    detail: {
      markdown: [
        "## Connect a tracking service",
        "",
        "Either key is enough; with both, La Poste numbers use La Poste's own API.",
        "",
        "- **La Poste** (free): create an app on developer.laposte.fr and subscribe it to the **Suivi** API.",
        "  Copy its `X-Okapi-Key`.",
        "- **17TRACK** (free tier, 100 numbers): sign up on api.17track.net, then copy the key in",
        "  **Settings → Security → Access key**. It tracks 2,000+ carriers: UPS, DHL, FedEx, Amazon, DPD, GLS…",
        "",
        "Then paste them in **Settings → Extensions → Parcel Tracking → Configure**.",
      ].join("\n"),
    },
    actions: [
      open(LAPOSTE_KEY_URL, "Get a La Poste Key", { icon: Icons.key }),
      open(TRACK17_KEY_URL, "Get a 17TRACK Key", { icon: Icons.key }),
    ],
  };
}
