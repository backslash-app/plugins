// Reading the texts (clipboard, primary selection, Backslash's clipboard history) and the diff views.

import {
  type Action,
  action,
  clipboard,
  copy,
  detail,
  type DetailSpec,
  field,
  form,
  type FormSpec,
  Icons,
  meta,
  replace,
  type Stat,
} from "@backslash/api";
import {
  changedPairs,
  type ClipEntry,
  diffBlock,
  diffLines,
  hunks,
  type Options,
  parseHistory,
  plural,
  singleLineChange,
  splitLines,
  stats,
  unifiedPatch,
  wordDiff,
} from "./lib.ts";

export const HOME = Deno.env.get("HOME") ?? "";
/** Where Backslash keeps its clipboard history. */
export const HISTORY_FILE = `${HOME}/.local/state/backslash/clipboard.json`;

export interface Prefs {
  context?: number;
}

/** Runs a program with a timeout; undefined when it is missing or fails. */
async function output(program: string, args: string[]): Promise<string | undefined> {
  try {
    const out = await new Deno.Command(program, {
      args,
      stdin: "null",
      stdout: "piped",
      stderr: "null",
      signal: AbortSignal.timeout(2000),
    }).output();
    return out.success ? new TextDecoder().decode(out.stdout) : undefined;
  } catch {
    return undefined;
  }
}

/** The primary selection (the text selected with the mouse): Wayland first, then X11. */
export async function readSelection(): Promise<string> {
  return (await output("wl-paste", ["--primary", "--no-newline"])) ??
    (await output("xclip", ["-o", "-selection", "primary"])) ??
    (await output("xsel", ["--primary", "--output"])) ?? "";
}

export const readClipboard = () => clipboard.read().catch(() => "");

export async function readHistory(): Promise<ClipEntry[]> {
  try {
    return parseHistory(await Deno.readTextFile(HISTORY_FILE));
  } catch {
    return [];
  }
}

function describe(text: string): string {
  const { lines } = splitLines(text);
  return `${plural(lines.length, "line")}, ${plural([...text].length, "char")}`;
}

export interface Comparison {
  left: string;
  right: string;
  labels: [string, string];
  options: Options;
  context: number;
}

export function diffView(c: Comparison): DetailSpec {
  const { left, right, labels, options, context } = c;
  const ops = diffLines(left, right, options);
  const s = stats(ops);
  const patch = unifiedPatch(left, right, labels, { ...options, context });
  const hs = hunks(ops, context);
  const identical = left === right;
  const sameIgnoring = !identical && !patch;
  const single = singleLineChange(ops);
  const pairs = changedPairs(ops, 6);
  const oneLiners = !left.includes("\n") && !right.includes("\n");

  const body: string[] = [];
  if (identical) {
    body.push("## The texts are identical", "", describe(left));
  } else if (sameIgnoring) {
    const ignored = [options.ignoreWhitespace && "whitespace", options.ignoreCase && "case"].filter(Boolean);
    body.push(
      "## No difference",
      "",
      `The texts differ only in ${ignored.length ? ignored.join(" and ") : "the final line break"}.`,
    );
  } else {
    const changes = s.added + s.removed + s.changed;
    body.push(`## ${plural(changes, "line")} differ · ${Math.round(s.similarity * 100)} % similar`);
    const words = single ?? (oneLiners ? [left, right] as [string, string] : undefined);
    if (words) {
      body.push("", "**Word changes**", "", "```", wordDiff(words[0], words[1]), "```");
    }
    const block = diffBlock(ops, context);
    body.push(
      "",
      "```diff",
      `--- ${labels[0]}`,
      `+++ ${labels[1]}`,
      block.text,
      "```",
      ...(block.truncated ? ["", `_${plural(block.truncated, "more line")}: copy the patch to see everything._`] : []),
    );
    if (!words && pairs.length) {
      body.push("", "**Word changes**", "", "```", ...pairs.map(([a, b]) => wordDiff(a, b)), "```");
    }
  }

  const statCards: Stat[] = [
    { label: "Added", value: s.added, color: "green" },
    { label: "Removed", value: s.removed, color: "red" },
    { label: "Changed", value: s.changed, color: "orange" },
    { label: "Similarity", value: `${Math.round(s.similarity * 100)} %` },
  ];

  const again = (next: Partial<Comparison>) => replace(diffView({ ...c, ...next }));
  const actions: Action[] = [
    ...(patch ? [copy(patch, "Copy Unified Patch", { icon: Icons.code })] : []),
    action("Swap Sides", () => again({ left: right, right: left, labels: [labels[1], labels[0]] }), {
      icon: Icons.shuffle,
      shortcut: "<Ctrl>s",
    }),
    action(
      options.ignoreWhitespace ? "Compare Whitespace" : "Ignore Whitespace",
      () => again({ options: { ...options, ignoreWhitespace: !options.ignoreWhitespace } }),
      { icon: Icons.filter, shortcut: "<Ctrl>w", section: "Options" },
    ),
    action(
      options.ignoreCase ? "Compare Case" : "Ignore Case",
      () => again({ options: { ...options, ignoreCase: !options.ignoreCase } }),
      { icon: Icons.text, shortcut: "<Ctrl>i", section: "Options" },
    ),
    action("More Context", () => again({ context: context + 5 }), { icon: Icons.plus, section: "Options" }),
    action("Edit Texts…", () => compareForm(c), { icon: Icons.note, shortcut: "<Ctrl>e", section: "Options" }),
    ...(single || oneLiners
      ? [copy(wordDiff(...(single ?? [left, right] as [string, string])), "Copy Word Diff", { section: "Copy" })]
      : []),
    copy(left, `Copy ${cap(labels[0])}`, { section: "Copy" }),
    copy(right, `Copy ${cap(labels[1])}`, { section: "Copy" }),
  ];

  return detail({
    title: `${cap(labels[0])} → ${cap(labels[1])}`,
    markdown: body.join("\n"),
    stats: identical || sameIgnoring ? undefined : statCards,
    status: identical
      ? "Identical"
      : `${plural(hs.length, "hunk")} · ${context} lines of context${
        options.ignoreWhitespace ? " · ignoring whitespace" : ""
      }${options.ignoreCase ? " · ignoring case" : ""}`,
    metadata: [
      meta.text(cap(labels[0]), describe(left), { icon: Icons.minus, color: "red" }),
      meta.text(cap(labels[1]), describe(right), { icon: Icons.plus, color: "green" }),
      meta.separator(),
      meta.tags("Options", [
        { text: options.ignoreWhitespace ? "Whitespace ignored" : "Whitespace compared", color: "gray" },
        { text: options.ignoreCase ? "Case ignored" : "Case compared", color: "gray" },
      ]),
      meta.text("Unchanged", plural(s.unchanged, "line")),
    ],
    actions,
  });
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function compareForm(c: Partial<Comparison> & { context: number }): FormSpec {
  return form({
    title: "Compare Texts",
    submitTitle: "Compare",
    fields: [
      field.textArea("left", "Original", { value: c.left ?? "", placeholder: "The text before" }),
      field.textArea("right", "Changed", { value: c.right ?? "", placeholder: "The text after" }),
      field.checkbox("ignoreWhitespace", "Ignore whitespace", { value: c.options?.ignoreWhitespace ?? false }),
      field.checkbox("ignoreCase", "Ignore case", { value: c.options?.ignoreCase ?? false }),
    ],
    submit: (v) => {
      const left = String(v.left ?? "");
      const right = String(v.right ?? "");
      if (!left && !right) throw new Error("Type or paste the two texts to compare");
      return diffView({
        left,
        right,
        labels: ["original", "changed"],
        options: { ignoreWhitespace: v.ignoreWhitespace === true, ignoreCase: v.ignoreCase === true },
        context: c.context,
      });
    },
  });
}

export function contextOf(prefs: Prefs): number {
  const n = Number(prefs.context ?? 3);
  return Number.isFinite(n) ? Math.max(0, Math.min(50, Math.round(n))) : 3;
}
