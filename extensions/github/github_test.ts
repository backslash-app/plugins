import { assertEquals } from "@std/assert";
import type { Context } from "@backslash/api";
import { ago, colorOf, compact, languageColor } from "./api.ts";
import { checks, prItem, type PullRequest, review, stateIcon } from "./prs.ts";

const ctx: Context = { args: {}, preferences: {}, query: "", signal: new AbortController().signal };

const pr: PullRequest = {
  id: "PR_1",
  number: 57,
  title: "Detect terminals before pasting",
  url: "https://github.com/backslash-app/backslash/pull/57",
  body: "<!-- template -->Fixes pasting into Kitty.",
  isDraft: false,
  state: "OPEN",
  createdAt: "2026-10-27T08:00:00Z",
  updatedAt: "2026-10-27T10:00:00Z",
  additions: 86,
  deletions: 12,
  changedFiles: 4,
  headRefName: "fix/kitty-paste",
  baseRefName: "main",
  reviewDecision: "APPROVED",
  author: { login: "ada", avatarUrl: "https://avatars.githubusercontent.com/u/1" },
  repository: { nameWithOwner: "backslash-app/backslash" },
  labels: { nodes: [{ name: "bug", color: "d73a4a" }] },
  commits: { totalCount: 3, nodes: [{ commit: { statusCheckRollup: { state: "SUCCESS" } } }] },
};

Deno.test("numbers, dates and colors", () => {
  assertEquals([compact(950), compact(1234), compact(45_600), compact(2_300_000)], ["950", "1.2k", "46k", "2.3M"]);
  const now = new Date("2026-10-27T12:00:00Z");
  assertEquals([ago("2026-10-27T09:00:00Z", now), ago("2026-10-26T09:00:00Z", now), ago("2026-10-22T09:00:00Z", now)], [
    "today",
    "yesterday",
    "5d",
  ]);
  assertEquals([colorOf("d73a4a"), colorOf("0e8a16"), languageColor("Rust"), languageColor("Nope")], [
    "red",
    "green",
    "orange",
    "gray",
  ]);
});

Deno.test("pull request states, checks and reviews", () => {
  assertEquals(stateIcon(pr), { source: "bs-pr-open", tint: "green" });
  assertEquals(stateIcon({ ...pr, isDraft: true }).tint, "gray");
  assertEquals(stateIcon({ ...pr, state: "MERGED" }).source, "bs-pr-merged");
  assertEquals(checks(pr)?.color, "green");
  assertEquals(
    checks({ ...pr, commits: { totalCount: 1, nodes: [{ commit: { statusCheckRollup: { state: "FAILURE" } } }] } })
      ?.text,
    "Checks failed",
  );
  assertEquals(review(pr), { text: "Approved", color: "green" });
});

Deno.test("pull request item", () => {
  const item = prItem(pr, ctx, "backslash-app/backslash");
  assertEquals(item.subtitle, "#57");
  assertEquals(item.accessories?.map((a) => a.tag ?? a.text), [undefined, "Approved", "+86 −12", undefined, "today"]);
  assertEquals(item.detail?.markdown, "Fixes pasting into Kitty.");
  assertEquals(item.detail?.stats?.map((s) => s.value), [4, "+86", "−12"]);
  assertEquals(item.actions?.slice(0, 3).map((a) => a.title), [
    "Open in Browser",
    "Show Details",
    "Open Changed Files",
  ]);
});
