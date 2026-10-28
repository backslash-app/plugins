import {
  type Action,
  action,
  type Color,
  type Context,
  copy,
  Icons,
  type Item,
  list,
  meta,
  paste,
  refresh,
} from "@backslash/api";
import {
  COIN,
  diceNotation,
  drawInRange,
  EIGHT_BALL,
  formatNumber,
  hex,
  hsl,
  type Intent,
  type Lang,
  language,
  looksFrench,
  luminance,
  type Mood,
  parseIntent,
  pick,
  randomColor,
  randomInt,
  roll,
  rollBreakdown,
  shuffle,
  YES_NO,
} from "../lib.ts";

const env = (k: string) => {
  try {
    return Deno.env.get(k);
  } catch {
    return undefined;
  }
};
const locale = () => env("LC_ALL") || env("LC_MESSAGES") || env("LANG");

const again = (title = "Again") => action(title, () => refresh(), { icon: Icons.refresh, shortcut: "<Ctrl>r" });

/** Enter draws again, then copy and paste the result. */
const resultActions = (value: string, more: Action[] = []): Action[] => [
  again(),
  copy(value, "Copy Result", { section: "Copy" }),
  paste(value, "Paste Result", { section: "Copy" }),
  ...more,
];

const T = {
  en: {
    coin: "Coin Flip",
    dice: "Dice",
    number: "Random Number",
    pick: "Pick",
    shuffle: "Shuffle",
    color: "Random Color",
    yesno: "Yes or No",
    ball: "Magic 8-Ball",
    result: "Result",
  },
  fr: {
    coin: "Pile ou face",
    dice: "Dés",
    number: "Nombre aléatoire",
    pick: "Tirage",
    shuffle: "Mélange",
    color: "Couleur aléatoire",
    yesno: "Oui ou non",
    ball: "Boule magique",
    result: "Résultat",
  },
};

function coinItems(count: number, lang: Lang): Item[] {
  const faces = Array.from({ length: count }, () => randomInt(0, 1));
  const names = COIN[lang];
  if (count === 1) {
    const face = names[faces[0]];
    return [{
      id: "coin",
      title: face,
      subtitle: T[lang].coin,
      icon: { source: Icons.coin, tint: faces[0] === 0 ? "yellow" : "orange" },
      section: T[lang].result,
      detail: {
        stats: [{ label: T[lang].coin, value: face, color: faces[0] === 0 ? "yellow" : "orange" }],
        metadata: [meta.text("Odds", "1 in 2", { icon: Icons.coin })],
      },
      actions: resultActions(face),
    }];
  }
  const heads = faces.filter((f) => f === 0).length;
  const seq = faces.map((f) => names[f][0]).join(" ");
  return [{
    id: "coins",
    title: `${heads} ${names[0]} · ${count - heads} ${names[1]}`,
    subtitle: `${count} × ${T[lang].coin}`,
    icon: { source: Icons.coin, tint: "yellow" },
    section: T[lang].result,
    detail: {
      stats: [
        { label: names[0], value: heads, color: "yellow" },
        { label: names[1], value: count - heads, color: "orange" },
      ],
      markdown: `\`${seq}\``,
      metadata: [meta.progress(names[0], heads / count)],
    },
    actions: resultActions(faces.map((f) => names[f]).join(", ")),
  }];
}

function diceItems(intent: Extract<Intent, { kind: "dice" }>, lang: Lang): Item[] {
  const r = roll(intent.dice);
  const notation = diceNotation(intent.dice);
  const breakdown = rollBreakdown(r);
  const span = r.max - r.min;
  const ratio = span ? (r.total - r.min) / span : 1;
  const color: Color = ratio >= 0.8 ? "green" : ratio <= 0.2 ? "red" : "blue";
  return [{
    id: "dice",
    title: String(r.total),
    subtitle: intent.dice.count === 1 && !intent.dice.modifier ? notation : `${notation} · ${breakdown}`,
    icon: { source: Icons.dice, tint: color },
    section: T[lang].result,
    keywords: [notation],
    detail: {
      stats: [
        { label: notation, value: r.total, color },
        { label: "Min", value: r.min },
        { label: "Max", value: r.max },
      ],
      markdown: `${breakdown}`,
      metadata: [
        meta.text("Dice", `${intent.dice.count} × d${intent.dice.sides}`, { icon: Icons.dice }),
        ...(intent.dice.keep
          ? [meta.text("Keep", `${intent.dice.keep > 0 ? "Highest" : "Lowest"} ${Math.abs(intent.dice.keep)}`)]
          : []),
        ...(intent.dice.modifier
          ? [meta.text("Modifier", intent.dice.modifier > 0 ? `+${intent.dice.modifier}` : `${intent.dice.modifier}`)]
          : []),
        meta.progress("Roll", ratio, `${r.total} of ${r.min}–${r.max}`),
      ],
    },
    actions: resultActions(String(r.total), [
      copy(`${notation}: ${breakdown} = ${r.total}`, "Copy Roll Details", { section: "Copy" }),
    ]),
  }];
}

function rangeItems(intent: Extract<Intent, { kind: "range" }>, lang: Lang): Item[] {
  const { range } = intent;
  const n = drawInRange(range);
  const shown = formatNumber(n, range.decimals);
  const value = range.decimals ? n.toFixed(range.decimals) : String(n);
  const bounds = `${formatNumber(range.min, range.decimals)} – ${formatNumber(range.max, range.decimals)}`;
  const count = Math.round((range.max - range.min) * 10 ** range.decimals) + 1;
  return [{
    id: "range",
    title: shown,
    subtitle: bounds,
    icon: { source: Icons.hash, tint: "blue" },
    section: T[lang].result,
    detail: {
      stats: [{ label: T[lang].number, value: shown, color: "blue" }],
      metadata: [
        meta.text("Range", `${bounds} (both included)`, { icon: Icons.hash }),
        meta.text("Possible values", formatNumber(count)),
        ...(range.decimals
          ? [meta.text("Precision", `${range.decimals} decimal${range.decimals > 1 ? "s" : ""}`)]
          : []),
        meta.progress("Position", range.max > range.min ? (n - range.min) / (range.max - range.min) : 1),
      ],
    },
    actions: resultActions(value),
  }];
}

function pickItems(intent: Extract<Intent, { kind: "pick" }>, lang: Lang): Item[] {
  if (intent.items.length < 2) return [hint(lang, "pick")];
  const chosen = shuffle(intent.items).slice(0, intent.count);
  const value = chosen.join(", ");
  return [{
    id: "pick",
    title: value,
    subtitle: `${T[lang].pick} · ${intent.count} of ${intent.items.length}`,
    icon: { source: Icons.sparkle, tint: "purple" },
    section: T[lang].result,
    detail: {
      stats: [
        { label: "Picked", value: intent.count, color: "purple" },
        { label: "Choices", value: intent.items.length },
      ],
      markdown: intent.items.map((i) => (chosen.includes(i) ? `- **${i}**` : `- ${i}`)).join("\n"),
      metadata: [meta.text("Odds", `${intent.count} in ${intent.items.length} each`, { icon: Icons.sparkle })],
    },
    actions: resultActions(value),
  }];
}

function shuffleItems(intent: Extract<Intent, { kind: "shuffle" }>, lang: Lang): Item[] {
  if (intent.items.length < 2) return [hint(lang, "shuffle")];
  const order = shuffle(intent.items);
  return [
    {
      id: "shuffle",
      title: order.join(", "),
      subtitle: `${T[lang].shuffle} · ${order.length} items`,
      icon: { source: Icons.shuffle, tint: "teal" },
      section: T[lang].result,
      detail: {
        stats: [{ label: "Items", value: order.length, color: "teal" }],
        markdown: order.map((x, i) => `${i + 1}. ${x}`).join("\n"),
      },
      actions: resultActions(order.join(", "), [
        copy(order.join("\n"), "Copy One per Line", { section: "Copy", shortcut: "<Ctrl><Shift>c" }),
      ]),
    },
    ...order.map((x, i): Item => ({
      id: `shuffle:${i}`,
      title: x,
      icon: { source: Icons.hash, tint: "gray" },
      accessories: [{ text: `#${i + 1}` }],
      section: "Order",
      actions: [copy(x), again("Shuffle Again")],
    })),
  ];
}

function colorItems(lang: Lang): Item[] {
  const c = randomColor();
  const h = hex(c);
  const { h: hue, s, l } = hsl(c);
  const rgb = `rgb(${c.r}, ${c.g}, ${c.b})`;
  const hslText = `hsl(${hue}, ${s}%, ${l}%)`;
  const lum = luminance(c);
  return [{
    id: "color",
    title: h,
    subtitle: rgb,
    icon: `color:${h}`,
    section: T[lang].result,
    keywords: [rgb, hslText],
    detail: {
      stats: [
        { label: "Hue", value: `${hue}°` },
        { label: "Saturation", value: `${s} %` },
        { label: "Lightness", value: `${l} %` },
      ],
      metadata: [
        meta.text("HEX", h, { icon: `color:${h}` }),
        meta.text("RGB", rgb),
        meta.text("HSL", hslText),
        meta.separator(),
        meta.text("Tone", lum > 0.4 ? "Light: dark text reads best" : "Dark: light text reads best", {
          icon: lum > 0.4 ? Icons.sun : Icons.moon,
        }),
      ],
    },
    actions: [
      again("New Color"),
      copy(h, `Copy ${h}`, { section: "Copy" }),
      copy(rgb, `Copy ${rgb}`, { section: "Copy" }),
      copy(hslText, `Copy ${hslText}`, { section: "Copy" }),
      paste(h, `Paste ${h}`, { section: "Copy" }),
    ],
  }];
}

function yesNoItems(lang: Lang): Item[] {
  const yes = randomInt(0, 1) === 0;
  const answer = YES_NO[lang][yes ? 0 : 1];
  return [{
    id: "yesno",
    title: answer,
    subtitle: T[lang].yesno,
    icon: { source: yes ? Icons.check : Icons.cross, tint: yes ? "green" : "red" },
    section: T[lang].result,
    detail: { stats: [{ label: T[lang].yesno, value: answer, color: yes ? "green" : "red" }] },
    actions: resultActions(answer),
  }];
}

const MOOD: Record<Mood, { color: Color; icon: string }> = {
  yes: { color: "green", icon: Icons.check },
  maybe: { color: "yellow", icon: Icons.question },
  no: { color: "red", icon: Icons.cross },
};

const MOOD_NAME: Record<Lang, Record<Mood, string>> = {
  en: { yes: "Positive", maybe: "Non-committal", no: "Negative" },
  fr: { yes: "Positive", maybe: "Incertaine", no: "Négative" },
};

function eightBallItems(question: string, lang: Lang): Item[] {
  const [answer, mood] = pick(EIGHT_BALL[lang]);
  return [{
    id: "8ball",
    title: answer,
    subtitle: question || T[lang].ball,
    icon: { source: Icons.sparkle, tint: MOOD[mood].color },
    section: T[lang].ball,
    detail: {
      markdown: question ? `> ${question}\n\n### ${answer}` : `### ${answer}`,
      metadata: [
        meta.text(
          "Mood",
          MOOD_NAME[lang][mood],
          { icon: MOOD[mood].icon, color: MOOD[mood].color },
        ),
      ],
    },
    actions: resultActions(answer, [
      ...(question ? [copy(`${question} ${answer}`, "Copy Question and Answer", { section: "Copy" })] : []),
    ]),
  }];
}

const EXAMPLES = {
  pick: ["pick pizza, sushi, tacos", "pick 2 Alice, Bob, Carol, Dan"],
  shuffle: ["shuffle Alice, Bob, Carol"],
};

function hint(lang: Lang, kind: "pick" | "shuffle"): Item {
  return {
    id: `hint:${kind}`,
    title: kind === "pick" ? "List at least two choices" : "List at least two items",
    subtitle: EXAMPLES[kind][0],
    icon: { source: Icons.info, tint: "gray" },
    section: T[lang].result,
    detail: {
      markdown: `Separate them with commas, semicolons, \`or\` or new lines.\n\n${
        EXAMPLES[kind].map((e) => `- \`${e}\``).join("\n")
      }`,
    },
  };
}

/** The tools, with a fresh draw each, and what to type for the others. */
function tools(lang: Lang): Item[] {
  const quick = [
    ...coinItems(1, lang),
    ...diceItems({ kind: "dice", dice: { count: 1, sides: 6, modifier: 0 } }, lang),
    ...rangeItems({ kind: "range", range: { min: 1, max: 100, decimals: 0 } }, lang),
    ...yesNoItems(lang),
    ...colorItems(lang),
    ...eightBallItems("", lang),
  ].map((i) => ({ ...i, section: "Quick Draws" }));
  quick[0].subtitle = T[lang].coin;
  quick[1].subtitle = `${T[lang].dice} · d6`;
  quick[2].subtitle = `${T[lang].number} · 1–100`;
  quick[3].subtitle = T[lang].yesno;
  quick[4].subtitle = `${T[lang].color} · ${quick[4].subtitle}`;
  quick[5].subtitle = T[lang].ball;
  const typed: { title: string; examples: string[]; icon: string; tint: Color; about: string }[] = [
    {
      title: "Dice notation",
      examples: ["2d6+3", "d20", "4d6kh3"],
      icon: Icons.dice,
      tint: "blue",
      about: "Up to 100 dice of 2 to 1000 sides. `kh3` keeps the 3 highest dice, `kl1` the lowest.",
    },
    {
      title: "Number in a range",
      examples: ["1-100", "0.5-2.5", "1 to 6", "de 1 à 10"],
      icon: Icons.hash,
      tint: "blue",
      about: "Both bounds are included. Decimals in a bound set the precision.",
    },
    {
      title: "Pick from a list",
      examples: ["pick tea, coffee, juice", "pick 2 Alice, Bob, Carol", "pizza or sushi"],
      icon: Icons.sparkle,
      tint: "purple",
      about: "Or just type a list. `pick 2 …` draws two different ones.",
    },
    {
      title: "Shuffle a list",
      examples: ["shuffle Alice, Bob, Carol", "mélanger a; b; c"],
      icon: Icons.shuffle,
      tint: "teal",
      about: "The items in a random order.",
    },
    {
      title: "Several coins",
      examples: ["flip 10", "pile ou face"],
      icon: Icons.coin,
      tint: "yellow",
      about: "Counts heads and tails, up to 100 coins.",
    },
    {
      title: "Ask the Magic 8-Ball",
      examples: ["8ball Will it rain tomorrow?", "boule Est-ce que je vais gagner ?"],
      icon: Icons.question,
      tint: "pink",
      about: "Any question ending with `?` gets an answer, in English or French.",
    },
  ];
  return [
    ...quick,
    ...typed.map((t): Item => ({
      id: `type:${t.title}`,
      title: t.title,
      subtitle: t.examples.join(" · "),
      icon: { source: t.icon, tint: t.tint },
      section: "Type",
      keywords: t.examples,
      detail: { markdown: `${t.about}\n\n${t.examples.map((e) => `- \`${e}\``).join("\n")}` },
      actions: t.examples.map((e) => copy(e, `Copy “${e}”`, { icon: Icons.copy })),
    })),
  ];
}

export default (ctx: Context) => {
  const prefs = ctx.preferences as { language?: string };
  const langFor = (query: string): Lang =>
    (prefs.language ?? "auto").trim().toLowerCase() === "auto" && looksFrench(query)
      ? "fr"
      : language(prefs.language, locale());
  return list({
    placeholder: "Coin, 2d6+3, 1-100, pick a, b, c, shuffle…, color, 8ball…",
    status: (items) => items.find((i) => i.section !== "Order")?.subtitle ?? "Random",
    empty: { title: "Nothing to draw", icon: Icons.dice },
    search(query) {
      const lang = langFor(query);
      const intent = parseIntent(query);
      switch (intent.kind) {
        case "tools":
          return tools(lang);
        case "coin":
          return coinItems(intent.count, lang);
        case "dice":
          return diceItems(intent, lang);
        case "range":
          return rangeItems(intent, lang);
        case "pick":
          return pickItems(intent, lang);
        case "shuffle":
          return shuffleItems(intent, lang);
        case "color":
          return colorItems(lang);
        case "yesno":
          return yesNoItems(lang);
        case "eightball":
          return eightBallItems(intent.question, lang);
        case "unknown":
          return tools(lang).filter((i) =>
            `${i.title} ${i.subtitle ?? ""}`.toLowerCase().includes(intent.text.toLowerCase())
          );
      }
    },
  });
};
