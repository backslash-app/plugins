import { assertEquals, assertStringIncludes, assertThrows } from "@std/assert";
import { fence, fileBlock, type Gist, gistItem, gistMarkdown, guessFilename, newGist, size } from "./lib.ts";

const now = new Date("2026-10-28T12:00:00Z");

// Shaped like GET /gists/{id}.
const gist: Gist = {
  id: "aa5a315d61ae9438b18d",
  html_url: "https://gist.github.com/ada/aa5a315d61ae9438b18d",
  git_pull_url: "https://gist.github.com/aa5a315d61ae9438b18d.git",
  description: "Kitty paste workaround",
  public: false,
  created_at: "2026-10-01T08:00:00Z",
  updated_at: "2026-10-27T09:00:00Z",
  comments: 2,
  owner: { login: "ada", avatar_url: "https://avatars.githubusercontent.com/u/1?v=4" },
  files: {
    "paste.sh": {
      filename: "paste.sh",
      type: "application/x-sh",
      language: "Shell",
      raw_url: "https://gist.githubusercontent.com/ada/aa5a/raw/paste.sh",
      size: 61,
      content: '#!/bin/sh\nkitty @ send-text --match recent:0 "$(wl-paste)"\n',
      truncated: false,
    },
    "README.md": {
      filename: "README.md",
      type: "text/markdown",
      language: "Markdown",
      raw_url: "https://gist.githubusercontent.com/ada/aa5a/raw/README.md",
      size: 40,
      content: "Use it like this:\n\n```sh\n./paste.sh\n```\n",
    },
  },
};

Deno.test("code fences", () => {
  assertEquals(fence(gist.files["paste.sh"]), "bash");
  assertEquals(fence({ filename: "a.cpp", language: "C++", raw_url: "", size: 1 }), "cpp");
  assertEquals(fence({ filename: "main.rs", language: "Rust", raw_url: "", size: 1 }), "rust");
  assertEquals(fence({ filename: "notes.org", language: null, raw_url: "", size: 1 }), "org");
  assertEquals([size(61), size(4321), size(52_000), size(2_400_000)], ["61 B", "4.3 KB", "52 KB", "2.4 MB"]);
});

Deno.test("file blocks", () => {
  assertEquals(
    fileBlock(gist.files["paste.sh"]),
    '**paste.sh** · Shell · 61 B\n\n```bash\n#!/bin/sh\nkitty @ send-text --match recent:0 "$(wl-paste)"\n```',
  );
  // Backticks inside get a longer fence.
  assertStringIncludes(fileBlock(gist.files["README.md"]), "````markdown\nUse it like this:");
  const long = { ...gist.files["paste.sh"], content: Array.from({ length: 100 }, (_, i) => `line ${i}`).join("\n") };
  const block = fileBlock(long, 10);
  assertStringIncludes(block, "line 9\n```");
  assertEquals(block.includes("line 10"), false);
  assertStringIncludes(block, "more in the full file");
  assertStringIncludes(fileBlock({ ...long, content: undefined }), "_Loading…_");
  assertEquals(gistMarkdown(gist).split("**").length, 5);
});

Deno.test("gist item", () => {
  const item = gistItem(gist, [], now);
  assertEquals(item.title, "Kitty paste workaround");
  assertEquals(item.subtitle, "paste.sh +1");
  assertEquals(item.icon, { source: "bs-code", tint: "green" });
  assertEquals(item.accessories?.map((a) => a.tag ?? a.text ?? a.tooltip), ["Shell", "2", "Secret", "2", "yesterday"]);
  assertEquals(item.detail?.metadata?.[0].value, "Secret");
  assertEquals(item.detail?.metadata?.[2].tags?.map((t) => t.text), ["Shell", "Markdown"]);
  const untitled = gistItem({ ...gist, description: "", public: true }, [], now);
  assertEquals([untitled.title, untitled.subtitle], ["paste.sh", undefined]);
});

Deno.test("file names from the clipboard", () => {
  assertEquals(guessFilename("#!/usr/bin/env bash\necho hi"), "script.sh");
  assertEquals(guessFilename('{"a": 1}'), "snippet.json");
  assertEquals(guessFilename("{ not json"), "snippet.txt");
  assertEquals(guessFilename('fn main() {\n    println!("hi");\n}'), "main.rs");
  assertEquals(guessFilename("package main\n\nfunc main() {}"), "main.go");
  assertEquals(guessFilename("from pathlib import Path\nprint(Path.home())"), "snippet.py");
  assertEquals(guessFilename('import { assert } from "@std/assert";\nconst x: number = 1;'), "snippet.ts");
  assertEquals(guessFilename("SELECT * FROM users WHERE id = 1;"), "query.sql");
  assertEquals(guessFilename("# Title\n\nSome notes"), "notes.md");
  assertEquals(guessFilename("name: CI\non: push\njobs:\n  test: {}"), "config.yaml");
  assertEquals(guessFilename('[package]\nname = "x"'), "config.toml");
  assertEquals(guessFilename("just some words"), "snippet.txt");
});

Deno.test("new gist body", () => {
  assertEquals(newGist({ description: " Paste ", filename: "a/b.sh", content: "echo", visibility: "public" }), {
    description: "Paste",
    public: true,
    files: { "a-b.sh": { content: "echo" } },
  });
  assertEquals(newGist({ content: '{"a":1}' }).files, { "snippet.json": { content: '{"a":1}' } });
  assertEquals(newGist({ content: "x" }).public, false);
  assertThrows(() => newGist({ content: "  \n" }), Error, "empty");
});
