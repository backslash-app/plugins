import { type Action, copy, Icons, type Item, list, meta, type Metadata } from "@backslash/api";
import {
  bounds,
  boundsInWords,
  boundsShort,
  bump,
  BUMPS,
  compare,
  compareReason,
  compareSentence,
  desugared,
  type Dialect,
  DIALECT_TITLE,
  difference,
  EXAMPLES,
  format,
  isPrerelease,
  maxSatisfying,
  parseQuery,
  parseRange,
  parts,
  type Range,
  satisfies,
  sortVersions,
  type Version,
} from "../lib.ts";

const SYNTAX = [
  "## What you can type",
  "",
  "- A range, then versions to check: `^1.2.3 1.4.0 2.0.0`, or `1.4.0 in ^1.2`",
  "- A range alone, to explain it: `~1.2`, `>=1.0 <2 || ^3`, `1.2.3 - 2.3`",
  "- `cargo:`, `gem:`, `pypi:` or `npm:` before a range to pick its syntax",
  "- `bump 1.2.3` (optionally a prerelease id: `bump 1.2.3 beta`)",
  "- `1.2.3 vs 1.10.0` to compare, `sort 1.10.0 1.2.0 1.9.0` to sort",
  "",
  "| Syntax | Means |",
  "|---|---|",
  "| `^1.2.3` | `>=1.2.3 <2.0.0` (npm, Cargo) |",
  "| `^0.2.3` | `>=0.2.3 <0.3.0` |",
  "| `~1.2.3` | `>=1.2.3 <1.3.0` |",
  "| `1.x`, `1.*` | `>=1.0.0 <2.0.0` |",
  "| `1.2` in Cargo | `^1.2` |",
  "| `~> 2.1` (RubyGems) | `>= 2.1, < 3` |",
  "| `~=1.4.5` (Python) | `>=1.4.5, ==1.4.*` |",
].join("\n");

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

function exampleItems(): Item[] {
  return EXAMPLES.map((e) => {
    const q = parseQuery(e.query);
    const answer = q.kind === "range"
      ? boundsShort(bounds(q.range.sets[0])) + (q.range.sets.length > 1 ? " || …" : "")
      : q.kind === "compare"
      ? compareSentence(q.a, q.b)
      : q.kind === "bump"
      ? `→ ${format(bump(q.version, "patch"))}, ${format(bump(q.version, "minor"))}…`
      : "";
    return {
      id: `example:${e.query}`,
      title: e.query,
      subtitle: e.title,
      icon: { source: Icons.lightbulb, tint: "yellow" },
      section: "Examples: type one",
      accessories: answer ? [{ text: answer }] : [],
      detail: { markdown: SYNTAX },
      actions: [copy(e.query, "Copy Example")],
    };
  });
}

function versionMetadata(v: Version): Metadata[] {
  return parts(v).map(([label, value]) => meta.text(label, value));
}

function bumpItems(v: Version, preid: string): Item[] {
  if (v.scheme !== "semver") return [];
  return BUMPS.map((b) => {
    const next = bump(v, b.kind, preid);
    const text = format(next);
    const command = `npm version ${b.kind}${preid && b.kind.startsWith("pre") ? ` --preid ${preid}` : ""}`;
    return {
      id: `bump:${b.kind}`,
      title: text,
      subtitle: `${b.title}: ${b.description}`,
      icon: {
        source: b.kind.startsWith("pre") ? Icons.flag : Icons.arrowUp,
        tint: b.kind === "major" ? "red" : b.kind === "minor" ? "orange" : b.kind === "patch" ? "green" : "purple",
      },
      section: `Bump ${format(v)}`,
      tags: [b.kind],
      detail: {
        markdown: [`## ${format(v)} → ${text}`, "", b.description, "", "```sh", command, "```"].join("\n"),
        metadata: versionMetadata(next),
      },
      actions: [copy(text, "Copy Version"), copy(command, "Copy npm Command", { icon: Icons.terminal })],
    };
  });
}

function rangeDetail(range: Range): string {
  const lines = [`## \`${range.source}\``, "", `${DIALECT_TITLE[range.dialect]} syntax.`, ""];
  range.sets.forEach((set, i) => {
    if (range.sets.length > 1) lines.push(`### Alternative ${i + 1}`, "");
    lines.push("| Term | Means | Comparators |", "|---|---|---|");
    for (const t of set) {
      lines.push(`| \`${t.source}\` | ${t.meaning} | \`${t.comparators.map((c) => c.text).join(" ") || "*"}\` |`);
    }
    lines.push("", `**${boundsInWords(bounds(set))}.**`, "");
  });
  if (range.dialect === "npm" || range.dialect === "cargo") {
    lines.push(
      "> Prereleases (`1.3.0-beta`) only match when the range names a prerelease of the same `x.y.z`.",
    );
  } else if (range.dialect === "python") {
    lines.push("> pip skips prereleases unless a specifier names one, or with `--pre`.");
  } else lines.push("> Bundler only picks prereleases when the requirement names one.");
  return lines.join("\n");
}

function rangeItems(range: Range, candidates: Version[]): Item[] {
  const items: Item[] = [];
  const allBounds = range.sets.map(bounds);
  const short = allBounds.map(boundsShort).join(" || ");
  const words = allBounds.map(boundsInWords).join("; or ");
  const sets = range.sets.map((s) => s.map((t) => t.meaning).join(", ")).join(" — or — ");
  const actions: Action[] = [
    copy(desugared(range), "Copy as Comparators"),
    copy(words, "Copy Explanation", { icon: Icons.text, shortcut: "<Ctrl><Shift>e" }),
    copy(range.source, "Copy Range", { icon: Icons.copy }),
  ];
  items.push({
    id: "range",
    title: words,
    subtitle: short,
    icon: { source: allBounds.every((b) => b.empty) ? Icons.cross : Icons.filter, tint: "blue" },
    section: `${DIALECT_TITLE[range.dialect]} range`,
    keywords: [sets],
    detail: {
      markdown: rangeDetail(range),
      metadata: [
        meta.tags("Syntax", [{ text: DIALECT_TITLE[range.dialect], color: "blue" }]),
        ...allBounds.flatMap((b, i) => [
          ...(allBounds.length > 1 ? [meta.text(`Alternative ${i + 1}`, boundsShort(b))] : []),
          meta.text(
            "Minimum",
            b.lower ? `${b.lower.text}${b.lower.inclusive ? " (included)" : " (excluded)"}` : "None",
            {
              icon: Icons.arrowDown,
            },
          ),
          meta.text(
            "Maximum",
            b.upper ? `${b.upper.text}${b.upper.inclusive ? " (included)" : " (excluded)"}` : "None",
            {
              icon: Icons.arrowUp,
            },
          ),
          ...(b.excluded.length ? [meta.text("Excluded", b.excluded.join(", "), { icon: Icons.minus })] : []),
        ]),
        meta.separator(),
        meta.text("Comparators", desugared(range)),
      ],
    },
    actions,
  });

  // A bare version means something else in npm (exact) and Cargo (caret).
  if (range.dialect === "npm" && /^\s*v?\d+\.\d+\.\d+\s*$/.test(range.source)) {
    const cargo = parseRange(range.source, "cargo");
    items.push({
      id: "cargo",
      title: boundsInWords(bounds(cargo.sets[0])),
      subtitle: `In Cargo.toml, "${range.source.trim()}" means ^${range.source.trim()}`,
      icon: { source: Icons.info, tint: "orange" },
      section: `${DIALECT_TITLE[range.dialect]} range`,
      detail: { markdown: rangeDetail(cargo) },
      actions: [copy(desugared(cargo), "Copy as Comparators")],
    });
  }

  if (candidates.length) {
    const best = maxSatisfying(candidates, range);
    for (const c of sortVersions(candidates).reverse()) {
      const verdict = satisfies(c, range);
      const isBest = best !== undefined && compare(best, c) === 0 && best.raw === c.raw;
      items.push({
        id: `candidate:${c.raw}`,
        title: format(c),
        subtitle: verdict.ok ? `Satisfies ${range.source}` : verdict.reason,
        icon: { source: verdict.ok ? Icons.check : Icons.cross, tint: verdict.ok ? "green" : "red" },
        section: candidates.length > 1
          ? `Versions · ${best ? `highest match ${format(best)}` : "none matches"}`
          : "Version",
        accessories: [
          ...(isBest && candidates.length > 1 ? [{ tag: "Highest match", color: "green" as const }] : []),
          ...(isPrerelease(c) ? [{ tag: "prerelease", color: "purple" as const }] : []),
          { tag: verdict.ok ? "Yes" : "No", color: verdict.ok ? "green" as const : "red" as const },
        ],
        detail: {
          markdown: [
            `## ${format(c)} ${verdict.ok ? "satisfies" : "doesn't satisfy"} \`${range.source}\``,
            "",
            `It ${/^(is|doesn't|matches) /.test(verdict.reason) ? "" : "is "}${verdict.reason}.`,
            "",
            `\`${range.source}\` → ${words}.`,
          ].join("\n"),
          metadata: [...versionMetadata(c), meta.separator(), meta.text("Range", short)],
        },
        actions: [
          copy(format(c), "Copy Version"),
          copy(`${format(c)} ${verdict.ok ? "satisfies" : "does not satisfy"} ${range.source}`, "Copy Answer", {
            icon: Icons.text,
          }),
          ...actions.slice(0, 2),
        ],
      });
    }
  }
  return items;
}

function versionItems(v: Version, dialect?: Dialect): Item[] {
  const text = format(v);
  const items: Item[] = [{
    id: "version",
    title: text,
    subtitle: `${v.scheme === "semver" ? "Semantic version" : v.scheme === "ruby" ? "Gem version" : "Python version"}${
      isPrerelease(v) ? " · prerelease" : ""
    }`,
    icon: { source: Icons.tag, tint: "blue" },
    section: "Version",
    accessories: v.build.length ? [{ tag: `+${v.build.join(".")}` }] : [],
    detail: {
      markdown: [
        `## ${text}`,
        "",
        v.raw !== text ? `Written \`${v.raw}\`, read as \`${text}\`.` : "",
        isPrerelease(v) ? "A prerelease: it sorts before the final release and most ranges skip it." : "",
      ].filter(Boolean).join("\n\n"),
      metadata: versionMetadata(v),
    },
    actions: [copy(text, "Copy Version")],
  }];
  items.push(...bumpItems(v, ""));
  if (v.scheme === "semver" && !dialect) {
    for (const r of [`^${text}`, `~${text}`, `>=${text}`]) {
      const range = parseRange(r, "npm");
      const b = bounds(range.sets[0]);
      items.push({
        id: `as:${r}`,
        title: r,
        subtitle: range.sets[0][0].meaning,
        icon: { source: Icons.filter, tint: "teal" },
        section: "As a Range",
        accessories: [{ text: boundsShort(b) }],
        detail: { markdown: rangeDetail(range) },
        actions: [copy(r, "Copy Range"), copy(desugared(range), "Copy as Comparators")],
      });
    }
  }
  return items;
}

function compareItems(a: Version, b: Version): Item[] {
  const sentence = compareSentence(a, b);
  const d = compare(a, b);
  const newer = d < 0 ? b : a;
  return [
    {
      id: "compare",
      title: sentence,
      subtitle: compareReason(a, b),
      icon: { source: d === 0 ? Icons.check : Icons.arrowUp, tint: d === 0 ? "green" : "blue" },
      section: "Comparison",
      accessories: [{ tag: difference(a, b), color: "purple" }],
      detail: {
        markdown: [
          `## ${sentence}`,
          "",
          d === 0 ? "They have the same precedence." : `**${format(newer)}** is newer: ${compareReason(a, b)}.`,
          "",
          "Versions compare number by number (`1.10.0` > `1.9.0`), a prerelease comes before its release, and build metadata (`+…`) is ignored.",
        ].join("\n"),
        metadata: [
          meta.text("Newer", d === 0 ? "Same" : format(newer), { icon: Icons.arrowUp }),
          meta.text("Difference", difference(a, b)),
        ],
      },
      actions: [copy(sentence, "Copy Comparison"), copy(format(newer), "Copy Newer Version")],
    },
    ...[a, b].map((v, i): Item => ({
      id: `side:${i}`,
      title: format(v),
      subtitle: i === 0 ? "First" : "Second",
      icon: { source: Icons.tag, tint: compare(v, newer) === 0 && d !== 0 ? "green" : "gray" },
      section: "Versions",
      detail: { markdown: `## ${format(v)}`, metadata: versionMetadata(v) },
      actions: [copy(format(v), "Copy Version")],
    })),
  ];
}

function sortItems(versions: Version[]): Item[] {
  const sorted = sortVersions(versions);
  const asc = sorted.map(format).join("\n");
  const desc = [...sorted].reverse().map(format).join("\n");
  return sorted.map((v, i) => ({
    id: `sorted:${i}:${v.raw}`,
    title: format(v),
    subtitle: i === sorted.length - 1 ? "Newest" : i === 0 ? "Oldest" : undefined,
    icon: { source: Icons.tag, tint: i === sorted.length - 1 ? "green" : "gray" },
    section: `Sorted · ${plural(sorted.length, "version")}, oldest first`,
    accessories: [
      { text: String(i + 1) },
      ...(isPrerelease(v) ? [{ tag: "prerelease", color: "purple" as const }] : []),
    ],
    detail: { markdown: ["```", asc, "```"].join("\n"), metadata: versionMetadata(v) },
    actions: [
      copy(asc, "Copy Sorted List"),
      copy(desc, "Copy Newest First", { icon: Icons.arrowDown }),
      copy(format(v), "Copy Version", { shortcut: "<Ctrl><Shift>c" }),
    ],
  }));
}

export default list({
  placeholder: "^1.2.3 1.4.0 · ~> 2.1 · ~=1.4.5 · bump 1.2.3 · 1.2.3 vs 1.10.0",
  empty: { title: "Nothing to show", icon: Icons.tag },
  status: (items) => {
    const first = items[0];
    if (!first) return "";
    if (first.id === "error") return "Not a version or range";
    if (first.id?.startsWith("example:")) return "npm · Cargo · RubyGems · Python";
    const checked = items.filter((i) => i.id?.startsWith("candidate:"));
    if (checked.length) {
      const yes = checked.filter((i) => i.accessories?.some((a) => a.tag === "Yes")).length;
      return `${yes} of ${checked.length} satisfy the range`;
    }
    if (first.id?.startsWith("sorted:")) return `${plural(items.length, "version")}, oldest first`;
    if (first.id?.startsWith("bump:")) return first.section ?? "";
    return String(first.subtitle ?? "");
  },
  search(query) {
    const q = parseQuery(query);
    switch (q.kind) {
      case "empty":
        return exampleItems();
      case "version":
        return versionItems(q.version, q.dialect);
      case "bump":
        return [...bumpItems(q.version, q.preid), ...versionItems(q.version).slice(0, 1)];
      case "compare":
        return compareItems(q.a, q.b);
      case "sort":
        return sortItems(q.versions);
      case "range":
        return rangeItems(q.range, q.candidates);
      case "error":
        return [{
          id: "error",
          title: q.message,
          subtitle: "Not a version or range",
          icon: { source: Icons.alert, tint: "red" },
          detail: { markdown: SYNTAX },
          actions: [copy(query, "Copy Input")],
        }, ...exampleItems()];
    }
  },
});
