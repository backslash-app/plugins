import { action, Icons, type Item, list, refresh } from "@backslash/api";
import { clearRecent, product, recent, remember, search } from "../api.ts";
import { findBarcode, langOf } from "../lib.ts";
import { errorItem, notFoundItem, productItem } from "../views.ts";

let status = "";

const clear = action("Clear Recent Products", async () => {
  await clearRecent();
  return refresh();
}, { icon: Icons.trash, destructive: true, confirm: "Forget the recently viewed products?", section: "Recent" });

export default list({
  placeholder: "Search products by name, brand or barcode…",
  status: () => status,
  empty: { title: "No product found", description: "Try fewer words, the brand, or the barcode", icon: Icons.search },
  async search(query, { preferences, signal }): Promise<Item[]> {
    const lang = langOf(preferences.language);
    const q = query.trim();
    if (!q) {
      const seen = await recent();
      status = seen.length ? `${seen.length} recently viewed` : "";
      if (!seen.length) {
        return [{
          id: "hint",
          title: "Type a product name or a barcode",
          subtitle: "Nutri-Score, NOVA, Eco-Score, allergens, additives and nutrition facts from Open Food Facts",
          icon: { source: Icons.search, tint: "gray" },
        }];
      }
      return seen.map((p) => productItem(p, { section: "Recently viewed", recent: true, extra: [clear] }));
    }
    try {
      const code = findBarcode(q);
      if (code && /^\d[\d\s-]*$/.test(q)) {
        const p = await product(code, lang, signal);
        status = "";
        if (!p) return [notFoundItem(code)];
        await remember(p);
        return [productItem(p)];
      }
      if (q.length < 2) return [];
      const { products, count } = await search(q, lang, signal);
      status = count > products.length
        ? `${products.length} of ${count.toLocaleString("en")} products`
        : `${products.length} products`;
      return products.map((p) => productItem(p));
    } catch (e) {
      if (signal.aborted) throw e;
      status = "";
      return [errorItem(e)];
    }
  },
});
