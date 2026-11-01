// The lists both commands show.

import { action, type Context, Icons, type Item, list, type ListSpec } from "@backslash/api";
import { lookup, related } from "./api.ts";
import {
  entryItem,
  EXAMPLES,
  headwordItem,
  isPhrase,
  type More,
  parseQuery,
  plural,
  type Relation,
  RELATIONS,
  rhymeItems,
  sectionTitle,
} from "./lib.ts";

let lastStatus = "";
export const status = () => lastStatus;

/** "Synonyms of …" and "Rhymes for …" for any word in a list. */
export const more: More = (word, relation) => [
  action(`Look Up “${word}”`, () => resultsView(word, "all"), { icon: Icons.search, shortcut: "<Ctrl>l" }),
  ...(relation === "rhy" || relation === "all"
    ? [action(`Rhymes for “${word}”`, () => resultsView(word, "rhy"), { icon: Icons.music, shortcut: "<Ctrl>r" })]
    : []),
];

export function exampleItems(only?: (q: string) => boolean): Item[] {
  return EXAMPLES.filter((e) => !only || only(e.query)).map((e) => ({
    id: `example:${e.query}`,
    title: e.query,
    subtitle: e.title,
    icon: { source: Icons.lightbulb, tint: "yellow" as const },
    section: "Type a word, or try",
    actions: [action("Try It", () => resultsView(e.query, "all"), { icon: Icons.search })],
  }));
}

async function relationItems(relation: Relation, text: string, signal: AbortSignal): Promise<Item[]> {
  const entries = await related(relation, text, signal);
  if (relation === "rhy" || relation === "nry") return rhymeItems(entries, text, relation, more);
  return entries.map((e) => entryItem(e, sectionTitle(relation, text), relation, more));
}

function noneItem(text: string, what: string): Item {
  return {
    id: "none",
    title: `No ${what} for “${text}”`,
    subtitle: "Try another word, or another filter",
    icon: { source: Icons.search, tint: "gray" },
    actions: more(text, "all"),
  };
}

/** Everything for one word: its meaning, synonyms, antonyms and rhymes. */
async function allItems(word: string, signal: AbortSignal): Promise<Item[]> {
  const [head, synonyms, antonyms, rhymes] = await Promise.all([
    lookup(word, signal),
    related("syn", word, signal, 30),
    related("ant", word, signal, 10),
    related("rhy", word, signal, 15),
  ]);
  const items: Item[] = [];
  if (head) items.push(headwordItem(head, more));
  items.push(...synonyms.slice(0, 20).map((e) => entryItem(e, sectionTitle("syn", word), "syn", more)));
  items.push(...antonyms.map((e) => entryItem(e, sectionTitle("ant", word), "ant", more)));
  items.push(...rhymes.slice(0, 12).map((e) => entryItem(e, sectionTitle("rhy", word), "rhy", more)));
  lastStatus = [
    plural(synonyms.length, "synonym"),
    plural(antonyms.length, "antonym"),
    plural(rhymes.length, "rhyme"),
  ].join(" · ");
  return items;
}

/** The items for what was typed, under the picked filter. */
export async function results(query: string, filter: Relation | "all", signal: AbortSignal): Promise<Item[]> {
  const q = parseQuery(query);
  if (!q.text) {
    lastStatus = "Datamuse · English";
    return exampleItems();
  }
  const relation = q.relation ?? (filter !== "all" ? filter : isPhrase(q.text) ? "ml" : undefined);
  if (!relation) {
    const items = await allItems(q.text, signal);
    return items.length ? items : [noneItem(q.text, "words")];
  }
  const items = await relationItems(relation, q.text, signal);
  lastStatus = `${plural(items.length, "word")} · ${RELATIONS[relation].title}`;
  return items.length ? items : [noneItem(q.text, RELATIONS[relation].title.toLowerCase())];
}

/** A list for another word, opened from an action. */
export function resultsView(query: string, filter: Relation | "all"): ListSpec {
  return list({
    title: query,
    placeholder: "Filter these words…",
    items: (ctx: Context) => results(query, filter, ctx.signal),
    status,
  });
}
