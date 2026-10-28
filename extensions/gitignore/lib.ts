// github/gitignore templates: listing, combining, and merging into an existing .gitignore without duplicates.

export const REPO = "github/gitignore";
export const BRANCH = "main";
export const TREE_URL = `https://api.github.com/repos/${REPO}/git/trees/${BRANCH}?recursive=1`;
export const rawUrl = (path: string) =>
  `https://raw.githubusercontent.com/${REPO}/${BRANCH}/${path.split("/").map(encodeURIComponent).join("/")}`;
export const githubUrl = (path: string) =>
  `https://github.com/${REPO}/blob/${BRANCH}/${path.split("/").map(encodeURIComponent).join("/")}`;

export type Category = "language" | "global" | "community";

export const CATEGORY_TITLE: Record<Category, string> = {
  language: "Languages & Frameworks",
  global: "Editors & Operating Systems",
  community: "Community",
};

export interface Template {
  /** `Node`, `macOS`, `Vue`. */
  name: string;
  /** `Node.gitignore`, `Global/macOS.gitignore`, `community/JavaScript/Vue.gitignore`. */
  path: string;
  category: Category;
  /** The community folder, e.g. `JavaScript`. */
  group?: string;
  size?: number;
}

interface TreeEntry {
  path: string;
  type: "blob" | "tree" | string;
  size?: number;
}

/** The templates in a `GET /repos/github/gitignore/git/trees/main?recursive=1` answer. */
export function templatesFromTree(tree: { tree: TreeEntry[] }): Template[] {
  return tree.tree
    .filter((e) => e.type === "blob" && e.path.endsWith(".gitignore") && !e.path.startsWith("."))
    .map((e) => templateFromPath(e.path, e.size))
    .sort(compareTemplates);
}

export function templateFromPath(path: string, size?: number): Template {
  const parts = path.split("/");
  const name = parts[parts.length - 1].replace(/\.gitignore$/, "");
  const category: Category = parts[0] === "Global" ? "global" : parts[0] === "community" ? "community" : "language";
  return {
    name,
    path,
    category,
    ...(category === "community" && parts.length > 2 ? { group: parts.slice(1, -1).join("/") } : {}),
    ...(size !== undefined ? { size } : {}),
  };
}

const CATEGORY_ORDER: Category[] = ["language", "global", "community"];

function compareTemplates(a: Template, b: Template): number {
  return CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category) ||
    a.name.localeCompare(b.name, "en", { sensitivity: "base" });
}

/** The ones most people want, shown first. */
export const POPULAR = [
  "Node.gitignore",
  "Python.gitignore",
  "Rust.gitignore",
  "Go.gitignore",
  "Java.gitignore",
  "Global/macOS.gitignore",
  "Global/Linux.gitignore",
  "Global/Windows.gitignore",
  "Global/VisualStudioCode.gitignore",
  "Global/JetBrains.gitignore",
  "Global/Vim.gitignore",
  "C++.gitignore",
  "C.gitignore",
  "Ruby.gitignore",
  "Composer.gitignore",
  "Laravel.gitignore",
  "Gradle.gitignore",
  "Maven.gitignore",
  "Unity.gitignore",
  "VisualStudio.gitignore",
  "Terraform.gitignore",
  "Dart.gitignore",
  "Swift.gitignore",
  "Kotlin.gitignore",
];

/** Words people type for a template that its name doesn't contain. */
export const ALIASES: Record<string, string[]> = {
  "Node.gitignore": ["javascript", "typescript", "npm", "yarn", "pnpm", "js", "ts", "react", "next"],
  "Python.gitignore": ["pip", "django", "flask", "venv", "py", "poetry", "uv", "jupyter"],
  "Rust.gitignore": ["cargo", "crates"],
  "Go.gitignore": ["golang"],
  "Java.gitignore": ["jvm", "jar"],
  "C++.gitignore": ["cpp", "cplusplus", "cmake"],
  "Ruby.gitignore": ["rails", "gem", "bundler"],
  "Composer.gitignore": ["php"],
  "Global/macOS.gitignore": ["mac", "osx", "apple", "ds_store"],
  "Global/Windows.gitignore": ["win", "thumbs.db"],
  "Global/VisualStudioCode.gitignore": ["vscode", "vs code", "code"],
  "Global/JetBrains.gitignore": ["intellij", "idea", "pycharm", "webstorm", "goland", "rider", "clion", "phpstorm"],
  "Global/Vim.gitignore": ["neovim", "nvim", "swap"],
  "Global/Emacs.gitignore": ["spacemacs", "doom"],
  "VisualStudio.gitignore": ["dotnet", ".net", "csharp", "c#", "msvc"],
  "Dart.gitignore": ["flutter"],
  "Terraform.gitignore": ["tf", "hcl", "opentofu"],
  "Unity.gitignore": ["game", "unity3d"],
  "TeX.gitignore": ["latex", "tex"],
};

/** Templates worth suggesting for the files at the root of a project. */
export function suggestFor(files: string[]): string[] {
  const has = (name: string | RegExp) => files.some((f) => typeof name === "string" ? f === name : name.test(f));
  const out: string[] = [];
  if (has("package.json")) out.push("Node.gitignore");
  if (has("pyproject.toml") || has("requirements.txt") || has("setup.py") || has("Pipfile")) {
    out.push("Python.gitignore");
  }
  if (has("Cargo.toml")) out.push("Rust.gitignore");
  if (has("go.mod")) out.push("Go.gitignore");
  if (has("Gemfile")) out.push("Ruby.gitignore");
  if (has("composer.json")) out.push("Composer.gitignore");
  if (has("pom.xml")) out.push("Maven.gitignore", "Java.gitignore");
  if (has(/^build\.gradle(\.kts)?$/) || has(/^settings\.gradle(\.kts)?$/)) {
    out.push("Gradle.gitignore", "Java.gitignore");
  }
  if (has("CMakeLists.txt")) out.push("CMake.gitignore", "C++.gitignore");
  if (has("pubspec.yaml")) out.push("Dart.gitignore");
  if (has(/\.tf$/)) out.push("Terraform.gitignore");
  if (has(/\.(sln|csproj)$/)) out.push("VisualStudio.gitignore");
  if (has("Package.swift")) out.push("Swift.gitignore");
  if (has("mix.exs")) out.push("Elixir.gitignore");
  if (has(/\.tex$/)) out.push("TeX.gitignore");
  return [...new Set(out)];
}

// ---------------------------------------------------------------------------
// Combining and merging

/** A pattern line as git compares it: trailing spaces dropped (unless escaped). */
export function normalizeLine(line: string): string {
  return line.replace(/\r$/, "").replace(/(?<!\\)\s+$/, "");
}

const isPattern = (line: string) => {
  const l = normalizeLine(line).trim();
  return l !== "" && !l.startsWith("#");
};

/** The patterns a .gitignore already has. */
export function patternsOf(text: string): Set<string> {
  return new Set(text.split("\n").filter(isPattern).map((l) => normalizeLine(l).trim()));
}

export const headerFor = (name: string) => `# --- ${name} (github.com/${REPO}) ---`;

export interface MergeResult {
  text: string;
  /** Pattern lines added. */
  added: number;
  /** Pattern lines skipped because the file already had them. */
  skipped: number;
  /** Templates that brought nothing new. */
  unchanged: string[];
}

/**
 * Appends the templates to `existing`, skipping the patterns it (or an earlier template) already has.
 * A template's comment lines are kept with the paragraph they introduce, and dropped with it when
 * all of its patterns are already there.
 */
export function mergeGitignore(existing: string, templates: { name: string; content: string }[]): MergeResult {
  const seen = patternsOf(existing);
  const blocks: string[] = [];
  let added = 0, skipped = 0;
  const unchanged: string[] = [];
  for (const t of templates) {
    const paragraphs = t.content.replace(/\r\n/g, "\n").split(/\n\s*\n/);
    const kept: string[] = [];
    for (const paragraph of paragraphs) {
      const lines = paragraph.split("\n").map(normalizeLine);
      const out: string[] = [];
      let patterns = 0;
      for (const line of lines) {
        if (!isPattern(line)) {
          if (line.trim()) out.push(line);
          continue;
        }
        const key = line.trim();
        if (seen.has(key)) {
          skipped++;
          continue;
        }
        seen.add(key);
        out.push(line);
        patterns++;
      }
      if (patterns) {
        added += patterns;
        kept.push(out.join("\n"));
      }
    }
    if (kept.length) blocks.push([headerFor(t.name), "", kept.join("\n\n")].join("\n"));
    else unchanged.push(t.name);
  }
  const base = existing.replace(/\s+$/, "");
  const text = [base, ...blocks].filter(Boolean).join("\n\n") + (base || blocks.length ? "\n" : "");
  return { text, added, skipped, unchanged };
}

/** The selected templates as one file. */
export function combine(templates: { name: string; content: string }[]): string {
  return mergeGitignore("", templates).text;
}

/** How many patterns a template has. */
export const patternCount = (content: string) => content.split("\n").filter(isPattern).length;

/** The first comment lines, as a one-line description. */
export function describe(content: string): string {
  const first = content.split("\n").map((l) => l.trim()).find((l) => l.startsWith("#") && l.replace(/^#+/, "").trim());
  return first ? first.replace(/^#+\s*/, "").slice(0, 120) : "";
}

/** A code block that can't be closed by the content. */
export function fence(text: string): string {
  const ticks = "`".repeat(Math.max(3, ...[...text.matchAll(/`{3,}/g)].map((m) => m[0].length + 1)));
  return `${ticks}gitignore\n${text.replace(/\s+$/, "")}\n${ticks}`;
}

// ---------------------------------------------------------------------------
// Projects

export const DEFAULT_FOLDERS = "~/Projects, ~/projects, ~/code, ~/Code, ~/src, ~/dev, ~/git, ~/repos, ~/workspace";

export function parseFolders(pref: string | undefined, home: string): string[] {
  const raw = (pref?.trim() || DEFAULT_FOLDERS).split(/[,:\n]/).map((f) => f.trim()).filter(Boolean);
  const expanded = raw.map((f) => expandHome(f, home).replace(/\/+$/, "") || "/");
  return [...new Set(expanded)].filter((f) => f.startsWith("/"));
}

export const expandHome = (path: string, home: string) => path.trim().replace(/^~(?=\/|$)/, home);

export const tilde = (path: string, home: string) =>
  home && (path === home || path.startsWith(`${home}/`)) ? `~${path.slice(home.length)}` : path;

/** Files that make a folder a project. */
export const MARKERS = new Set([
  ".git",
  "package.json",
  "Cargo.toml",
  "pyproject.toml",
  "setup.py",
  "requirements.txt",
  "go.mod",
  "Gemfile",
  "composer.json",
  "pom.xml",
  "build.gradle",
  "build.gradle.kts",
  "CMakeLists.txt",
  "Makefile",
  "pubspec.yaml",
  "mix.exs",
  "deno.json",
  "flake.nix",
]);

export const SKIP_DIRS = new Set(["node_modules", "vendor", "target", ".venv", "venv", "__pycache__", "build", "dist"]);

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** "Added 23 lines to ~/code/app/.gitignore (8 already there)". */
export function mergeMessage(r: MergeResult, where: string, created: boolean): string {
  if (!r.added) return `${where} already has every line`;
  const verb = created ? "Created" : "Added";
  return `${verb} ${created ? `${where} with ${plural(r.added, "line")}` : `${plural(r.added, "line")} to ${where}`}${
    r.skipped ? ` (${r.skipped} already there)` : ""
  }`;
}
