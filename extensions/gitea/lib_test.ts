import { assertEquals } from "@std/assert";
import {
  ago,
  checks,
  colorOf,
  compact,
  groupByRepo,
  type Issue,
  issueItem,
  issueMetadata,
  type Notification,
  notificationIcon,
  notificationUrl,
  type Pull,
  type Repo,
  repoIcon,
  repoItem,
  repoUrl,
  stateIcon,
  subjectNumber,
} from "./lib.ts";
import { AuthError, normalizeUrl, server, setupItems } from "./api.ts";

// Realistic Forgejo 13 / Gitea 1.24 responses (shapes from the API docs; codeberg.org runs Forgejo).
const user = { id: 42, login: "ada", full_name: "Ada Lovelace", avatar_url: "https://codeberg.org/avatars/1f2e" };
const repo = { id: 7, name: "backslash", owner: "backslash-app", full_name: "backslash-app/backslash" };
const issues = [
  {
    id: 901,
    number: 57,
    title: "Detect terminals before pasting",
    html_url: "https://codeberg.org/backslash-app/backslash/pulls/57",
    state: "open",
    body: "Fixes pasting into Kitty.\n\n<!-- template -->",
    user,
    labels: [{ id: 1, name: "bug", color: "ee0701" }],
    milestone: { title: "1.2" },
    assignees: [user],
    comments: 3,
    created_at: "2026-10-26T08:00:00Z",
    updated_at: "2026-10-28T09:00:00Z",
    repository: repo,
    pull_request: {
      merged: false,
      merged_at: null,
      draft: false,
      html_url: "https://codeberg.org/backslash-app/backslash/pulls/57",
    },
  },
  {
    id: 902,
    number: 12,
    title: "WIP: Forgejo Actions cache",
    html_url: "https://codeberg.org/ada/notes/pulls/12",
    state: "open",
    body: "",
    user,
    labels: [],
    milestone: null,
    assignees: null,
    comments: 0,
    created_at: "2026-10-20T08:00:00Z",
    updated_at: "2026-10-27T09:00:00Z",
    repository: { id: 8, name: "notes", owner: "ada", full_name: "ada/notes" },
    pull_request: { merged: false, draft: true },
  },
];
const pull57 = {
  id: 5001,
  number: 57,
  head: { ref: "fix/kitty-paste", sha: "3f2a9c1d" },
  base: { ref: "main" },
  mergeable: true,
  merged: false,
  draft: false,
  additions: 86,
  deletions: 12,
  changed_files: 4,
  requested_reviewers: [{ login: "grace" }],
};
const status = { state: "failure", total_count: 2, statuses: [] };
const repos = [
  {
    id: 7,
    name: "backslash",
    full_name: "backslash-app/backslash",
    owner: user,
    description: "A launcher for Linux",
    html_url: "https://codeberg.org/backslash-app/backslash",
    clone_url: "https://codeberg.org/backslash-app/backslash.git",
    ssh_url: "git@codeberg.org:backslash-app/backslash.git",
    website: "https://backslash.dev",
    stars_count: 1234,
    forks_count: 56,
    open_issues_count: 12,
    open_pr_counter: 3,
    release_counter: 5,
    language: "Rust",
    default_branch: "main",
    private: false,
    fork: false,
    archived: false,
    mirror: false,
    updated_at: "2026-10-28T08:00:00Z",
    topics: ["launcher", "gtk"],
  },
  {
    id: 8,
    name: "notes",
    full_name: "ada/notes",
    owner: user,
    description: "",
    html_url: "https://codeberg.org/ada/notes",
    clone_url: "https://codeberg.org/ada/notes.git",
    ssh_url: "git@codeberg.org:ada/notes.git",
    stars_count: 0,
    forks_count: 0,
    open_issues_count: 0,
    language: "",
    default_branch: "main",
    private: true,
    fork: false,
    archived: false,
    updated_at: "2026-10-20T08:00:00Z",
  },
];
const notifications = [
  {
    id: 300,
    unread: true,
    pinned: false,
    updated_at: "2026-10-28T07:00:00Z",
    repository: repo,
    subject: {
      title: "Detect terminals before pasting",
      url: "https://codeberg.org/api/v1/repos/backslash-app/backslash/pulls/57",
      html_url: "https://codeberg.org/backslash-app/backslash/pulls/57",
      latest_comment_html_url: "https://codeberg.org/backslash-app/backslash/pulls/57#issuecomment-99",
      type: "Pull",
      state: "open",
    },
    url: "https://codeberg.org/api/v1/notifications/threads/300",
  },
  {
    id: 301,
    unread: false,
    pinned: true,
    updated_at: "2026-10-25T07:00:00Z",
    repository: repo,
    subject: {
      title: "Crash on Wayland",
      html_url: "https://codeberg.org/backslash-app/backslash/issues/40",
      type: "Issue",
      state: "closed",
    },
  },
];

const pr = issues[0] as unknown as Issue;
const draft = issues[1] as unknown as Issue;

Deno.test("pull request state, checks and metadata", () => {
  assertEquals(stateIcon(pr), { source: "bs-pr-open", tint: "green" });
  assertEquals(stateIcon(draft), { source: "bs-pr-draft", tint: "gray" });
  assertEquals(stateIcon({ ...pr, pull_request: { merged: true } }), { source: "bs-pr-merged", tint: "purple" });
  assertEquals(stateIcon({ ...pr, state: "closed" }), { source: "bs-pr-closed", tint: "red" });
  assertEquals(stateIcon({ ...pr, pull_request: null }), { source: "bs-issue-open", tint: "green" });
  const full: Pull = { ...pr, detail: pull57, ci: status as Pull["ci"] };
  assertEquals(checks(full), { icon: "bs-x", color: "red", text: "Checks failed" });
  assertEquals(checks({ ...full, ci: { state: "success", total_count: 1 } })?.text, "Checks passed");
  assertEquals(checks({ ...full, ci: { state: "pending", total_count: 0 } }), undefined);
  const lines = issueMetadata(full).map((m) => [m.label, m.value ?? m.tags?.map((t) => t.text).join(",")]);
  assertEquals(lines.slice(0, 8), [
    ["Status", "Open"],
    ["Author", "Ada Lovelace"],
    ["Branch", "fix/kitty-paste → main"],
    ["Checks", "Checks failed"],
    ["Reviewers", "grace"],
    ["Assignees", "ada"],
    ["Labels", "bug"],
    ["Milestone", "1.2"],
  ]);
  const conflict = issueMetadata({ ...full, detail: { ...pull57, mergeable: false } });
  assertEquals(conflict.some((m) => m.value === "Conflicts with the base branch"), true);
});

Deno.test("pull request items", () => {
  const item = issueItem({ ...pr, detail: pull57, ci: status as Pull["ci"] }, "backslash-app/backslash");
  assertEquals([item.title, item.subtitle, item.section], [
    "Detect terminals before pasting",
    "#57",
    "backslash-app/backslash",
  ]);
  assertEquals(item.accessories?.map((a) => a.tag ?? a.text ?? a.tooltip), [
    "Checks failed",
    "bug",
    "+86 −12",
    "3",
    "ada",
    item.accessories![5].text,
  ]);
  assertEquals(item.detail?.stats?.map((s) => s.value), [4, "+86", "−12"]);
  assertEquals(item.detail?.markdown, "Fixes pasting into Kitty.");
  assertEquals(item.actions?.map((a) => a.title).slice(0, 3), [
    "Open in Browser",
    "Show Details",
    "Open Files Changed",
  ]);
  const checkout = item.actions?.find((a) => a.title === "Copy Checkout Command") as { text: string };
  assertEquals(
    checkout.text,
    "git fetch https://codeberg.org/backslash-app/backslash.git pull/57/head:pr-57 && git switch pr-57",
  );
  // Before the details load: no branch, no diff.
  assertEquals(issueItem(pr).subtitle, "backslash #57");
  assertEquals(issueItem(pr).actions?.some((a) => a.title === "Copy Branch Name"), false);
});

Deno.test("self-hosted pull request links", () => {
  const self = { ...pr, html_url: "https://git.example.com/infra/ansible/pulls/3", number: 3, detail: pull57 };
  assertEquals(repoUrl(self), "https://git.example.com/infra/ansible");
  const checkout = issueItem(self).actions?.find((a) => a.title === "Copy Checkout Command") as { text: string };
  assertEquals(
    checkout.text,
    "git fetch https://git.example.com/infra/ansible.git pull/3/head:pr-3 && git switch pr-3",
  );
});

Deno.test("grouped by repository, most recent first", () => {
  const a = { ...pr, id: 1, repository: { ...pr.repository, full_name: "x/a" } };
  const b = { ...pr, id: 2, repository: { ...pr.repository, full_name: "x/b" } };
  const a2 = { ...a, id: 3 };
  assertEquals(groupByRepo([a, b, a2]).map((i) => i.id), [1, 3, 2]);
});

Deno.test("repositories", () => {
  const [main, notes] = repos as unknown as Repo[];
  assertEquals(repoIcon(main), { source: "bs-repo", tint: "orange" });
  assertEquals(repoIcon(notes), { source: "bs-lock", tint: "orange" });
  assertEquals(repoIcon({ ...main, archived: true }).source, "bs-archive");
  const item = repoItem(main, "Your Repositories");
  assertEquals(item.detail?.stats?.map((s) => s.value), ["1.2k", "56", 12, 3]);
  assertEquals(item.accessories?.[0].text, "Rust");
  assertEquals(
    (item.actions?.find((a) => a.title === "Copy git clone (SSH)") as { text: string }).text,
    "git clone git@codeberg.org:backslash-app/backslash.git",
  );
  assertEquals(repoItem(notes).detail?.metadata?.find((m) => m.label === "Visibility")?.tags, [{
    text: "Private",
    color: "orange",
  }]);
});

Deno.test("notifications", () => {
  const [unread, pinned] = notifications as unknown as Notification[];
  assertEquals(notificationIcon(unread), { source: "bs-pr-open", tint: "green" });
  assertEquals(notificationIcon(pinned), { source: "bs-issue-closed", tint: "purple" });
  assertEquals(notificationIcon({ ...unread, subject: { ...unread.subject, state: "merged" } }).source, "bs-pr-merged");
  assertEquals(
    notificationUrl(unread, "https://codeberg.org"),
    "https://codeberg.org/backslash-app/backslash/pulls/57#issuecomment-99",
  );
  assertEquals(
    notificationUrl(pinned, "https://codeberg.org"),
    "https://codeberg.org/backslash-app/backslash/issues/40",
  );
  assertEquals([subjectNumber(unread), subjectNumber(pinned)], ["57", "40"]);
});

Deno.test("server address and token", () => {
  assertEquals(
    [
      normalizeUrl("codeberg.org/"),
      normalizeUrl("https://git.example.com/api/v1/"),
      normalizeUrl("http://192.168.1.20:3000/explore/repos"),
      normalizeUrl("https://example.com/gitea/user/settings/applications"),
      normalizeUrl(""),
      normalizeUrl("192.168.1.20:3000"),
      normalizeUrl("forgejo.local"),
    ],
    [
      "https://codeberg.org",
      "https://git.example.com",
      "http://192.168.1.20:3000",
      "https://example.com/gitea",
      "",
      "http://192.168.1.20:3000",
      "http://forgejo.local",
    ],
  );
  assertEquals(server({ url: "git.example.com", token: "  abc " }), {
    base: "https://git.example.com",
    token: "abc",
    host: "git.example.com",
  });
  const fails = (prefs: Record<string, unknown>) => {
    try {
      server(prefs);
    } catch (e) {
      return e instanceof AuthError ? [e.kind, e.base ?? null] : ["other"];
    }
    return [];
  };
  assertEquals(fails({ token: "abc" }), ["url", null]);
  assertEquals(fails({ url: "https://git.example.com" }), ["token", "https://git.example.com"]);
  const [row] = setupItems(new AuthError("Add an access token", "https://git.example.com"));
  assertEquals([row.id, row.actions?.[0].title], ["setup", "Create Access Token"]);
  assertEquals((row.actions?.[0] as { target: string }).target, "https://git.example.com/user/settings/applications");
  assertEquals(setupItems(new AuthError("Add the address", undefined, "url"))[0].actions?.map((a) => a.title), [
    "How to Create a Token",
  ]);
});

Deno.test("formatting", () => {
  const now = new Date("2026-10-28T12:00:00Z");
  assertEquals([ago("2026-10-28T09:00:00Z", now), ago("2026-10-27T09:00:00Z", now), ago("2026-10-24T09:00:00Z", now)], [
    "today",
    "yesterday",
    "4d",
  ]);
  assertEquals([compact(950), compact(1234), compact(45_600)], ["950", "1.2k", "46k"]);
  assertEquals([colorOf("ee0701"), colorOf("#0e8a16"), colorOf("cccccc"), colorOf(undefined)], [
    "red",
    "green",
    "gray",
    "gray",
  ]);
});
