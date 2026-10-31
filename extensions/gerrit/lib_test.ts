import { assert, assertEquals } from "@std/assert";
import { server, SetupError } from "./api.ts";
import {
  age,
  basicAuth,
  type Change,
  changesPath,
  changeState,
  changeUrl,
  gerritTime,
  gitCommand,
  labelColor,
  mainLabels,
  messageBody,
  normalizeUrl,
  parseChanges,
  parseGerritJson,
  parseLabel,
  searchUrl,
  shortLabel,
  signed,
  sizeBucket,
  sizeText,
} from "./lib.ts";

// GET /a/changes/?q=is:open+reviewer:self&o=LABELS&o=DETAILED_LABELS&o=DETAILED_ACCOUNTS&o=CURRENT_REVISION
//   &o=CURRENT_COMMIT&o=DOWNLOAD_COMMANDS&o=SUBMITTABLE (abridged, as Gerrit 3.9 sends it).
const ANSWER = `)]}'
[
  {
    "id": "openstack%2Fnova~912345",
    "triplet_id": "openstack%2Fnova~master~I8473b95934b5732ac55d26311a706c9c2bde9940",
    "project": "openstack/nova",
    "branch": "master",
    "topic": "bp/vgpu-live-migration",
    "hashtags": ["vgpu"],
    "attention_set": {
      "1000096": { "account": { "_account_id": 1000096, "name": "Ada Lovelace", "email": "ada@example.com", "username": "ada" }, "last_update": "2026-10-30 09:00:00.000000000", "reason": "Reviewer was added" }
    },
    "change_id": "I8473b95934b5732ac55d26311a706c9c2bde9940",
    "subject": "Add vGPU live migration support",
    "status": "NEW",
    "created": "2026-10-20 08:11:02.000000000",
    "updated": "2026-10-30 14:02:11.123000000",
    "submit_type": "MERGE_IF_NECESSARY",
    "mergeable": true,
    "submittable": false,
    "insertions": 182,
    "deletions": 14,
    "total_comment_count": 9,
    "unresolved_comment_count": 2,
    "has_review_started": true,
    "_number": 912345,
    "owner": {
      "_account_id": 1000042,
      "name": "Grace Hopper",
      "email": "grace@example.com",
      "username": "grace",
      "avatars": [{ "url": "https://review.example.com/avatar/32.png", "height": 32 }, { "url": "https://review.example.com/avatar/100.png", "height": 100 }]
    },
    "labels": {
      "Verified": {
        "approved": { "_account_id": 3, "name": "Zuul" },
        "all": [{ "value": 1, "_account_id": 3, "name": "Zuul" }, { "value": 0, "_account_id": 1000096, "name": "Ada Lovelace" }],
        "values": { "-1": "Fails", " 0": "No score", "+1": "Verified" },
        "default_value": 0
      },
      "Code-Review": {
        "disliked": { "_account_id": 1000096, "name": "Ada Lovelace" },
        "value": -1,
        "all": [
          { "value": 1, "_account_id": 1000100, "name": "Alan Turing" },
          { "value": -1, "_account_id": 1000096, "name": "Ada Lovelace" }
        ],
        "values": { "-2": "Do not merge", "-1": "This patch needs further work", " 0": "No score", "+1": "Looks good to me, but someone else must approve", "+2": "Looks good to me, approved" },
        "default_value": 0
      },
      "Workflow": {
        "all": [],
        "values": { "-1": "Work in progress", " 0": "Ready for reviews", "+1": "Approved" },
        "default_value": 0
      }
    },
    "reviewers": { "REVIEWER": [{ "_account_id": 1000096, "name": "Ada Lovelace" }, { "_account_id": 1000100, "name": "Alan Turing" }] },
    "current_revision": "184ebe53805e102605d11f6b143486d15c23a09c",
    "revisions": {
      "184ebe53805e102605d11f6b143486d15c23a09c": {
        "kind": "REWORK",
        "_number": 3,
        "created": "2026-10-30 14:02:11.000000000",
        "ref": "refs/changes/45/912345/3",
        "fetch": {
          "anonymous http": {
            "url": "https://review.example.com/openstack/nova",
            "ref": "refs/changes/45/912345/3",
            "commands": {
              "Checkout": "git fetch https://review.example.com/openstack/nova refs/changes/45/912345/3 && git checkout FETCH_HEAD",
              "Cherry Pick": "git fetch https://review.example.com/openstack/nova refs/changes/45/912345/3 && git cherry-pick FETCH_HEAD"
            }
          },
          "ssh": {
            "url": "ssh://grace@review.example.com:29418/openstack/nova",
            "ref": "refs/changes/45/912345/3",
            "commands": {
              "Checkout": "git fetch ssh://grace@review.example.com:29418/openstack/nova refs/changes/45/912345/3 && git checkout FETCH_HEAD"
            }
          }
        },
        "commit": {
          "subject": "Add vGPU live migration support",
          "message": "Add vGPU live migration support\\n\\nMediated devices are now reserved on the destination\\nbefore the migration starts.\\n\\nImplements: blueprint vgpu-live-migration\\nChange-Id: I8473b95934b5732ac55d26311a706c9c2bde9940\\nSigned-off-by: Grace Hopper <grace@example.com>\\n"
        }
      }
    }
  },
  {
    "id": "openstack%2Fnova~912400",
    "project": "openstack/nova",
    "branch": "stable/2026.1",
    "change_id": "Iaaaa",
    "subject": "[WIP] Fix flaky test",
    "status": "NEW",
    "work_in_progress": true,
    "updated": "2026-10-29 10:00:00.000000000",
    "insertions": 3,
    "deletions": 1,
    "_number": 912400,
    "owner": { "_account_id": 1000042 },
    "labels": {
      "Code-Review": {
        "rejected": { "_account_id": 7, "name": "Core Reviewer" },
        "all": [{ "value": -2, "_account_id": 7, "name": "Core Reviewer" }],
        "values": { "-2": "Do not merge", " 0": "No score", "+2": "Approved" }
      }
    },
    "current_revision": "deadbeef",
    "revisions": { "deadbeef": { "_number": 1, "ref": "refs/changes/00/912400/1", "fetch": {} } },
    "_more_changes": true
  }
]
`;

const first = () => parseChanges(parseGerritJson(ANSWER)).changes[0];
const second = () => parseChanges(parseGerritJson(ANSWER)).changes[1];

Deno.test("the XSSI prefix is stripped", () => {
  assertEquals(parseGerritJson(')]}\'\n{"a":1}'), { a: 1 });
  assertEquals(parseGerritJson(")]}'[1]"), [1]);
  assertEquals(parseGerritJson("[2]"), [2]);
});

Deno.test("addresses", () => {
  assertEquals(normalizeUrl("review.opendev.org"), "https://review.opendev.org");
  assertEquals(normalizeUrl("https://gerrit.example.com/r/"), "https://gerrit.example.com/r");
  assertEquals(normalizeUrl("https://gerrit.example.com/r/a/"), "https://gerrit.example.com/r");
  assertEquals(normalizeUrl("https://review.example.com/c/openstack/nova/+/912345"), "https://review.example.com");
  assertEquals(normalizeUrl("https://review.example.com/q/status:open"), "https://review.example.com");
  assertEquals(normalizeUrl("https://review.example.com/#/q/status:open"), "https://review.example.com");
  assertEquals(normalizeUrl("192.168.1.5:8080"), "http://192.168.1.5:8080");
  assertEquals(normalizeUrl("gerrit.lan"), "http://gerrit.lan");
  assertEquals(normalizeUrl(""), "");
});

Deno.test("preferences", () => {
  const s = server({ url: "review.example.com/", username: "grace", password: " s3cret ", scheme: "ssh" });
  assertEquals(s, {
    base: "https://review.example.com",
    host: "review.example.com",
    user: "grace",
    password: "s3cret",
    scheme: "ssh",
  });
  let err: unknown;
  try {
    server({ url: "review.example.com", username: "grace" });
  } catch (e) {
    err = e;
  }
  assert(err instanceof SetupError);
  assertEquals((err as Error).message, "Add your user name and HTTP password for review.example.com");
  assertEquals(basicAuth("grace", "s3cret"), `Basic ${btoa("grace:s3cret")}`);
  assertEquals(basicAuth("é", "x"), "Basic w6k6eA==");
});

Deno.test("timestamps are UTC with nanoseconds", () => {
  assertEquals(gerritTime("2026-10-30 14:02:11.123000000"), Date.parse("2026-10-30T14:02:11.123Z"));
  assertEquals(gerritTime("2026-10-30 14:02:11"), Date.parse("2026-10-30T14:02:11Z"));
  assertEquals(gerritTime("yesterday"), undefined);
  assertEquals(gerritTime(undefined), undefined);
});

Deno.test("a change", () => {
  const c = first();
  assertEquals(c.number, 912345);
  assertEquals(c.changeId, "I8473b95934b5732ac55d26311a706c9c2bde9940");
  assertEquals(c.project, "openstack/nova");
  assertEquals(c.topic, "bp/vgpu-live-migration");
  assertEquals(c.hashtags, ["vgpu"]);
  assertEquals(c.owner.name, "Grace Hopper");
  assertEquals(c.owner.avatar, "https://review.example.com/avatar/100.png");
  assertEquals(c.updated, Date.parse("2026-10-30T14:02:11.123Z"));
  assertEquals([c.insertions, c.deletions, c.comments, c.unresolved], [182, 14, 9, 2]);
  assertEquals(c.patchset, 3);
  assertEquals(c.ref, "refs/changes/45/912345/3");
  assertEquals(c.attention.map((a) => a.name), ["Ada Lovelace"]);
  assertEquals(c.reviewers.map((a) => a.name), ["Ada Lovelace", "Alan Turing"]);
  assertEquals(c.labels.map((l) => l.name), ["Code-Review", "Verified", "Workflow"]);
  assertEquals(c.fetch.map((f) => f.scheme), ["anonymous http", "ssh"]);
  assert(c.message?.startsWith("Add vGPU"));
  const s = second();
  assertEquals(s.wip, true);
  assertEquals(s.owner.name, "Account 1000042");
  assertEquals(parseChanges(parseGerritJson(ANSWER)).more, true);
});

Deno.test("several queries answer a list per query", () => {
  const one = parseChanges(parseGerritJson(ANSWER)).changes;
  const both = parseChanges([[{ _number: 1, subject: "a" }], [{ _number: 2, subject: "b", _more_changes: true }]]);
  assertEquals(both.changes.map((c) => c.number), [1, 2]);
  assertEquals(both.more, true);
  assertEquals(parseChanges({}).changes, []);
  assertEquals(one.length, 2);
});

Deno.test("labels sum up with the veto or the strongest vote", () => {
  const [cr, v, wf] = first().labels;
  assertEquals([cr.value, cr.state, cr.min, cr.max], [-1, "disliked", -2, 2]);
  assertEquals(cr.votes.map((x) => `${x.account.name} ${x.value}`), ["Alan Turing 1", "Ada Lovelace -1"].reverse());
  assertEquals([v.value, v.state], [1, "approved"]);
  assertEquals(v.votes.length, 1); // the 0 vote is dropped
  assertEquals([wf.value, wf.state], [0, "none"]);
  const rejected = second().labels[0];
  assertEquals([rejected.value, rejected.state], [-2, "rejected"]);
  assertEquals(labelColor(rejected), "red");
  assertEquals(labelColor(cr), "orange");
  assertEquals(labelColor(v), "green");
  assertEquals(labelColor(parseLabel("Code-Review", { all: [{ value: 1 }], values: { "-2": "", "+2": "" } })), "teal");
  assertEquals(labelColor(wf), "gray");
  assertEquals(mainLabels(first()).map((l) => l.name), ["Code-Review", "Verified"]);
});

Deno.test("checkout commands: the server's, the chosen scheme, or built", () => {
  const c = first();
  const base = "https://review.example.com";
  assertEquals(
    gitCommand(base, c, "Checkout"),
    "git fetch https://review.example.com/openstack/nova refs/changes/45/912345/3 && git checkout FETCH_HEAD",
  );
  assertEquals(
    gitCommand(base, c, "Checkout", "ssh"),
    "git fetch ssh://grace@review.example.com:29418/openstack/nova refs/changes/45/912345/3 && git checkout FETCH_HEAD",
  );
  // ssh has no cherry-pick command here: built from its fetch URL.
  assertEquals(
    gitCommand(base, c, "Cherry Pick", "ssh"),
    "git fetch ssh://grace@review.example.com:29418/openstack/nova refs/changes/45/912345/3 && git cherry-pick FETCH_HEAD",
  );
  assertEquals(
    gitCommand(base, c, "Branch"),
    "git fetch https://review.example.com/openstack/nova refs/changes/45/912345/3 && git checkout -b change-912345-3 FETCH_HEAD",
  );
  // No download scheme at all: the project on the server.
  assertEquals(
    gitCommand(base, second(), "Checkout"),
    "git fetch https://review.example.com/openstack/nova refs/changes/00/912400/1 && git checkout FETCH_HEAD",
  );
  assertEquals(gitCommand(base, { ...second(), ref: undefined } as Change, "Checkout"), undefined);
});

Deno.test("URLs and queries", () => {
  const base = "https://gerrit.example.com/r";
  assertEquals(changeUrl(base, first()), "https://gerrit.example.com/r/c/openstack/nova/+/912345");
  assertEquals(changeUrl(base, { project: "a b/c", number: 1 }, 2), "https://gerrit.example.com/r/c/a%20b/c/+/1/2");
  assertEquals(searchUrl(base, "topic:x status:open"), "https://gerrit.example.com/r/q/topic%3Ax%20status%3Aopen");
  const path = changesPath("is:open owner:self", 25);
  const q = new URLSearchParams(path.split("?")[1]);
  assert(path.startsWith("/changes/?"));
  assertEquals(q.get("q"), "is:open owner:self");
  assertEquals(q.get("n"), "25");
  assert(q.getAll("o").includes("DETAILED_LABELS"));
  assert(q.getAll("o").includes("DOWNLOAD_COMMANDS"));
});

Deno.test("state of a change", () => {
  assertEquals(changeState(first()).title, "Unresolved comments");
  assertEquals(changeState(second()).title, "WIP");
  assertEquals(changeState({ ...second(), wip: false }).title, "Blocked");
  assertEquals(changeState({ ...first(), submittable: true, unresolved: 0 }).title, "Ready to submit");
  assertEquals(changeState({ ...first(), mergeable: false }).title, "Merge conflict");
  assertEquals(changeState({ ...first(), status: "MERGED" }).color, "purple");
  assertEquals(changeState({ ...first(), status: "ABANDONED" }).title, "Abandoned");
  assertEquals(changeState({ ...first(), unresolved: 0 }).title, "In review");
});

Deno.test("formatting", () => {
  assertEquals(signed(2), "+2");
  assertEquals(signed(-1), "-1");
  assertEquals(signed(0), "0");
  assertEquals(shortLabel("Code-Review"), "CR");
  assertEquals(shortLabel("Verified"), "V");
  assertEquals(shortLabel("Library-Compliance"), "LC");
  assertEquals(sizeText(first()), "+182 −14");
  assertEquals(sizeBucket(first()), "M");
  assertEquals(sizeBucket({ insertions: 3, deletions: 1 }), "XS");
  assertEquals(sizeBucket({ insertions: 3000, deletions: 1 }), "XL");
  const now = Date.parse("2026-10-31T12:00:00Z");
  assertEquals(age(now - 5 * 60_000, now), "5m");
  assertEquals(age(now - 3 * 3600_000, now), "3h");
  assertEquals(age(now - 2 * 86400_000, now), "2d");
  assertEquals(age(undefined, now), "");
  assertEquals(
    messageBody(first().message),
    "Mediated devices are now reserved on the destination\nbefore the migration starts.\n\nImplements: blueprint vgpu-live-migration",
  );
  assertEquals(messageBody(undefined), "");
});
