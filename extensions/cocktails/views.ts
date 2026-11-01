// Drinks as launcher items.

import {
  type Accessory,
  type Action,
  action,
  copy,
  Icons,
  type Item,
  meta,
  type Metadata,
  open,
  refresh,
  toast,
} from "@backslash/api";
import { toggle } from "./api.ts";
import {
  ALCOHOL_TITLE,
  type Drink,
  drinkUrl,
  type Language,
  languageOf,
  type Match,
  recipeMarkdown,
  recipeText,
  thumb,
  type Units,
  unitsOf,
} from "./lib.ts";

export interface Prefs {
  units?: string;
  language?: string;
  bar?: string;
  apiKey?: string;
}

export interface Settings {
  units: Units;
  lang: Language;
  apiKey?: string;
}

export function settings(p: Prefs): Settings {
  return { units: unitsOf(p.units), lang: languageOf(p.language), apiKey: p.apiKey?.trim() || undefined };
}

export function drinkItem(
  d: Drink,
  s: Settings,
  o: { favorite?: boolean; section?: string; match?: Match; extra?: Action[] } = {},
): Item {
  const accessories: Accessory[] = [];
  if (o.match?.missing.length) {
    accessories.push({
      tag: `Missing ${o.match.missing.join(", ")}`,
      color: o.match.missing.length === 1 ? "orange" : "red",
      tooltip: "Not in your bar",
    });
  } else if (o.match) accessories.push({ tag: "You can make it", color: "green" });
  if (o.favorite) accessories.push({ icon: { source: Icons.heartFilled, tint: "pink" }, tooltip: "Favorite" });
  if (d.alcohol !== "alcoholic") {
    accessories.push({ tag: d.alcohol === "optional" ? "Alcohol optional" : "No alcohol", color: "teal" });
  }
  const metadata: Metadata[] = [
    meta.tags("Type", [
      { text: ALCOHOL_TITLE[d.alcohol], color: d.alcohol === "alcoholic" ? "purple" : "teal" },
      ...(d.iba ? [{ text: `IBA · ${d.iba}`, color: "yellow" as const }] : []),
    ]),
  ];
  if (d.category) metadata.push(meta.text("Category", d.category));
  if (d.glass) metadata.push(meta.text("Glass", d.glass));
  if (o.match?.missing.length) {
    metadata.push(meta.tags("Missing", o.match.missing.map((text) => ({ text, color: "orange" as const }))));
  }
  if (d.tags.length) metadata.push(meta.tags("Tags", d.tags.slice(0, 6)));
  metadata.push(meta.separator(), meta.link("TheCocktailDB", "thecocktaildb.com", drinkUrl(d)));
  if (d.attribution) metadata.push(meta.text("Photo", d.attribution));

  const actions: Action[] = [
    copy(recipeText(d, s.units, s.lang), "Copy Recipe"),
    action(o.favorite ? "Remove from Favorites" : "Add to Favorites", async () => {
      const now = await toggle(d);
      await toast(now ? `${d.name} added to favorites` : `${d.name} removed from favorites`, { style: "success" });
      return refresh();
    }, { icon: o.favorite ? Icons.heart : Icons.heartFilled, shortcut: "<Ctrl>s" }),
    ...(o.extra ?? []),
    open(drinkUrl(d), "Open on TheCocktailDB", { section: "Open" }),
    copy(d.ingredients.map((i) => `- ${i.name}`).join("\n"), "Copy Ingredients", {
      section: "Copy",
      shortcut: "<Ctrl><Shift>i",
    }),
    ...(o.match?.missing.length
      ? [copy(o.match.missing.map((m) => `- ${m}`).join("\n"), "Copy What's Missing", { section: "Copy" })]
      : []),
    copy(d.name, "Copy Name", { section: "Copy" }),
  ];

  return {
    id: `${o.section ?? ""}:${d.id}`,
    title: d.name,
    subtitle: d.ingredients.slice(0, 4).map((i) => i.name).join(", ") + (d.ingredients.length > 4 ? "…" : ""),
    icon: thumb(d, "small") ?? "🍸",
    section: o.section,
    keywords: [...d.ingredients.map((i) => i.name), ...(d.category ? [d.category] : []), ...(d.glass ? [d.glass] : [])],
    accessories,
    detail: {
      image: thumb(d, "medium"),
      markdown: recipeMarkdown(d, s.units, s.lang),
      metadata,
    },
    actions,
  };
}
