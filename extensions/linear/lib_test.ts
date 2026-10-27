import { assertEquals } from "@std/assert";
import { type Issue, issueItem, sortIssues } from "./lib.ts";

const issue = (identifier: string, type: string, name: string, priority: number, updatedAt = "2026-10-01"): Issue => ({
  id: identifier,
  identifier,
  title: `Title ${identifier}`,
  url: `https://linear.app/acme/issue/${identifier}`,
  priority,
  priorityLabel: ["No priority", "Urgent", "High", "Medium", "Low"][priority],
  updatedAt,
  state: { id: name, name, type },
  team: { id: "t", key: "ENG", name: "Engineering" },
  project: identifier === "ENG-1" ? { name: "Launch" } : null,
});

Deno.test("issues: in progress first, then by priority, no priority last", () => {
  const sorted = sortIssues([
    issue("ENG-1", "backlog", "Backlog", 1),
    issue("ENG-2", "unstarted", "Todo", 0),
    issue("ENG-3", "unstarted", "Todo", 3),
    issue("ENG-4", "started", "In Review", 4),
    issue("ENG-5", "started", "In Progress", 2, "2026-09-01"),
    issue("ENG-6", "started", "In Progress", 2, "2026-10-02"),
  ]);
  assertEquals(sorted.map((i) => i.identifier), ["ENG-6", "ENG-5", "ENG-4", "ENG-3", "ENG-2", "ENG-1"]);
});

Deno.test("issue item", () => {
  const item = issueItem(issue("ENG-1", "started", "In Progress", 1), { section: "In Progress" });
  assertEquals(item.subtitle, "ENG · Launch");
  assertEquals(item.accessories, [{ tag: "Urgent", color: "red" }, { text: "ENG-1" }]);
  assertEquals(item.actions?.map((a) => a.title), [
    "Open in Linear",
    "Copy Identifier",
    "Copy URL",
    "Copy as Markdown Link",
  ]);
  const movable = issueItem(issue("ENG-2", "unstarted", "Todo", 0), { moveTo: () => Promise.reject() });
  assertEquals(movable.accessories, [{ text: "ENG-2" }]);
  assertEquals(movable.actions?.[1].title, "Change Status…");
});
