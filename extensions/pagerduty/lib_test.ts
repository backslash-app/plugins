import { assertEquals } from "@std/assert";
import {
  age,
  apiHost,
  appHost,
  entryLabel,
  type Incident,
  incidentsQuery,
  isAssignedTo,
  noteBody,
  type OnCall,
  onCallRows,
  priorityColor,
  reassignToPolicy,
  reassignToUser,
  short,
  sortIncidents,
  statusBody,
  timelineMarkdown,
} from "./lib.ts";

const incident = (n: number, status: Incident["status"], urgency: Incident["urgency"], created: string): Incident => ({
  id: `P${n}`,
  incident_number: n,
  title: `Incident ${n}`,
  status,
  urgency,
  created_at: created,
  html_url: `https://acme.pagerduty.com/incidents/P${n}`,
  service: { id: "S1", summary: "Checkout API" },
  assignments: [{ at: created, assignee: { id: "U1", summary: "Ada Lovelace" } }],
});

Deno.test("regions", () => {
  assertEquals(apiHost("eu"), "api.eu.pagerduty.com");
  assertEquals(apiHost(" EU "), "api.eu.pagerduty.com");
  assertEquals(apiHost(undefined), "api.pagerduty.com");
  assertEquals(appHost("us"), "app.pagerduty.com");
});

Deno.test("incident queries and order", () => {
  assertEquals(
    decodeURIComponent(incidentsQuery("U1")),
    "statuses[]=triggered&statuses[]=acknowledged&user_ids[]=U1&sort_by=created_at:desc&limit=100&total=true",
  );
  assertEquals(decodeURIComponent(incidentsQuery()).includes("user_ids"), false);
  const sorted = sortIncidents([
    incident(1, "acknowledged", "high", "2026-10-28T10:00:00Z"),
    incident(2, "triggered", "low", "2026-10-28T11:00:00Z"),
    incident(3, "triggered", "high", "2026-10-28T09:00:00Z"),
    incident(4, "triggered", "high", "2026-10-28T11:30:00Z"),
  ]);
  assertEquals(sorted.map((i) => i.incident_number), [4, 3, 2, 1]);
  assertEquals(isAssignedTo(sorted[0], "U1"), true);
  assertEquals(isAssignedTo(sorted[0], "U2"), false);
});

Deno.test("write bodies", () => {
  assertEquals(statusBody("acknowledged"), { incident: { type: "incident_reference", status: "acknowledged" } });
  assertEquals(reassignToUser("U2").incident.assignments[0].assignee, { id: "U2", type: "user_reference" });
  assertEquals(reassignToPolicy("EP1").incident.escalation_policy, { id: "EP1", type: "escalation_policy_reference" });
  assertEquals(noteBody("Rolled back"), { note: { content: "Rolled back" } });
  assertEquals(priorityColor("#A8171C"), "#a8171c");
  assertEquals(priorityColor("eb6016"), "#eb6016");
  assertEquals(priorityColor("red"), undefined);
});

Deno.test("timeline", () => {
  const md = timelineMarkdown([
    {
      id: "L2",
      type: "acknowledge_log_entry",
      summary: "Acknowledged by Ada Lovelace",
      created_at: "2026-10-28T10:05:00Z",
      agent: { id: "U1", summary: "Ada Lovelace" },
    },
    { id: "L1", type: "trigger_log_entry", summary: "Triggered through the API.", created_at: "2026-10-28T10:00:00Z" },
    {
      id: "L3",
      type: "annotate_log_entry",
      summary: "Note added",
      created_at: "2026-10-28T10:10:00Z",
      channel: { type: "note", summary: "Rolling back the deploy" },
    },
  ], "UTC");
  assertEquals(md.split("\n"), [
    "- **28 Oct, 10:00** · Triggered · Triggered through the API.",
    "- **28 Oct, 10:05** · Acknowledged · Acknowledged by Ada Lovelace",
    "- **28 Oct, 10:10** · Note · Note added",
    "  > Rolling back the deploy",
  ]);
  assertEquals(entryLabel("urgency_change_log_entry"), "Urgency changed");
  assertEquals(entryLabel("some_new_log_entry"), "Some new");
});

Deno.test("on call rows", () => {
  const oncalls: OnCall[] = [
    {
      user: {
        id: "U1",
        summary: "Ada Lovelace",
        email: "ada@acme.dev",
        avatar_url: "https://secure.gravatar.com/avatar/a.png",
      },
      schedule: { id: "SCH1", summary: "Platform primary", html_url: "https://acme.pagerduty.com/schedules/SCH1" },
      escalation_policy: { id: "EP1", summary: "Platform" },
      escalation_level: 1,
      start: "2026-10-27T09:00:00Z",
      end: "2026-11-03T09:00:00Z",
    },
    {
      user: { id: "U1", summary: "Ada Lovelace" },
      schedule: { id: "SCH1", summary: "Platform primary" },
      escalation_policy: { id: "EP2", summary: "Payments" },
      escalation_level: 2,
      start: "2026-10-27T09:00:00Z",
      end: "2026-11-03T09:00:00Z",
    },
    {
      user: { id: "U2", summary: "Bob Martin" },
      schedule: null,
      escalation_policy: { id: "EP1", summary: "Platform" },
      escalation_level: 3,
      start: null,
      end: null,
    },
    {
      user: { id: "U3", summary: "Chloé Dupont" },
      schedule: { id: "SCH0", summary: "Database" },
      escalation_policy: { id: "EP3", summary: "Data" },
      escalation_level: 1,
      start: "2026-10-28T00:00:00Z",
      end: "2026-10-29T00:00:00Z",
    },
  ];
  const rows = onCallRows(oncalls);
  assertEquals(rows.map((r) => [r.group, r.name, r.level]), [
    ["Database", "Chloé Dupont", 1],
    ["Platform primary", "Ada Lovelace", 1],
    ["Platform (direct)", "Bob Martin", 3],
  ]);
  assertEquals(rows[1].email, "ada@acme.dev");
  assertEquals(rows[2].end, undefined);
});

Deno.test("time", () => {
  assertEquals(short(30_000), "30 s");
  assertEquals(short(5 * 3600_000), "5 h");
  assertEquals(short(3 * 86400_000), "3 d");
  assertEquals(age("2026-10-28T11:48:00Z", Date.parse("2026-10-28T12:00:00Z")), "12 min");
});
