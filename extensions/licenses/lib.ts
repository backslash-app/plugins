// Pure logic of the Licenses extension: categories, rules, filling the texts in, comparing.

import type { Color } from "@backslash/api";

export type RuleKind = "permissions" | "conditions" | "limitations";

export interface License {
  /** choosealicense.com key, e.g. "apache-2.0". */
  key: string;
  /** As choosealicense.com writes it (GNU licenses without -only / -or-later). */
  spdx: string;
  title: string;
  nickname?: string;
  featured: boolean;
  description: string;
  how: string;
  note?: string;
  /** Well-known projects using it: name → URL of their license file. */
  using: Record<string, string>;
  permissions: string[];
  conditions: string[];
  limitations: string[];
}

export interface Rule {
  tag: string;
  label: string;
  description: string;
}

/** choosealicense.com's _data/rules.yml. */
export const RULES: Record<RuleKind, Rule[]> = {
  permissions: [
    {
      tag: "commercial-use",
      label: "Commercial use",
      description: "The licensed material and derivatives may be used for commercial purposes.",
    },
    { tag: "modifications", label: "Modification", description: "The licensed material may be modified." },
    { tag: "distribution", label: "Distribution", description: "The licensed material may be distributed." },
    {
      tag: "private-use",
      label: "Private use",
      description: "The licensed material may be used and modified in private.",
    },
    {
      tag: "patent-use",
      label: "Patent use",
      description: "This license provides an express grant of patent rights from contributors.",
    },
  ],
  conditions: [
    {
      tag: "include-copyright",
      label: "License and copyright notice",
      description: "A copy of the license and copyright notice must be included with the licensed material.",
    },
    {
      tag: "include-copyright--source",
      label: "License and copyright notice for source",
      description:
        "A copy of the license and copyright notice must be included with the licensed material in source form, but is not required for binaries.",
    },
    {
      tag: "document-changes",
      label: "State changes",
      description: "Changes made to the licensed material must be documented.",
    },
    {
      tag: "disclose-source",
      label: "Disclose source",
      description: "Source code must be made available when the licensed material is distributed.",
    },
    {
      tag: "network-use-disclose",
      label: "Network use is distribution",
      description:
        "Users who interact with the licensed material via network are given the right to receive a copy of the source code.",
    },
    {
      tag: "same-license",
      label: "Same license",
      description: "Modifications must be released under the same license when distributing the licensed material.",
    },
    {
      tag: "same-license--file",
      label: "Same license (file)",
      description:
        "Modifications of existing files must be released under the same license when distributing the licensed material.",
    },
    {
      tag: "same-license--library",
      label: "Same license (library)",
      description:
        "Modifications must be released under the same license, or this condition may not apply to works that use the licensed material as a library.",
    },
  ],
  limitations: [
    {
      tag: "trademark-use",
      label: "Trademark use",
      description: "This license explicitly states that it does NOT grant trademark rights.",
    },
    { tag: "liability", label: "Liability", description: "This license includes a limitation of liability." },
    {
      tag: "patent-use",
      label: "Patent use",
      description: "This license explicitly states that it does NOT grant any rights in the patents of contributors.",
    },
    {
      tag: "warranty",
      label: "Warranty",
      description: "This license explicitly states that it does NOT provide any warranty.",
    },
  ],
};

export const KIND_COLOR: Record<RuleKind, Color> = { permissions: "green", conditions: "blue", limitations: "red" };
export const KIND_TITLE: Record<RuleKind, string> = {
  permissions: "Permissions",
  conditions: "Conditions",
  limitations: "Limitations",
};

export const ruleLabel = (kind: RuleKind, tag: string) => RULES[kind].find((r) => r.tag === tag)?.label ?? tag;

/** The rules of a license in choosealicense.com's order, as labels. */
export function ruleLabels(l: License, kind: RuleKind): string[] {
  return RULES[kind].filter((r) => l[kind].includes(r.tag)).map((r) => r.label);
}

export type Category = "copyleft" | "weak-copyleft" | "permissive" | "public-domain";

export const CATEGORIES: { value: Category; title: string; tint: Color }[] = [
  { value: "permissive", title: "Permissive", tint: "green" },
  { value: "weak-copyleft", title: "Weak Copyleft", tint: "teal" },
  { value: "copyleft", title: "Copyleft", tint: "purple" },
  { value: "public-domain", title: "Public Domain", tint: "orange" },
];

/** Strong copyleft (whole work), weak (file or library), permissive, or no condition at all. */
export function category(l: License): Category {
  if (l.conditions.includes("same-license")) return "copyleft";
  if (l.conditions.some((c) => c.startsWith("same-license--"))) return "weak-copyleft";
  if (!l.conditions.length) return "public-domain";
  return "permissive";
}

export const categoryInfo = (l: License) => CATEGORIES.find((c) => c.value === category(l))!;

/** GNU licenses come as -only and -or-later in SPDX; the bare ids are deprecated. */
export function spdxIds(l: License): string[] {
  if (/^(A|L)?GPL-\d\.\d$/.test(l.spdx)) return [`${l.spdx}-or-later`, `${l.spdx}-only`];
  return [l.spdx];
}

export const spdxUrl = (id: string) => `https://spdx.org/licenses/${id}.html`;
export const chooseUrl = (l: License) => `https://choosealicense.com/licenses/${l.key}/`;
export const rawUrl = (l: License) =>
  `https://raw.githubusercontent.com/github/choosealicense.com/gh-pages/_licenses/${l.key}.txt`;

/** The license text from a choosealicense.com file: what follows the front matter. */
export function bodyOf(file: string): string {
  const m = file.match(/^---\n[\s\S]*?\n---\n/);
  return (m ? file.slice(m[0].length) : file).replace(/^\n+/, "");
}

export interface Holder {
  year: string;
  name: string;
  project?: string;
  email?: string;
}

/**
 * Fills choosealicense.com's placeholders. Only theirs: the "how to apply"
 * appendices (GNU's `<year>  <name of author>`, Apache's `[yyyy] [name of
 * copyright owner]`) are templates for the reader and stay.
 */
export function fill(text: string, h: Holder): string {
  let out = text.replaceAll("[year]", h.year);
  if (h.name) out = out.replaceAll("[fullname]", h.name);
  if (h.project) out = out.replaceAll("[project]", h.project);
  if (h.email) out = out.replaceAll("[email]", h.email);
  return out;
}

/** Whether the text still has a placeholder the user should fill in. */
export const placeholders = (text: string) => [...new Set(text.match(/\[(fullname|year|project|email)\]/g) ?? [])];

/** Whether the license text names the copyright holder (MIT does, GPL doesn't). */
export const namesHolder = (text: string) => /\[(fullname|year)\]/.test(text);

/** The usual file name: GNU licenses ask for COPYING. */
export const defaultFileName = (l: License) => (/^(A|L)?GPL/.test(l.spdx) ? "COPYING" : "LICENSE");

export const FILE_NAMES = ["LICENSE", "LICENSE.md", "LICENSE.txt", "COPYING", "UNLICENSE"];

/** `~/x` and `$HOME/x` → absolute; trailing slashes removed. */
export function expandHome(path: string, home: string): string {
  let p = path.trim();
  if (p === "~" || p.startsWith("~/")) p = home + p.slice(1);
  else if (p.startsWith("$HOME")) p = home + p.slice(5);
  return p.length > 1 ? p.replace(/\/+$/, "") : p;
}

/** The last segment of a folder, used as [project]. */
export const folderName = (path: string) => path.replace(/\/+$/, "").split("/").pop() ?? "";

export const tilde = (path: string, home: string) =>
  home && (path === home || path.startsWith(home + "/")) ? "~" + path.slice(home.length) : path;

/** Finds a license by SPDX id or key, case-insensitive ("mit", "Apache-2.0", "gpl-3.0-or-later"). */
export function find(all: License[], id: string): License | undefined {
  const q = id.trim().toLowerCase().replace(/-(only|or-later)$/, "");
  return all.find((l) => l.spdx.toLowerCase() === q || l.key === q);
}

/** Popular first (choosealicense's featured), then by title. */
export function sortLicenses(all: License[]): License[] {
  const popular = ["MIT", "Apache-2.0", "GPL-3.0"];
  const rank = (l: License) => (popular.includes(l.spdx) ? popular.indexOf(l.spdx) : 99);
  return [...all].sort((a, b) => rank(a) - rank(b) || a.title.localeCompare(b.title));
}

/** Rules one license has and the other hasn't, as markdown lists. */
export function compare(a: License, b: License): string {
  const lines = [`# ${a.spdx} vs ${b.spdx}`, ""];
  lines.push(
    `**${a.title}** is ${categoryInfo(a).title.toLowerCase()}, **${b.title}** is ${
      categoryInfo(b).title.toLowerCase()
    }.`,
  );
  for (const kind of ["permissions", "conditions", "limitations"] as RuleKind[]) {
    lines.push("", `## ${KIND_TITLE[kind]}`, "");
    for (const r of RULES[kind]) {
      const inA = a[kind].includes(r.tag);
      const inB = b[kind].includes(r.tag);
      if (!inA && !inB) continue;
      const who = inA && inB ? "both" : inA ? `only **${a.spdx}**` : `only **${b.spdx}**`;
      lines.push(`- ${r.label}: ${who}`);
    }
  }
  const diff = (kind: RuleKind) =>
    a[kind].filter((t) => !b[kind].includes(t)).length + b[kind].filter((t) => !a[kind].includes(t)).length;
  const total = diff("permissions") + diff("conditions") + diff("limitations");
  lines.push("", "---", "", total ? `${total} difference${total === 1 ? "" : "s"}.` : "Same rules.");
  return lines.join("\n");
}

/** `git config user.name` output → a name, or undefined. */
export const gitName = (out: string) => out.trim().split("\n")[0]?.trim() || undefined;
