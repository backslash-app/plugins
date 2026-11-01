// List items for each kind of query.

import { copy, Icons, type Item, meta } from "@backslash/api";
import { type Ingredient, INGREDIENTS, OVEN, type Substitution, SUBSTITUTIONS } from "./data.ts";
import {
  amountText,
  type Conversion,
  convert,
  CUP_TITLE,
  type CupSystem,
  decimal,
  EXAMPLES,
  grams,
  inUnit,
  measureWith,
  niceNumber,
  type Oven,
  type Query,
  type ScaledLine,
  type Unit,
  unitById,
} from "./lib.ts";

const SYNTAX = [
  "## What you can type",
  "",
  "| Type | To get |",
  "|---|---|",
  "| `1 cup flour`, `3 c. à s. de miel` | the weight of a volume of an ingredient |",
  "| `200 g sugar in cups`, `100 g butter in tbsp` | the volume of a weight |",
  "| `2 sticks butter` | US butter sticks in grams |",
  "| `flour`, `farine` | what a cup, a spoon and 100 g weigh |",
  "| `350 F`, `180 C fan`, `gas 6`, `th 7` | oven temperatures |",
  "| `scale 4 to 6: 200 g flour, 3 eggs` | quantities for more or fewer servings |",
  "| `x1.5 2 tsp baking powder, 1 egg` | quantities multiplied |",
  "| `sub buttermilk`, `sans œufs` | what to use instead |",
].join("\n");

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

function weightTable(i: Ingredient): string {
  const cup = i.gramsPerCup;
  return [
    "| Amount | Weight |",
    "|---|---|",
    `| 1 cup (US) | ${grams(cup)} |`,
    `| ½ cup | ${grams(cup / 2)} |`,
    `| ¼ cup | ${grams(cup / 4)} |`,
    `| 1 tbsp | ${grams(cup / 16)} |`,
    `| 1 tsp | ${grams(cup / 48)} |`,
    `| 1 metric cup (250 ml) | ${grams(cup * 250 / 236.588)} |`,
  ].join("\n");
}

function ingredientMarkdown(i: Ingredient): string {
  return [
    `## ${i.name}`,
    "",
    `*${i.fr}* · ${i.group}`,
    "",
    weightTable(i),
    "",
    `100 g is ${niceNumber(100 / i.gramsPerCup)} cups, or ${measureWith(100 / i.gramsPerCup * 236.588)}.`,
    ...(i.note ? ["", `> ${i.note}.`] : []),
  ].join("\n");
}

export function ingredientItem(i: Ingredient, section = "Ingredient"): Item {
  return {
    id: `ingredient:${i.id}`,
    title: i.name,
    subtitle: `1 cup = ${grams(i.gramsPerCup)} · 1 tbsp = ${grams(i.gramsPerCup / 16)}`,
    icon: { source: Icons.coffee, tint: "orange" },
    section,
    keywords: [i.fr, ...i.aliases],
    accessories: [{ text: i.fr }],
    detail: { markdown: ingredientMarkdown(i) },
    actions: [
      copy(`1 cup ${i.name.toLowerCase()} = ${grams(i.gramsPerCup)}`, "Copy Cup Weight"),
      copy(String(Math.round(i.gramsPerCup)), "Copy Grams per Cup", { icon: Icons.hash }),
    ],
  };
}

export function conversionItems(c: Conversion, cups: CupSystem): Item[] {
  const name = c.ingredient.name.toLowerCase();
  const source = `${amountText(c.amount, c.unit)} ${name}`;
  const markdown = [
    `## ${source}`,
    "",
    `**${grams(c.grams)}** · ${decimal(c.ml)} ml · measure with ${measureWith(c.ml)}`,
    "",
    ingredientMarkdown(c.ingredient).replace(/^## .*\n\n/, ""),
    "",
    `> Cups are ${
      CUP_TITLE[cups]
    } unless you type "metric cup" or "UK cup" (Settings → Extensions → Kitchen Converter).`,
  ].join("\n");
  const detail = {
    markdown,
    metadata: [
      meta.text("Ingredient", c.ingredient.name),
      meta.text("Grams per US cup", String(c.ingredient.gramsPerCup)),
      meta.text("Group", c.ingredient.group),
    ],
  };
  const row = (unit: Unit, section: string, subtitle?: string): Item => {
    const text = amountText(inUnit(c, unit, cups), unit);
    return {
      id: `to:${unit.id}`,
      title: text,
      subtitle: subtitle ?? `${source}`,
      icon: { source: unit.kind === "volume" ? Icons.droplet : Icons.box, tint: unit === c.target ? "green" : "blue" },
      section,
      detail,
      actions: [copy(text, "Copy Amount"), copy(`${source} = ${text}`, "Copy Conversion", { icon: Icons.text })],
    };
  };
  const units = c.unit.kind === "volume"
    ? ["g", "oz", "cup", "tbsp", "tsp", "ml"]
    : c.unit.kind === "stick"
    ? ["g", "oz", "cup", "tbsp"]
    : ["cup", "tbsp", "tsp", "ml", c.unit.id === "g" ? "oz" : "g"];
  const ordered = units.map(unitById).filter((u) => u.id !== c.unit.id);
  const target = c.target ? [c.target, ...ordered.filter((u) => u.id !== c.target!.id)] : ordered;
  const items = target.map((u, i) => row(u, i === 0 ? "Result" : "Also", i === 0 ? `${source}` : undefined));
  items.splice(1, 0, {
    id: "measure",
    title: measureWith(c.ml),
    subtitle: "With US measuring cups and spoons",
    icon: { source: Icons.coffee, tint: "teal" },
    section: "Result",
    detail,
    actions: [copy(measureWith(c.ml), "Copy")],
  });
  return items;
}

export function ovenItems(o: Oven): Item[] {
  const markdown = [
    `## ${o.celsius} °C · ${o.fahrenheit} °F`,
    "",
    o.fromFan ? `${o.source} is ${o.celsius} °C in a conventional oven.` : "",
    "",
    "| Gas mark | °C | °F | Fan °C | Thermostat | |",
    "|---|---|---|---|---|---|",
    ...OVEN.map((r) =>
      `| ${r.gas === o.gas?.gas ? `**${r.gas}**` : r.gas} | ${r.celsius} | ${r.fahrenheit} | ${r.celsius - 20} | ${
        decimal(r.celsius / 30)
      } | ${r.words} |`
    ),
    "",
    "> Fan (convection) ovens: about 20 °C lower. French thermostats: °C ÷ 30.",
  ].filter((l, i) => l || i !== 2).join("\n");
  const detail = { markdown };
  const item = (id: string, title: string, subtitle: string, tint: "red" | "orange" | "blue" | "purple" | "teal") => ({
    id,
    title,
    subtitle,
    icon: { source: Icons.thermometer, tint },
    section: o.source,
    detail,
    actions: [copy(title, "Copy")],
  });
  return [
    item("c", `${o.celsius} °C`, o.fromFan ? "Conventional oven" : "Celsius", "red"),
    item("f", `${o.fahrenheit} °F`, "Fahrenheit, rounded to 5", "orange"),
    item("fan", `${o.fanCelsius} °C fan`, "Fan or convection oven", "teal"),
    ...(o.gas ? [item("gas", `Gas mark ${o.gas.gas}`, o.gas.words, "blue")] : []),
    item("th", `Thermostat ${decimal(o.thermostat)}`, "French oven dial", "purple"),
  ];
}

export function scaleItems(q: Extract<Query, { kind: "scale" }>): Item[] {
  const what = q.from ? `${q.from} → ${q.to} servings` : `× ${decimal(q.factor)}`;
  const all = q.lines.map((l) => l.text).join("\n");
  const head: Item = {
    id: "factor",
    title: `× ${niceNumber(q.factor, 0.005)}`,
    subtitle: q.lines.length ? `${what} · ${plural(q.lines.length, "line")}` : `${what}: add the ingredients after it`,
    icon: { source: Icons.calculator, tint: "blue" },
    section: "Scale",
    detail: {
      markdown: [
        `## ${what}`,
        "",
        q.lines.length
          ? ["| Before | After |", "|---|---|", ...q.lines.map((l) => `| ${l.source} | ${l.text} |`)].join("\n")
          : "Type the quantities after the factor, separated by commas: `scale 4 to 6: 200 g flour, 3 eggs`.",
      ].join("\n"),
    },
    actions: q.lines.length
      ? [copy(all, "Copy Scaled Recipe"), copy(decimal(q.factor), "Copy Factor")]
      : [copy(decimal(q.factor), "Copy Factor")],
  };
  return [
    head,
    ...q.lines.map((l: ScaledLine, i): Item => ({
      id: `line:${i}`,
      title: l.text,
      subtitle: l.hint ?? (l.scaled ? `was ${l.source}` : "No amount: unchanged"),
      icon: { source: l.scaled ? Icons.check : Icons.minus, tint: l.scaled ? "green" : "gray" },
      section: "Scaled",
      detail: head.detail,
      actions: [copy(l.text, "Copy Line"), copy(all, "Copy Scaled Recipe", { icon: Icons.text })],
    })),
  ];
}

export function substitutionItem(s: Substitution, section = "Substitutions"): Item {
  const markdown = [
    `## ${s.name}`,
    "",
    `*${s.fr}* · for ${s.amount}`,
    "",
    ...s.with.map((w) => `- ${w}`),
    ...(s.note ? ["", `> ${s.note}.`] : []),
  ].join("\n");
  return {
    id: `sub:${s.id}`,
    title: `${s.name}: ${s.with[0]}`,
    subtitle: `For ${s.amount}`,
    icon: { source: Icons.shuffle, tint: "purple" },
    section,
    keywords: [s.fr, ...s.keywords],
    accessories: s.with.length > 1 ? [{ text: `+${s.with.length - 1} more` }] : [],
    detail: { markdown },
    actions: [copy(`${s.amount} ${s.name.toLowerCase()} = ${s.with[0]}`, "Copy Substitution")],
  };
}

function exampleItems(): Item[] {
  return EXAMPLES.map((e) => ({
    id: `example:${e.query}`,
    title: e.query,
    subtitle: e.title,
    icon: { source: Icons.lightbulb, tint: "yellow" },
    section: "Examples: type one",
    detail: { markdown: SYNTAX },
    actions: [copy(e.query, "Copy Example")],
  }));
}

export function itemsFor(q: Query, cups: CupSystem): Item[] {
  switch (q.kind) {
    case "empty":
      return [
        ...exampleItems(),
        ...ovenItems({
          celsius: 180,
          fahrenheit: 350,
          gas: OVEN[5],
          thermostat: 6,
          fanCelsius: 160,
          fromFan: false,
          source: "Oven: 180 °C",
        }),
        ...SUBSTITUTIONS.map((s) => substitutionItem(s)),
        ...INGREDIENTS.map((i) => ingredientItem(i, `Weights: ${i.group}`)),
      ];
    case "convert":
      return conversionItems(q.conversion, cups);
    case "volume": {
      const ml = q.amount * q.unit.size(cups);
      const water = convert(q.amount, q.unit, INGREDIENTS.find((i) => i.id === "water")!, cups, q.target);
      return [
        {
          id: "volume",
          title: `${decimal(ml)} ml`,
          subtitle: q.note,
          icon: { source: Icons.droplet, tint: "blue" },
          section: amountText(q.amount, q.unit),
          detail: { markdown: SYNTAX },
          actions: [copy(`${decimal(ml)} ml`, "Copy")],
        },
        ...conversionItems(water, cups).slice(1, 4).map((i) => ({ ...i, section: "Of water" })),
      ];
    }
    case "ingredient":
      return [
        ingredientItem(q.ingredient),
        ...SUBSTITUTIONS.filter((s) =>
          s.keywords.some((k) => q.ingredient.aliases.includes(k) || k === q.ingredient.id)
        )
          .map((s) => substitutionItem(s)),
      ];
    case "oven":
      return ovenItems(q.oven);
    case "scale":
      return scaleItems(q);
    case "substitute":
      return q.matches.length ? q.matches.map((s) => substitutionItem(s)) : [{
        id: "error",
        title: `No substitution for "${q.text}"`,
        subtitle: "Try buttermilk, egg, baking powder, brown sugar, cream…",
        icon: { source: Icons.question, tint: "orange" },
        detail: { markdown: SYNTAX },
        actions: [],
      }, ...SUBSTITUTIONS.map((s) => substitutionItem(s, "All Substitutions"))];
    case "search":
      return [
        ...q.ingredients.map((i) => ingredientItem(i, "Ingredients")),
        ...q.substitutions.map((s) => substitutionItem(s)),
      ];
    case "error":
      return [{
        id: "error",
        title: q.message,
        subtitle: "Try 1 cup flour, 350 F or sub buttermilk",
        icon: { source: Icons.alert, tint: "red" },
        detail: { markdown: SYNTAX },
        actions: [],
      }, ...exampleItems()];
  }
}
