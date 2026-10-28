import { clipboard, type Context, Icons, list } from "@backslash/api";
import { eccOf, qrItem } from "../ui.ts";

// The clipboard's text as a QR code, e.g. to send a link to a phone.
export default (ctx: Context) =>
  list({
    placeholder: "Filter…",
    empty: { title: "The clipboard has no text", description: "Copy a link or a text first", icon: Icons.qr },
    status: `Level ${eccOf(ctx)} · scan it with your phone`,
    async items() {
      const text = await clipboard.read();
      return text.trim() ? [await qrItem(text, eccOf(ctx), { id: "clipboard", subtitle: "From the clipboard" })] : [];
    },
  });
