import { assertEquals } from "jsr:@std/assert@1";
import { age, parseRepos } from "./lib.ts";

Deno.test("repositories: commas, spaces, duplicates and junk", () => {
  assertEquals(parseRepos("denoland/deno, rust-lang/rust\nnot a repo, denoland/deno"), [
    "denoland/deno",
    "rust-lang/rust",
  ]);
  assertEquals(parseRepos(""), []);
});

Deno.test("age of a release", () => {
  const now = Date.parse("2026-10-28T12:00:00Z");
  assertEquals(age("2026-10-28T08:00:00Z", now), "today");
  assertEquals(age("2026-10-25T12:00:00Z", now), "3d");
  assertEquals(age("2026-08-01T12:00:00Z", now), "2mo");
  assertEquals(age("2024-10-01T12:00:00Z", now), "2y");
});
