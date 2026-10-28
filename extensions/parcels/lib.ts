// Carrier detection, La Poste and 17TRACK responses, statuses and formatting.
// Pure, tested in lib_test.ts.

import { type Color, Icons } from "@backslash/api";

// ---------------------------------------------------------------------------
// Carriers

export type CarrierId =
  | "laposte"
  | "colissimo"
  | "chronopost"
  | "ups"
  | "fedex"
  | "dhl"
  | "dhl-paket"
  | "dpd"
  | "gls"
  | "amazon"
  | "usps"
  | "mondial-relay"
  | "postnl"
  | "cainiao"
  | "post"
  | "unknown";

export interface Carrier {
  id: CarrierId;
  name: string;
  /** Tracked with La Poste's own API when its key is set. */
  laposte: boolean;
}

const CARRIERS: Record<CarrierId, Omit<Carrier, "id">> = {
  laposte: { name: "La Poste", laposte: true },
  colissimo: { name: "Colissimo", laposte: true },
  chronopost: { name: "Chronopost", laposte: true },
  ups: { name: "UPS", laposte: false },
  fedex: { name: "FedEx", laposte: false },
  dhl: { name: "DHL Express", laposte: false },
  "dhl-paket": { name: "DHL Paket", laposte: false },
  dpd: { name: "DPD", laposte: false },
  gls: { name: "GLS", laposte: false },
  amazon: { name: "Amazon Logistics", laposte: false },
  usps: { name: "USPS", laposte: false },
  "mondial-relay": { name: "Mondial Relay", laposte: false },
  postnl: { name: "PostNL", laposte: false },
  cainiao: { name: "Cainiao", laposte: false },
  post: { name: "Postal service", laposte: false },
  unknown: { name: "Unknown carrier", laposte: false },
};

export const carrier = (id: CarrierId, name?: string): Carrier => ({ id, ...CARRIERS[id], ...(name ? { name } : {}) });

/** Postal operators of UPU S10 numbers (`RB123456785GB`), by the last two letters. */
const POSTS: Record<string, string> = {
  GB: "Royal Mail",
  DE: "Deutsche Post",
  US: "USPS",
  CN: "China Post",
  NL: "PostNL",
  BE: "bpost",
  ES: "Correos",
  IT: "Poste Italiane",
  CH: "Swiss Post",
  CA: "Canada Post",
  JP: "Japan Post",
  PT: "CTT",
  PL: "Poczta Polska",
  SE: "PostNord",
  DK: "PostNord",
  AT: "Österreichische Post",
  LU: "POST Luxembourg",
  HK: "Hongkong Post",
  SG: "Singapore Post",
  AU: "Australia Post",
};

/** Tracking numbers are typed with spaces and dashes, in any case. */
export const cleanNumber = (input: string) => input.replace(/[\s.-]+/g, "").toUpperCase();

/** UPU S10 check digit of the 8 serial digits (weights 8 6 4 2 3 5 9 7). */
export function s10CheckDigit(serial: string): number {
  const weights = [8, 6, 4, 2, 3, 5, 9, 7];
  const sum = [...serial].reduce((n, d, i) => n + Number(d) * weights[i], 0);
  const check = 11 - (sum % 11);
  return check === 10 ? 0 : check === 11 ? 5 : check;
}

/** `RB123456785GB`: two letters, 8 digits, a check digit, the country. */
export function isS10(number: string): boolean {
  const m = /^[A-Z]{2}(\d{8})(\d)[A-Z]{2}$/.exec(number);
  return !!m && s10CheckDigit(m[1]) === Number(m[2]);
}

/** The carrier a tracking number most likely belongs to, from its format. */
export function detectCarrier(input: string): Carrier {
  const n = cleanNumber(input);
  if (/^1Z[0-9A-Z]{16}$/.test(n)) return carrier("ups");
  if (/^TB[ACM]\d{12}$/.test(n)) return carrier("amazon");
  if (/^JJD\d{16,20}$/.test(n) || /^00340\d{15}$/.test(n)) return carrier("dhl-paket");
  if (/^(GM|LX|RX)\d{16,18}$/.test(n)) return carrier("dhl", "DHL eCommerce");
  if (/^3S[0-9A-Z]{11,13}$/.test(n)) return carrier("postnl");
  if (/^(LP|CN)\d{14,16}$/.test(n)) return carrier("cainiao");
  if (/^[A-Z]{2}\d{9}[A-Z]{2}$/.test(n)) {
    const country = n.slice(-2);
    const service = n[0];
    if (country === "FR") {
      if (service === "E" || service === "X") return carrier("chronopost");
      if (service === "C") return carrier("colissimo");
      return carrier("laposte");
    }
    if (country === "US") return carrier("usps");
    if (country === "NL") return carrier("postnl");
    return carrier("post", POSTS[country] ?? `Postal service (${country})`);
  }
  // Colissimo and La Poste letters: a digit, a letter and 11 digits (`6A12345678901`).
  if (/^\d[A-Z]\d{11}$/.test(n)) return n[0] === "1" || n[0] === "2" ? carrier("laposte") : carrier("colissimo");
  // Chronopost France: two letters, 9 digits and two more letters or a 13-character code starting with XA/XJ…
  if (/^X[A-Z]\d{11}$/.test(n)) return carrier("chronopost");
  if (/^(94|93|92|95)\d{20}$/.test(n) || /^420\d{5}(9[1-5])\d{20}$/.test(n)) return carrier("usps");
  if (/^\d{10}$/.test(n)) return carrier("dhl");
  if (/^\d{14}$/.test(n)) return carrier("dpd");
  if (/^\d{12}$/.test(n) || /^\d{15}$/.test(n) || /^\d{20}$/.test(n)) return carrier("fedex");
  if (/^\d{11}$/.test(n)) return carrier("gls");
  if (/^\d{8}$/.test(n)) return carrier("mondial-relay");
  return carrier("unknown");
}

/** Numbers the APIs accept: 5 to 40 letters and digits. */
export const validNumber = (input: string) => /^[A-Z0-9]{5,40}$/.test(cleanNumber(input));

/** The carrier's own tracking page; 17TRACK's when the carrier is unknown. */
export function trackingUrl(c: CarrierId, number: string): string {
  const n = encodeURIComponent(number);
  switch (c) {
    case "laposte":
    case "colissimo":
      return `https://www.laposte.fr/outils/suivre-vos-envois?code=${n}`;
    case "chronopost":
      return `https://www.chronopost.fr/tracking-no-cms/suivi-page?listeNumerosLT=${n}`;
    case "ups":
      return `https://www.ups.com/track?tracknum=${n}`;
    case "fedex":
      return `https://www.fedex.com/fedextrack/?trknbr=${n}`;
    case "dhl":
      return `https://www.dhl.com/global-en/home/tracking.html?tracking-id=${n}`;
    case "dhl-paket":
      return `https://www.dhl.de/en/privatkunden/pakete-empfangen/verfolgen.html?piececode=${n}`;
    case "dpd":
      return `https://trace.dpd.fr/fr/trace/${n}`;
    case "gls":
      return `https://gls-group.com/FR/fr/suivi-colis?match=${n}`;
    case "amazon":
      return `https://track.amazon.com/tracking/${n}`;
    case "usps":
      return `https://tools.usps.com/go/TrackConfirmAction?tLabels=${n}`;
    case "mondial-relay":
      return `https://www.mondialrelay.fr/suivi-de-colis/?numeroExpedition=${n}`;
    case "postnl":
      return `https://jouw.postnl.nl/track-and-trace/${n}`;
    default:
      return `https://t.17track.net/en#nums=${n}`;
  }
}

// ---------------------------------------------------------------------------
// Statuses

export type Status =
  | "pending"
  | "info"
  | "transit"
  | "pickup"
  | "out"
  | "delivered"
  | "failed"
  | "exception"
  | "returned"
  | "expired";

const LOOKS: Record<Status, { text: string; color: Color; icon: string }> = {
  pending: { text: "Not found yet", color: "gray", icon: Icons.hourglass },
  info: { text: "Label created", color: "blue", icon: Icons.tag },
  transit: { text: "In transit", color: "blue", icon: Icons.package },
  pickup: { text: "Ready for pickup", color: "purple", icon: Icons.pin },
  out: { text: "Out for delivery", color: "yellow", icon: Icons.rocket },
  delivered: { text: "Delivered", color: "green", icon: Icons.done },
  failed: { text: "Delivery failed", color: "orange", icon: Icons.alert },
  exception: { text: "Problem", color: "red", icon: Icons.alert },
  returned: { text: "Returned to sender", color: "red", icon: Icons.arrowRight },
  expired: { text: "No news for a long time", color: "gray", icon: Icons.clock },
};

export const statusLook = (s: Status) => LOOKS[s] ?? LOOKS.pending;

/** Parcels with nothing left to wait for. */
export const isFinal = (s: Status) => s === "delivered" || s === "returned";

/** 17TRACK's `latest_status.status`. */
export function status17(s: string | undefined): Status {
  switch (s) {
    case "InfoReceived":
      return "info";
    case "InTransit":
      return "transit";
    case "AvailableForPickup":
      return "pickup";
    case "OutForDelivery":
      return "out";
    case "Delivered":
      return "delivered";
    case "DeliveryFailure":
      return "failed";
    case "Exception":
      return "exception";
    case "Expired":
      return "expired";
    default:
      return "pending";
  }
}

/** La Poste event codes (DR1 declared, PC1 taken in charge, MD2 out for delivery, DI1 delivered…). */
export function statusLaPoste(code: string | undefined): Status {
  const c = (code ?? "").toUpperCase();
  if (/^DI2/.test(c) || /^RE/.test(c)) return "returned";
  if (/^DI/.test(c)) return "delivered";
  if (/^MD/.test(c)) return "out";
  if (/^AG/.test(c)) return "pickup";
  if (/^ND/.test(c)) return "failed";
  if (/^PB/.test(c)) return "exception";
  if (/^DR/.test(c)) return "info";
  if (/^(PC|ET|EP|DO|SD|IN)/.test(c)) return "transit";
  return c ? "transit" : "pending";
}

// ---------------------------------------------------------------------------
// Tracking, the same for both APIs

export interface TrackEvent {
  /** ISO 8601. */
  time: string;
  description: string;
  location?: string;
  code?: string;
}

export interface Tracking {
  status: Status;
  /** The status as the carrier words it, when it says more than ours. */
  detail?: string;
  carrier: string;
  /** Newest first. */
  events: TrackEvent[];
  eta?: { from?: string; to?: string };
  origin?: string;
  destination?: string;
  product?: string;
  url?: string;
}

/** `GET /suivi/v2/idships/{id}` of La Poste. */
export interface LaPosteResponse {
  lang?: string;
  returnCode: number;
  returnMessage?: string;
  idShip?: string;
  shipment?: {
    idShip: string;
    holder?: number;
    product?: string;
    isFinal?: boolean;
    deliveryDate?: string;
    entryDate?: string;
    url?: string;
    event?: { code: string; label: string; date: string }[];
    timeline?: { shortLabel?: string; longLabel?: string; id: number; date?: string; status: boolean }[];
    contextData?: {
      originCountry?: string;
      arrivalCountry?: { code?: string; name?: string } | string;
      removalPoint?: { name?: string; type?: string };
    };
  };
}

const HOLDERS: Record<number, string> = { 1: "La Poste", 2: "La Poste", 3: "Chronopost", 4: "Colissimo" };

const byTime = (a: TrackEvent, b: TrackEvent) => Date.parse(b.time) - Date.parse(a.time);

export function fromLaPoste(r: LaPosteResponse): Tracking {
  const s = r.shipment;
  if (!s) throw new Error(r.returnMessage || "La Poste knows nothing about this number yet");
  const events = (s.event ?? []).map((e) => ({ time: e.date, description: e.label.trim(), code: e.code }))
    .sort(byTime);
  let status = statusLaPoste(events[0]?.code);
  if (s.isFinal && status !== "returned") status = "delivered";
  const step = [...(s.timeline ?? [])].filter((t) => t.status).sort((a, b) => b.id - a.id)[0];
  const arrival = s.contextData?.arrivalCountry;
  const product = s.product ? s.product[0].toUpperCase() + s.product.slice(1) : undefined;
  return {
    status,
    detail: step?.shortLabel?.trim() || undefined,
    carrier: (s.holder && HOLDERS[s.holder]) || product || "La Poste",
    events,
    product,
    origin: s.contextData?.originCountry,
    destination: typeof arrival === "string" ? arrival : arrival?.name ?? arrival?.code,
    url: s.url,
    ...(s.deliveryDate && status !== "delivered" ? { eta: { from: s.deliveryDate } } : {}),
  };
}

/** One `data.accepted[]` of 17TRACK's `POST /track/v2.2/gettrackinfo`. */
export interface Track17 {
  number: string;
  carrier?: number;
  track_info?: {
    shipping_info?: {
      shipper_address?: Address17;
      recipient_address?: Address17;
    };
    latest_status?: { status?: string; sub_status?: string; sub_status_descr?: string | null };
    latest_event?: Event17 | null;
    time_metrics?: {
      days_after_order?: number;
      days_of_transit?: number;
      estimated_delivery_date?: { source?: string | null; from?: string | null; to?: string | null };
    };
    tracking?: {
      providers?: {
        provider?: { key?: number; name?: string; alias?: string; homepage?: string; country?: string };
        service_type?: string | null;
        events?: Event17[];
      }[];
    };
  };
}

interface Address17 {
  country?: string | null;
  state?: string | null;
  city?: string | null;
}

interface Event17 {
  time_iso?: string;
  time_utc?: string;
  description?: string;
  location?: string | null;
  stage?: string | null;
  sub_status?: string | null;
  address?: Address17;
}

const place = (a?: Address17) => [a?.city, a?.state, a?.country].filter(Boolean).join(", ") || undefined;

export function from17(t: Track17): Tracking {
  const info = t.track_info;
  const providers = info?.tracking?.providers ?? [];
  const seen = new Set<string>();
  const events: TrackEvent[] = [];
  for (const p of providers) {
    for (const e of p.events ?? []) {
      const time = e.time_iso || e.time_utc;
      if (!time || !e.description) continue;
      const key = `${Date.parse(time)}|${e.description}`;
      if (seen.has(key)) continue;
      seen.add(key);
      events.push({ time, description: e.description.trim(), location: e.location || place(e.address) });
    }
  }
  events.sort(byTime);
  const eta = info?.time_metrics?.estimated_delivery_date;
  const name = providers.map((p) => p.provider?.name).filter(Boolean);
  const sub = info?.latest_status?.sub_status_descr;
  return {
    status: status17(info?.latest_status?.status),
    detail: sub || undefined,
    carrier: [...new Set(name)].join(" → ") || "",
    events,
    origin: info?.shipping_info?.shipper_address?.country ?? undefined,
    destination: info?.shipping_info?.recipient_address?.country ?? undefined,
    product: providers[0]?.service_type ?? undefined,
    ...(eta?.from || eta?.to ? { eta: { from: eta.from ?? undefined, to: eta.to ?? undefined } } : {}),
  };
}

// ---------------------------------------------------------------------------
// Saved parcels

export interface Parcel {
  number: string;
  label: string;
  carrier: CarrierId;
  added: number;
  tracking?: Tracking;
  /** Unix ms of the last successful check. */
  checked?: number;
  /** Last error, kept until the next good check. */
  error?: string;
  /** Registered with 17TRACK (which counts numbers against the quota). */
  registered?: boolean;
}

export const statusOf = (p: Parcel): Status => p.tracking?.status ?? "pending";

/** What changed between two checks, for a notification: undefined when nothing did. */
export function change(before: Tracking | undefined, after: Tracking): string | undefined {
  if (!before) return after.status === "pending" ? undefined : statusLook(after.status).text;
  if (before.status !== after.status) return statusLook(after.status).text;
  const [a, b] = [before.events[0], after.events[0]];
  if (b && (!a || a.time !== b.time || a.description !== b.description)) return b.description;
  return undefined;
}

/** "just now", "5 min ago", "3 h ago", "2 d ago". */
export function ago(iso: string | number | undefined, now = Date.now()): string {
  if (iso === undefined) return "";
  const t = typeof iso === "number" ? iso : Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const s = Math.max(0, (now - t) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86_400)} d ago`;
}

/** "Tue 28 Oct, 14:05" in the user's time zone. */
export function when(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const day = d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }).replace(",", "");
  const time = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  return `${day}, ${time}`;
}

/** "Thu 30 Oct" or "Thu 30 Oct – Sat 1 Nov". */
export function etaText(eta: Tracking["eta"]): string | undefined {
  if (!eta?.from && !eta?.to) return undefined;
  const day = (iso: string) =>
    new Date(iso).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }).replace(",", "");
  if (eta.from && eta.to && day(eta.from) !== day(eta.to)) return `${day(eta.from)} – ${day(eta.to)}`;
  return day((eta.from ?? eta.to)!);
}

/** The timeline as Markdown, grouped by day, newest first. */
export function timeline(t: Tracking): string {
  if (!t.events.length) return "_No event yet: carriers often take a day to scan a new parcel._";
  const out: string[] = [];
  let day = "";
  for (const e of t.events) {
    const d = new Date(e.time);
    const label = d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
    if (label !== day) {
      out.push(`### ${label}`);
      day = label;
    }
    const time = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
    out.push(`- **${time}** ${e.description}${e.location ? ` — *${e.location}*` : ""}`);
  }
  return out.join("\n");
}

/** Days since the first event. */
export function daysInTransit(t: Tracking, now = Date.now()): number | undefined {
  const first = t.events.at(-1);
  if (!first) return undefined;
  const end = isFinal(t.status) && t.events[0] ? Date.parse(t.events[0].time) : now;
  return Math.max(0, Math.floor((end - Date.parse(first.time)) / 86_400_000));
}

/** Command subtitle: "2 on the way · 1 to pick up". */
export function summary(parcels: Parcel[]): string | null {
  const count = (pred: (s: Status) => boolean) => parcels.filter((p) => pred(statusOf(p))).length;
  const out = count((s) => s === "out");
  const pickup = count((s) => s === "pickup");
  const moving = count((s) => !isFinal(s) && s !== "out" && s !== "pickup");
  const parts = [
    out ? `${out} out for delivery` : "",
    pickup ? `${pickup} to pick up` : "",
    moving ? `${moving} on the way` : "",
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}
