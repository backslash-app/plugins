import { assert, assertEquals } from "@std/assert";
import { parse } from "@std/toml";
import { findProjects, writeGitignore } from "./api.ts";
import {
  combine,
  describe,
  fence,
  githubUrl,
  headerFor,
  mergeGitignore,
  mergeMessage,
  normalizeLine,
  parseFolders,
  patternCount,
  patternsOf,
  POPULAR,
  rawUrl,
  suggestFor,
  templateFromPath,
  templatesFromTree,
  TREE_URL,
} from "./lib.ts";

// Excerpts of the real templates.
const NODE = `# Logs
logs
*.log
npm-debug.log*

# Dependency directories
node_modules/
jspm_packages/

# dotenv environment variable files
.env
.env.development.local
`;

const MACOS = `# General
.DS_Store
.AppleDouble
.LSOverride

# Icon must end with two \\r
Icon\r\r

# Thumbnails
._*
`;

const PYTHON = `# Byte-compiled / optimized / DLL files
__pycache__/
*.py[cod]

# Environments
.env
.venv
`;

Deno.test("templates from the git tree", () => {
  // Shaped like `GET /repos/github/gitignore/git/trees/main?recursive=1`.
  const tree = {
    sha: "abc",
    truncated: false,
    tree: [
      { path: ".github", type: "tree" },
      { path: ".github/PULL_REQUEST_TEMPLATE.md", type: "blob", size: 900 },
      { path: "Global", type: "tree" },
      { path: "Global/macOS.gitignore", type: "blob", size: 600 },
      { path: "Node.gitignore", type: "blob", size: 2100 },
      { path: "community/JavaScript/Vue.gitignore", type: "blob", size: 80 },
      { path: "C++.gitignore", type: "blob", size: 400 },
      { path: "README.md", type: "blob", size: 4000 },
    ],
  };
  const templates = templatesFromTree(tree);
  assertEquals(templates.map((t) => t.path), [
    "C++.gitignore",
    "Node.gitignore",
    "Global/macOS.gitignore",
    "community/JavaScript/Vue.gitignore",
  ]);
  assertEquals(templates[3], {
    name: "Vue",
    path: "community/JavaScript/Vue.gitignore",
    category: "community",
    group: "JavaScript",
    size: 80,
  });
  assertEquals(templateFromPath("Global/macOS.gitignore"), {
    name: "macOS",
    path: "Global/macOS.gitignore",
    category: "global",
  });
});

Deno.test("urls", () => {
  assertEquals(TREE_URL, "https://api.github.com/repos/github/gitignore/git/trees/main?recursive=1");
  assertEquals(rawUrl("C++.gitignore"), "https://raw.githubusercontent.com/github/gitignore/main/C%2B%2B.gitignore");
  assertEquals(
    rawUrl("Global/macOS.gitignore"),
    "https://raw.githubusercontent.com/github/gitignore/main/Global/macOS.gitignore",
  );
  assertEquals(githubUrl("Node.gitignore"), "https://github.com/github/gitignore/blob/main/Node.gitignore");
  for (const p of POPULAR) assert(p.endsWith(".gitignore"), p);
});

Deno.test("patterns and lines", () => {
  assertEquals(normalizeLine("node_modules/   "), "node_modules/");
  assertEquals(normalizeLine("trailing\\ "), "trailing\\ ");
  assertEquals(normalizeLine("Icon\r"), "Icon");
  assertEquals([...patternsOf(NODE)], [
    "logs",
    "*.log",
    "npm-debug.log*",
    "node_modules/",
    "jspm_packages/",
    ".env",
    ".env.development.local",
  ]);
  assertEquals(patternCount(MACOS), 5);
  assertEquals(describe(NODE), "Logs");
  assertEquals(describe("\n\nfoo"), "");
});

Deno.test("merging into an empty file", () => {
  const r = mergeGitignore("", [{ name: "Node", content: NODE }]);
  assertEquals(r.added, 7);
  assertEquals(r.skipped, 0);
  assert(r.text.startsWith(`${headerFor("Node")}\n\n# Logs\nlogs\n`));
  assert(r.text.endsWith(".env.development.local\n"));
});

Deno.test("merging skips lines already there, and their now-empty paragraphs", () => {
  const existing = "node_modules/\n*.log\nlogs\nnpm-debug.log*\n/dist\n";
  const r = mergeGitignore(existing, [{ name: "Node", content: NODE }]);
  assertEquals(r.skipped, 4);
  assertEquals(r.added, 3);
  assertEquals(
    r.text,
    `node_modules/\n*.log\nlogs\nnpm-debug.log*\n/dist\n\n${
      headerFor("Node")
    }\n\n# Dependency directories\njspm_packages/\n\n# dotenv environment variable files\n.env\n.env.development.local\n`,
  );
  // The "# Logs" comment went away with its patterns.
  assert(!r.text.includes("# Logs"));
  // Merging again changes nothing.
  const again = mergeGitignore(r.text, [{ name: "Node", content: NODE }]);
  assertEquals(again.added, 0);
  assertEquals(again.unchanged, ["Node"]);
  assertEquals(again.text, r.text);
});

Deno.test("combining templates drops duplicates across them", () => {
  const text = combine([{ name: "Node", content: NODE }, { name: "Python", content: PYTHON }, {
    name: "macOS",
    content: MACOS,
  }]);
  // .env is in Node and Python: only Node's is kept.
  assertEquals(text.split("\n").filter((l) => l === ".env").length, 1);
  assert(text.includes(headerFor("Python")));
  assert(text.includes("__pycache__/"));
  // Python's "# Environments" paragraph keeps .venv only.
  assert(text.includes("# Environments\n.venv"));
  assert(text.includes(headerFor("macOS")));
  assertEquals(text.indexOf(headerFor("Node")) < text.indexOf(headerFor("Python")), true);
  const r = mergeGitignore("", [{ name: "Node", content: NODE }, { name: "Node again", content: NODE }]);
  assertEquals(r.unchanged, ["Node again"]);
});

Deno.test("existing file without a final newline, with CRLF", () => {
  const r = mergeGitignore("dist\r\n.env", [{ name: "Python", content: PYTHON }]);
  assert(r.text.startsWith("dist\r\n.env\n\n# --- Python"));
  assertEquals(r.skipped, 1);
});

Deno.test("messages", () => {
  const r = { text: "", added: 23, skipped: 8, unchanged: [] };
  assertEquals(
    mergeMessage(r, "~/code/app/.gitignore", false),
    "Added 23 lines to ~/code/app/.gitignore (8 already there)",
  );
  assertEquals(mergeMessage({ ...r, skipped: 0 }, "~/a/.gitignore", true), "Created ~/a/.gitignore with 23 lines");
  assertEquals(mergeMessage({ ...r, added: 0 }, "~/a/.gitignore", false), "~/a/.gitignore already has every line");
});

Deno.test("suggestions from a project's files", () => {
  assertEquals(suggestFor(["package.json", "README.md"]), ["Node.gitignore"]);
  assertEquals(suggestFor(["pyproject.toml", "Cargo.toml"]), ["Python.gitignore", "Rust.gitignore"]);
  assertEquals(suggestFor(["build.gradle.kts"]), ["Gradle.gitignore", "Java.gitignore"]);
  assertEquals(suggestFor(["main.tf"]), ["Terraform.gitignore"]);
  assertEquals(suggestFor([]), []);
});

Deno.test("code fences survive backticks", () => {
  assertEquals(fence("a\n"), "```gitignore\na\n```");
  assertEquals(fence("```x```"), "````gitignore\n```x```\n````");
});

Deno.test("folders", () => {
  assertEquals(parseFolders("~/code, /srv/x/", "/home/ada"), ["/home/ada/code", "/srv/x"]);
  assertEquals(parseFolders(undefined, "/home/ada").length, 9);
});

Deno.test("projects and writing .gitignore on disk", async () => {
  const root = await Deno.makeTempDir();
  try {
    await Deno.mkdir(`${root}/app/src`, { recursive: true });
    await Deno.writeTextFile(`${root}/app/package.json`, "{}");
    await Deno.writeTextFile(`${root}/app/.gitignore`, "node_modules/\n\n*.log\n");
    await Deno.mkdir(`${root}/work/api/.git`, { recursive: true });
    await Deno.mkdir(`${root}/notes`);
    const projects = await findProjects(root, 2);
    assertEquals(projects.map((p) => p.path.slice(root.length)).sort(), ["/app", "/work/api"]);
    const app = projects.find((p) => p.path.endsWith("/app"))!;
    assertEquals(app.gitignoreLines, 2);
    assertEquals(suggestFor(app.files), ["Node.gitignore"]);

    const r = await writeGitignore(app.path, [{ name: "Node", content: NODE }]);
    assertEquals([r.added, r.skipped, r.created], [5, 2, false]);
    const text = await Deno.readTextFile(`${root}/app/.gitignore`);
    assert(text.startsWith("node_modules/\n\n*.log\n\n# --- Node"));

    const created = await writeGitignore(`${root}/work/api/`, [{ name: "macOS", content: MACOS }]);
    assert(created.created);
    assertEquals(created.path, `${root}/work/api/.gitignore`);
    assert((await Deno.readTextFile(created.path)).includes(".DS_Store"));

    // Nothing new: the file is left alone.
    const before = (await Deno.stat(created.path)).mtime;
    const none = await writeGitignore(`${root}/work/api`, [{ name: "macOS", content: MACOS }]);
    assertEquals(none.added, 0);
    assertEquals((await Deno.stat(created.path)).mtime?.getTime(), before?.getTime());
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("manifest hosts", async () => {
  const manifest = parse(await Deno.readTextFile(new URL("./backslash.toml", import.meta.url))) as {
    permissions: { net: string[] };
    commands: { name: string }[];
  };
  assertEquals(manifest.permissions.net, [new URL(TREE_URL).host, new URL(rawUrl("x")).host]);
  for (const c of manifest.commands) await Deno.stat(new URL(`./commands/${c.name}.ts`, import.meta.url));
});
