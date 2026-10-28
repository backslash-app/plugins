import { assert, assertEquals } from "@std/assert";
import { LICENSES, TEXTS } from "./data.ts";
import {
  bodyOf,
  category,
  compare,
  defaultFileName,
  expandHome,
  fill,
  find,
  folderName,
  gitName,
  type License,
  namesHolder,
  placeholders,
  ruleLabels,
  sortLicenses,
  spdxIds,
  tilde,
} from "./lib.ts";

const get = (id: string) => find(LICENSES, id)!;

Deno.test("embedded data covers the common licenses", () => {
  for (
    const id of [
      "MIT",
      "Apache-2.0",
      "GPL-2.0",
      "GPL-3.0",
      "LGPL-2.1",
      "LGPL-3.0",
      "AGPL-3.0",
      "MPL-2.0",
      "BSD-2-Clause",
      "BSD-3-Clause",
      "ISC",
      "Unlicense",
      "CC0-1.0",
      "EUPL-1.2",
      "0BSD",
    ]
  ) assert(find(LICENSES, id), id);
  assert(TEXTS["mit"].startsWith("MIT License\n\nCopyright (c) [year] [fullname]"));
  assertEquals(TEXTS["gpl-3.0"], undefined); // long texts are fetched
});

Deno.test("categories", () => {
  assertEquals(category(get("MIT")), "permissive");
  assertEquals(category(get("Apache-2.0")), "permissive");
  assertEquals(category(get("GPL-3.0")), "copyleft");
  assertEquals(category(get("AGPL-3.0")), "copyleft");
  assertEquals(category(get("MPL-2.0")), "weak-copyleft");
  assertEquals(category(get("LGPL-3.0")), "weak-copyleft");
  assertEquals(category(get("Unlicense")), "public-domain");
  assertEquals(category(get("CC0-1.0")), "public-domain");
});

Deno.test("rule labels follow choosealicense's order", () => {
  assertEquals(ruleLabels(get("Apache-2.0"), "permissions"), [
    "Commercial use",
    "Modification",
    "Distribution",
    "Private use",
    "Patent use",
  ]);
  assertEquals(ruleLabels(get("MIT"), "conditions"), ["License and copyright notice"]);
  assertEquals(ruleLabels(get("AGPL-3.0"), "conditions").includes("Network use is distribution"), true);
});

Deno.test("SPDX ids: GNU licenses get -or-later / -only", () => {
  assertEquals(spdxIds(get("GPL-3.0")), ["GPL-3.0-or-later", "GPL-3.0-only"]);
  assertEquals(spdxIds(get("LGPL-2.1")), ["LGPL-2.1-or-later", "LGPL-2.1-only"]);
  assertEquals(spdxIds(get("MIT")), ["MIT"]);
  assertEquals(find(LICENSES, "gpl-3.0-or-later")?.key, "gpl-3.0");
  assertEquals(find(LICENSES, "apache-2.0")?.spdx, "Apache-2.0");
  assertEquals(find(LICENSES, "nope"), undefined);
});

Deno.test("fills the placeholders, not the GNU appendix", () => {
  const mit = fill(TEXTS["mit"], { year: "2026", name: "Ada Lovelace" });
  assert(mit.includes("Copyright (c) 2026 Ada Lovelace\n"));
  assertEquals(placeholders(mit), []);
  const gnu = "Copyright (C) <year>  <name of author>\nCopyright [year] [fullname]";
  assertEquals(fill(gnu, { year: "2026", name: "Ada" }), "Copyright (C) <year>  <name of author>\nCopyright 2026 Ada");
  const apache = "   Copyright [yyyy] [name of copyright owner]";
  assertEquals(fill(apache, { year: "2026", name: "Ada" }), apache);
  // No name: the placeholder stays, so the user sees what's missing.
  assertEquals(placeholders(fill(TEXTS["isc"], { year: "2026", name: "" })), ["[fullname]"]);
  const bsd = fill(TEXTS["bsd-3-clause-clear"], { year: "2026", name: "Ada", project: "engine" });
  assertEquals(placeholders(bsd), []);
});

Deno.test("names the holder or not", () => {
  assert(namesHolder(TEXTS["mit"]));
  assert(!namesHolder("GNU GENERAL PUBLIC LICENSE\nVersion 3"));
});

Deno.test("front matter is stripped from fetched files", () => {
  const file =
    "---\ntitle: GNU General Public License v3.0\nspdx-id: GPL-3.0\n---\n\n                    GNU GENERAL PUBLIC LICENSE\n";
  assertEquals(bodyOf(file), "                    GNU GENERAL PUBLIC LICENSE\n");
  assertEquals(bodyOf("plain"), "plain");
});

Deno.test("file names", () => {
  assertEquals(defaultFileName(get("GPL-3.0")), "COPYING");
  assertEquals(defaultFileName(get("MIT")), "LICENSE");
});

Deno.test("paths", () => {
  assertEquals(expandHome("~/Projects/app/", "/home/ada"), "/home/ada/Projects/app");
  assertEquals(expandHome("$HOME/x", "/home/ada"), "/home/ada/x");
  assertEquals(expandHome("/srv/app", "/home/ada"), "/srv/app");
  assertEquals(expandHome("/", "/home/ada"), "/");
  assertEquals(folderName("/home/ada/Projects/app/"), "app");
  assertEquals(tilde("/home/ada/Projects/app/LICENSE", "/home/ada"), "~/Projects/app/LICENSE");
  assertEquals(tilde("/home/adam/x", "/home/ada"), "/home/adam/x");
});

Deno.test("popular first", () => {
  assertEquals(sortLicenses(LICENSES).slice(0, 3).map((l) => l.spdx), ["MIT", "Apache-2.0", "GPL-3.0"]);
});

Deno.test("compares two licenses", () => {
  const md = compare(get("MIT"), get("Apache-2.0"));
  assert(md.startsWith("# MIT vs Apache-2.0"));
  assert(md.includes("- Patent use: only **Apache-2.0**"));
  assert(md.includes("- Commercial use: both"));
  assert(md.includes("- State changes: only **Apache-2.0**"));
  const same: License = { ...get("MIT") };
  assert(compare(get("MIT"), same).endsWith("Same rules."));
});

Deno.test("git name", () => {
  assertEquals(gitName("Ada Lovelace\n"), "Ada Lovelace");
  assertEquals(gitName(""), undefined);
});
