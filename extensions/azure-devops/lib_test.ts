import { assertEquals, assertStringIncludes } from "@std/assert";
import {
  ago,
  type Build,
  buildItem,
  currentFailures,
  formatDuration,
  guessCategory,
  htmlToText,
  myWorkItemsQuery,
  normalizeOrg,
  parseList,
  patAuth,
  policySummary,
  prArtifactId,
  prItem,
  prMetadata,
  prUrl,
  type Pull,
  queueBody,
  refName,
  runGroup,
  runStatus,
  sortBuilds,
  sortWorkItems,
  splitTags,
  statePatch,
  uniquePulls,
  votes,
  withVersion,
  type WorkItem,
  workItemItem,
  workItemUrl,
} from "./lib.ts";

// Shaped like the Azure DevOps REST API 7.1.
const ada = { id: "ada-id", displayName: "Ada Lovelace", uniqueName: "ada@contoso.com" };
const bob = { id: "bob-id", displayName: "Bob Martin" };

const pr: Pull = {
  pullRequestId: 42,
  title: "Retry webhooks with backoff",
  description: "Retries failed deliveries 5 times.",
  status: "active",
  isDraft: false,
  mergeStatus: "succeeded",
  createdBy: ada,
  creationDate: "2026-10-26T08:00:00Z",
  sourceRefName: "refs/heads/feature/retry",
  targetRefName: "refs/heads/main",
  reviewers: [
    { ...bob, vote: 10, isRequired: true },
    { id: "me", displayName: "Me", vote: 0, isRequired: true },
    { id: "team", displayName: "[Web]\\Web Team", vote: 0, isContainer: true },
  ],
  repository: { id: "repo-1", name: "hooks", project: { id: "proj-1", name: "Web App" } },
  policies: [
    {
      evaluationId: "e1",
      status: "approved",
      configuration: { isBlocking: true, isEnabled: true, type: { displayName: "Minimum number of reviewers" } },
    },
    {
      evaluationId: "e2",
      status: "rejected",
      configuration: {
        isBlocking: true,
        isEnabled: true,
        type: { displayName: "Build" },
        settings: { displayName: "CI build" },
      },
      context: { buildId: 77 },
    },
    {
      evaluationId: "e3",
      status: "notApplicable",
      configuration: { isEnabled: true, type: { displayName: "Comment requirements" } },
    },
  ],
};

Deno.test("organization, auth and URLs", () => {
  assertEquals(normalizeOrg("acme"), "acme");
  assertEquals(normalizeOrg("https://dev.azure.com/acme/Web%20App/_git/x"), "acme");
  assertEquals(normalizeOrg("https://acme.visualstudio.com/"), "acme");
  assertEquals(normalizeOrg("  "), "");
  assertEquals(patAuth("abc"), `Basic ${btoa(":abc")}`);
  assertEquals(parseList(" Web App, ,Mobile "), ["Web App", "Mobile"]);
  assertEquals(withVersion("/_apis/projects"), "/_apis/projects?api-version=7.1");
  assertEquals(withVersion("/_apis/projects?$top=1"), "/_apis/projects?$top=1&api-version=7.1");
  assertEquals(withVersion("/x?api-version=7.1-preview", "7.0"), "/x?api-version=7.1-preview");
  assertEquals(prUrl("acme", pr), "https://dev.azure.com/acme/Web%20App/_git/hooks/pullrequest/42");
  assertEquals(prArtifactId(pr), "vstfs:///CodeReview/CodeReviewId/proj-1/42");
});

Deno.test("formatting", () => {
  const now = Date.parse("2026-10-29T12:00:00Z");
  assertEquals(ago("2026-10-29T11:59:30Z", now), "now");
  assertEquals(ago("2026-10-29T11:00:00Z", now), "1h");
  assertEquals(ago("2026-10-27T12:00:00Z", now), "2d");
  assertEquals(ago(undefined, now), "");
  assertEquals(formatDuration(65_000), "1m 5s");
  assertEquals(formatDuration(3_720_000), "1h 2m");
  assertEquals(formatDuration(undefined), "—");
  assertEquals(refName("refs/heads/feature/x"), "feature/x");
  assertEquals(refName("refs/tags/v1"), "v1");
  assertEquals(refName("refs/pull/12/merge"), "PR 12");
  assertEquals(htmlToText("<div>Hello&nbsp;<b>world</b></div><ul><li>one</li></ul>"), "Hello world\n- one");
});

Deno.test("votes and policies", () => {
  const v = votes(pr);
  assertEquals(v.people.map((r) => r.id), ["bob-id", "me"]);
  assertEquals([v.approved.length, v.required.length, v.requiredPending.length], [1, 2, 1]);
  const p = policySummary(pr.policies)!;
  assertEquals([p.text, p.color, p.failed.length], ["1 of 2 policies failing", "red", 1]);
  assertEquals(policySummary([])?.text, undefined);
  assertEquals(policySummary([pr.policies![0]])?.text, "Policy passed");
  const md = prMetadata("acme", pr);
  assertEquals(md.find((m) => m.label === "  CI build")?.value, "Failed");
  assertEquals(md.some((m) => m.label.includes("Comment requirements")), false);
  assertEquals(md.find((m) => m.label === "Required")?.value, "1 of 2 approved");
});

Deno.test("pull request item", () => {
  const item = prItem("acme", pr, "bob-id");
  assertEquals([item.id, item.subtitle, item.section], ["repo-1#42", "hooks !42", "Web App"]);
  assertEquals(item.accessories?.map((a) => a.tag ?? a.text ?? a.tooltip), [
    "1 of 2 policies failing",
    "1/2",
    "You: Approved",
    "Ada Lovelace",
    item.accessories?.at(-1)?.text,
  ]);
  assertEquals(item.actions?.[0].title, "Open in Browser");
  const conflicts = prItem("acme", { ...pr, mergeStatus: "conflicts", isDraft: true, policies: undefined }, "x");
  assertEquals(conflicts.accessories?.[0].tag, "Conflicts");
  assertEquals(conflicts.icon, { source: "bs-pr-draft", tint: "gray" });
  const older = { ...pr, pullRequestId: 7, creationDate: "2026-01-01T00:00:00Z" };
  assertEquals(uniquePulls([older, pr, pr]).map((p) => p.pullRequestId), [42, 7]);
});

const wi = (id: number, state: string, fields: Partial<WorkItem["fields"]> = {}): WorkItem => ({
  id,
  fields: {
    "System.Title": `Item ${id}`,
    "System.State": state,
    "System.WorkItemType": "Bug",
    "System.TeamProject": "Web App",
    "System.ChangedDate": "2026-10-28T10:00:00Z",
    ...fields,
  },
});

Deno.test("work items", () => {
  const q = myWorkItemsQuery(["Web App", "O'Neil"]);
  assertStringIncludes(q, "[System.AssignedTo] = @Me");
  assertStringIncludes(q, "NOT IN ('Closed', 'Done', 'Removed', 'Completed', 'Cut')");
  assertStringIncludes(q, "[System.TeamProject] IN ('Web App', 'O''Neil')");
  assertEquals(myWorkItemsQuery().includes("TeamProject"), false);
  assertEquals(
    ["New", "Active", "Resolved", "Closed", "Removed", "To Do", "Committed"].map(guessCategory),
    ["Proposed", "InProgress", "Resolved", "Completed", "Removed", "Proposed", "InProgress"],
  );
  assertEquals(splitTags("frontend; urgent ;"), ["frontend", "urgent"]);
  assertEquals(statePatch("Active"), [{ op: "add", path: "/fields/System.State", value: "Active" }]);
  const w = wi(1234, "Active", {
    "Microsoft.VSTS.Common.Priority": 1,
    "System.IterationPath": "Web App\\Sprint 12",
    "System.Tags": "api; auth",
    "System.Description": "<p>Login fails</p>",
  });
  assertEquals(workItemUrl("acme", w), "https://dev.azure.com/acme/Web%20App/_workitems/edit/1234");
  const item = workItemItem("acme", w);
  assertEquals([item.title, item.subtitle, item.icon], ["Item 1234", "Bug 1234", { source: "bs-bug", tint: "red" }]);
  assertEquals(item.accessories?.map((a) => a.tag ?? a.text), [
    undefined,
    "Sprint 12",
    "Active",
    item.accessories?.[3].text,
  ]);
  assertEquals(item.detail?.markdown, "Login fails");
  assertEquals(item.actions?.find((a) => a.title.startsWith("Copy Commit"))?.title, "Copy Commit Mention (AB#)");
  const sorted = sortWorkItems(
    [
      wi(1, "New"),
      wi(2, "Active", { "Microsoft.VSTS.Common.Priority": 3 }),
      wi(3, "Active", {
        "Microsoft.VSTS.Common.Priority": 1,
      }),
    ],
    (x) => guessCategory(x.fields["System.State"]),
  );
  assertEquals(sorted.map((x) => x.id), [3, 2, 1]);
});

const build = (id: number, o: Partial<Build>): Build => ({
  id,
  buildNumber: `20261029.${id}`,
  status: "completed",
  result: "succeeded",
  definition: { id: 1, name: "CI" },
  project: { id: "proj-1", name: "Web App" },
  sourceBranch: "refs/heads/main",
  sourceVersion: "9f8e7d6c5b4a",
  queueTime: `2026-10-29T0${id}:00:00Z`,
  startTime: `2026-10-29T0${id}:00:10Z`,
  finishTime: `2026-10-29T0${id}:05:10Z`,
  ...o,
});

Deno.test("pipeline runs", () => {
  const old = build(1, { result: "failed" });
  const fixed = build(2, {});
  const broken = build(3, { result: "failed", definition: { id: 2, name: "Deploy" } });
  const running = build(4, { status: "inProgress", result: undefined, finishTime: undefined });
  assertEquals([old, fixed, running].map(runStatus), ["failed", "succeeded", "running"]);
  assertEquals(runStatus(build(5, { result: "partiallySucceeded" })), "partial");
  assertEquals(runStatus(build(5, { status: "notStarted", result: undefined })), "queued");
  const all = [old, fixed, broken, running];
  const failing = currentFailures(all);
  assertEquals([...failing].map((b) => b.id), [3]);
  assertEquals(runGroup(old, failing), "Recent");
  assertEquals(sortBuilds(all).map((b) => b.id), [3, 4, 2, 1]);
  const item = buildItem("acme", old, failing);
  assertEquals(item.section, "Recent");
  assertEquals(item.accessories?.at(-1)?.tag, "Failed (fixed since)");
  assertEquals(item.accessories?.[1].text, "5m 0s");
  const first = buildItem("acme", broken, failing).actions?.[0] as { title: string; target?: string };
  assertEquals(first.title, "Open in Browser");
  assertEquals(first.target, "https://dev.azure.com/acme/Web%20App/_build/results?buildId=3");
  assertEquals(queueBody(old), {
    definition: { id: 1 },
    sourceBranch: "refs/heads/main",
    sourceVersion: "9f8e7d6c5b4a",
  });
});
