import { assertEquals } from "@std/assert";
import type { Context } from "@backslash/api";
import { colorOf, type Issue, issueItem, issueMetadata, shortDate, sortIssues, stateIcon } from "./lib.ts";

const ctx: Context = { args: {}, preferences: { apiKey: "k" }, query: "", signal: new AbortController().signal };

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
  assignee: { name: "Ada Lovelace", avatarUrl: null },
  labels: { nodes: [{ name: "Bug", color: "#eb5757" }] },
  children: { nodes: [{ state: { type: "completed" } }, { state: { type: "started" } }] },
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

Deno.test("states, labels and dates look like Linear", () => {
  assertEquals(stateIcon({ name: "In Review", type: "started" }), {
    source: "bs-circle-three-quarters",
    tint: "green",
  });
  assertEquals(stateIcon({ name: "Done", type: "completed" }).tint, "purple");
  assertEquals([colorOf("#eb5757"), colorOf("#4cb782"), colorOf("#5e6ad2"), colorOf("#bec2c8")], [
    "red",
    "green",
    "blue",
    "gray",
  ]);
  const now = new Date("2026-10-27T12:00:00");
  assertEquals(shortDate("2026-10-24T09:00:00", now), "3d");
});

Deno.test("issue item and its panel", () => {
  const item = issueItem(issue("ENG-1", "started", "In Progress", 1), ctx, { section: "In Progress" });
  assertEquals(item.subtitle, "ENG-1");
  assertEquals(item.icon, { source: "bs-circle-half", tint: "yellow" });
  assertEquals(item.accessories?.[0], { icon: { source: "bs-priority-urgent", tint: "orange" }, tooltip: "Urgent" });
  assertEquals(item.accessories?.[1], { tag: "Bug", color: "red" });
  assertEquals(item.accessories?.[2], { avatar: "Ada Lovelace", tooltip: "Ada Lovelace" });
  const titles = item.actions?.map((a) => a.title);
  assertEquals(titles?.slice(0, 5), ["Open in Linear", "Show Details", "Change Status", "Set Priority", "Assign To"]);
  const labels = issueMetadata(issue("ENG-1", "started", "In Progress", 1)).map((m) => m.label);
  assertEquals(labels.slice(0, 6), ["Status", "Priority", "Assignee", "Labels", "Project", "Sub-issues"]);
});
