import { assertEquals } from "@std/assert";
import {
  type Account,
  basicAuth,
  builds,
  type Issue,
  issueIcon,
  issueItem,
  prIcon,
  prItem,
  prMetadata,
  type Pull,
  q,
  type Repo,
  repoItem,
  reviews,
  uniquePulls,
} from "./lib.ts";

// Shaped like the Bitbucket Cloud 2.0 API.
const ada: Account = {
  uuid: "{3f1b2c4d-0000-4000-8000-1a2b3c4d5e6f}",
  account_id: "557058:ada",
  display_name: "Ada Lovelace",
  nickname: "ada",
  links: { avatar: { href: "https://secure.gravatar.com/avatar/abc?d=https%3A%2F%2Favatar-management" } },
};
const bob: Account = { uuid: "{bob}", display_name: "Bob Martin", links: { avatar: { href: "https://x/bob" } } };
const eve: Account = { uuid: "{eve}", display_name: "Eve Moneypenny" };

const pr: Pull = {
  id: 42,
  title: "Retry webhooks with backoff",
  description: "Retries failed deliveries 5 times.",
  state: "OPEN",
  draft: false,
  author: ada,
  source: { branch: { name: "feature/retry" }, repository: { full_name: "acme/hooks" }, commit: { hash: "9f8e7d6" } },
  destination: { branch: { name: "main" }, repository: { full_name: "acme/hooks" } },
  comment_count: 3,
  task_count: 1,
  created_on: "2026-10-26T08:00:00.000000+00:00",
  updated_on: new Date().toISOString(),
  links: { html: { href: "https://bitbucket.org/acme/hooks/pull-requests/42" } },
  reviewers: [bob, eve],
  participants: [
    { user: bob, role: "REVIEWER", approved: true, state: "approved" },
    { user: eve, role: "REVIEWER", approved: false, state: "changes_requested" },
    { user: ada, role: "PARTICIPANT", approved: false, state: null },
  ],
  statuses: [
    { key: "build", name: "Pipeline #118", state: "SUCCESSFUL" },
    { key: "sonar", name: "SonarCloud", state: "FAILED" },
  ],
};

Deno.test("auth header and queries", () => {
  assertEquals(basicAuth("ada@example.com", "ATATT3x"), `Basic ${btoa("ada@example.com:ATATT3x")}`);
  assertEquals(basicAuth("zoé", "pä"), "Basic em/DqTpww6Q=");
  assertEquals(q("reviewers.uuid", ada.uuid!), 'reviewers.uuid="{3f1b2c4d-0000-4000-8000-1a2b3c4d5e6f}"');
  assertEquals(q("name", 'a"b'), 'name="a\\"b"');
});

Deno.test("builds and reviews", () => {
  assertEquals(builds(pr.statuses)?.text, "1 of 2 builds failed");
  assertEquals(builds([{ key: "a", state: "INPROGRESS" }, { key: "b", state: "SUCCESSFUL" }])?.color, "yellow");
  assertEquals(builds([{ key: "a", state: "SUCCESSFUL" }])?.text, "Build passed");
  assertEquals(builds([]), undefined);
  const r = reviews(pr);
  assertEquals([r.approved.length, r.changes.length, r.total, r.reviewersApproved], [1, 1, 2, 1]);
  assertEquals(prIcon(pr), { source: "bs-pr-open", tint: "green" });
  assertEquals(prIcon({ ...pr, state: "MERGED" }).source, "bs-pr-merged");
  assertEquals(prIcon({ ...pr, draft: true }).tint, "gray");
});

Deno.test("pull request item and panel", () => {
  const item = prItem(pr, "acme/hooks");
  assertEquals([item.id, item.subtitle], ["acme/hooks#42", "#42"]);
  assertEquals(item.accessories?.map((a) => a.tag ?? a.text ?? a.tooltip), [
    "1 of 2 builds failed",
    "Changes requested",
    "1",
    "3",
    "Ada Lovelace",
    "today",
  ]);
  const lines = prMetadata(pr).map((m) => [m.label, m.value ?? m.tags?.map((t) => t.text).join(", ")]);
  assertEquals(lines.slice(0, 9), [
    ["Status", "Open"],
    ["Author", "Ada Lovelace"],
    ["Branch", "feature/retry → main"],
    ["Builds", "1 of 2 builds failed"],
    ["  Pipeline #118", "Successful"],
    ["  SonarCloud", "Failed"],
    ["Approvals", "1"],
    ["Reviewers", "1 of 2 approved"],
    ["Approved by", "Bob Martin"],
  ]);
  assertEquals(lines.slice(9, 11), [["Changes requested", "Eve Moneypenny"], ["Waiting on", "Eve Moneypenny"]]);
  // From the list, before the details load: no approvals line.
  const bare = prItem({ ...pr, participants: undefined, statuses: undefined }, "other/repo");
  assertEquals(bare.subtitle, "hooks #42");
  assertEquals(bare.accessories?.length, 3);
  assertEquals(
    (bare.actions?.find((a) => a.title === "Copy Checkout Command") as { text: string }).text,
    [
      "git fetch origin feature/retry && git switch feature/retry",
    ][0],
  );
});

Deno.test("unique pull requests, newest first", () => {
  const a = { ...pr, id: 1, updated_on: "2026-10-01T00:00:00Z" };
  const b = { ...pr, id: 2, updated_on: "2026-10-03T00:00:00Z" };
  assertEquals(uniquePulls([a, b, a]).map((p) => p.id), [2, 1]);
});

const repo: Repo = {
  uuid: "{r1}",
  full_name: "acme/hooks",
  name: "hooks",
  description: "Webhook delivery service",
  is_private: true,
  language: "go",
  updated_on: "2026-10-20T10:00:00Z",
  size: 4_200_000,
  has_issues: true,
  mainbranch: { name: "main" },
  links: {
    html: { href: "https://bitbucket.org/acme/hooks" },
    clone: [
      { name: "https", href: "https://ada@bitbucket.org/acme/hooks.git" },
      { name: "ssh", href: "git@bitbucket.org:acme/hooks.git" },
    ],
  },
  workspace: { slug: "acme", name: "Acme Corp" },
  project: { key: "PLAT", name: "Platform" },
};

Deno.test("repository item", () => {
  const item = repoItem(repo, "Acme Corp");
  assertEquals(item.icon, { source: "bs-lock", tint: "teal" });
  assertEquals(item.accessories?.map((a) => a.tag ?? a.text), ["PLAT", "Go", item.accessories![2].text]);
  const clone = (t: string) => (item.actions?.find((a) => a.title === t) as { text: string }).text;
  assertEquals(clone("Copy git clone (SSH)"), "git clone git@bitbucket.org:acme/hooks.git");
  assertEquals(clone("Copy git clone (HTTPS)"), "git clone https://bitbucket.org/acme/hooks.git");
  assertEquals(item.actions?.some((a) => a.title === "Open Issues"), true);
  assertEquals(item.detail?.metadata?.find((m) => m.label === "Size")?.value, "4.2 MB");
});

Deno.test("issue item", () => {
  const issue: Issue = {
    id: 7,
    title: "Retries ignore Retry-After",
    state: "open",
    kind: "bug",
    priority: "critical",
    assignee: ada,
    reporter: bob,
    content: { raw: "Seen on **staging**." },
    votes: 2,
    created_on: "2026-10-20T10:00:00Z",
    updated_on: "2026-10-27T10:00:00Z",
    links: { html: { href: "https://bitbucket.org/acme/hooks/issues/7" } },
    repository: { full_name: "acme/hooks" },
  };
  const item = issueItem(issue);
  assertEquals(item.icon, { source: "bs-bug", tint: "red" });
  assertEquals(item.accessories?.[0], {
    icon: { source: "bs-priority-high", tint: "orange" },
    tooltip: "Critical priority",
  });
  assertEquals(item.detail?.markdown, "Seen on **staging**.");
  assertEquals(issueIcon({ ...issue, state: "resolved" }).source, "bs-issue-closed");
  assertEquals(issueItem({ ...issue, state: "on hold" }).accessories?.[1].tag, "On hold");
});
