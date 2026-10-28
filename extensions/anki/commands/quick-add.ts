import { run } from "@backslash/api";
import { BASIC, CLOZE, orderModels, parseQuickAdd } from "../lib.ts";
import { addCard, anki, lastDeck, OfflineError, pickDeck } from "../anki.ts";

// "Quick Add Anki Card  bonjour :: hello #french" → a Basic card in the last deck used.
export default run<{ card: string }>(async (ctx) => {
  const card = parseQuickAdd(String(ctx.args.card ?? ctx.query ?? ""));
  try {
    const [decks, remembered, models] = await Promise.all([
      anki<string[]>(ctx, "deckNames"),
      lastDeck(),
      anki<string[]>(ctx, "modelNames"),
    ]);
    const deck = pickDeck(decks, remembered);
    const model = card.cloze
      ? (models.includes(CLOZE) ? CLOZE : models.find((m) => /cloze/i.test(m)))
      : (models.includes(BASIC) ? BASIC : orderModels(models).find((m) => !/cloze/i.test(m)));
    if (!model) throw new Error(`No ${card.cloze ? "Cloze" : "Basic"} note type in this collection: use Add Anki Card`);
    await addCard(ctx, { deck, model, front: card.front, back: card.back, tags: card.tags });
    return `Added to ${deck.replace(/::/g, " › ")}`;
  } catch (e) {
    if (e instanceof OfflineError) {
      throw new Error("Open Anki with the AnkiConnect add-on (code 2055492159) to add cards");
    }
    throw e;
  }
});
