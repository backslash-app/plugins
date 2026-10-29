import { assertEquals, assertStringIncludes } from "@std/assert";
import {
  ago,
  assignedTo,
  currentFailures,
  firstLine,
  graphqlError,
  isOpenPatch,
  type Job,
  jobGroup,
  jobItem,
  jobUrl,
  type ListedPatchset,
  patchItem,
  patchTitle,
  patchUrl,
  type Repo,
  repoItem,
  repoUrl,
  sortJobs,
  sortPatches,
  sortTickets,
  taskSummary,
  ticketItem,
  ticketRef,
  ticketUrl,
  type TrackedTicket,
  username,
} from "./lib.ts";

// Shaped like the sr.ht GraphQL APIs.
const ada = { canonicalName: "~ada" };

const repo: Repo = {
  id: 1234,
  name: "engine",
  description: "Difference engine",
  visibility: "UNLISTED",
  created: "2025-01-01T00:00:00Z",
  updated: "2026-10-28T10:00:00Z",
  owner: ada,
  HEAD: { name: "refs/heads/main" },
};

Deno.test("helpers", () => {
  assertEquals(username(ada), "ada");
  assertEquals(username(null), "");
  assertEquals(firstLine("Fix the gears\n\nLong text"), "Fix the gears");
  assertEquals(graphqlError([{ message: "Access denied " }, { message: "Access denied" }]), "Access denied");
  assertEquals(graphqlError([]), undefined);
  const now = Date.parse("2026-10-29T12:00:00Z");
  assertEquals(ago("2026-10-29T11:30:00Z", now), "30m");
  assertEquals(ago(null, now), "");
});

Deno.test("repositories", () => {
  assertEquals(repoUrl(repo), "https://git.sr.ht/~ada/engine");
  const item = repoItem(repo);
  assertEquals([item.title, item.subtitle], ["engine", "Difference engine"]);
  assertEquals(item.accessories?.map((a) => a.tag ?? a.text).slice(0, 2), ["Unlisted", "main"]);
  const clone = item.actions?.find((a) => a.title === "Copy git clone (SSH)") as { text: string };
  assertEquals(clone.text, "git clone git@git.sr.ht:~ada/engine");
});

const job = (id: number, status: Job["status"], tags = ["engine", "main"], o: Partial<Job> = {}): Job => ({
  id,
  created: "2026-10-29T10:00:00Z",
  updated: "2026-10-29T10:05:00Z",
  status,
  note: "Fix the gears\n\nmore",
  tags,
  image: "alpine/edge",
  owner: ada,
  tasks: [
    { name: "setup", status: "SUCCESS" },
    { name: "test", status: status === "FAILED" ? "FAILED" : "SUCCESS" },
  ],
  ...o,
});

Deno.test("builds", () => {
  const old = job(1, "FAILED");
  const fixed = job(2, "SUCCESS");
  const broken = job(3, "FAILED", ["docs"]);
  const running = job(4, "RUNNING", ["engine", "main"], { tasks: [{ name: "build", status: "RUNNING" }] });
  const all = [old, fixed, broken, running];
  const failing = currentFailures(all);
  assertEquals([...failing].map((j) => j.id), [3]);
  assertEquals([jobGroup(old, failing), jobGroup(running, failing)], ["Recent", "Running"]);
  assertEquals(sortJobs(all).map((j) => j.id), [3, 4, 2, 1]);
  assertEquals(taskSummary(old), "test failed");
  assertEquals(taskSummary(fixed), "2/2 tasks");
  assertEquals(jobUrl(old), "https://builds.sr.ht/~ada/job/1");
  const item = jobItem(old, failing);
  assertEquals([item.title, item.subtitle, item.section], ["Fix the gears", "engine/main", "Recent"]);
  assertEquals(item.accessories?.at(-1)?.tag, "Failed (fixed since)");
  assertEquals(jobItem(job(5, "SUCCESS", [], { note: null }), failing).title, "alpine/edge");
});

const tracker = { id: 7, name: "engine", owner: ada };
const ticket = (id: number, status: TrackedTicket["status"], o: Partial<TrackedTicket> = {}): TrackedTicket => ({
  id,
  subject: `Ticket ${id}`,
  status,
  created: "2026-10-20T00:00:00Z",
  updated: `2026-10-2${id}T00:00:00Z`,
  submitter: { canonicalName: "~bob" },
  assignees: [ada],
  labels: [{ name: "bug", backgroundColor: "#ff0000" }],
  tracker,
  ...o,
});

Deno.test("tickets", () => {
  const t = ticket(3, "CONFIRMED", { body: "Gears slip." });
  assertEquals(ticketUrl(t), "https://todo.sr.ht/~ada/engine/3");
  assertEquals(ticketRef(t), "~ada/engine#3");
  assertEquals(assignedTo(t, "~ada"), true);
  assertEquals(assignedTo(t, "~bob"), false);
  assertEquals(
    sortTickets([ticket(1, "REPORTED"), ticket(2, "IN_PROGRESS"), t, ticket(4, "REPORTED")]).map((x) => x.id),
    [2, 3, 4, 1],
  );
  const item = ticketItem(t, "~ada");
  assertEquals([item.section, item.subtitle, item.detail?.markdown], ["~ada/engine", "#3", "Gears slip."]);
  assertEquals(item.accessories?.map((a) => a.tag ?? a.tooltip ?? a.text).slice(0, 3), [
    "bug",
    "Assigned to you",
    "Confirmed",
  ]);
  const resolved = ticketItem(ticket(5, "RESOLVED", { resolution: "WONT_FIX" }), "~bob");
  assertEquals(resolved.detail?.metadata?.[0].value, "Resolved (won't fix)");
});

const patch = (id: number, status: ListedPatchset["status"], o: Partial<ListedPatchset> = {}): ListedPatchset => ({
  id,
  subject: "Speed up the mill",
  status,
  created: "2026-10-27T00:00:00Z",
  updated: `2026-10-2${id}T00:00:00Z`,
  version: 2,
  prefix: "engine",
  submitter: { canonicalName: "~bob" },
  list: { id: 9, name: "engine-devel", owner: ada },
  ...o,
});

Deno.test("patchsets", () => {
  const p = patch(5, "PROPOSED");
  assertEquals(patchTitle(p), "[PATCH engine v2] Speed up the mill");
  assertEquals(patchTitle({ ...p, version: 1, prefix: null }), "[PATCH] Speed up the mill");
  assertEquals(patchUrl(p), "https://lists.sr.ht/~ada/engine-devel/patches/5");
  assertEquals([isOpenPatch(p), isOpenPatch(patch(1, "APPLIED"))], [true, false]);
  assertEquals(sortPatches([patch(1, "APPLIED"), patch(2, "NEEDS_REVISION"), p]).map((x) => x.id), [5, 2, 1]);
  const item = patchItem(p);
  assertEquals([item.subtitle, item.section], ["engine v2", "~ada/engine-devel"]);
  const am = item.actions?.find((a) => a.title === "Copy git am Command") as { text: string };
  assertStringIncludes(am.text, "/patches/5/mbox | git am -3");
});
