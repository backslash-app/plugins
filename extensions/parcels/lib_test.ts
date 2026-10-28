import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { parse } from "@std/toml";
import { HOSTS, source } from "./api.ts";
import {
  ago,
  change,
  cleanNumber,
  daysInTransit,
  detectCarrier,
  from17,
  fromLaPoste,
  isS10,
  type LaPosteResponse,
  type Parcel,
  s10CheckDigit,
  status17,
  statusLaPoste,
  summary,
  timeline,
  type Track17,
  trackingUrl,
  validNumber,
} from "./lib.ts";

Deno.test("S10 check digit", () => {
  // The UPU's own example: RB 12345678 5 GB.
  assertEquals(s10CheckDigit("12345678"), 5);
  assert(isS10("RB123456785GB"));
  assert(!isS10("RB123456784GB"));
  assertEquals(s10CheckDigit("00000008"), 0); // 56 % 11 = 1, 11 - 1 = 10 → 0
  assertEquals(s10CheckDigit("00000000"), 5); // 11 → 5
});

Deno.test("carrier detection", () => {
  const id = (n: string) => detectCarrier(n).id;
  assertEquals(id("1Z999AA10123456784"), "ups");
  assertEquals(id("1z 999 aa1 0123 4567 84"), "ups");
  assertEquals(id("6A12345678901"), "colissimo");
  assertEquals(id("8R 123 456 789 01"), "colissimo");
  assertEquals(id("1K12345678901"), "laposte");
  assertEquals(id("CB123456789FR"), "colissimo");
  assertEquals(id("EE123456789FR"), "chronopost");
  assertEquals(id("XS123456789FR"), "chronopost");
  assertEquals(id("RR123456789FR"), "laposte");
  assertEquals(id("XJ12345678901"), "chronopost");
  assertEquals(id("TBA123456789012"), "amazon");
  assertEquals(id("JJD000390007849587234"), "dhl-paket");
  assertEquals(id("GM2951173225174494"), "dhl");
  assertEquals(id("1234567890"), "dhl");
  assertEquals(id("9400111899223197428490"), "usps");
  assertEquals(id("RB123456785US"), "usps");
  assertEquals(id("05222333444555"), "dpd");
  assertEquals(id("123456789012"), "fedex");
  assertEquals(id("3SABCD1234567"), "postnl");
  assertEquals(id("LP00123456789012"), "cainiao");
  assertEquals(id("12345678"), "mondial-relay");
  assertEquals(id("ZZZ"), "unknown");
  assertEquals(detectCarrier("RB123456785GB").name, "Royal Mail");
  assertEquals(detectCarrier("RB123456785ZZ").name, "Postal service (ZZ)");
  assertEquals(cleanNumber(" 6a-1234 5678.901 "), "6A12345678901");
  assert(validNumber("6A12345678901"));
  assert(!validNumber("12"));
  assert(!validNumber("not a number!"));
});

Deno.test("carrier pages", () => {
  assertEquals(
    trackingUrl("colissimo", "6A12345678901"),
    "https://www.laposte.fr/outils/suivre-vos-envois?code=6A12345678901",
  );
  assertEquals(trackingUrl("ups", "1Z999AA10123456784"), "https://www.ups.com/track?tracknum=1Z999AA10123456784");
  assertEquals(trackingUrl("unknown", "AB12"), "https://t.17track.net/en#nums=AB12");
});

Deno.test("statuses", () => {
  assertEquals(statusLaPoste("DI1"), "delivered");
  assertEquals(statusLaPoste("DI2"), "returned");
  assertEquals(statusLaPoste("MD2"), "out");
  assertEquals(statusLaPoste("AG1"), "pickup");
  assertEquals(statusLaPoste("ND1"), "failed");
  assertEquals(statusLaPoste("PC1"), "transit");
  assertEquals(statusLaPoste("DR1"), "info");
  assertEquals(statusLaPoste(undefined), "pending");
  assertEquals(status17("OutForDelivery"), "out");
  assertEquals(status17("AvailableForPickup"), "pickup");
  assertEquals(status17("NotFound"), "pending");
});

// Shaped like `GET https://api.laposte.fr/suivi/v2/idships/6A18987970674?lang=en_GB`.
const LAPOSTE: LaPosteResponse = {
  lang: "en_GB",
  returnCode: 200,
  shipment: {
    idShip: "6A18987970674",
    holder: 4,
    product: "colissimo",
    isFinal: false,
    entryDate: "2026-10-26T18:01:00+01:00",
    url: "https://www.laposte.fr/outils/suivre-vos-envois?code=6A18987970674",
    event: [
      { code: "ET1", label: "Your parcel is being processed.", date: "2026-10-27T03:12:00+01:00" },
      { code: "MD2", label: "Your parcel is out for delivery.", date: "2026-10-28T07:45:00+01:00" },
      { code: "PC1", label: "Your parcel has been taken in charge by La Poste.", date: "2026-10-26T18:01:00+01:00" },
      { code: "DR1", label: "The sender is preparing your parcel.", date: "2026-10-25T10:00:00+01:00" },
    ],
    timeline: [
      { id: 1, shortLabel: "Announced", status: true },
      { id: 2, shortLabel: "Taken in charge", status: true },
      { id: 3, shortLabel: "Being processed", status: true },
      { id: 4, shortLabel: "Out for delivery", status: true },
      { id: 5, shortLabel: "Delivered", status: false },
    ],
    contextData: { originCountry: "FR", arrivalCountry: { code: "FR", name: "France" } },
  },
};

Deno.test("La Poste response", () => {
  const t = fromLaPoste(LAPOSTE);
  assertEquals(t.status, "out");
  assertEquals(t.carrier, "Colissimo");
  assertEquals(t.detail, "Out for delivery");
  assertEquals(t.events.map((e) => e.code), ["MD2", "ET1", "PC1", "DR1"]);
  assertEquals(t.destination, "France");
  assertEquals(t.url, LAPOSTE.shipment!.url);
  const delivered = fromLaPoste({
    ...LAPOSTE,
    shipment: {
      ...LAPOSTE.shipment!,
      isFinal: true,
      event: [{ code: "DI1", label: "Your parcel is delivered.", date: "2026-10-28T11:02:00+01:00" }],
    },
  });
  assertEquals(delivered.status, "delivered");
  let error = "";
  try {
    fromLaPoste({ returnCode: 104, returnMessage: "Unknown tracking number" });
  } catch (e) {
    error = (e as Error).message;
  }
  assertEquals(error, "Unknown tracking number");
});

// Shaped like a `data.accepted[]` of `POST https://api.17track.net/track/v2.2/gettrackinfo`.
const TRACK17: Track17 = {
  number: "1Z999AA10123456784",
  carrier: 100002,
  track_info: {
    shipping_info: { shipper_address: { country: "DE" }, recipient_address: { country: "FR" } },
    latest_status: { status: "InTransit", sub_status: "InTransit_Other", sub_status_descr: null },
    latest_event: null,
    time_metrics: {
      days_after_order: 3,
      days_of_transit: 2,
      estimated_delivery_date: {
        source: "Official",
        from: "2026-10-30T00:00:00+01:00",
        to: "2026-10-31T00:00:00+01:00",
      },
    },
    tracking: {
      providers: [{
        provider: { key: 100002, name: "UPS", homepage: "https://www.ups.com", country: "US" },
        service_type: "UPS Standard",
        events: [
          {
            time_iso: "2026-10-28T06:10:00+01:00",
            description: "Arrived at Facility",
            location: "Paris, FR",
          },
          {
            time_iso: "2026-10-27T21:30:00+01:00",
            description: "Departed from Facility",
            location: null,
            address: { city: "Köln", country: "DE" },
          },
          { time_iso: "2026-10-26T14:00:00+01:00", description: "Shipper created a label", location: "" },
          { time_iso: "2026-10-26T14:00:00+01:00", description: "Shipper created a label", location: "" },
        ],
      }],
    },
  },
};

Deno.test("17TRACK response", () => {
  const t = from17(TRACK17);
  assertEquals(t.status, "transit");
  assertEquals(t.carrier, "UPS");
  assertEquals(t.product, "UPS Standard");
  assertEquals(t.events.length, 3);
  assertEquals(t.events[1].location, "Köln, DE");
  assertEquals(t.origin, "DE");
  assertEquals(t.eta?.to, "2026-10-31T00:00:00+01:00");
  assertEquals(daysInTransit(t, Date.parse("2026-10-28T12:00:00+01:00")), 1);
  const md = timeline(t);
  assertStringIncludes(md, "Arrived at Facility — *Paris, FR*");
  assertEquals((md.match(/^### /gm) ?? []).length, 3);
  assertEquals(from17({ number: "X" }).status, "pending");
});

Deno.test("changes and summary", () => {
  const before = from17(TRACK17);
  assertEquals(change(before, before), undefined);
  const after = { ...before, status: "out" as const };
  assertEquals(change(before, after), "Out for delivery");
  const moved = {
    ...before,
    events: [{ time: "2026-10-28T09:00:00+01:00", description: "Loaded on vehicle" }, ...before.events],
  };
  assertEquals(change(before, moved), "Loaded on vehicle");
  assertEquals(change(undefined, { status: "pending", carrier: "", events: [] }), undefined);
  const parcel = (status: "out" | "transit" | "delivered" | "pickup"): Parcel => ({
    number: status,
    label: status,
    carrier: "ups",
    added: 0,
    tracking: { ...before, status },
  });
  assertEquals(
    summary([parcel("out"), parcel("transit"), parcel("transit"), parcel("delivered"), parcel("pickup")]),
    "1 out for delivery · 1 to pick up · 2 on the way",
  );
  assertEquals(summary([parcel("delivered")]), null);
  const now = Date.parse("2026-10-28T12:00:00Z");
  assertEquals(ago("2026-10-28T11:59:30Z", now), "just now");
  assertEquals(ago("2026-10-28T11:15:00Z", now), "45 min ago");
  assertEquals(ago("2026-10-26T11:00:00Z", now), "2 d ago");
});

Deno.test("which API tracks which parcel", () => {
  const p = (carrier: Parcel["carrier"]): Parcel => ({ number: "X", label: "X", carrier, added: 0 });
  assertEquals(source(p("colissimo"), { laposte: "k", track17: "k" }), "laposte");
  assertEquals(source(p("ups"), { laposte: "k", track17: "k" }), "17track");
  assertEquals(source(p("colissimo"), { track17: "k" }), "17track");
  assertEquals(source(p("ups"), { laposte: "k" }), "laposte");
  let message = "";
  try {
    source(p("ups"), {});
  } catch (e) {
    message = (e as Error).message;
  }
  assertStringIncludes(message, "API key");
});

Deno.test("manifest", async () => {
  const manifest = parse(await Deno.readTextFile(new URL("./backslash.toml", import.meta.url))) as {
    permissions: { net: string[] };
    commands: { name: string; interval?: string; mode?: string }[];
  };
  assertEquals(manifest.permissions.net, HOSTS);
  const refresh = manifest.commands.find((c) => c.name === "refresh");
  assertEquals(refresh?.interval, "1h");
  assertEquals(refresh?.mode, "no-view");
  for (const c of manifest.commands) await Deno.stat(new URL(`./commands/${c.name}.ts`, import.meta.url));
});
