// Text Diff: Myers line diff, hunks, unified patches, word diffs and stats. Pure, tested in lib_test.ts.

export type OpType = "equal" | "insert" | "delete";

export interface Op<T = string> {
  type: OpType;
  /** The token itself: from `a` for equal and delete, from `b` for insert. */
  value: T;
  /** 0-based index in `a` (equal, delete). */
  ai?: number;
  /** 0-based index in `b` (equal, insert). */
  bi?: number;
}

/** Beyond this many differences, the middle is shown as one replacement (keeps huge diffs fast). */
export const MAX_EDIT_DISTANCE = 2000;

/**
 * Myers' O(ND) diff of two sequences. Common prefix and suffix are trimmed first.
 * Deletions come before insertions within a change.
 */
export function diff<T>(a: T[], b: T[], eq: (x: T, y: T) => boolean = (x, y) => x === y): Op<T>[] {
  let start = 0;
  while (start < a.length && start < b.length && eq(a[start], b[start])) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && eq(a[endA - 1], b[endB - 1])) endA--, endB--;

  const head: Op<T>[] = [];
  for (let i = 0; i < start; i++) head.push({ type: "equal", value: a[i], ai: i, bi: i });
  const tail: Op<T>[] = [];
  for (let i = endA, j = endB; i < a.length; i++, j++) tail.push({ type: "equal", value: a[i], ai: i, bi: j });

  const A = a.slice(start, endA);
  const B = b.slice(start, endB);
  const n = A.length;
  const m = B.length;
  const middle: Op<T>[] = [];
  const del = (i: number) => middle.push({ type: "delete", value: A[i], ai: start + i });
  const ins = (j: number) => middle.push({ type: "insert", value: B[j], bi: start + j });

  if (n === 0 || m === 0) {
    for (let i = 0; i < n; i++) del(i);
    for (let j = 0; j < m; j++) ins(j);
    return [...head, ...middle, ...tail];
  }

  const max = Math.min(n + m, MAX_EDIT_DISTANCE);
  const offset = max + 1;
  const v = new Int32Array(2 * max + 3);
  const trace: Int32Array[] = [];
  let found = -1;
  for (let d = 0; d <= max && found < 0; d++) {
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1])
        ? v[offset + k + 1]
        : v[offset + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && eq(A[x], B[y])) x++, y++;
      v[offset + k] = x;
      if (x >= n && y >= m) {
        found = d;
        break;
      }
    }
  }

  if (found < 0) {
    // Too different: one big replacement.
    for (let i = 0; i < n; i++) del(i);
    for (let j = 0; j < m; j++) ins(j);
    return [...head, ...middle, ...tail];
  }

  // Walk the trace back from (n, m).
  const rev: Op<T>[] = [];
  let x = n;
  let y = m;
  for (let d = found; d > 0; d--) {
    const vd = trace[d];
    const k = x - y;
    const prevK = k === -d || (k !== d && vd[offset + k - 1] < vd[offset + k + 1]) ? k + 1 : k - 1;
    const prevX = vd[offset + prevK];
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      x--, y--;
      rev.push({ type: "equal", value: A[x], ai: start + x, bi: start + y });
    }
    if (x === prevX) {
      y--;
      rev.push({ type: "insert", value: B[y], bi: start + y });
    } else {
      x--;
      rev.push({ type: "delete", value: A[x], ai: start + x });
    }
  }
  while (x > 0 && y > 0) {
    x--, y--;
    rev.push({ type: "equal", value: A[x], ai: start + x, bi: start + y });
  }
  rev.reverse();
  return [...head, ...normalize(rev), ...tail];
}

/** Within each run of changes, deletions first, then insertions. */
function normalize<T>(ops: Op<T>[]): Op<T>[] {
  const out: Op<T>[] = [];
  let dels: Op<T>[] = [];
  let inss: Op<T>[] = [];
  const flush = () => {
    out.push(...dels, ...inss);
    dels = [];
    inss = [];
  };
  for (const op of ops) {
    if (op.type === "delete") dels.push(op);
    else if (op.type === "insert") inss.push(op);
    else {
      flush();
      out.push(op);
    }
  }
  flush();
  return out;
}

// ---------------------------------------------------------------------------
// Lines

export interface Text {
  lines: string[];
  /** Whether the text ends with a line break. */
  finalNewline: boolean;
}

export function splitLines(text: string): Text {
  const normalized = text.replace(/\r\n?/g, "\n");
  if (normalized === "") return { lines: [], finalNewline: false };
  const finalNewline = normalized.endsWith("\n");
  const lines = (finalNewline ? normalized.slice(0, -1) : normalized).split("\n");
  return { lines, finalNewline };
}

export interface Options {
  ignoreWhitespace?: boolean;
  ignoreCase?: boolean;
}

/** The form a line is compared in. */
export function comparable(line: string, o: Options): string {
  let s = line;
  if (o.ignoreWhitespace) s = s.replace(/\s+/g, " ").trim();
  if (o.ignoreCase) s = s.toLowerCase();
  return s;
}

export function diffLines(a: string, b: string, o: Options = {}): Op<string>[] {
  const A = splitLines(a).lines;
  const B = splitLines(b).lines;
  const ka = A.map((l) => comparable(l, o));
  const kb = B.map((l) => comparable(l, o));
  // Diff the comparable keys, report the original lines.
  const ops = diff(ka.map((_, i) => i), kb.map((_, i) => i), (x, y) => ka[x] === kb[y]);
  return ops.map((op) => ({
    type: op.type,
    value: op.type === "insert" ? B[op.bi!] : A[op.ai!],
    ai: op.ai,
    bi: op.bi,
  }));
}

// ---------------------------------------------------------------------------
// Stats

export interface Stats {
  /** Lines only in the second text. */
  added: number;
  /** Lines only in the first text. */
  removed: number;
  /** Lines replaced by another (paired within a change). */
  changed: number;
  unchanged: number;
  /** 0 to 1. */
  similarity: number;
}

export function stats(ops: Op[]): Stats {
  let added = 0;
  let removed = 0;
  let changed = 0;
  let unchanged = 0;
  let dels = 0;
  let inss = 0;
  const flush = () => {
    const pairs = Math.min(dels, inss);
    changed += pairs;
    removed += dels - pairs;
    added += inss - pairs;
    dels = inss = 0;
  };
  for (const op of ops) {
    if (op.type === "delete") dels++;
    else if (op.type === "insert") inss++;
    else {
      flush();
      unchanged++;
    }
  }
  flush();
  const total = ops.filter((o) => o.type !== "insert").length + ops.filter((o) => o.type !== "delete").length;
  return { added, removed, changed, unchanged, similarity: total ? (2 * unchanged) / total : 1 };
}

// ---------------------------------------------------------------------------
// Hunks and patches

export interface Hunk {
  /** 1-based first line in `a` (0 when the hunk adds to an empty range). */
  aStart: number;
  aLines: number;
  bStart: number;
  bLines: number;
  ops: Op[];
}

export function hunks(ops: Op[], context = 3): Hunk[] {
  const changes = ops.map((o, i) => (o.type === "equal" ? -1 : i)).filter((i) => i >= 0);
  if (!changes.length) return [];
  // Group changes whose context overlaps.
  const groups: [number, number][] = [];
  for (const i of changes) {
    const last = groups[groups.length - 1];
    if (last && i - last[1] <= 2 * context + 1) last[1] = i;
    else groups.push([i, i]);
  }
  return groups.map(([first, last]) => {
    const from = Math.max(0, first - context);
    const to = Math.min(ops.length - 1, last + context);
    const slice = ops.slice(from, to + 1);
    // Position of the hunk: lines of a and b before it.
    let aBefore = 0;
    let bBefore = 0;
    for (let i = 0; i < from; i++) {
      if (ops[i].type !== "insert") aBefore++;
      if (ops[i].type !== "delete") bBefore++;
    }
    const aLines = slice.filter((o) => o.type !== "insert").length;
    const bLines = slice.filter((o) => o.type !== "delete").length;
    return {
      aStart: aLines ? aBefore + 1 : aBefore,
      aLines,
      bStart: bLines ? bBefore + 1 : bBefore,
      bLines,
      ops: slice,
    };
  });
}

const range = (start: number, count: number) => (count === 1 ? `${start}` : `${start},${count}`);

export const hunkHeader = (h: Hunk) => `@@ -${range(h.aStart, h.aLines)} +${range(h.bStart, h.bLines)} @@`;

/** A unified diff, as `diff -u` and `git apply` read it. Empty when the texts are equal. */
export function unifiedPatch(
  a: string,
  b: string,
  labels: [string, string] = ["a", "b"],
  o: Options & { context?: number } = {},
): string {
  const ta = splitLines(a);
  const tb = splitLines(b);
  const ops = diffLines(a, b, o);
  const lastA = ta.lines.length - 1;
  const lastB = tb.lines.length - 1;
  const last = ops[ops.length - 1];
  if (ta.finalNewline !== tb.finalNewline && !o.ignoreWhitespace && last?.type === "equal") {
    // Same last line, but only one ends with a line break: that line changed.
    ops.splice(ops.length - 1, 1, { type: "delete", value: last.value, ai: last.ai }, {
      type: "insert",
      value: tb.lines[lastB],
      bi: last.bi,
    });
  }
  const hs = hunks(ops, o.context ?? 3);
  if (!hs.length) return "";
  const out = [`--- ${labels[0]}`, `+++ ${labels[1]}`];
  for (const h of hs) {
    out.push(hunkHeader(h));
    for (const op of h.ops) {
      out.push((op.type === "equal" ? " " : op.type === "delete" ? "-" : "+") + op.value);
      const endsA = op.type !== "insert" && op.ai === lastA && !ta.finalNewline;
      const endsB = op.type !== "delete" && op.bi === lastB && !tb.finalNewline;
      if (endsA || endsB) out.push("\\ No newline at end of file");
    }
  }
  return out.join("\n") + "\n";
}

/** The hunks as a ```diff block body (no file header), cut after `maxLines`. */
export function diffBlock(ops: Op[], context = 3, maxLines = 400): { text: string; truncated: number } {
  const out: string[] = [];
  let total = 0;
  for (const h of hunks(ops, context)) {
    const lines = [
      hunkHeader(h),
      ...h.ops.map((op) => (op.type === "equal" ? " " : op.type === "delete" ? "-" : "+") + op.value),
    ];
    total += lines.length;
    for (const l of lines) if (out.length < maxLines) out.push(l);
  }
  return { text: out.join("\n"), truncated: Math.max(0, total - out.length) };
}

// ---------------------------------------------------------------------------
// Words

/** Words, runs of spaces and single punctuation marks. */
export function tokenize(line: string): string[] {
  return line.match(/\s+|[\p{L}\p{N}_]+|[^\s\p{L}\p{N}_]/gu) ?? [];
}

/** `git diff --word-diff` style: `the [-old-]{+new+} word`. */
export function wordDiff(a: string, b: string): string {
  const ops = diff(tokenize(a), tokenize(b));
  let out = "";
  let dels = "";
  let inss = "";
  const flush = () => {
    if (dels) out += `[-${dels}-]`;
    if (inss) out += `{+${inss}+}`;
    dels = inss = "";
  };
  for (let i = 0; i < ops.length; i++) {
    const op = ops[i];
    // A lone space between two changes is part of the change: fewer, longer markers.
    if (
      op.type === "equal" && /^\s+$/.test(op.value) && (dels || inss) && ops[i + 1] && ops[i + 1].type !== "equal"
    ) {
      if (dels) dels += op.value;
      if (inss) inss += op.value;
      continue;
    }
    if (op.type === "delete") dels += op.value;
    else if (op.type === "insert") inss += op.value;
    else {
      flush();
      out += op.value;
    }
  }
  flush();
  return out;
}

/** The single changed line pair, when the change is exactly one line replaced by another. */
export function singleLineChange(ops: Op[]): [string, string] | undefined {
  const changes = ops.filter((o) => o.type !== "equal");
  if (changes.length !== 2) return undefined;
  const [d, i] = changes;
  if (d.type !== "delete" || i.type !== "insert") return undefined;
  return [d.value, i.value];
}

/** Every one-for-one changed line pair (a change of n lines replaced by n lines), for word diffs. */
export function changedPairs(ops: Op[], limit = 10): [string, string][] {
  const out: [string, string][] = [];
  let dels: string[] = [];
  let inss: string[] = [];
  const flush = () => {
    if (dels.length && dels.length === inss.length) dels.forEach((d, k) => out.push([d, inss[k]]));
    dels = [];
    inss = [];
  };
  for (const op of ops) {
    if (op.type === "delete") dels.push(op.value);
    else if (op.type === "insert") inss.push(op.value);
    else flush();
  }
  flush();
  return out.slice(0, limit);
}

// ---------------------------------------------------------------------------
// Sources

export interface ClipEntry {
  id: number;
  text: string;
  /** Unix seconds. */
  time: number;
  pinned?: boolean;
}

/** Backslash's clipboard history file, most recent first (pinned entries by time too). */
export function parseHistory(json: string): ClipEntry[] {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    return [];
  }
  if (!Array.isArray(data)) return [];
  return data
    .filter((e): e is ClipEntry => e && typeof e.text === "string" && typeof e.time === "number")
    .sort((x, y) => y.time - x.time || y.id - x.id);
}

/** The two texts to compare, in order of preference: clipboard vs selection, then the last two copies. */
export function pickPair(
  clipboard: string,
  selection: string,
  history: ClipEntry[],
): { left: string; right: string; labels: [string, string] } | undefined {
  if (clipboard.trim() && selection.trim() && clipboard !== selection) {
    return { left: clipboard, right: selection, labels: ["clipboard", "selection"] };
  }
  const recent = history.filter((e) => e.text.trim());
  const latest = clipboard.trim() ? clipboard : recent[0]?.text;
  const previous = recent.find((e) => e.text !== latest);
  if (latest && previous) return { left: previous.text, right: latest, labels: ["previous copy", "latest copy"] };
  return undefined;
}

export function relativeTime(unixSeconds: number, now = Date.now()): string {
  const s = Math.max(0, Math.round(now / 1000 - unixSeconds));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  const d = Math.floor(s / 86400);
  return d === 1 ? "yesterday" : `${d} days ago`;
}

/** First non-empty line, shortened. */
export function firstLine(text: string, max = 70): string {
  const line = text.split("\n").find((l) => l.trim())?.trim() ?? "";
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

export const plural = (n: number, word: string) => `${n.toLocaleString("en")} ${word}${n === 1 ? "" : "s"}`;
