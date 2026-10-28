import { assert, assertEquals, assertMatch } from "@std/assert";
import { parse } from "@std/toml";
import {
  branchSummary,
  chezmoiFiles,
  diffMarkdown,
  diffStat,
  editorScript,
  gitFiles,
  gitState,
  packageState,
  parentDir,
  parseChezmoiStatus,
  parseGitStatus,
  parseLog,
  parseStowrc,
  sortFiles,
  STOW_SKIP,
  stowArgs,
  stowError,
  stowTarget,
  terminalScript,
  tildify,
  unquoteGitPath,
} from "./lib.ts";
import { TERMINALS } from "./terminal.ts";

const HOME = "/home/ada";

const CHEZMOI_STATUS = ` M .bashrc
MM .config/nvim/init.lua
 A .config/git/config
 D .oldrc
 R .chezmoiscripts/install-packages.sh
`;

const CHEZMOI_MANAGED = `/home/ada/.bashrc
/home/ada/.config/git/config
/home/ada/.config/nvim/init.lua
/home/ada/.config/starship.toml
/home/ada/.zshrc
`;

const GIT_STATUS = `## main...origin/main [ahead 2, behind 1]
 M .bashrc
M  .config/kitty/kitty.conf
A  .config/new.conf
 D .vimrc
R  .zshrc -> .config/zsh/.zshrc
UU .gitconfig
 M "\\303\\251t\\303\\251.txt"
`;

Deno.test("chezmoi status: local edits and what apply would do", () => {
  const status = parseChezmoiStatus(CHEZMOI_STATUS, HOME);
  assertEquals(status.map((f) => [f.path, f.state, f.localEdit]), [
    ["/home/ada/.bashrc", "apply-modify", false],
    ["/home/ada/.config/nvim/init.lua", "modified", true],
    ["/home/ada/.config/git/config", "apply-add", false],
    ["/home/ada/.oldrc", "apply-delete", false],
    ["/home/ada/.chezmoiscripts/install-packages.sh", "script", false],
  ]);
  const files = sortFiles(chezmoiFiles(CHEZMOI_MANAGED, status));
  assertEquals(files.length, 7);
  assertEquals(files[0].path, "/home/ada/.config/nvim/init.lua");
  assertEquals(files.at(-1)!.state, "clean");
  assertEquals(files.filter((f) => f.state === "clean").map((f) => f.path), [
    "/home/ada/.config/starship.toml",
    "/home/ada/.zshrc",
  ]);
});

Deno.test("git status: branch, states, renames and quoted paths", () => {
  const s = parseGitStatus(GIT_STATUS);
  assertEquals(s.branch, { branch: "main", upstream: "origin/main", ahead: 2, behind: 1 });
  assertEquals(branchSummary(s.branch), "main · 2 to push · 1 to pull");
  assertEquals(s.files.length, 7);
  assertEquals(s.files[4], { x: "R", y: " ", from: ".zshrc", path: ".config/zsh/.zshrc" });
  assertEquals(s.files[6].path, "été.txt");
  assertEquals(gitState(" ", "M"), { state: "modified", staged: false });
  assertEquals(gitState("M", " "), { state: "modified", staged: true });
  assertEquals(gitState("A", " "), { state: "added", staged: true });
  assertEquals(gitState(" ", "D"), { state: "deleted", staged: false });
  assertEquals(gitState("U", "U").state, "conflict");
  assertEquals(gitState("?", "?").state, "untracked");
  assertEquals(parseGitStatus("## No commits yet on main\n").branch, {
    ahead: 0,
    behind: 0,
    branch: "main",
    empty: true,
  });
  assertEquals(branchSummary(parseGitStatus("## main\n").branch), "main · not pushed anywhere");
  assertEquals(
    branchSummary(parseGitStatus("## main...origin/main\n").branch),
    "main · in sync",
  );
  assertEquals(unquoteGitPath('"a\\tb"'), "a\tb");
});

Deno.test("git files: tracked files merged with their status", () => {
  const files = gitFiles("bare", HOME, ".bashrc\n.config/kitty/kitty.conf\n.profile\n", parseGitStatus(GIT_STATUS));
  const by = Object.fromEntries(files.map((f) => [f.path, f]));
  assertEquals(by["/home/ada/.profile"].state, "clean");
  assertEquals(by["/home/ada/.bashrc"].state, "modified");
  assertEquals(by["/home/ada/.config/kitty/kitty.conf"].staged, true);
  assertEquals(by["/home/ada/.config/zsh/.zshrc"].from, "/home/ada/.zshrc");
  assertEquals(sortFiles(files)[0].state, "conflict");
});

Deno.test("git log", () => {
  assertEquals(parseLog("a1b2c3d\t2 hours ago\tkitty: bigger font\nd4e5f6a\t3 days ago\tnvim: lsp\tconfig\n"), [
    { hash: "a1b2c3d", when: "2 hours ago", subject: "kitty: bigger font" },
    { hash: "d4e5f6a", when: "3 days ago", subject: "nvim: lsp\tconfig" },
  ]);
});

Deno.test("stow options and targets", () => {
  const o = parseStowrc("--target=~/\n--dotfiles\n# comment\n--ignore=\\.md$ -v\n", "/home/ada/dotfiles", HOME);
  assertEquals(o, { target: "/home/ada/", dotfiles: true, ignore: ["\\.md$"] });
  const d = parseStowrc("", "/home/ada/dotfiles", HOME);
  assertEquals(d.target, "/home/ada");
  assertEquals(parseStowrc("-t /etc", "/x/y", HOME).target, "/etc");
  assertEquals(parseStowrc("--target $HOME/.config", "/x/y", HOME).target, "/home/ada/.config");
  assertEquals(stowTarget("dot-config/nvim/init.lua", { ...d, dotfiles: true }), "/home/ada/.config/nvim/init.lua");
  assertEquals(stowTarget("dot-config/nvim/init.lua", d), "/home/ada/dot-config/nvim/init.lua");
  assertEquals(stowArgs("/home/ada/dotfiles", d, "restow", "vim"), [
    "--dir",
    "/home/ada/dotfiles",
    "--target",
    "/home/ada",
    "--restow",
    "--verbose=1",
    "vim",
  ]);
  assert(STOW_SKIP.test(".git"));
  assert(STOW_SKIP.test("README.md"));
  assert(!STOW_SKIP.test("nvim"));
  assertEquals(parentDir("/home/ada/dotfiles/"), "/home/ada");
  assertEquals(
    packageState({
      name: "x",
      files: [{ source: "a", target: "b", state: "linked" }, { source: "c", target: "d", state: "missing" }],
    }),
    "partial",
  );
  assertMatch(
    stowError(
      "WARNING! stowing bash would cause conflicts:\n  * existing target is neither a link nor a directory: .bashrc\nAll operations aborted.",
    ),
    /Files already exist: \.bashrc/,
  );
});

Deno.test("diffs and scripts", () => {
  const diff =
    "diff --git a/.bashrc b/.bashrc\n--- a/.bashrc\n+++ b/.bashrc\n@@ -1,2 +1,2 @@\n-alias ll='ls -l'\n+alias ll='ls -la'\n+export EDITOR=nvim\n";
  assertEquals(diffStat(diff), { added: 2, removed: 1 });
  assert(diffMarkdown(diff).startsWith("```diff\n"));
  assertEquals(diffMarkdown(""), "No difference.");
  const t = terminalScript("Committing…", [["git", "add", "--update"], ["git", "commit", "--verbose"]]);
  assert(t[2].includes("git add --update && git commit --verbose"));
  assertEquals(editorScript("/home/ada/my file"), [
    "sh",
    "-c",
    'exec "${VISUAL:-${EDITOR:-nano}}" "$1"',
    "sh",
    "/home/ada/my file",
  ]);
  assertEquals(tildify("/home/ada/.bashrc", HOME), "~/.bashrc");
});

async function gitRun(args: string[], cwd: string) {
  const out = await new Deno.Command("git", { args, cwd, stdout: "piped", stderr: "piped" }).output();
  if (out.code !== 0) throw new Error(new TextDecoder().decode(out.stderr));
}

Deno.test("loads a real bare repository and Stow folder", async () => {
  const hasGit = await new Deno.Command("git", { args: ["--version"], stdout: "null", stderr: "null" }).output()
    .then((o) => o.code === 0, () => false);
  if (!hasGit) return;
  const home = await Deno.makeTempDir({ prefix: "dotfiles-test-" });
  try {
    // A bare repository tracking two files, one of them edited since.
    await Deno.writeTextFile(`${home}/.bashrc`, "alias ll='ls -l'\n");
    await Deno.writeTextFile(`${home}/.profile`, "export PATH\n");
    const g = ["--git-dir", `${home}/.dotfiles`, "--work-tree", home];
    await gitRun(["init", "--bare", "--quiet", `${home}/.dotfiles`], home);
    await gitRun([...g, "add", ".bashrc", ".profile"], home);
    await gitRun([...g, "-c", "user.name=T", "-c", "user.email=t@e", "commit", "--quiet", "-m", "init"], home);
    await Deno.writeTextFile(`${home}/.bashrc`, "alias ll='ls -la'\n");
    // A Stow folder: "vim" is linked, "kitty" is not, "zsh" collides with a real file.
    await Deno.mkdir(`${home}/dotfiles/vim`, { recursive: true });
    await Deno.mkdir(`${home}/dotfiles/kitty/dot-config/kitty`, { recursive: true });
    await Deno.mkdir(`${home}/dotfiles/zsh`, { recursive: true });
    await Deno.writeTextFile(`${home}/dotfiles/.stowrc`, "--dotfiles\n");
    await Deno.writeTextFile(`${home}/dotfiles/vim/dot-vimrc`, "set number\n");
    await Deno.writeTextFile(`${home}/dotfiles/kitty/dot-config/kitty/kitty.conf`, "font_size 12\n");
    await Deno.writeTextFile(`${home}/dotfiles/zsh/dot-zshrc`, "bindkey -e\n");
    await Deno.writeTextFile(`${home}/dotfiles/README.md`, "my dotfiles\n");
    await Deno.symlink(`${home}/dotfiles/vim/dot-vimrc`, `${home}/.vimrc`);
    await Deno.writeTextFile(`${home}/.zshrc`, "# mine\n");

    Deno.env.set("HOME", home);
    const { load } = await import("./dotfiles.ts");
    const sources = await load({});
    const bare = sources.find((s) => s.backend === "bare")!;
    assert(bare, "the bare repository is found");
    const states = Object.fromEntries(bare.files.map((f) => [f.path.slice(home.length + 1), f.state]));
    assertEquals(states, { ".bashrc": "modified", ".profile": "clean" });
    const stow = sources.find((s) => s.backend === "stow")!;
    assert(stow?.stow, "the stow folder is found");
    const pkgs = Object.fromEntries(stow.stow.packages.map((p) => [p.name, packageState(p)]));
    assertEquals(pkgs, { kitty: "unlinked", vim: "linked", zsh: "conflict" });
    assertEquals(
      stow.stow.packages.find((p) => p.name === "kitty")!.files[0].target,
      `${home}/.config/kitty/kitty.conf`,
    );
  } finally {
    await Deno.remove(home, { recursive: true });
  }
});

Deno.test("manifest: programs and commands", async () => {
  const manifest = parse(await Deno.readTextFile(new URL("./backslash.toml", import.meta.url))) as {
    permissions: { run: string[] };
    commands: { name: string }[];
    preferences: Record<string, unknown>[];
  };
  const run = new Set(manifest.permissions.run);
  for (const p of [...TERMINALS, "chezmoi", "yadm", "git", "stow"]) assert(run.has(p), `${p} is not in run`);
  for (const c of manifest.commands) await Deno.stat(new URL(`./commands/${c.name}.ts`, import.meta.url));
  const allowed = new Set(["name", "title", "description", "required", "default", "type"]);
  for (const p of manifest.preferences) for (const k of Object.keys(p)) assert(allowed.has(k), `${p.name}: ${k}`);
});
