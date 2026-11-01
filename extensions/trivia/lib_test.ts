import { assert, assertEquals, assertRejects } from "@std/assert";
import { parse } from "@std/toml";
import { fetchQuestions, limits, NoQuestions } from "./api.ts";
import {
  BATCH,
  CATEGORIES,
  categoryName,
  decodeText,
  difficultyOf,
  emptyStats,
  hashId,
  kindOf,
  matches,
  outcome,
  percent,
  praise,
  type QuestionsResponse,
  questionsUrl,
  resetTokenUrl,
  score,
  scoreLine,
  settingsKey,
  settingsText,
  shareText,
  shortCategory,
  shuffle,
  statsMarkdown,
  toQuestion,
  toQuestions,
  waitBeforeRequest,
} from "./lib.ts";

const fixture = async (name: string): Promise<QuestionsResponse> =>
  JSON.parse(await Deno.readTextFile(new URL(`./fixtures/${name}`, import.meta.url)));

/** A repeatable random source. */
function seeded(seed: number): () => number {
  return () => {
    seed = (seed * 1103515245 + 12345) % 2 ** 31;
    return seed / 2 ** 31;
  };
}

const ANY = { category: 0, difficulty: "any", kind: "any" } as const;

Deno.test("categories and settings", () => {
  assertEquals(CATEGORIES.length, 24);
  assertEquals(new Set(CATEGORIES.map((c) => c.id)).size, 24);
  assertEquals(shortCategory("Entertainment: Video Games"), "Video Games");
  assertEquals(shortCategory("Science: Computers"), "Computers");
  assertEquals(shortCategory("Science & Nature"), "Science & Nature");
  assertEquals(categoryName(22), "Geography");
  assertEquals(categoryName(0), "Any category");
  assertEquals(categoryName(999), "Any category");
  assertEquals(difficultyOf("hard"), "hard");
  assertEquals(difficultyOf(undefined), "any");
  assertEquals(kindOf("boolean"), "boolean");
  assertEquals(kindOf("x"), "any");
  assertEquals(settingsKey({ category: 9, difficulty: "easy", kind: "boolean" }), "9|easy|boolean");
  assertEquals(
    settingsText({ category: 15, difficulty: "hard", kind: "boolean" }),
    "Video Games · hard · true or false",
  );
  assertEquals(settingsText(ANY), "Any category · any difficulty");
});

Deno.test("urls", () => {
  assertEquals(questionsUrl(ANY), `https://opentdb.com/api.php?amount=${BATCH}&encode=url3986`);
  assertEquals(
    questionsUrl({ category: 22, difficulty: "medium", kind: "multiple" }, 1, "tok"),
    "https://opentdb.com/api.php?amount=1&encode=url3986&category=22&difficulty=medium&type=multiple&token=tok",
  );
  assertEquals(resetTokenUrl("abc"), "https://opentdb.com/api_token.php?command=reset&token=abc");
});

Deno.test("response codes and rate limit", () => {
  assertEquals(outcome(0), { ok: true });
  assertEquals(outcome(1), { ok: false, reason: "no-results" });
  assertEquals(outcome(3), { ok: false, reason: "token-unknown" });
  assertEquals(outcome(4), { ok: false, reason: "token-empty" });
  assertEquals(outcome(5), { ok: false, reason: "rate-limit" });
  assertEquals(outcome(42), { ok: false, reason: "unknown" });
  assertEquals(waitBeforeRequest(undefined, 1000), 0);
  assertEquals(waitBeforeRequest(10_000, 12_000), 3250);
  assertEquals(waitBeforeRequest(10_000, 20_000), 0);
  // A clock that went backwards never makes it wait longer than the spacing.
  assertEquals(waitBeforeRequest(30_000, 10_000), 5250);
});

Deno.test("decoding questions", async () => {
  assertEquals(decodeText("What%20is%20%22Pi%22%3F"), 'What is "Pi"?');
  assertEquals(decodeText("100%"), "100%");
  const res = await fixture("questions.json");
  const qs = toQuestions(res, seeded(1));
  assertEquals(qs.length, res.results.length);
  for (const [i, q] of qs.entries()) {
    const raw = res.results[i];
    assertEquals(q.text, decodeURIComponent(raw.question).trim());
    assert(!q.text.includes("%20"));
    assert(q.answers.includes(q.correct));
    assertEquals(q.answers.length, 1 + raw.incorrect_answers.length);
    assertEquals(new Set(q.answers).size, q.answers.length);
    assertEquals(q.id, hashId(q.text));
  }
  const tf = toQuestions(await fixture("boolean.json"));
  assert(tf.every((q) => q.kind === "boolean" && q.answers.join() === "True,False"));
  assertEquals(tf[0].correct, "True");
  assertEquals(tf[0].category, "Celebrities");
  assertEquals(tf[1].category, "Entertainment: Video Games");
  assertEquals(tf[1].text, '"Sonic the Hedgehog 2" originally was going to have a time travel system.');
});

Deno.test("shuffle keeps every answer and duplicates are dropped", () => {
  const items = ["a", "b", "c", "d"];
  const out = shuffle(items, seeded(7));
  assertEquals([...out].sort(), items);
  assertEquals(items, ["a", "b", "c", "d"]);
  const raw = {
    type: "multiple",
    difficulty: "easy",
    category: "Geography",
    question: "Capital%20of%20France%3F",
    correct_answer: "Paris",
    incorrect_answers: ["Lyon", "Nice", "Lille"],
  };
  assertEquals(toQuestions({ response_code: 0, results: [raw, raw] }).length, 1);
});

Deno.test("matching settings", () => {
  const q = toQuestion({
    type: "boolean",
    difficulty: "hard",
    category: "Entertainment%3A%20Video%20Games",
    question: "x",
    correct_answer: "True",
    incorrect_answers: ["False"],
  });
  assert(matches(q, ANY));
  assert(matches(q, { category: 15, difficulty: "hard", kind: "boolean" }));
  assert(!matches(q, { category: 22, difficulty: "any", kind: "any" }));
  assert(!matches(q, { category: 0, difficulty: "easy", kind: "any" }));
  assert(!matches(q, { category: 0, difficulty: "any", kind: "multiple" }));
});

Deno.test("scoring", () => {
  const q = toQuestion({
    type: "multiple",
    difficulty: "medium",
    category: "Geography",
    question: "Capital%20of%20Italy%3F",
    correct_answer: "Rome",
    incorrect_answers: ["Milan", "Turin", "Naples"],
  });
  let s = emptyStats();
  assertEquals(scoreLine(s), "No answers yet");
  assertEquals(percent(s), "–");
  s = score(s, q, "Rome");
  s = score(s, q, "Rome");
  s = score(s, q, "Rome");
  assertEquals([s.answered, s.correct, s.streak, s.best], [3, 3, 3, 3]);
  s = score(s, q, "Milan");
  assertEquals([s.answered, s.correct, s.streak, s.best], [4, 3, 0, 3]);
  s = score(s, q, "Rome");
  assertEquals(s.byCategory.Geography, { answered: 5, correct: 4 });
  assertEquals(s.byDifficulty.medium, { answered: 5, correct: 4 });
  assertEquals(percent(s), "80 %");
  assertEquals(scoreLine(s), "4/5 right · streak 1 · best 3");
  assertEquals(shareText(s), "Trivia: 4 of 5 right (80 %), best streak 3");
  assertEquals(praise(1), "Correct!");
  assertEquals(praise(3), "3 in a row!");
  assertEquals(praise(12), "Unstoppable: 12 in a row!");
  const md = statsMarkdown(s);
  assert(md.includes("| Geography | 4/5 | 80 % |"));
  assert(md.includes("| Medium | 4/5 | 80 % |"));
  assert(statsMarkdown(emptyStats()).includes("No answers yet"));
});

/** Answers Open Trivia DB requests from a script, recording the URLs. */
function fakeApi(answers: unknown[]): { urls: string[]; restore: () => void } {
  const urls: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = ((input: string | URL | Request) => {
    urls.push(String(input));
    const body = answers.shift();
    if (body === undefined) throw new Error(`unexpected request ${input}`);
    return Promise.resolve(new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } }));
  }) as typeof fetch;
  return { urls, restore: () => (globalThis.fetch = original) };
}

const one = {
  type: "multiple",
  difficulty: "easy",
  category: "Geography",
  question: "Capital%20of%20France%3F",
  correct_answer: "Paris",
  incorrect_answers: ["Lyon", "Nice", "Lille"],
};

Deno.test("api: token, rate limit and running out of questions", async () => {
  limits.spacing = 0;
  // No token stored (no launcher in tests): one is requested, then the questions.
  let api = fakeApi([{ response_code: 0, token: "T1" }, { response_code: 0, results: [one] }]);
  try {
    const qs = await fetchQuestions(ANY);
    assertEquals(qs.map((q) => q.correct), ["Paris"]);
    assert(api.urls[0].includes("api_token.php?command=request"));
    assert(api.urls[1].includes("token=T1"));
  } finally {
    api.restore();
  }
  // Rate limited, then an expired token, then fewer questions left than asked.
  api = fakeApi([
    { response_code: 0, token: "T1" },
    { response_code: 5, results: [] },
    { response_code: 3, results: [] },
    { response_code: 0, token: "T2" },
    { response_code: 1, results: [] },
    { response_code: 0, results: [one] },
  ]);
  try {
    const qs = await fetchQuestions(ANY);
    assertEquals(qs.length, 1);
    assert(api.urls.at(-1)!.includes("amount=1"));
    assert(api.urls.at(-1)!.includes("token=T2"));
  } finally {
    api.restore();
  }
  // Everything asked already: the token is reset once, then it gives up.
  api = fakeApi([
    { response_code: 0, token: "T1" },
    { response_code: 4, results: [] },
    { response_code: 0, token: "T1" },
    { response_code: 4, results: [] },
  ]);
  try {
    await assertRejects(() => fetchQuestions({ category: 13, difficulty: "hard", kind: "boolean" }), NoQuestions);
    assert(api.urls[2].includes("command=reset&token=T1"));
  } finally {
    api.restore();
  }
  api = fakeApi([{ response_code: 0, token: "T1" }, { response_code: 2, results: [] }]);
  try {
    await assertRejects(() => fetchQuestions(ANY), Error, "refused");
  } finally {
    api.restore();
  }
});

Deno.test("manifest", async () => {
  const m = parse(await Deno.readTextFile(new URL("./backslash.toml", import.meta.url))) as any;
  assertEquals(m.extension.id, "trivia");
  assertEquals(m.extension.categories, ["media"]);
  assertEquals(m.permissions, { net: ["opentdb.com"] });
  for (const c of m.commands) await Deno.stat(new URL(`./commands/${c.name}.ts`, import.meta.url));
});
