import { assertEquals, assertThrows } from "@std/assert";
import {
  buildDecks,
  compareDeckNames,
  dueSubtitle,
  dueToday,
  friendlyError,
  installHint,
  noteFields,
  noteParams,
  orderModels,
  parseQuickAdd,
  parseTags,
  request,
  toHtml,
  unwrap,
  visibleDecks,
} from "./lib.ts";
import { pickDeck } from "./anki.ts";

// What AnkiConnect 6 answers for a small collection.
const NAMES = {
  "Default": 1,
  "Languages": 1700000000001,
  "Languages::Japanese": 1700000000002,
  "Geography": 1700000000003,
  "languages::French": 1700000000004,
};
const STATS = {
  "1": { deck_id: 1, name: "Default", new_count: 0, learn_count: 0, review_count: 0, total_in_deck: 0 },
  "1700000000001": {
    deck_id: 1700000000001,
    name: "Languages",
    new_count: 20,
    learn_count: 3,
    review_count: 41,
    total_in_deck: 900,
  },
  "1700000000002": {
    deck_id: 1700000000002,
    name: "Languages::Japanese",
    new_count: 10,
    learn_count: 2,
    review_count: 30,
    total_in_deck: 600,
  },
  "1700000000004": {
    deck_id: 1700000000004,
    name: "languages::French",
    new_count: 10,
    learn_count: 1,
    review_count: 11,
    total_in_deck: 300,
  },
  "1700000000003": {
    deck_id: 1700000000003,
    name: "Geography",
    new_count: 5,
    learn_count: 0,
    review_count: 7,
    total_in_deck: 250,
  },
};

Deno.test("requests and replies", () => {
  assertEquals(request("deckNames"), { action: "deckNames", version: 6, params: {} });
  assertEquals(request("sync", {}, "k"), { action: "sync", version: 6, params: {}, key: "k" });
  assertEquals(unwrap<number>({ result: 5, error: null }), 5);
  assertThrows(
    () => unwrap({ result: null, error: "cannot create note because it is a duplicate" }),
    Error,
    "already exists",
  );
  assertThrows(() => unwrap({ nope: 1 }), Error, "Unexpected");
  assertEquals(
    friendlyError("valid api key must be provided"),
    "AnkiConnect wants an API key: set it in Settings → Extensions → Anki",
  );
  assertEquals(friendlyError("collection is not available"), "Anki: collection is not available");
});

Deno.test("decks in tree order with their counts", () => {
  const decks = buildDecks(NAMES, STATS);
  assertEquals(decks.map((d) => d.name), [
    "Default",
    "Geography",
    "Languages",
    "languages::French",
    "Languages::Japanese",
  ]);
  const jp = decks.find((d) => d.leaf === "Japanese")!;
  assertEquals([jp.parent, jp.depth, jp.newCount, jp.learnCount, jp.reviewCount, jp.total], [
    "Languages",
    1,
    10,
    2,
    30,
    600,
  ]);
  // The empty Default deck is hidden, as in Anki.
  assertEquals(visibleDecks(decks).map((d) => d.leaf), ["Geography", "Languages", "French", "Japanese"]);
  assertEquals(visibleDecks(buildDecks({ Default: 1 }, {})).length, 1);
  assertEquals(compareDeckNames("A::B", "A"), 1);
  assertEquals(compareDeckNames("a", "B") < 0, true);
});

Deno.test("due today counts top-level decks only", () => {
  const decks = buildDecks(NAMES, STATS);
  assertEquals(dueToday(decks), { review: 48, learn: 3, new: 25 });
  assertEquals(dueSubtitle(decks), "51 due today · 25 new");
  assertEquals(dueSubtitle(buildDecks({ Default: 1 }, {})), undefined);
});

Deno.test("quick add: sides, tags and clozes", () => {
  assertEquals(parseQuickAdd("bonjour :: hello"), { front: "bonjour", back: "hello", tags: [], cloze: false });
  assertEquals(parseQuickAdd("  chat::cat #french #animals "), {
    front: "chat",
    back: "cat",
    tags: ["french", "animals"],
    cloze: false,
  });
  assertEquals(parseQuickAdd("The capital of France is {{c1::Paris}}"), {
    front: "The capital of France is {{c1::Paris}}",
    back: "",
    tags: [],
    cloze: true,
  });
  assertEquals(parseQuickAdd("{{c1::Paris::city}} is in {{c2::France}} :: Europe #geo"), {
    front: "{{c1::Paris::city}} is in {{c2::France}}",
    back: "Europe",
    tags: ["geo"],
    cloze: true,
  });
  assertEquals(parseQuickAdd("C# :: a language").front, "C#");
  assertEquals(parseQuickAdd("std::vector :: C++ dynamic array"), {
    front: "std::vector",
    back: "C++ dynamic array",
    tags: [],
    cloze: false,
  });
  assertEquals(parseQuickAdd("chat::cat").back, "cat");
  assertThrows(() => parseQuickAdd("no separator"), Error, "::");
  assertThrows(() => parseQuickAdd(":: back"), Error, "front");
});

Deno.test("fields, tags, HTML and note types", () => {
  assertEquals(noteFields(["Front", "Back"], "q", "a"), { Front: "q", Back: "a" });
  assertEquals(noteFields(["Text", "Back Extra"], "{{c1::x}}", ""), { Text: "{{c1::x}}", "Back Extra": "" });
  assertEquals(noteFields(["Vorderseite", "Rückseite", "Notes"], "q", "a"), {
    Vorderseite: "q",
    Rückseite: "a",
    Notes: "",
  });
  assertEquals(noteFields([], "q", "a"), { Front: "q", Back: "a" });
  assertEquals(parseTags("french, vocab  #verbs french"), ["french", "vocab", "verbs"]);
  assertEquals(toHtml("a < b & c\nnext"), "a &lt; b &amp; c<br>next");
  assertEquals(
    orderModels(["Image Occlusion", "Cloze", "Basic (type in the answer)", "Basic", "Basic (and reversed card)"]),
    [
      "Basic",
      "Basic (and reversed card)",
      "Cloze",
      "Basic (type in the answer)",
      "Image Occlusion",
    ],
  );
  assertEquals(noteParams({ deck: "D", model: "Basic", fields: { Front: "q" }, tags: ["t"] }), {
    note: {
      deckName: "D",
      modelName: "Basic",
      fields: { Front: "q" },
      tags: ["t"],
      options: { allowDuplicate: false, duplicateScope: "deck" },
    },
  });
});

Deno.test("the last deck is remembered while it exists", () => {
  assertEquals(pickDeck(["Default", "French"], "French"), "French");
  assertEquals(pickDeck(["Default", "French"], "Gone"), "French");
  assertEquals(pickDeck(["Default"], undefined), "Default");
  assertEquals(pickDeck([], undefined), "Default");
});

Deno.test("install hints per distribution", () => {
  assertEquals(installHint("ID=fedora\nVERSION_ID=41").some((l) => l.includes("dnf")), true);
  assertEquals(installHint('ID=linuxmint\nID_LIKE="ubuntu debian"').some((l) => l.includes("apt")), true);
  assertEquals(installHint("ID=arch").some((l) => l.includes("anki-bin")), true);
  assertEquals(installHint("").length, 2);
});
