// The library in the extension's storage, seeded with the starter prompts the first time.

import { storage } from "@backslash/api";
import { type Prompt, starterPrompts } from "./lib.ts";

type Json = Parameters<typeof storage.set>[1];

const KEY = "prompts";
const SEEDED = "seeded";

export async function loadPrompts(): Promise<Prompt[]> {
  const saved = await storage.get(KEY) as unknown as Prompt[] | undefined;
  if (Array.isArray(saved)) return saved;
  if (await storage.get<boolean>(SEEDED)) return [];
  const starters = starterPrompts(Date.now());
  await savePrompts(starters);
  await storage.set(SEEDED, true);
  return starters;
}

export async function savePrompts(prompts: Prompt[]): Promise<void> {
  await storage.set(KEY, prompts as unknown as Json);
}

/** Loads, changes one prompt (or removes it when `fn` returns null), saves. */
export async function updatePrompt(id: string, fn: (p: Prompt) => Prompt | null): Promise<Prompt | null> {
  const prompts = await loadPrompts();
  const i = prompts.findIndex((p) => p.id === id);
  if (i === -1) throw new Error("This prompt no longer exists");
  const next = fn(prompts[i]);
  if (next) prompts[i] = next;
  else prompts.splice(i, 1);
  await savePrompts(prompts);
  return next;
}

export async function addPrompt(prompt: Prompt): Promise<void> {
  await savePrompts([...await loadPrompts(), prompt]);
}

/** Counts a use, so the most used prompts come first. */
export async function recordUse(id: string): Promise<void> {
  await updatePrompt(id, (p) => ({ ...p, uses: p.uses + 1, lastUsed: Date.now() })).catch(() => {});
}
