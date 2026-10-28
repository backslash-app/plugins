import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import {
  affected,
  ago,
  cleanBody,
  componentLook,
  components,
  groups,
  incidentMarkdown,
  overall,
  parseCustom,
  serviceMarkdown,
  serviceMetadata,
  SERVICES,
  serviceStats,
  subtitle,
  type Summary,
  UNREACHABLE,
  upcomingMaintenance,
} from "./lib.ts";

const NOW = new Date("2026-10-28T14:00:00Z");

// Shaped like https://www.githubstatus.com/api/v2/summary.json during an incident.
const github: Summary = {
  page: {
    id: "kctbh9vrtdwd",
    name: "GitHub",
    url: "https://www.githubstatus.com",
    time_zone: "Etc/UTC",
    updated_at: "2026-10-28T13:52:11.142Z",
  },
  components: [
    {
      id: "8l4ygp009s5s",
      name: "Git Operations",
      status: "operational",
      description: "Performance of git clones, pulls, pushes, and associated operations",
      position: 1,
      group_id: null,
      group: false,
      only_show_if_degraded: false,
    },
    {
      id: "brv1bkgrwx7q",
      name: "API Requests",
      status: "operational",
      position: 3,
      group_id: null,
      group: false,
    },
    {
      id: "br0l2tvcx85d",
      name: "Actions",
      status: "degraded_performance",
      description: "Workflows, Compute and Orchestration for GitHub Actions",
      position: 5,
      group_id: null,
      group: false,
      updated_at: "2026-10-28T13:40:00.000Z",
    },
    { id: "grp1", name: "Codespaces", status: "partial_outage", position: 9, group: true, components: ["cs1"] },
    { id: "cs1", name: "Codespaces EU", status: "partial_outage", position: 10, group_id: "grp1", group: false },
  ],
  incidents: [
    {
      id: "yz8g1lqjdq5v",
      name: "Disruption with some GitHub services",
      status: "investigating",
      impact: "minor",
      shortlink: "https://stspg.io/ab12cd",
      created_at: "2026-10-28T13:31:02.000Z",
      started_at: "2026-10-28T13:31:02.000Z",
      incident_updates: [
        {
          id: "u1",
          status: "investigating",
          body: "We are investigating reports of degraded performance for Actions.",
          created_at: "2026-10-28T13:31:02.000Z",
          display_at: "2026-10-28T13:31:02.000Z",
          affected_components: [{
            code: "br0l2tvcx85d",
            name: "Actions",
            old_status: "operational",
            new_status: "degraded_performance",
          }],
        },
        {
          id: "u2",
          status: "investigating",
          body:
            'Queued jobs are delayed. See <a href="https://github.com/orgs/community">the community</a> &amp; updates.',
          created_at: "2026-10-28T13:50:00.000Z",
          display_at: "2026-10-28T13:50:00.000Z",
        },
      ],
    },
  ],
  scheduled_maintenances: [
    {
      id: "m1",
      name: "Codespaces maintenance",
      status: "scheduled",
      impact: "maintenance",
      created_at: "2026-10-20T10:00:00.000Z",
      scheduled_for: "2026-10-29T02:00:00.000Z",
      scheduled_until: "2026-10-29T04:00:00.000Z",
      incident_updates: [{
        id: "m1u",
        status: "scheduled",
        body: "Planned upgrade.",
        created_at: "2026-10-20T10:00:00.000Z",
      }],
    },
    {
      id: "m2",
      name: "Far away",
      status: "scheduled",
      impact: "maintenance",
      created_at: "2026-10-20T10:00:00.000Z",
      scheduled_for: "2026-11-20T02:00:00.000Z",
      incident_updates: [],
    },
  ],
  status: { indicator: "minor", description: "Minor Service Outage" },
};

const quiet: Summary = {
  page: { id: "x", name: "npm", url: "https://status.npmjs.org" },
  components: [{ id: "a", name: "www.npmjs.com website", status: "operational" }],
  incidents: [],
  status: { indicator: "none", description: "All Systems Operational" },
};

Deno.test("built-in services have unique ids and hosts listed in the manifest", async () => {
  const manifest = await Deno.readTextFile(new URL("./backslash.toml", import.meta.url));
  assertEquals(new Set(SERVICES.map((s) => s.id)).size, SERVICES.length);
  for (const s of SERVICES) assertStringIncludes(manifest, `"${s.host}"`);
  assert(!SERVICES.some((s) => s.host === "status.openai.com"), "OpenAI left Statuspage");
});

Deno.test("custom pages", () => {
  const { services, errors } = parseCustom("Acme=abc123xyz, https://beta9.statuspage.io/, bad host!,\nZed = Q1W2E3");
  assertEquals(services.map((s) => [s.name, s.host]), [
    ["Acme", "abc123xyz.statuspage.io"],
    ["beta9", "beta9.statuspage.io"],
    ["Zed", "q1w2e3.statuspage.io"],
  ]);
  assertEquals(errors, ["bad host!"]);
  assertEquals(parseCustom(undefined), { services: [], errors: [] });
});

Deno.test("overall status takes the worst component, not only the indicator", () => {
  assertEquals(overall(github).label, "Partial outage");
  assertEquals(overall(quiet).label, "Operational");
  const silentOutage = { ...quiet, components: [{ id: "a", name: "Web", status: "major_outage" }] };
  assertEquals(overall(silentOutage).color, "red");
  assertEquals(componentLook("whatever_new").label, "Whatever new");
});

Deno.test("components: groups skipped, worst first", () => {
  assertEquals(components(github).map((c) => c.name), ["Codespaces EU", "Actions", "Git Operations", "API Requests"]);
  assertEquals(affected(github).length, 2);
  assertEquals(groups(github).get("cs1"), "Codespaces");
});

Deno.test("incident updates, newest first, HTML cleaned", () => {
  const md = incidentMarkdown(github.incidents[0]);
  assert(md.indexOf("Queued jobs") < md.indexOf("We are investigating"));
  assertStringIncludes(md, "[the community](https://github.com/orgs/community) & updates");
  assertStringIncludes(md, "impact minor");
  assertEquals(cleanBody("a<br/>b <b>c</b>"), "a\nb c");
  assertStringIncludes(incidentMarkdown(github.incidents[0], { updates: 1 }), "_1 earlier update_");
});

Deno.test("detail of a service", () => {
  assertEquals(upcomingMaintenance(github, NOW).map((m) => m.id), ["m1"]);
  const md = serviceMarkdown(SERVICES[0], github, NOW);
  assertStringIncludes(md, "Disruption with some GitHub services");
  assertStringIncludes(md, "Codespaces maintenance");
  assertStringIncludes(serviceMarkdown(SERVICES[4], quiet, NOW), "No open incident on npm's status page.");
  const stats = serviceStats(github);
  assertEquals(stats[1].value, "2 of 4 affected");
  assertEquals(stats[2].value, 1);
  const metadata = serviceMetadata(SERVICES[0], github, NOW);
  assertEquals(metadata[0].label, "Codespaces · Codespaces EU");
  assertEquals(metadata[0].value, "Partial outage");
  assert(metadata.some((m) => m.link === "https://www.githubstatus.com"));
  assert(metadata.some((m) => m.value === "7m ago"));
});

Deno.test("root subtitle", () => {
  const [gh, cf, , , npm] = SERVICES;
  const ok = overall(quiet);
  assertEquals(subtitle([{ service: gh, look: ok }, { service: cf, look: ok }]), "All systems operational");
  assertEquals(
    subtitle([{ service: gh, look: overall(github) }, { service: npm, look: ok }]),
    "GitHub: partial outage",
  );
  const degraded = componentLook("degraded_performance");
  assertEquals(
    subtitle([{ service: npm, look: degraded }, { service: gh, look: componentLook("major_outage") }]),
    "GitHub: outage · +1",
  );
  assertEquals(subtitle([{ service: npm, look: degraded }]), "npm: degraded");
  assertEquals(subtitle([{ service: npm, look: UNREACHABLE }]), null);
  assertEquals(subtitle([]), null);
});

Deno.test("ago", () => {
  assertEquals(ago("2026-10-28T13:59:30Z", NOW), "just now");
  assertEquals(ago("2026-10-28T11:00:00Z", NOW), "3h ago");
  assertEquals(ago(undefined, NOW), "");
});
