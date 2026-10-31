import { clipboard, Icons, type Item, list } from "@backslash/api";
import { product, remember } from "../api.ts";
import { findBarcode, langOf, validBarcode } from "../lib.ts";
import { errorItem, notFoundItem, productItem } from "../views.ts";

let status = "";

/** The barcode given as argument, else the one in the clipboard. */
export default list({
  placeholder: "Filter…",
  status: () => status,
  empty: { title: "No barcode", description: "Give one, or copy it first", icon: Icons.scan },
  async items({ args, preferences, signal }): Promise<Item[]> {
    const lang = langOf(preferences.language);
    const given = String(args.barcode ?? "").trim();
    const source = given || (await clipboard.read().catch(() => "")).trim();
    const code = findBarcode(source);
    if (!code) {
      status = "";
      return [{
        id: "none",
        title: given ? `“${given}” isn't a barcode` : "No barcode in the clipboard",
        subtitle: "8, 12, 13 or 14 digits, like 3017624010701",
        icon: { source: Icons.scan, tint: "gray" },
      }];
    }
    status = `${code}${given ? "" : " (from the clipboard)"}${
      validBarcode(code) ? "" : " · check digit doesn't match"
    }`;
    try {
      const p = await product(code, lang, signal);
      if (!p) return [notFoundItem(code)];
      await remember(p);
      return [productItem(p)];
    } catch (e) {
      if (signal.aborted) throw e;
      return [errorItem(e)];
    }
  },
});
