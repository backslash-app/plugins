import {
  type Action,
  action,
  close,
  type Context,
  copy,
  detail,
  field,
  form,
  Icons,
  type Item,
  list,
  meta,
  open,
  refresh,
  toast,
  updateCommandMetadata,
} from "@backslash/api";
import { add, check, keys, merge, remove, removeDelivered, rename, saved, SetupError, setupItem } from "../api.ts";
import {
  ago,
  carrier,
  daysInTransit,
  detectCarrier,
  etaText,
  isFinal,
  type Parcel,
  statusLook,
  statusOf,
  summary,
  timeline,
  trackingUrl,
  validNumber,
  when,
} from "../lib.ts";

/** Parcels checked more recently than this are shown as they are. */
const FRESH = 10 * 60_000;

// Set by "Refresh": the next load checks every parcel again.
let force = false;

const refreshAll = action("Refresh All", () => {
  force = true;
  return refresh();
}, { icon: Icons.refresh, shortcut: "<Ctrl>r", section: "Parcels" });

const addForm = (number = "") =>
  form({
    title: "Track a Parcel",
    submitTitle: "Track",
    fields: [
      field.text("number", "Tracking number", { required: true, value: number, placeholder: "6A12345678901, 1Z…" }),
      field.text("label", "Label", { placeholder: "What is it? (optional)" }),
    ],
    async submit(values, ctx) {
      const number = String(values.number ?? "");
      if (!validNumber(number)) {
        await toast("Not a tracking number: 5 to 40 letters and digits", { style: "failure" });
        return;
      }
      const parcel = await add(number, String(values.label ?? "").trim());
      force = true;
      const [c] = await check([parcel], keys(ctx.preferences), ctx.signal).catch((e) => {
        if (e instanceof SetupError) throw e;
        return [];
      });
      if (c) await merge([c.parcel]);
      await toast(`Tracking ${parcel.label}`, { style: "success", message: c?.parcel.error });
      return close();
    },
  });

const addAction = action("Track a Parcel…", () => addForm(), {
  icon: Icons.plus,
  shortcut: "<Ctrl>n",
  section: "Parcels",
});

function renameForm(p: Parcel) {
  return form({
    title: `Rename ${p.number}`,
    submitTitle: "Rename",
    fields: [field.text("label", "Label", { value: p.label, required: true })],
    async submit(values) {
      await rename(p.number, String(values.label ?? "").trim());
      return refresh();
    },
  });
}

function carrierName(p: Parcel): string {
  return p.tracking?.carrier || carrier(p.carrier).name;
}

function timelineView(p: Parcel, actions: Action[]) {
  const t = p.tracking;
  const look = statusLook(statusOf(p));
  return detail({
    title: p.label,
    markdown: [
      `# ${p.label}`,
      `**${look.text}**${t?.detail && t.detail !== look.text ? ` · ${t.detail}` : ""}`,
      p.error ? `> ${p.error}` : "",
      t ? timeline(t) : "_Not checked yet._",
    ].filter(Boolean).join("\n\n"),
    metadata: metadata(p),
    actions,
  });
}

function metadata(p: Parcel) {
  const t = p.tracking;
  const look = statusLook(statusOf(p));
  const eta = etaText(t?.eta);
  return [
    meta.tags("Status", [{ text: look.text, color: look.color }]),
    meta.text("Number", p.number, { icon: Icons.hash }),
    meta.text("Carrier", carrierName(p), { icon: Icons.package }),
    ...(t?.product && t.product !== carrierName(p) ? [meta.text("Service", t.product)] : []),
    ...(eta ? [meta.text("Expected", eta, { icon: Icons.calendar, color: "yellow" })] : []),
    ...(t?.origin || t?.destination
      ? [meta.text("Route", [t.origin ?? "?", t.destination ?? "?"].join(" → "), { icon: Icons.globe })]
      : []),
    meta.separator(),
    meta.text("Added", ago(p.added)),
    ...(p.checked ? [meta.text("Checked", ago(p.checked), { icon: Icons.refresh })] : []),
    meta.link("Carrier page", carrierName(p), t?.url ?? trackingUrl(p.carrier, p.number)),
  ];
}

function parcelItem(p: Parcel, ctx: Context): Item {
  const t = p.tracking;
  const status = statusOf(p);
  const look = statusLook(status);
  const last = t?.events[0];
  const eta = etaText(t?.eta);
  const transit = t ? daysInTransit(t) : undefined;
  const url = t?.url ?? trackingUrl(p.carrier, p.number);
  const actions: Action[] = [
    open(url, `Open on ${carrierName(p)}`, { icon: Icons.external, shortcut: "<Ctrl>o" }),
    copy(p.number, "Copy Tracking Number", { shortcut: "<Ctrl><Shift>c", section: "Parcel" }),
    action("Rename…", () => renameForm(p), { icon: Icons.text, shortcut: "<Ctrl>e", section: "Parcel" }),
    action("Refresh", async () => {
      const [c] = await check([p], keys(ctx.preferences), ctx.signal);
      if (c) await merge([c.parcel]);
      return refresh();
    }, { icon: Icons.refresh, shortcut: "<Ctrl><Shift>r", section: "Parcel" }),
    ...(t?.events.length
      ? [copy(`${p.label}: ${look.text} — ${last!.description}`, "Copy Latest Status", { section: "Parcel" })]
      : []),
    open(`https://t.17track.net/en#nums=${encodeURIComponent(p.number)}`, "Open on 17TRACK", {
      icon: Icons.globe,
      section: "Parcel",
    }),
    action("Remove Parcel", async () => {
      await remove(p, keys(ctx.preferences));
      await toast(`${p.label} removed`, { style: "success" });
      return refresh();
    }, {
      icon: Icons.trash,
      destructive: true,
      confirm: `Stop tracking ${p.label}?`,
      shortcut: "<Ctrl>x",
      section: "Parcel",
    }),
    addAction,
    refreshAll,
    action("Remove Delivered Parcels", async () => {
      const n = await removeDelivered(keys(ctx.preferences));
      await toast(n ? `${n} delivered parcel${n === 1 ? "" : "s"} removed` : "No delivered parcel");
      return refresh();
    }, { icon: Icons.archive, destructive: true, confirm: "Remove every delivered parcel?", section: "Parcels" }),
  ];
  return {
    id: p.number,
    title: p.label,
    subtitle: last?.description ?? (p.error || look.text),
    icon: { source: p.error && !t ? Icons.alert : look.icon, tint: p.error && !t ? "orange" : look.color },
    section: isFinal(status) ? "Delivered" : status === "out" || status === "pickup" ? "Arriving" : "On the Way",
    keywords: [p.number, carrierName(p), look.text, ...(last?.location ? [last.location] : [])],
    accessories: [
      ...(eta && !isFinal(status) ? [{ text: eta, icon: Icons.calendar, tooltip: "Expected delivery" }] : []),
      { tag: carrierName(p), color: "gray" as const },
      { tag: look.text, color: look.color, tooltip: t?.detail },
      ...(last ? [{ text: ago(last.time), tooltip: when(last.time) }] : []),
    ],
    detail: {
      stats: [
        { label: "Status", value: look.text, color: look.color },
        ...(transit !== undefined ? [{ label: isFinal(status) ? "Took" : "In transit", value: `${transit} d` }] : []),
        { label: "Events", value: t?.events.length ?? 0 },
      ],
      markdown: [
        p.error ? `> ${p.error}` : "",
        t ? timeline({ ...t, events: t.events.slice(0, 8) }) : "_Not checked yet._",
        t && t.events.length > 8 ? `_…and ${t.events.length - 8} older events (Enter shows them all)._` : "",
      ].filter(Boolean).join("\n\n"),
      metadata: metadata(p),
    },
    actions: [action("Show Timeline", () => timelineView(p, actions.slice(0, 6)), { icon: Icons.history }), ...actions],
  };
}

const rank = (p: Parcel) => {
  const s = statusOf(p);
  return s === "out" || s === "pickup" ? 0 : isFinal(s) ? 2 : 1;
};
const latest = (p: Parcel) => Date.parse(p.tracking?.events[0]?.time ?? "") || p.added;

/** Out for delivery and to pick up first, then on the way, then delivered; the latest news first. */
const sorted = (parcels: Parcel[]) => [...parcels].sort((a, b) => rank(a) - rank(b) || latest(b) - latest(a));

export default (ctx: Context) =>
  list({
    placeholder: "Filter parcels by label, number, carrier, status…",
    empty: {
      title: "No parcel tracked",
      description: "Ctrl+N tracks a Colissimo, Chronopost, UPS, DHL, FedEx, Amazon… number",
      icon: Icons.package,
    },
    actions: [addAction, refreshAll],
    status: (items) =>
      items[0]?.id === "setup"
        ? "Not connected"
        : `${items.filter((i) => i.section !== "Delivered").length} on the way · ${items.length} tracked`,
    async *items({ preferences, signal }) {
      const k = keys(preferences);
      const parcels = await saved();
      if (!k.laposte && !k.track17) {
        yield [setupItem(new SetupError("Add a La Poste or 17TRACK API key to track parcels"))];
        return;
      }
      // A tracking number in the search bar, or copied: offer to track it.
      const typed = ctx.query.trim();
      const suggestion: Item[] = typed && validNumber(typed) && !parcels.some((p) => p.number === typed.toUpperCase())
        ? [{
          id: "add-typed",
          title: `Track ${typed.toUpperCase()}`,
          subtitle: detectCarrier(typed).name,
          icon: { source: Icons.plus, tint: "blue" },
          actions: [action("Track This Number…", () => addForm(typed), { icon: Icons.plus })],
        }]
        : [];
      const show = (all: Parcel[]) => [...suggestion, ...sorted(all).map((p) => parcelItem(p, ctx))];
      yield show(parcels);
      const stale = parcels.filter((p) =>
        force || !p.checked || (Date.now() - p.checked > FRESH && !(p.tracking && isFinal(p.tracking.status)))
      );
      force = false;
      if (!stale.length) return;
      try {
        const checked = await check(stale, k, signal);
        const all = await merge(checked.map((c) => c.parcel));
        updateCommandMetadata({ subtitle: summary(all) }).catch(() => {});
        yield show(all);
      } catch (e) {
        if (e instanceof SetupError) yield [setupItem(e), ...show(parcels)];
        else throw e;
      }
    },
  });
