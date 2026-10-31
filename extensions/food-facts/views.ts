// Product rows, their preview panel and actions.

import { type Action, action, close, copy, Icons, type Item, meta, open, openExternal, refresh } from "@backslash/api";
import { forget, remember } from "./api.ts";
import { editUrl, GRADE_TINT, NOVA, pageUrl, type Product, productMarkdown, shareLine, subtitle } from "./lib.ts";

function scoreAccessories(p: Product) {
  return [
    ...(p.nutriscore
      ? [{ tag: `Nutri ${p.nutriscore.toUpperCase()}`, color: GRADE_TINT[p.nutriscore], tooltip: "Nutri-Score" }]
      : []),
    ...(p.nova ? [{ tag: `NOVA ${p.nova}`, color: NOVA[p.nova].tint, tooltip: NOVA[p.nova].title }] : []),
    ...(p.ecoscore
      ? [{
        tag: `Eco ${p.ecoscore.toUpperCase()}`,
        color: GRADE_TINT[p.ecoscore],
        tooltip: "Eco-Score (Green-Score)",
      }]
      : []),
  ];
}

export function productItem(p: Product, o: { section?: string; recent?: boolean; extra?: Action[] } = {}): Item {
  return {
    id: `${o.section ?? ""}:${p.code}`,
    title: p.name,
    subtitle: subtitle(p),
    icon: p.thumbnail ?? { source: Icons.package, tint: "gray" },
    section: o.section,
    keywords: [p.code, ...p.brands, ...p.categories.slice(0, 5)],
    accessories: scoreAccessories(p),
    detail: {
      image: p.image ?? p.thumbnail,
      stats: [
        {
          label: "Nutri-Score",
          value: p.nutriscore ? p.nutriscore.toUpperCase() : "?",
          color: p.nutriscore ? GRADE_TINT[p.nutriscore] : "gray",
        },
        { label: "NOVA", value: p.nova ?? "?", color: p.nova ? NOVA[p.nova].tint : "gray" },
        {
          label: "Eco-Score",
          value: p.ecoscore ? p.ecoscore.toUpperCase() : "?",
          color: p.ecoscore ? GRADE_TINT[p.ecoscore] : "gray",
        },
      ],
      markdown: productMarkdown(p),
      metadata: [
        meta.text("Barcode", p.code, { icon: Icons.scan }),
        ...(p.brands.length ? [meta.text("Brand", p.brands.join(", "))] : []),
        ...(p.quantity ? [meta.text("Quantity", p.quantity)] : []),
        ...(p.serving ? [meta.text("Serving", p.serving)] : []),
        ...(p.nova ? [meta.text("Processing", NOVA[p.nova].title, { color: NOVA[p.nova].tint })] : []),
        ...(p.allergens.length
          ? [meta.tags("Allergens", p.allergens.map((a) => ({ text: a, color: "orange" as const })))]
          : [meta.text("Allergens", "None declared")]),
        ...(p.labels.length ? [meta.tags("Labels", p.labels.slice(0, 6))] : []),
        meta.separator(),
        meta.link("Open Food Facts", `world.openfoodfacts.org/product/${p.code}`, pageUrl(p.code)),
      ],
    },
    actions: [
      action("Open on Open Food Facts", async () => {
        await remember(p);
        await openExternal(pageUrl(p.code));
        return close();
      }, { icon: Icons.globe }),
      copy(p.code, "Copy Barcode", { shortcut: "<Ctrl><Shift>c" }),
      copy(shareLine(p), "Copy Summary", { section: "Copy" }),
      ...(p.ingredients ? [copy(p.ingredients, "Copy Ingredients", { section: "Copy" })] : []),
      open(editUrl(p.code), "Edit or Complete on Open Food Facts", {
        icon: Icons.external,
        section: "Open Food Facts",
      }),
      ...(o.recent
        ? [action("Remove from Recent", async () => {
          await forget(p.code);
          return refresh();
        }, { icon: Icons.trash, section: "Recent" })]
        : []),
      ...(o.extra ?? []),
    ],
  };
}

export function notFoundItem(code: string): Item {
  return {
    id: `missing:${code}`,
    title: `No product with barcode ${code}`,
    subtitle: "Open Food Facts doesn't know it yet: you can add it",
    icon: { source: Icons.scan, tint: "gray" },
    detail: {
      markdown: [
        `## ${code} isn't in Open Food Facts`,
        "",
        "Open Food Facts is filled in by its users. Add the product with a few photos (front, ingredients,",
        "nutrition facts) from the website or the mobile app, and the scores are computed for everyone.",
      ].join("\n"),
    },
    actions: [
      open(editUrl(code), "Add It on Open Food Facts", { icon: Icons.plus }),
      copy(code, "Copy Barcode"),
    ],
  };
}

export function errorItem(e: unknown): Item {
  return {
    id: "error",
    title: "Open Food Facts didn't answer",
    subtitle: (e as Error).message,
    icon: { source: Icons.alert, tint: "orange" },
    actions: [open("https://status.openfoodfacts.org/", "Open the Status Page")],
  };
}
