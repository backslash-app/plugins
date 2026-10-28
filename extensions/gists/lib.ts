// Gists: how they look, code fences and file names. Tested in lib_test.ts.

import { type Action, type Color, Icons, type Item, meta, type Metadata } from "@backslash/api";

export interface GistFile {
  filename: string;
  type?: string;
  language?: string | null;
  raw_url: string;
  size: number;
  /** Only from `GET /gists/{id}`. */
  content?: string;
  truncated?: boolean;
}

/** `GET /gists` (no contents) or `GET /gists/{id}` (with contents). */
export interface Gist {
  id: string;
  html_url: string;
  git_pull_url?: string;
  description: string | null;
  public: boolean;
  created_at: string;
  updated_at: string;
  comments: number;
  owner?: { login: string; avatar_url?: string } | null;
  files: Record<string, GistFile>;
  truncated?: boolean;
}

export const files = (g: Gist) => Object.values(g.files ?? {});

export const gistTitle = (g: Gist) => g.description?.trim() || files(g)[0]?.filename || g.id;

// --- Formatting ---------------------------------------------------------------------

export function size(bytes: number): string {
  if (bytes < 1000) return `${bytes} B`;
  if (bytes < 1_000_000) return `${(bytes / 1000).toFixed(bytes < 10_000 ? 1 : 0)} KB`;
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

/** "today", "yesterday", "3d", "25 Oct", "Mar 2024". */
export function ago(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const days = Math.floor((now.getTime() - d.getTime()) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days}d`;
  if (days < 365) return d.toLocaleDateString("en", { day: "numeric", month: "short" });
  return d.toLocaleDateString("en", { month: "short", year: "numeric" });
}

/** GitHub language names → code fence info strings. */
const FENCES: Record<string, string> = {
  "C++": "cpp",
  "C#": "csharp",
  "F#": "fsharp",
  "Objective-C": "objectivec",
  Shell: "bash",
  "Bourne Shell": "bash",
  "Bourne Again Shell": "bash",
  PowerShell: "powershell",
  "Vim Script": "vim",
  "Emacs Lisp": "elisp",
  "Git Config": "ini",
  INI: "ini",
  "Jupyter Notebook": "json",
  "JSON with Comments": "jsonc",
  "Protocol Buffer": "protobuf",
  TSX: "tsx",
  JSX: "jsx",
  Text: "text",
  Dockerfile: "dockerfile",
  Makefile: "makefile",
};

export function fence(file: GistFile): string {
  const lang = file.language ?? "";
  if (FENCES[lang]) return FENCES[lang];
  if (lang) return lang.toLowerCase().replace(/\s+/g, "-");
  const ext = /\.([a-z0-9]+)$/i.exec(file.filename)?.[1]?.toLowerCase();
  return ext ?? "text";
}

const LANGUAGE_COLORS: Record<string, Color> = {
  TypeScript: "blue",
  JavaScript: "yellow",
  Python: "blue",
  Rust: "orange",
  Go: "teal",
  Shell: "green",
  Ruby: "red",
  Java: "orange",
  Kotlin: "purple",
  PHP: "purple",
  "C++": "pink",
  C: "gray",
  "C#": "green",
  Markdown: "gray",
  JSON: "gray",
  YAML: "red",
  HTML: "red",
  CSS: "purple",
  SQL: "orange",
  Lua: "blue",
  Nix: "blue",
  Swift: "orange",
  Dart: "teal",
  Elixir: "purple",
  Haskell: "purple",
  TOML: "orange",
  Dockerfile: "blue",
};

export const languageColor = (lang?: string | null): Color => LANGUAGE_COLORS[lang ?? ""] ?? "gray";

/** A file as a code block, cut after `maxLines` lines. */
export function fileBlock(file: GistFile, maxLines = 60, maxChars = 4000): string {
  const header = `**${file.filename}** · ${[file.language, size(file.size)].filter(Boolean).join(" · ")}`;
  if (file.content === undefined) return `${header}\n\n_Loading…_`;
  let lines = file.content.replace(/\s+$/, "").split("\n");
  let cut = lines.length > maxLines;
  lines = lines.slice(0, maxLines);
  let text = lines.join("\n");
  if (text.length > maxChars) {
    text = text.slice(0, maxChars);
    cut = true;
  }
  // A fence longer than any run of backticks inside.
  const ticks = Math.max(3, ...[...text.matchAll(/`+/g)].map((m) => m[0].length + 1));
  const f = "`".repeat(ticks);
  const more = cut || file.truncated ? "\n\n_… more in the full file._" : "";
  return `${header}\n\n${f}${fence(file)}\n${text}\n${f}${more}`;
}

export function gistMarkdown(g: Gist, maxFiles = 5): string {
  const all = files(g);
  const parts = all.slice(0, maxFiles).map((f) => fileBlock(f));
  if (all.length > maxFiles) parts.push(`_And ${all.length - maxFiles} more files._`);
  return parts.join("\n\n");
}

export function gistMetadata(g: Gist, now = new Date()): Metadata[] {
  const all = files(g);
  const languages = [...new Set(all.map((f) => f.language).filter((l): l is string => !!l))];
  return [
    meta.text("Visibility", g.public ? "Public" : "Secret", {
      icon: g.public ? Icons.globe : Icons.lock,
      color: g.public ? "blue" : "orange",
    }),
    meta.text("Files", all.length === 1 ? all[0].filename : `${all.length} files`, { icon: Icons.file }),
    ...(languages.length ? [meta.tags("Languages", languages.map((l) => ({ text: l, color: languageColor(l) })))] : []),
    meta.text("Size", size(all.reduce((n, f) => n + (f.size ?? 0), 0))),
    meta.separator(),
    ...(g.owner ? [meta.person("Owner", g.owner.login, g.owner.avatar_url)] : []),
    ...(g.comments ? [meta.text("Comments", g.comments, { icon: Icons.comment })] : []),
    meta.text("Created", ago(g.created_at, now), { icon: Icons.calendar }),
    meta.text("Updated", ago(g.updated_at, now), { icon: Icons.clock }),
    meta.link("Gist", `gist.github.com/${g.id.slice(0, 8)}`, g.html_url),
  ];
}

export function gistItem(g: Gist, actions: Action[], now = new Date()): Item {
  const all = files(g);
  const first = all[0];
  const described = !!g.description?.trim();
  const names = all.map((f) => f.filename);
  return {
    id: g.id,
    title: gistTitle(g),
    subtitle: described ? (names.length > 1 ? `${names[0]} +${names.length - 1}` : names[0]) : undefined,
    icon: { source: Icons.code, tint: languageColor(first?.language) },
    keywords: [...names, ...all.map((f) => f.language ?? ""), g.public ? "public" : "secret"],
    accessories: [
      ...(first?.language ? [{ tag: first.language, color: languageColor(first.language) }] : []),
      ...(all.length > 1 ? [{ icon: Icons.file, text: String(all.length), tooltip: `${all.length} files` }] : []),
      ...(g.public ? [] : [{ icon: { source: Icons.lock, tint: "orange" as const }, tooltip: "Secret" }]),
      ...(g.comments ? [{ icon: Icons.comment, text: String(g.comments), tooltip: "Comments" }] : []),
      { text: ago(g.updated_at, now), tooltip: "Updated" },
    ],
    detail: { markdown: gistMarkdown(g), metadata: gistMetadata(g, now) },
    actions,
  };
}

// --- Creating -----------------------------------------------------------------------

/** A file name matching what the clipboard looks like. */
export function guessFilename(content: string): string {
  const t = content.trim();
  const first = t.split("\n")[0];
  if (/^#!.*\b(bash|sh|zsh)\b/.test(first)) return "script.sh";
  if (/^#!.*\bpython/.test(first)) return "script.py";
  if (/^#!.*\b(node|deno|bun)\b/.test(first)) return "script.js";
  if (/^[{[]/.test(t)) {
    try {
      JSON.parse(t);
      return "snippet.json";
    } catch { /* not JSON */ }
  }
  if (/^<\?php/.test(t)) return "snippet.php";
  if (/^<(!doctype html|html)/i.test(t)) return "page.html";
  if (/^<\?xml|^<svg/i.test(t)) return t.startsWith("<svg") ? "image.svg" : "snippet.xml";
  if (/^package \w+/m.test(t) && /\bfunc\b/.test(t)) return "main.go";
  if (/\bfn \w+\(|^use (std|crate)::/m.test(t)) return "main.rs";
  if (/^(def |class \w+.*:|import \w+$|from [\w.]+ import )/m.test(t)) return "snippet.py";
  if (/\b(interface|type) \w+ = |: (string|number|boolean)\b|^import .* from ["']/m.test(t)) return "snippet.ts";
  if (/^(const|let|function|export) /m.test(t)) return "snippet.js";
  if (/^\s*(SELECT|INSERT INTO|CREATE TABLE|UPDATE|WITH)\b/i.test(t)) return "query.sql";
  if (/^\[[\w.]+\]\s*$/m.test(t) && /^\w+\s*=\s*/m.test(t)) return "config.toml";
  if (/^(FROM|RUN) /m.test(t) && /^FROM /m.test(t)) return "Dockerfile";
  if (/^#{1,3} \S/m.test(t) || /^[-*] \S/m.test(t)) return "notes.md";
  if (/^[\w-]+:( |$)/m.test(t) && t.split("\n").filter((l) => /^\s*[\w-]+:( |$)/.test(l)).length >= 2) {
    return "config.yaml";
  }
  return "snippet.txt";
}

/** Body of `POST /gists`. */
export function newGist(values: { description?: string; filename?: string; content: string; visibility?: string }) {
  const content = values.content;
  if (!content.trim()) throw new Error("The gist is empty: copy some text first, or type it");
  const filename = (values.filename ?? "").trim().replace(/[/\\]/g, "-") || guessFilename(content);
  return {
    description: (values.description ?? "").trim(),
    public: values.visibility === "public",
    files: { [filename]: { content } },
  };
}
