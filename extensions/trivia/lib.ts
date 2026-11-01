// Pure logic: Open Trivia DB URLs and answers, questions, scoring and the
// text shown. No network or storage here, so all of it is testable.

export const API = "https://opentdb.com";

/** Open Trivia DB's categories, by id. */
export const CATEGORIES: { id: number; name: string }[] = [
  { id: 9, name: "General Knowledge" },
  { id: 10, name: "Entertainment: Books" },
  { id: 11, name: "Entertainment: Film" },
  { id: 12, name: "Entertainment: Music" },
  { id: 13, name: "Entertainment: Musicals & Theatres" },
  { id: 14, name: "Entertainment: Television" },
  { id: 15, name: "Entertainment: Video Games" },
  { id: 16, name: "Entertainment: Board Games" },
  { id: 17, name: "Science & Nature" },
  { id: 18, name: "Science: Computers" },
  { id: 19, name: "Science: Mathematics" },
  { id: 20, name: "Mythology" },
  { id: 21, name: "Sports" },
  { id: 22, name: "Geography" },
  { id: 23, name: "History" },
  { id: 24, name: "Politics" },
  { id: 25, name: "Art" },
  { id: 26, name: "Celebrities" },
  { id: 27, name: "Animals" },
  { id: 28, name: "Vehicles" },
  { id: 29, name: "Entertainment: Comics" },
  { id: 30, name: "Science: Gadgets" },
  { id: 31, name: "Entertainment: Japanese Anime & Manga" },
  { id: 32, name: "Entertainment: Cartoon & Animations" },
];

/** "Entertainment: Video Games" → "Video Games"; "Science & Nature" stays. */
export function shortCategory(name: string): string {
  return name.replace(/^(Entertainment|Science):\s*/, "");
}

export function categoryName(id: number | undefined): string {
  if (!id) return "Any category";
  const c = CATEGORIES.find((c) => c.id === id);
  return c ? shortCategory(c.name) : "Any category";
}

export type Difficulty = "any" | "easy" | "medium" | "hard";
export const DIFFICULTIES: { value: Difficulty; title: string }[] = [
  { value: "any", title: "Any Difficulty" },
  { value: "easy", title: "Easy" },
  { value: "medium", title: "Medium" },
  { value: "hard", title: "Hard" },
];

export type Kind = "any" | "multiple" | "boolean";
export const KINDS: { value: Kind; title: string }[] = [
  { value: "any", title: "Any Type" },
  { value: "multiple", title: "Multiple Choice" },
  { value: "boolean", title: "True or False" },
];

export function difficultyOf(value: unknown): Difficulty {
  return value === "easy" || value === "medium" || value === "hard" ? value : "any";
}

export function kindOf(value: unknown): Kind {
  return value === "multiple" || value === "boolean" ? value : "any";
}

export interface Settings {
  /** 0 for any category. */
  category: number;
  difficulty: Difficulty;
  kind: Kind;
}

/** Identifies a set of questions: a queue fetched for other settings is thrown away. */
export function settingsKey(s: Settings): string {
  return `${s.category}|${s.difficulty}|${s.kind}`;
}

export function settingsText(s: Settings): string {
  return [
    categoryName(s.category),
    s.difficulty === "any" ? "any difficulty" : s.difficulty,
    ...(s.kind === "any" ? [] : [s.kind === "boolean" ? "true or false" : "multiple choice"]),
  ].join(" · ");
}

// ---------------------------------------------------------------------------
// The API

/** Questions per request: enough to play a while between requests (one every 5 s at most). */
export const BATCH = 10;

export function questionsUrl(s: Settings, amount = BATCH, token?: string): string {
  const q = new URLSearchParams({ amount: String(amount), encode: "url3986" });
  if (s.category) q.set("category", String(s.category));
  if (s.difficulty !== "any") q.set("difficulty", s.difficulty);
  if (s.kind !== "any") q.set("type", s.kind);
  if (token) q.set("token", token);
  return `${API}/api.php?${q}`;
}

export const tokenUrl = () => `${API}/api_token.php?command=request`;
export const resetTokenUrl = (token: string) =>
  `${API}/api_token.php?${new URLSearchParams({ command: "reset", token })}`;

export interface RawQuestion {
  type: string;
  difficulty: string;
  category: string;
  question: string;
  correct_answer: string;
  incorrect_answers: string[];
}

export interface QuestionsResponse {
  response_code: number;
  results: RawQuestion[];
}

/** What a `response_code` means. */
export type Outcome =
  | { ok: true }
  | { ok: false; reason: "no-results" | "invalid" | "token-unknown" | "token-empty" | "rate-limit" | "unknown" };

export function outcome(code: number): Outcome {
  switch (code) {
    case 0:
      return { ok: true };
    case 1:
      return { ok: false, reason: "no-results" };
    case 2:
      return { ok: false, reason: "invalid" };
    case 3:
      return { ok: false, reason: "token-unknown" };
    case 4:
      return { ok: false, reason: "token-empty" };
    case 5:
      return { ok: false, reason: "rate-limit" };
    default:
      return { ok: false, reason: "unknown" };
  }
}

/** Open Trivia DB asks for one request every 5 seconds per address. */
export const RATE_LIMIT_MS = 5_000;

/** How long to wait before the next request may go out. */
export function waitBeforeRequest(lastAt: number | undefined, now: number, spacing = RATE_LIMIT_MS + 250): number {
  if (!lastAt) return 0;
  return Math.max(0, Math.min(spacing, lastAt + spacing - now));
}

// ---------------------------------------------------------------------------
// Questions

export interface Question {
  id: string;
  kind: "multiple" | "boolean";
  difficulty: Difficulty;
  category: string;
  text: string;
  correct: string;
  /** Shuffled once, so the order stays the same while it is shown. */
  answers: string[];
}

/** RFC 3986 decoding, for `encode=url3986`; text that isn't encoded passes as is. */
export function decodeText(text: string): string {
  try {
    return decodeURIComponent(text).trim();
  } catch {
    return text.trim();
  }
}

/** A stable short id from the question text (FNV-1a). */
export function hashId(text: string): string {
  let h = 0x811c9dc5;
  for (const c of new TextEncoder().encode(text)) {
    h ^= c;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

/** Fisher–Yates with a given random source (tests pass their own). */
export function shuffle<T>(items: T[], random: () => number = Math.random): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function toQuestion(raw: RawQuestion, random: () => number = Math.random): Question {
  const kind = raw.type === "boolean" ? "boolean" : "multiple";
  const text = decodeText(raw.question);
  const correct = decodeText(raw.correct_answer);
  const wrong = raw.incorrect_answers.map(decodeText);
  // True comes first in a true-or-false question, as people expect.
  const answers = kind === "boolean" ? ["True", "False"] : shuffle([correct, ...wrong], random);
  return {
    id: hashId(text),
    kind,
    difficulty: difficultyOf(raw.difficulty),
    category: decodeText(raw.category),
    text,
    correct,
    answers,
  };
}

export function toQuestions(res: QuestionsResponse, random: () => number = Math.random): Question[] {
  const seen = new Set<string>();
  return (res.results ?? []).map((r) => toQuestion(r, random)).filter((q) => {
    if (seen.has(q.id)) return false;
    seen.add(q.id);
    return true;
  });
}

/** Whether a question fits the settings (a stored one may come from older settings). */
export function matches(q: Question, s: Settings): boolean {
  const category = CATEGORIES.find((c) => c.id === s.category)?.name;
  return (!category || q.category === category) &&
    (s.difficulty === "any" || q.difficulty === s.difficulty) &&
    (s.kind === "any" || q.kind === s.kind);
}

// ---------------------------------------------------------------------------
// Score

export interface Tally {
  answered: number;
  correct: number;
}

export interface Stats extends Tally {
  streak: number;
  best: number;
  byCategory: Record<string, Tally>;
  byDifficulty: Record<string, Tally>;
}

export const emptyStats = (): Stats => ({
  answered: 0,
  correct: 0,
  streak: 0,
  best: 0,
  byCategory: {},
  byDifficulty: {},
});

function add(t: Tally | undefined, right: boolean): Tally {
  return { answered: (t?.answered ?? 0) + 1, correct: (t?.correct ?? 0) + (right ? 1 : 0) };
}

/** The score after answering `q` with `choice`. */
export function score(stats: Stats, q: Question, choice: string): Stats {
  const right = choice === q.correct;
  const streak = right ? stats.streak + 1 : 0;
  return {
    answered: stats.answered + 1,
    correct: stats.correct + (right ? 1 : 0),
    streak,
    best: Math.max(stats.best, streak),
    byCategory: { ...stats.byCategory, [q.category]: add(stats.byCategory[q.category], right) },
    byDifficulty: { ...stats.byDifficulty, [q.difficulty]: add(stats.byDifficulty[q.difficulty], right) },
  };
}

export function percent(t: Tally): string {
  return t.answered ? `${Math.round(t.correct / t.answered * 100)} %` : "–";
}

/** "7/10 right · streak 3 · best 5". */
export function scoreLine(s: Stats): string {
  if (!s.answered) return "No answers yet";
  return `${s.correct}/${s.answered} right · streak ${s.streak} · best ${s.best}`;
}

/** What to say after an answer, by streak. */
export function praise(streak: number): string {
  if (streak >= 10) return `Unstoppable: ${streak} in a row!`;
  if (streak >= 5) return `On fire: ${streak} in a row!`;
  if (streak >= 3) return `${streak} in a row!`;
  return "Correct!";
}

/** A table of the score per category, best first, for the stats view. */
export function statsMarkdown(s: Stats): string {
  if (!s.answered) return "## No answers yet\n\nPlay a few questions in **Trivia** and your score shows up here.";
  const rows = (record: Record<string, Tally>, label: (k: string) => string) =>
    Object.entries(record)
      .sort(([, a], [, b]) => b.correct / b.answered - a.correct / a.answered || b.answered - a.answered)
      .map(([k, t]) => `| ${label(k)} | ${t.correct}/${t.answered} | ${percent(t)} |`);
  const order = ["easy", "medium", "hard"];
  const difficulty = Object.fromEntries(
    order.filter((d) => s.byDifficulty[d]).map((d) => [d, s.byDifficulty[d]]),
  );
  return [
    "## By category",
    "",
    "| Category | Right | Rate |",
    "|---|---|---|",
    ...rows(s.byCategory, shortCategory),
    "",
    "## By difficulty",
    "",
    "| Difficulty | Right | Rate |",
    "|---|---|---|",
    ...Object.entries(difficulty).map(([d, t]) =>
      `| ${d[0].toUpperCase() + d.slice(1)} | ${t.correct}/${t.answered} | ${percent(t)} |`
    ),
  ].join("\n");
}

/** Plain text to share a score. */
export function shareText(s: Stats): string {
  return `Trivia: ${s.correct} of ${s.answered} right (${percent(s)}), best streak ${s.best}`;
}
