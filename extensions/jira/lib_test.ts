import { assertEquals } from "@std/assert";
import type { Context } from "@backslash/api";
import { AuthError, countStatus, errorText, guarded, normalizeSite } from "./api.ts";
import {
  adfToMarkdown,
  asKey,
  branchName,
  categoryName,
  type Issue,
  issueItem,
  issueMetadata,
  jqlFor,
  priorityLook,
  sortIssues,
  sprintOf,
  statusIcon,
  textToAdf,
  transitionActions,
  typeIcon,
} from "./lib.ts";

const ctx: Context = {
  args: {},
  preferences: { site: "acme.atlassian.net", email: "ada@acme.dev", token: "t" },
  query: "",
  signal: new AbortController().signal,
};

const AVATAR = "https://avatar-management--avatars.us-west-2.prod.public.atl-paas.net/5b10/abc/48";

// Shaped like an issue of `POST /rest/api/3/search/jql`.
const sample: Issue = {
  id: "10042",
  key: "ENG-42",
  fields: {
    summary: "Login page shows a blank screen",
    status: { name: "In Progress", statusCategory: { key: "indeterminate", name: "In Progress" } },
    priority: { id: "2", name: "High" },
    issuetype: { name: "Bug", subtask: false, hierarchyLevel: 0 },
    assignee: { accountId: "5b10", displayName: "Ada Lovelace", avatarUrls: { "48x48": AVATAR } },
    reporter: { accountId: "5b11", displayName: "Grace Hopper" },
    labels: ["frontend", "regression", "p1"],
    project: { key: "ENG", name: "Engineering" },
    created: "2026-10-20T09:00:00.000+0200",
    updated: "2026-10-27T09:00:00.000+0200",
    duedate: "2026-10-01",
    description: {
      type: "doc",
      version: 1,
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "Steps " }, { type: "text", text: "to", marks: [{ type: "strong" }] }, {
            type: "text",
            text: " reproduce:",
          }],
        },
      ],
    },
    customfield_10020: [
      { id: 1, name: "Sprint 41", state: "closed" },
      { id: 2, name: "Sprint 42", state: "active" },
    ],
  },
};

const issue = (key: string, category: string, priority: string, updated: string): Issue => ({
  ...sample,
  id: key,
  key,
  fields: {
    ...sample.fields,
    status: { name: category, statusCategory: { key: category, name: category } },
    priority: { id: "0", name: priority },
    updated,
  },
});

Deno.test("sites: name, host or URL; Jira Cloud only", () => {
  assertEquals(normalizeSite("acme"), "acme.atlassian.net");
  assertEquals(normalizeSite(" https://Acme.atlassian.net/jira/software/projects/ENG "), "acme.atlassian.net");
  assertEquals(normalizeSite("jira.acme.com"), "jira.acme.com");
});

Deno.test("Jira error bodies", () => {
  assertEquals(
    errorText({ errorMessages: ["Field 'x' does not exist"], errors: { summary: "You must specify a summary" } }),
    "Field 'x' does not exist; summary: You must specify a summary",
  );
});

Deno.test("status categories, priorities and types", () => {
  assertEquals(categoryName(sample), "In Progress");
  assertEquals(statusIcon(sample.fields.status), { source: "bs-circle-half", tint: "blue" });
  assertEquals(
    statusIcon({ name: "In Review", statusCategory: { key: "indeterminate", name: "" } }).source,
    "bs-circle-three-quarters",
  );
  assertEquals(statusIcon({ name: "Done", statusCategory: { key: "done", name: "" } }).tint, "green");
  assertEquals([priorityLook({ id: "1", name: "Highest" }).icon, priorityLook({ id: "3", name: "Medium" }).tint], [
    "bs-priority-urgent",
    "orange",
  ]);
  assertEquals(priorityLook(null).rank, 6);
  assertEquals(typeIcon({ name: "Bug" }), { source: "bs-bug", tint: "red" });
  assertEquals(typeIcon({ name: "Story" }).source, "bs-note");
  assertEquals(typeIcon({ name: "Sub-task", subtask: true }).source, "bs-layers");
  assertEquals(typeIcon({ name: "Task" }).source, "bs-square-check");
});

Deno.test("in progress first, then by priority and update", () => {
  const sorted = sortIssues([
    issue("A-1", "new", "Highest", "2026-10-01"),
    issue("A-2", "indeterminate", "Low", "2026-10-01"),
    issue("A-3", "indeterminate", "High", "2026-09-01"),
    issue("A-4", "indeterminate", "High", "2026-10-05"),
    issue("A-5", "new", "Medium", "2026-10-02"),
  ]);
  assertEquals(sorted.map((i) => i.key), ["A-4", "A-3", "A-2", "A-1", "A-5"]);
});

Deno.test("sprint: the active one", () => {
  assertEquals(sprintOf(sample, "customfield_10020")?.name, "Sprint 42");
  assertEquals(sprintOf(sample, undefined), undefined);
  assertEquals(
    sprintOf({ ...sample, fields: { ...sample.fields, customfield_10020: null } }, "customfield_10020"),
    undefined,
  );
});

Deno.test("ADF to Markdown and back", () => {
  const doc = {
    type: "doc",
    version: 1,
    content: [
      { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Context" }] },
      {
        type: "paragraph",
        content: [
          { type: "text", text: "See " },
          { type: "text", text: "the docs", marks: [{ type: "link", attrs: { href: "https://example.com" } }] },
          { type: "text", text: ", ask " },
          { type: "mention", attrs: { id: "1", text: "@Ada" } },
          { type: "hardBreak" },
          { type: "text", text: "run", marks: [{ type: "code" }] },
        ],
      },
      {
        type: "bulletList",
        content: [
          { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "one" }] }] },
          {
            type: "listItem",
            content: [
              { type: "paragraph", content: [{ type: "text", text: "two" }] },
              {
                type: "bulletList",
                content: [{
                  type: "listItem",
                  content: [{ type: "paragraph", content: [{ type: "text", text: "nested" }] }],
                }],
              },
            ],
          },
        ],
      },
      { type: "codeBlock", attrs: { language: "sh" }, content: [{ type: "text", text: "npm test" }] },
      {
        type: "taskList",
        content: [{ type: "taskItem", attrs: { state: "DONE" }, content: [{ type: "text", text: "done" }] }],
      },
      { type: "rule" },
    ],
  };
  assertEquals(
    adfToMarkdown(doc),
    "## Context\n\nSee [the docs](https://example.com), ask @Ada\n`run`\n\n- one\n- two\n  - nested\n\n```sh\nnpm test\n```\n\n- [x] done\n\n---",
  );
  assertEquals(adfToMarkdown(null), "");
  assertEquals(textToAdf("First line\nsecond\n\nNext"), {
    type: "doc",
    version: 1,
    content: [
      {
        type: "paragraph",
        content: [{ type: "text", text: "First line" }, { type: "hardBreak" }, { type: "text", text: "second" }],
      },
      { type: "paragraph", content: [{ type: "text", text: "Next" }] },
    ],
  });
});

Deno.test("search: text, keys and JQL", () => {
  assertEquals(jqlFor(""), "issuekey in issueHistory() ORDER BY lastViewed DESC");
  assertEquals(jqlFor("login pag"), 'text ~ "login pag*" ORDER BY updated DESC');
  assertEquals(jqlFor('say "hi"'), 'text ~ "say \\"hi\\"" ORDER BY updated DESC');
  assertEquals(jqlFor("project = ENG AND status = Done"), "project = ENG AND status = Done");
  assertEquals(jqlFor("assignee in (currentUser())"), "assignee in (currentUser())");
  assertEquals(jqlFor("labels is EMPTY"), "labels is EMPTY");
  assertEquals(jqlFor("login is broken"), 'text ~ "login is broken*" ORDER BY updated DESC');
  assertEquals([asKey(" eng-42 "), asKey("eng 42")], ["ENG-42", undefined]);
});

Deno.test("issue item and panel", () => {
  const item = issueItem(sample, ctx, { section: "In Progress", sprintField: "customfield_10020" });
  assertEquals(item.subtitle, "ENG-42");
  assertEquals(item.icon, { source: "bs-bug", tint: "red" });
  assertEquals(item.accessories?.[0], { tag: "In Progress", color: "blue" });
  assertEquals(item.accessories?.slice(1, 3), [{ tag: "frontend" }, { tag: "regression" }]);
  assertEquals(item.accessories?.[3], { icon: "bs-cycle", tooltip: "Sprint 42" });
  assertEquals(item.accessories?.[4].color, "red"); // overdue
  assertEquals(item.accessories?.[6], { avatar: AVATAR, tooltip: "Ada Lovelace" });
  assertEquals(item.detail?.markdown, "Steps **to** reproduce:");
  assertEquals(item.actions?.map((a) => a.title).slice(0, 5), [
    "Open in Jira",
    "Show Details",
    "Change Status",
    "Assign to Me",
    "Unassign",
  ]);
  assertEquals((item.actions?.[0] as { target: string }).target, "https://acme.atlassian.net/browse/ENG-42");
  assertEquals(issueMetadata(sample, "customfield_10020").map((m) => m.label).slice(0, 8), [
    "Status",
    "Type",
    "Priority",
    "Assignee",
    "Sprint",
    "Labels",
    "Due",
    "",
  ]);
  assertEquals(branchName(sample), "ENG-42-login-page-shows-a-blank-screen");
});

Deno.test("transitions: done last, named by their target", () => {
  const actions = transitionActions(
    { site: "acme.atlassian.net", email: "a", token: "t" },
    sample,
    [
      { id: "31", name: "Done", to: { name: "Done", statusCategory: { key: "done" } } },
      { id: "11", name: "Back to do", to: { name: "To Do", statusCategory: { key: "new" } } },
      { id: "21", name: "In Review", to: { name: "In Review", statusCategory: { key: "indeterminate" } } },
    ],
  );
  assertEquals(actions.map((a) => [a.title, a.icon]), [
    ["Back to do → To Do", "bs-circle"],
    ["In Review", "bs-circle-three-quarters"],
    ["Done", "bs-circle-check"],
  ]);
});

Deno.test("missing settings become a setup row", async () => {
  const items = await guarded(() => Promise.reject(new AuthError("Jira rejected the email or API token")));
  assertEquals([items[0].id, items[0].actions?.[0].title, countStatus(items, "issue")], [
    "setup",
    "Create API Token",
    "Not connected",
  ]);
});
