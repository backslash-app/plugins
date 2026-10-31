import { assert, assertEquals, assertThrows } from "@std/assert";
import {
  age,
  type AurPackage,
  depName,
  holdOpen,
  infoUrls,
  installCommand,
  isVcs,
  parseEvr,
  parseQm,
  parseRpc,
  pkgbuildMarkdown,
  pkgbuildUrl,
  pkgbuildWarnings,
  popularity,
  rank,
  removeCommand,
  rpmvercmp,
  searchTerms,
  searchUrl,
  stateOf,
  updateAllCommand,
  vercmp,
  votes,
} from "./lib.ts";

// Trimmed from https://aur.archlinux.org/rpc/v5/search/visual-studio-code (October 2026).
const SEARCH = {
  resultcount: 4,
  results: [
    {
      Description: "Visual Studio Code (vscode)",
      FirstSubmitted: 1453480870,
      ID: 1580321,
      LastModified: 1729680000,
      Maintainer: "dcelasun",
      Name: "visual-studio-code-bin",
      NumVotes: 1489,
      OutOfDate: null,
      PackageBase: "visual-studio-code-bin",
      PackageBaseID: 105802,
      Popularity: 21.432817,
      URL: "https://code.visualstudio.com/",
      URLPath: "/cgit/aur.git/snapshot/visual-studio-code-bin.tar.gz",
      Version: "1.95.0-1",
    },
    {
      Description: "Visual Studio Code Insiders (vscode)",
      FirstSubmitted: 1460000000,
      ID: 1580000,
      LastModified: 1729000000,
      Maintainer: null,
      Name: "visual-studio-code-insiders-bin",
      NumVotes: 180,
      OutOfDate: 1729500000,
      PackageBase: "visual-studio-code-insiders-bin",
      PackageBaseID: 110000,
      Popularity: 1.2,
      URL: null,
      Version: "1.96.0.1729-1",
    },
    {
      Description: "Language server for VS Code extensions",
      FirstSubmitted: 1600000000,
      ID: 1,
      LastModified: 1700000000,
      Maintainer: "someone",
      Name: "vscode-langservers-extracted",
      NumVotes: 30,
      OutOfDate: null,
      PackageBase: "vscode-langservers-extracted",
      PackageBaseID: 2,
      Popularity: 3.1,
      URL: "https://github.com/hrsh7th/vscode-langservers-extracted",
      Version: "4.10.0-1",
    },
    {
      Description: "Themes for visual studio code",
      FirstSubmitted: 1600000000,
      ID: 3,
      LastModified: 1600000000,
      Maintainer: "x",
      Name: "code-themes",
      NumVotes: 2,
      OutOfDate: null,
      PackageBase: "code-themes",
      PackageBaseID: 4,
      Popularity: 0.001,
      URL: null,
      Version: "1-1",
    },
  ],
  type: "search",
  version: 5,
} as const;

const results = () => parseRpc(SEARCH) as AurPackage[];

Deno.test("RPC answers and errors", () => {
  assertEquals(results().length, 4);
  assertEquals(parseRpc({ resultcount: 0, results: [], type: "search", version: 5 }), []);
  assertThrows(
    () => parseRpc({ error: "Too many package results.", resultcount: 0, results: [], type: "error", version: 5 }),
    Error,
    "Too many packages match",
  );
  assertThrows(() => parseRpc({ error: "Query arg too small.", type: "error" }), Error, "at least 2 characters");
  assertEquals(parseRpc(null), []);
});

Deno.test("search URLs and terms", () => {
  assertEquals(searchTerms("  Visual Studio  code "), { term: "visual", rest: ["studio", "code"] });
  assertEquals(searchTerms(""), undefined);
  assertEquals(searchUrl("c++"), "https://aur.archlinux.org/rpc/v5/search/c%2B%2B?by=name-desc");
  const urls = infoUrls(["a", "b", "c++"], 2);
  assertEquals(urls, [
    "https://aur.archlinux.org/rpc/v5/info?arg[]=a&arg[]=b",
    "https://aur.archlinux.org/rpc/v5/info?arg[]=c%2B%2B",
  ]);
  assertEquals(
    pkgbuildUrl("visual-studio-code-bin"),
    "https://aur.archlinux.org/cgit/aur.git/plain/PKGBUILD?h=visual-studio-code-bin",
  );
});

Deno.test("ranking: every word matches, exact name first, then popularity", () => {
  assertEquals(rank(results(), "visual studio code").map((p) => p.Name), [
    "visual-studio-code-bin",
    "visual-studio-code-insiders-bin",
    "code-themes",
  ]);
  assertEquals(rank(results(), "visual-studio-code-bin")[0].Name, "visual-studio-code-bin");
  assertEquals(rank(results(), "vscode").map((p) => p.Name), [
    "visual-studio-code-bin",
    "vscode-langservers-extracted",
    "visual-studio-code-insiders-bin",
  ]);
  const unused = { ...results()[3], Name: "studio", Popularity: 0, NumVotes: 0 };
  assertEquals(rank([unused, ...results()], "studio")[0].Name, "studio");
});

Deno.test("pacman -Qm", () => {
  assertEquals(parseQm("paru 2.0.4-1\nvisual-studio-code-bin 1.94.2-1\nmy-local-thing 0.1-1\n\n"), [
    { name: "paru", version: "2.0.4-1" },
    { name: "visual-studio-code-bin", version: "1.94.2-1" },
    { name: "my-local-thing", version: "0.1-1" },
  ]);
  assertEquals(parseQm(""), []);
});

Deno.test("vercmp agrees with pacman", () => {
  // Mostly from pacman's test/util/vercmptest.sh.
  const cases: [string, string, number][] = [
    ["1.5.0", "1.5.0", 0],
    ["1.5.1", "1.5.0", 1],
    ["1.5.1", "1.5", 1],
    ["1.5.0-1", "1.5.0-2", -1],
    ["1.5.0-1", "1.5.1-1", -1],
    ["1.5.0-2", "1.5.1-1", -1],
    ["1.5-1", "1.5", 0],
    ["1.5", "1.5-1", 0],
    ["1.1-1", "1.1", 0],
    ["1.0a", "1.0alpha", -1],
    ["1.0alpha", "1.0b", -1],
    ["1.0b", "1.0beta", -1],
    ["1.0beta", "1.0pre", -1],
    ["1.0pre", "1.0rc", -1],
    ["1.0rc", "1.0", -1],
    ["1.0", "1.0.a", -1],
    ["1.0.a", "1.0.1", -1],
    ["1", "1.0", -1],
    ["1.0", "1.0.0", -1],
    ["1.0.0", "1.0.1", -1],
    ["1.0", "1.0.0a", -1],
    ["1.0a", "1.0.1", -1],
    ["1.0.a", "1.0.b", -1],
    ["1.0", "1.0+1", -1],
    ["1.0.0", "1.0..0", -1],
    ["1.0..0", "1.0.0", 1],
    ["0:1.0", "1.0", 0],
    ["1:1.0", "1.0", 1],
    ["1:1.0", "2:1.0", -1],
    ["1.0", "1:0.5", -1],
    ["2.0.4-1", "2.0.4-2", -1],
    ["r123.abc1234-1", "r99.fff0000-1", 1],
    ["1.95.0-1", "1.94.2-1", 1],
    ["010", "10", 0],
  ];
  for (const [a, b, want] of cases) {
    assertEquals(Math.sign(vercmp(a, b)), want, `${a} vs ${b}`);
    assertEquals(Math.sign(vercmp(b, a)), -want, `${b} vs ${a}`);
  }
  assertEquals(rpmvercmp("1.0", "1.0"), 0);
  assertEquals(parseEvr("2:1.2.3-4"), { epoch: "2", version: "1.2.3", release: "4" });
  assertEquals(parseEvr("1.2"), { epoch: "0", version: "1.2", release: undefined });
});

Deno.test("installed against the AUR", () => {
  const [code] = results();
  assertEquals(stateOf({ name: code.Name, version: "1.94.2-1" }, code), "update");
  assertEquals(stateOf({ name: code.Name, version: "1.95.0-1" }, code), "current");
  assertEquals(stateOf({ name: code.Name, version: "1.95.0-2" }, code), "newer");
  assertEquals(stateOf({ name: "mine", version: "1" }, undefined), "missing");
  assert(isVcs("neovim-git"));
  assert(!isVcs("git-delta"));
});

Deno.test("terminal commands", () => {
  assertEquals(installCommand(["visual-studio-code-bin"], "paru"), "paru -S visual-studio-code-bin");
  assertEquals(installCommand(["a", "b"], "yay"), "yay -S a b");
  const manual = installCommand(["python-foo"], undefined, "python-foo-base");
  assert(manual.includes("git clone https://aur.archlinux.org/python-foo-base.git"));
  assert(manual.includes("cd python-foo-base"));
  assert(manual.endsWith("makepkg -si"));
  assertEquals(updateAllCommand("paru"), "paru -Sua");
  assertEquals(removeCommand(["x"]), "sudo pacman -Rns x");
  const script = holdOpen("paru -S x");
  assertEquals(script.slice(0, 2), ["sh", "-c"]);
  assert(script[2].startsWith("paru -S x\nstatus=$?"));
  assert(script[2].includes("read -r _"));
});

Deno.test("PKGBUILD preview", () => {
  const text = `pkgname=foo
pkgver=1.0
source=("https://example.com/foo-\${pkgver}.tar.gz")
sha256sums=('SKIP')
build() {
  curl -fsSL https://example.com/install.sh | bash
}
`;
  assertEquals(pkgbuildWarnings(text), ["Downloads a script and runs it", "Doesn't check the source's checksum"]);
  assertEquals(pkgbuildWarnings("source=('git+https://github.com/x/y.git')\nsha256sums=('SKIP')"), []);
  const md = pkgbuildMarkdown("foo", "echo ```");
  assert(md.includes("```bash\necho ˋˋˋ\n```"));
});

Deno.test("formatting", () => {
  const now = Date.parse("2026-10-31T12:00:00Z");
  assertEquals(age(now / 1000 - 3600, now), "today");
  assertEquals(age(now / 1000 - 3 * 86400, now), "3d");
  assertEquals(age(now / 1000 - 400 * 86400, now), "1y");
  assertEquals(popularity(21.432817), "21.4");
  assertEquals(popularity(1.2), "1.20");
  assertEquals(popularity(0.001), "<0.01");
  assertEquals(popularity(0), "0");
  assertEquals(votes(1489), "1.5k");
  assertEquals(votes(12_345), "12k");
  assertEquals(votes(30), "30");
  assertEquals(depName("openssl>=3"), "openssl");
  assertEquals(depName("python-foo: for bar support"), "python-foo");
});
