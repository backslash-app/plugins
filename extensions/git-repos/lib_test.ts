import { assertEquals } from "@std/assert";
import {
  branchUrl,
  changedFiles,
  changeSummary,
  commitUrl,
  findArgs,
  installCommand,
  isDirty,
  parseBranches,
  parseFolders,
  parseLog,
  parseStatus,
  pickRemote,
  relativeTime,
  remotePage,
  reposFromFind,
  rootOf,
  tilde,
} from "./lib.ts";
import { shellArgs, shellLine, terminalArgs } from "./terminal.ts";

// Real `git status --porcelain=v2 --branch --show-stash` output.
const DIRTY = `# branch.oid 667a1968df5af67e15fca1434f9ddfb3f3763836
# branch.head dev
# stash 1
1 .M N... 100644 100644 100644 78981922613b2afb6025042ff6bd878ac1994e85 78981922613b2afb6025042ff6bd878ac1994e85 a
1 A. N... 000000 100644 100644 0000000000000000000000000000000000000000 61780798228d17af2d34fce4cfbdf35556832472 b
2 R. N... 100644 100644 100644 d670460b4b4aece5915caf5c68d12f560a9fe3e4 d670460b4b4aece5915caf5c68d12f560a9fe3e4 R100 new.txt\told.txt
1 MM N... 100644 100644 100644 a1 b2 c.txt
u UU N... 100644 100644 100644 100644 a1 b2 c3 conflict.txt
? untracked
? notes/todo.md`;

const SYNCED = `# branch.oid 90a3b337c2cca1109472e55837eef606bfbaa5ad
# branch.head main
# branch.upstream origin/main
# branch.ab +1 -3`;

Deno.test("porcelain v2 status", () => {
  assertEquals(parseStatus(DIRTY), {
    oid: "667a1968df5af67e15fca1434f9ddfb3f3763836",
    branch: "dev",
    ahead: 0,
    behind: 0,
    staged: 3,
    modified: 2,
    untracked: 2,
    conflicts: 1,
    stashes: 1,
  });
  assertEquals(changedFiles(DIRTY), 7);
  const s = parseStatus(SYNCED);
  assertEquals([s.branch, s.upstream, s.ahead, s.behind, isDirty(s)], ["main", "origin/main", 1, 3, false]);
  const detached = parseStatus("# branch.oid d787b58\n# branch.head (detached)");
  assertEquals([detached.branch, detached.oid], [undefined, "d787b58"]);
  const empty = parseStatus("# branch.oid (initial)\n# branch.head main\n? README.md");
  assertEquals([empty.oid, empty.branch, empty.untracked], [undefined, "main", 1]);
  assertEquals(changeSummary(parseStatus(DIRTY)), "1 conflicted, 3 staged, 2 modified, 2 untracked");
  assertEquals(changeSummary(s), "Clean");
});

Deno.test("log records", () => {
  const out =
    "90a3b337c2cca1109472e55837eef606bfbaa5ad\x1f90a3b33\x1fSecond: not pushed\x1fAda Lovelace\x1fada@example.com\x1f1793183949\x1fHEAD -> main, tag: v1.0, origin/main\x1fLonger body\n\nSigned-off-by: Ada\n\x1e\n" +
    "b3511c4095f9d48b1fcc86a3f0e49d1fecf0f0be\x1fb3511c4\x1fFirst\x1fAda Lovelace\x1fada@example.com\x1f1793180000\x1f\x1f\x1e";
  const [a, b] = parseLog(out);
  assertEquals([a.short, a.subject, a.author, a.time, a.refs], [
    "90a3b33",
    "Second: not pushed",
    "Ada Lovelace",
    1793183949,
    ["HEAD -> main", "tag: v1.0", "origin/main"],
  ]);
  assertEquals(a.body, "Longer body\n\nSigned-off-by: Ada");
  assertEquals([b.refs, b.body], [[], ""]);
  assertEquals(parseLog(""), []);
});

Deno.test("remotes and their web pages", () => {
  const remotes =
    "remote.upstream.url git@codeberg.org:ada/synced.git\nremote.origin.url https://github.com/ada/app.git";
  assertEquals(pickRemote(remotes), { name: "origin", url: "https://github.com/ada/app.git" });
  assertEquals(pickRemote("remote.fork.url git@x.org:a/b"), { name: "fork", url: "git@x.org:a/b" });
  assertEquals(pickRemote(""), undefined);
  const cases: [string, string | undefined][] = [
    ["git@github.com:backslash-app/plugins.git", "https://github.com/backslash-app/plugins"],
    ["git@codeberg.org:ada/notes", "https://codeberg.org/ada/notes"],
    ["ssh://git@gitlab.example.com:2222/team/api.git", "https://gitlab.example.com/team/api"],
    ["git+ssh://git@github.com/a/b.git", "https://github.com/a/b"],
    ["https://user:token@gitlab.com/org/api.git", "https://gitlab.com/org/api"],
    ["http://git.local/repo/", "http://git.local/repo"],
    ["git://git.kernel.org/pub/scm/git/git.git", "https://git.kernel.org/pub/scm/git/git"],
    ["/srv/git/project.git", undefined],
    ["../other", undefined],
  ];
  for (const [remote, page] of cases) assertEquals(remotePage(remote), page, remote);
  assertEquals(commitUrl("https://github.com/a/b", "abc"), "https://github.com/a/b/commit/abc");
  assertEquals(commitUrl("https://gitlab.com/a/b", "abc"), "https://gitlab.com/a/b/-/commit/abc");
  assertEquals(commitUrl("https://bitbucket.org/a/b", "abc"), "https://bitbucket.org/a/b/commits/abc");
  assertEquals(branchUrl("https://codeberg.org/a/b", "fix/x"), "https://codeberg.org/a/b/src/branch/fix/x");
  assertEquals(branchUrl("https://github.com/a/b", "feat/ü"), "https://github.com/a/b/tree/feat/%C3%BC");
});

Deno.test("folders and the find command", () => {
  assertEquals(parseFolders("~/Projects, ~/work/:/opt/src\n~/Projects", "/home/ada"), [
    "/home/ada/Projects",
    "/home/ada/work",
    "/opt/src",
  ]);
  assertEquals(parseFolders("", "/home/ada").slice(0, 3), [
    "/home/ada/Projects",
    "/home/ada/projects",
    "/home/ada/code",
  ]);
  assertEquals(parseFolders("relative, ~", "/home/ada"), ["/home/ada"]);
  const args = findArgs(["/home/ada/code"], 3);
  assertEquals(args.slice(0, 5), ["/home/ada/code", "-mindepth", "1", "-maxdepth", "4"]);
  assertEquals(args.slice(-6), ["-prune", "-o", "-name", ".git", "-print", "-prune"]);
  assertEquals(findArgs(["/x"], 50)[4], "9");
  assertEquals(
    reposFromFind(
      "/home/ada/code/b/.git\n/home/ada/code/a/.git\n/home/ada/code/a/.git\nfind: ‘/home/ada/src’: No such file\n",
    ),
    ["/home/ada/code/a", "/home/ada/code/b"],
  );
  assertEquals(
    rootOf("/home/ada/code/org/api", ["/home/ada/code", "/home/ada/code/org", "/home/ada/src"]),
    "/home/ada/code/org",
  );
  assertEquals(rootOf("/elsewhere", ["/home/ada/code"]), undefined);
  assertEquals([tilde("/home/ada/code", "/home/ada"), tilde("/home/adam", "/home/ada")], ["~/code", "/home/adam"]);
});

Deno.test("relative times", () => {
  const now = 1_800_000_000_000;
  const ago = (s: number) => relativeTime(now / 1000 - s, now);
  assertEquals([
    ago(10),
    ago(300),
    ago(7200),
    ago(90_000),
    ago(4 * 86400),
    ago(20 * 86400),
    ago(90 * 86400),
    ago(800 * 86400),
  ], [
    "just now",
    "5 min ago",
    "2 h ago",
    "yesterday",
    "4 days ago",
    "2 weeks ago",
    "3 months ago",
    "2 years ago",
  ]);
});

Deno.test("branches and install hints", () => {
  assertEquals(parseBranches("main\nfeature/x\n(HEAD detached at d787b58)\n\n"), ["main", "feature/x"]);
  assertEquals(installCommand("ID=fedora\nVERSION_ID=41"), "sudo dnf install git");
  assertEquals(installCommand('ID=pop\nID_LIKE="ubuntu debian"'), "sudo apt install git");
  assertEquals(installCommand("ID=endeavouros\nID_LIKE=arch"), "sudo pacman -S git");
  assertEquals(installCommand('ID="opensuse-tumbleweed"'), "sudo zypper install git");
  assertEquals(installCommand(""), "Install git with your package manager");
});

Deno.test("terminal command lines", () => {
  assertEquals(terminalArgs("kitty", ["nvim", "."]), ["nvim", "."]);
  assertEquals(terminalArgs("gnome-terminal", ["nvim", "."]), ["--", "nvim", "."]);
  assertEquals(terminalArgs("tilix", ["nvim", "my file"]), ["-e", "nvim 'my file'"]);
  assertEquals(shellLine(["git", "log", "it's"]), "git log 'it'\\''s'");
  assertEquals(shellArgs("wezterm", "/r"), ["start", "--cwd", "/r"]);
  assertEquals(shellArgs("kitty", "/r"), ["--directory", "/r"]);
  assertEquals(shellArgs("konsole", "/r"), ["--workdir", "/r"]);
  assertEquals(shellArgs("gnome-terminal", "/r"), ["--working-directory=/r"]);
  assertEquals(shellArgs("alacritty", "/r"), []);
});
