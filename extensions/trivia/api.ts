// Network and storage: the session token (so questions don't repeat), the
// 5-second rate limit, a queue of fetched questions, the question on screen
// and the score.

import { storage } from "@backslash/api";
import {
  BATCH,
  emptyStats,
  matches,
  outcome,
  type Question,
  type QuestionsResponse,
  questionsUrl,
  RATE_LIMIT_MS,
  resetTokenUrl,
  type Settings,
  settingsKey,
  type Stats,
  tokenUrl,
  toQuestions,
  waitBeforeRequest,
} from "./lib.ts";

type Json = Parameters<typeof storage.set>[1];

async function load<T>(key: string): Promise<T | undefined> {
  return await storage.get(key).catch(() => undefined) as T | undefined;
}

async function save(key: string, value: unknown): Promise<void> {
  await storage.set(key, value as Json).catch(() => {});
}

/** There are no more questions for these settings, even after starting over. */
export class NoQuestions extends Error {}

let lastRequest: number | undefined;

/** Time kept between two requests; tests shorten it. */
export const limits = { spacing: RATE_LIMIT_MS + 250 };

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(signal.reason);
    }, { once: true });
  });
}

/** One request to Open Trivia DB, at least 5 s after the previous one. */
async function request<T>(url: string, signal?: AbortSignal): Promise<T> {
  lastRequest ??= await load<number>("lastRequest");
  const wait = waitBeforeRequest(lastRequest, Date.now(), limits.spacing);
  if (wait) await sleep(wait, signal);
  lastRequest = Date.now();
  await save("lastRequest", lastRequest);
  let res: Response;
  try {
    res = await fetch(url, { signal });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw new Error(`Open Trivia DB is unreachable: ${(e as Error).message}`);
  }
  if (!res.ok) throw new Error(`Open Trivia DB answered ${res.status}`);
  return await res.json() as T;
}

async function newToken(signal?: AbortSignal): Promise<string | undefined> {
  const res = await request<{ response_code: number; token?: string }>(tokenUrl(), signal);
  if (res.response_code !== 0 || !res.token) return undefined;
  await save("token", res.token);
  return res.token;
}

/**
 * A batch of new questions. Handles what the API answers: an unknown or
 * expired token (get a new one), a token that has seen everything (reset it),
 * too few questions left (ask for fewer) and the rate limit (wait).
 */
export async function fetchQuestions(s: Settings, signal?: AbortSignal): Promise<Question[]> {
  let token = await load<string>("token") ?? await newToken(signal).catch(() => undefined);
  let amount = BATCH;
  let reset = false;
  for (let attempt = 0; attempt < 6; attempt++) {
    const res = await request<QuestionsResponse>(questionsUrl(s, amount, token), signal);
    const o = outcome(res.response_code);
    if (o.ok) return toQuestions(res);
    switch (o.reason) {
      case "rate-limit":
        continue; // request() waits before the next try.
      case "token-unknown":
        token = await newToken(signal);
        continue;
      case "no-results":
        // Fewer questions are left than asked for: ask for one at a time.
        if (amount > 1) {
          amount = 1;
          continue;
        }
        // A token that has seen everything gets code 4, so none exist at all.
        throw new NoQuestions("No questions for these settings");
      case "token-empty":
        // Every question of these settings was asked: start over.
        if (token && !reset) {
          reset = true;
          await request(resetTokenUrl(token), signal);
          continue;
        }
        throw new NoQuestions("No questions for these settings");
      case "invalid":
        throw new Error("Open Trivia DB refused these settings");
      default:
        throw new Error(`Open Trivia DB answered code ${res.response_code}`);
    }
  }
  throw new Error("Open Trivia DB is busy, try again in a few seconds");
}

interface Queue {
  key: string;
  questions: Question[];
}

/** The next question for these settings: from the queue, or a new batch. */
export async function nextQuestion(s: Settings, signal?: AbortSignal): Promise<Question> {
  const key = settingsKey(s);
  const queue = await load<Queue>("queue");
  let questions = queue?.key === key ? queue.questions : [];
  if (!questions.length) questions = await fetchQuestions(s, signal);
  const [first, ...rest] = questions;
  if (!first) throw new NoQuestions("No questions for these settings");
  await save("queue", { key, questions: rest });
  return first;
}

export interface Game {
  question: Question;
  /** The answer picked, once it is. */
  choice?: string;
}

/** The question on screen, if it still fits the settings. */
export async function currentGame(s: Settings): Promise<Game | undefined> {
  const game = await load<Game>("game");
  if (!game?.question) return undefined;
  // A question already answered stays until "Next Question", whatever changed.
  if (game.choice !== undefined || matches(game.question, s)) return game;
  return undefined;
}

export async function setGame(game: Game | undefined): Promise<void> {
  if (game) await save("game", game);
  else await storage.delete("game").catch(() => {});
}

export async function stats(): Promise<Stats> {
  return { ...emptyStats(), ...await load<Stats>("stats") };
}

export async function saveStats(s: Stats): Promise<void> {
  await save("stats", s);
}

export async function resetStats(): Promise<void> {
  await save("stats", emptyStats());
}

export interface Choices {
  category: number;
  kind: Settings["kind"];
}

export async function choices(): Promise<Choices> {
  return { category: 0, kind: "any", ...await load<Choices>("choices") };
}

export async function saveChoices(c: Choices): Promise<void> {
  await save("choices", c);
}
