// Prompts, their {{variables}}, import/export and the starter library. Pure, tested in lib_test.ts.

export interface Prompt {
  id: string;
  title: string;
  body: string;
  tags: string[];
  pinned: boolean;
  /** Unix milliseconds. */
  created: number;
  updated: number;
  /** Times it was pasted or copied. */
  uses: number;
  lastUsed?: number;
}

// ---------------------------------------------------------------------------
// Variables

/** Placeholders filled by the extension itself rather than asked. */
export const BUILTINS = ["clipboard", "date", "time", "datetime", "weekday"] as const;
export type Builtin = typeof BUILTINS[number];

export interface Variable {
  /** As written, trimmed: `language`, `target language`. */
  name: string;
  /** For the form: "Target language". */
  label: string;
  /** `{{tone|friendly}}` → "friendly". */
  default?: string;
  /** Alone on its line in the prompt: probably a block of text or code, asked in a text area. */
  multiline: boolean;
  builtin?: Builtin;
}

/** `{{ name }}` or `{{ name | default }}`; names are letters, digits, spaces, `_`, `-` and `.`. */
const PLACEHOLDER = /\{\{\s*([\p{L}\p{N}_.-][\p{L}\p{N}_. -]*?)\s*(?:\|([^}]*))?\}\}/gu;

const isBuiltin = (name: string): name is Builtin => (BUILTINS as readonly string[]).includes(name.toLowerCase());

/** "target_language" → "Target language". */
export function labelOf(name: string): string {
  const words = name.replace(/[_.-]+/g, " ").replace(/\s+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** The placeholders of a prompt, in order of appearance, each once (case-insensitive). */
export function variables(body: string): Variable[] {
  const seen = new Map<string, Variable>();
  for (const line of body.split("\n")) {
    for (const m of line.matchAll(PLACEHOLDER)) {
      const name = m[1].trim();
      const key = name.toLowerCase();
      const alone = line.trim() === m[0].trim();
      const known = seen.get(key);
      if (known) {
        known.multiline ||= alone;
        if (known.default === undefined && m[2] !== undefined) known.default = m[2].trim();
        continue;
      }
      seen.set(key, {
        name,
        label: labelOf(name),
        default: m[2] !== undefined ? m[2].trim() : undefined,
        multiline: alone,
        builtin: isBuiltin(name) ? (key as Builtin) : undefined,
      });
    }
  }
  return [...seen.values()];
}

/** The variables the user is asked for. */
export const askedVariables = (body: string) => variables(body).filter((v) => !v.builtin);

export const usesClipboard = (body: string) => variables(body).some((v) => v.builtin === "clipboard");

/** A form field id for a variable: stable, safe. */
export const fieldId = (name: string) => `v_${name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "_")}`;

const pad = (n: number) => String(n).padStart(2, "0");

/** The values of the built-in placeholders at `now` (local time). */
export function builtinValues(now: Date, clipboard = ""): Record<Builtin, string> {
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
  return {
    clipboard,
    date,
    time,
    datetime: `${date} ${time}`,
    weekday: now.toLocaleDateString("en", { weekday: "long" }),
  };
}

/**
 * Replaces every placeholder: asked ones from `values` (keyed by name,
 * case-insensitive), falling back to their default, built-ins from `builtins`.
 * An empty value leaves nothing behind.
 */
export function fill(body: string, values: Record<string, string>, builtins: Partial<Record<Builtin, string>>): string {
  const byKey = new Map(Object.entries(values).map(([k, v]) => [k.toLowerCase(), v]));
  const defaults = new Map(variables(body).map((v) => [v.name.toLowerCase(), v.default ?? ""]));
  return body.replace(PLACEHOLDER, (_m, rawName: string) => {
    const key = rawName.trim().toLowerCase();
    if (isBuiltin(key)) return builtins[key as Builtin] ?? "";
    const given = byKey.get(key);
    return given !== undefined && given !== "" ? given : defaults.get(key) ?? "";
  });
}

// ---------------------------------------------------------------------------
// The library

/** "code, Review ,code" → ["code", "review"]. */
export function parseTags(text: string): string[] {
  const tags = text.split(/[,\n]/).map((t) => t.trim().toLowerCase().replace(/^#/, "")).filter(Boolean);
  return [...new Set(tags)].slice(0, 12);
}

export const newId = (): string => crypto.randomUUID();

/** Pinned first, then the most recently used, then by title. */
export function sortPrompts(prompts: Prompt[]): Prompt[] {
  return [...prompts].sort((a, b) =>
    Number(b.pinned) - Number(a.pinned) || (b.lastUsed ?? 0) - (a.lastUsed ?? 0) ||
    a.title.localeCompare(b.title)
  );
}

/** The first meaningful line, for the row's subtitle. */
export function excerpt(body: string, max = 80): string {
  const line = body.split("\n").map((l) => l.trim()).find((l) => l && !/^[-=#`*]+$/.test(l)) ?? "";
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line;
}

/** "Review (copy)", then "Review (copy 2)"… */
export function copyTitle(title: string, taken: string[]): string {
  const base = title.replace(/ \(copy(?: \d+)?\)$/, "");
  const names = new Set(taken.map((t) => t.toLowerCase()));
  let candidate = `${base} (copy)`;
  for (let n = 2; names.has(candidate.toLowerCase()); n++) candidate = `${base} (copy ${n})`;
  return candidate;
}

export function makePrompt(
  draft: { title: string; body: string; tags?: string[]; pinned?: boolean },
  now: number,
  id = newId(),
): Prompt {
  return {
    id,
    title: draft.title.trim(),
    body: draft.body.replace(/\s+$/, ""),
    tags: draft.tags ?? [],
    pinned: draft.pinned ?? false,
    created: now,
    updated: now,
    uses: 0,
  };
}

/** Checks a prompt typed in the form; returns a sentence when something is wrong. */
export function validate(title: string, body: string): string | undefined {
  if (!title.trim()) return "Give the prompt a title";
  if (!body.trim()) return "The prompt is empty";
  const open = (body.match(/\{\{/g) ?? []).length;
  const closed = (body.match(/\}\}/g) ?? []).length;
  if (open !== closed) return "A {{variable}} is not closed: check the braces";
  return undefined;
}

// ---------------------------------------------------------------------------
// Import and export

export const EXPORT_FORMAT = "backslash-prompts";

export interface ExportFile {
  format: typeof EXPORT_FORMAT;
  version: 1;
  prompts: { title: string; body: string; tags: string[]; pinned: boolean }[];
}

export function exportJson(prompts: Prompt[]): string {
  const file: ExportFile = {
    format: EXPORT_FORMAT,
    version: 1,
    prompts: sortPrompts(prompts).map((p) => ({ title: p.title, body: p.body, tags: p.tags, pinned: p.pinned })),
  };
  return JSON.stringify(file, null, 2);
}

export interface Draft {
  title: string;
  body: string;
  tags: string[];
  pinned: boolean;
}

/**
 * Prompts in copied JSON: this extension's export, a bare array, or an object
 * with a `prompts` array. Entries may name the text `body`, `prompt`, `text`
 * or `content`, and the title `title` or `name`.
 */
export function parseImport(text: string): Draft[] {
  let data: unknown;
  try {
    data = JSON.parse(text.trim());
  } catch {
    throw new Error("The clipboard doesn't hold JSON: copy an exported prompt library first");
  }
  const entries = Array.isArray(data)
    ? data
    : data && typeof data === "object" && Array.isArray((data as { prompts?: unknown }).prompts)
    ? (data as { prompts: unknown[] }).prompts
    : undefined;
  if (!entries) throw new Error("No prompts in the copied JSON: expected a list of prompts");
  const drafts: Draft[] = [];
  for (const e of entries) {
    if (!e || typeof e !== "object") continue;
    const o = e as Record<string, unknown>;
    const body = [o.body, o.prompt, o.text, o.content].find((v) => typeof v === "string" && v.trim()) as
      | string
      | undefined;
    const title = [o.title, o.name].find((v) => typeof v === "string" && v.trim()) as string | undefined;
    if (!body) continue;
    const tags = Array.isArray(o.tags)
      ? parseTags(o.tags.filter((t) => typeof t === "string").join(","))
      : typeof o.tags === "string"
      ? parseTags(o.tags)
      : [];
    drafts.push({
      title: (title ?? excerpt(body, 50)).trim(),
      body: body.replace(/\s+$/, ""),
      tags,
      pinned: !!o.pinned,
    });
  }
  if (!drafts.length) throw new Error("None of the copied entries has a prompt text");
  return drafts;
}

/**
 * Adds imported prompts: an identical one (same title and text) is skipped, one
 * with the same title gets the imported text, the others are added.
 */
export function mergeImport(
  existing: Prompt[],
  drafts: Draft[],
  now: number,
): { prompts: Prompt[]; added: number; updated: number; skipped: number } {
  const prompts = existing.map((p) => ({ ...p }));
  let added = 0, updated = 0, skipped = 0;
  for (const d of drafts) {
    const same = prompts.find((p) => p.title.toLowerCase() === d.title.toLowerCase());
    if (same && same.body === d.body) skipped++;
    else if (same) {
      same.body = d.body;
      same.tags = d.tags.length ? d.tags : same.tags;
      same.updated = now;
      updated++;
    } else {
      prompts.push(makePrompt(d, now));
      added++;
    }
  }
  return { prompts, added, updated, skipped };
}

// ---------------------------------------------------------------------------
// Starter prompts, added the first time the library opens

export const STARTERS: { title: string; tags: string[]; body: string }[] = [
  {
    title: "Code Review",
    tags: ["code"],
    body:
      `Review the following code as a senior engineer. Point out bugs, security issues, unclear names and missing edge cases, ordered by severity. For each, quote the line, explain the problem in one sentence and suggest a fix. End with what is good about it.

{{code}}`,
  },
  {
    title: "Commit Message from Diff",
    tags: ["code", "git"],
    body:
      `Write a commit message for this diff, following Conventional Commits (feat, fix, refactor, docs, test, chore…). A subject line under 72 characters in the imperative mood, a blank line, then a short body explaining why the change was made, wrapped at 72 characters. No markdown.

{{diff}}`,
  },
  {
    title: "Explain This Error",
    tags: ["code", "debug"],
    body: `I get this error while {{doing what|running my program}}:

{{error}}

Explain what it means in plain words, list the most likely causes from most to least likely, and give the steps to fix each. If you need more information, tell me exactly which command to run or which file to show.`,
  },
  {
    title: "Explain Code",
    tags: ["code", "learning"],
    body:
      `Explain what this code does, step by step, for someone who knows programming but not this codebase. Start with a one-sentence summary, then walk through the important parts, and finish with anything surprising or risky.

{{code}}`,
  },
  {
    title: "Write Unit Tests",
    tags: ["code", "test"],
    body:
      `Write unit tests for the code below using {{framework|the usual test framework for this language}}. Cover the normal cases, edge cases (empty input, limits, invalid values) and error paths. Use descriptive test names and no mocks unless necessary.

{{code}}`,
  },
  {
    title: "Refactor for Readability",
    tags: ["code"],
    body:
      `Refactor this code to make it easier to read and maintain without changing its behavior: clearer names, smaller functions, less nesting, no dead code. Show the new code, then list the changes in bullet points.

{{code}}`,
  },
  {
    title: "Regex from Description",
    tags: ["code"],
    body: `Write a {{flavor|JavaScript}} regular expression that matches: {{what to match}}.
Give the regex, explain each part, and show three strings it matches and three it must not match.`,
  },
  {
    title: "SQL Query",
    tags: ["code", "data"],
    body: `Write a {{dialect|PostgreSQL}} query that {{goal}}.

The tables are:
{{schema}}

Explain the query briefly and mention any index that would make it faster.`,
  },
  {
    title: "Translate",
    tags: ["writing", "language"],
    body:
      `Translate the following text into {{target language|English}}. Keep the meaning, tone and formatting (lists, line breaks, markdown). Keep names, code and URLs unchanged. Reply with the translation only.

{{clipboard}}`,
  },
  {
    title: "Summarize",
    tags: ["writing"],
    body:
      `Summarize the text below in {{length|5 bullet points}}. Keep the key facts, numbers and decisions; drop the filler. Then give a one-sentence takeaway.

{{clipboard}}`,
  },
  {
    title: "Reply to Email",
    tags: ["writing", "email"],
    body: `Write a reply to this email. Tone: {{tone|friendly and professional}}. What I want to say: {{my answer}}.
Keep it short, answer every question asked, and end with a clear next step. Sign as {{name|me}}.

Email:
{{email}}`,
  },
  {
    title: "Improve Writing",
    tags: ["writing"],
    body:
      `Rewrite this text so it is clearer and more concise, in the same language and with the same meaning. Fix grammar and spelling, prefer short sentences and active voice, and keep the author's voice. Reply with the new text only.

{{text}}`,
  },
  {
    title: "Fix Grammar and Spelling",
    tags: ["writing"],
    body:
      `Correct the spelling, grammar and punctuation of the text below without rephrasing it. Reply with the corrected text only.

{{clipboard}}`,
  },
  {
    title: "Meeting Notes to Action Items",
    tags: ["work"],
    body: `Turn these meeting notes into:
1. A three-sentence summary.
2. Decisions made.
3. Action items as a table: owner, task, due date (or "not set").
4. Open questions.

Notes from {{date}}:
{{notes}}`,
  },
  {
    title: "Pull Request Description",
    tags: ["code", "git"],
    body:
      `Write a pull request description for these changes: a title, a "Why" paragraph, a "What changed" bullet list, and a "How to test" checklist. Be concrete and brief.

{{changes}}`,
  },
  {
    title: "Bug Report",
    tags: ["work", "debug"],
    body:
      `Turn this into a clear bug report with: a one-line title, steps to reproduce, expected behavior, actual behavior, environment, and a severity guess (low, medium, high, critical) with a reason.

{{description}}`,
  },
  {
    title: "Shell Command",
    tags: ["code", "linux"],
    body:
      `Give me a single {{shell|bash}} command for Linux that {{task}}. Explain each flag on its own line. Warn me if the command deletes or overwrites anything.`,
  },
  {
    title: "Brainstorm Ideas",
    tags: ["thinking"],
    body:
      `Give me {{count|10}} varied ideas for {{topic}}. Mix safe and bold ones. For each: a short name, one sentence describing it, and its biggest risk. Then tell me which two you would pick and why.`,
  },
  {
    title: "Explain Like I'm New",
    tags: ["learning"],
    body:
      `Explain {{concept}} to someone new to the subject. Start with an everyday analogy, then the real explanation in simple words, then one concrete example, and end with the three terms worth remembering.`,
  },
  {
    title: "Pros and Cons",
    tags: ["thinking"],
    body: `I need to decide: {{decision}}.
Context: {{context|none}}.
List the pros and cons of each option in a table, point out what I might be missing, and give your recommendation with the one question that would change it.`,
  },
  {
    title: "Write Documentation",
    tags: ["code", "writing"],
    body:
      `Write documentation for this code in {{format|Markdown}}: what it is for, how to install or import it, a usage example, the parameters and return values, and the errors it can raise.

{{code}}`,
  },
  {
    title: "Daily Standup",
    tags: ["work"],
    body:
      `Turn these notes into a short standup update for {{weekday}} {{date}}, in three parts: Yesterday, Today, Blockers. One line per item, no filler.

{{notes}}`,
  },
];

/** The starter library as prompts. */
export function starterPrompts(now: number): Prompt[] {
  return STARTERS.map((s) => makePrompt(s, now));
}
