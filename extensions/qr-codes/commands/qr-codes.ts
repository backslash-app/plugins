import { action, clipboard, type Context, Icons, type Item, list, refresh } from "@backslash/api";
import { history, importScans } from "../system.ts";
import { eccOf, entryItem, qrItem, scanItem, wifiForm } from "../ui.ts";
import { scanClipboardImage } from "./scan-clipboard.ts";

export default (ctx: Context) => {
  const ecc = eccOf(ctx);
  let count = 0;
  return list({
    placeholder: "Text or link to turn into a QR code…",
    status: (items) =>
      items.some((i) => i.id?.startsWith("qr:"))
        ? `Level ${ecc} · Ctrl+Shift+C copies the picture`
        : `${count} in history`,
    async search(query) {
      const text = query.trim();
      if (text) return [await qrItem(query, ecc, { section: "QR Code" })];
      await importScans();
      const past = await history();
      count = past.length;
      const clip = await clipboard.read().catch(() => "");
      const items: Item[] = [];
      if (clip.trim()) {
        items.push(await qrItem(clip, ecc, { id: "clipboard", section: "From the Clipboard", subtitle: "Clipboard" }));
      }
      items.push(
        scanItem(ctx),
        {
          id: "scan-clipboard",
          title: "Scan Image in Clipboard",
          subtitle: "A copied screenshot or picture with a QR code",
          icon: { source: Icons.image, tint: "blue" },
          section: "Scan",
          actions: [action("Scan Image in Clipboard", () => scanClipboardImage(ecc), { icon: Icons.image })],
        },
        {
          id: "wifi",
          title: "Wi-Fi QR Code…",
          subtitle: "Guests scan it to join your network",
          icon: { source: Icons.wifi, tint: "teal" },
          section: "Create",
          actions: [action("Create Wi-Fi QR Code", () => wifiForm(ecc), { icon: Icons.wifi })],
        },
        ...(await Promise.all(past.map((e) => entryItem(e, ecc)))),
      );
      if (!past.length) {
        items.push({
          id: "tip",
          title: "Type a text or paste a link",
          subtitle: "Its QR code appears here",
          icon: { source: Icons.info, tint: "gray" },
          section: "Create",
          actions: [action("Refresh", () => refresh(), { icon: Icons.refresh })],
        });
      }
      return items;
    },
  });
};
