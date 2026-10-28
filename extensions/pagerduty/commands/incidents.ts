import {
  type Action,
  action,
  copy,
  detail,
  type DetailSpec,
  field,
  form,
  Icons,
  type Item,
  list,
  meta,
  open,
  pop,
  refresh,
  submenu,
  toast,
  updateCommandMetadata,
} from "@backslash/api";
import { type Account, account, currentUser, guarded, pd, SetupError, setupItems } from "../api.ts";
import {
  age,
  assignees,
  type Incident,
  incidentsQuery,
  isAssignedTo,
  type LogEntry,
  noteBody,
  priorityColor,
  reassignToPolicy,
  reassignToUser,
  type Ref,
  sortIncidents,
  STATUS,
  statusBody,
  timelineMarkdown,
} from "../lib.ts";

const label = (i: Incident) => `#${i.incident_number}`;

async function update(a: Account, i: Incident, body: unknown, message: string) {
  await pd(a, `/incidents/${i.id}`, { method: "PUT", body });
  await toast(message, { style: "success", message: `${label(i)} ${i.title}` });
  return refresh();
}

async function timelineView(a: Account, i: Incident): Promise<DetailSpec> {
  const [{ log_entries }, notes] = await Promise.all([
    pd<{ log_entries: LogEntry[] }>(a, `/incidents/${i.id}/log_entries?is_overview=true&limit=100`),
    pd<{ notes: { content: string; created_at: string; user: Ref }[] }>(a, `/incidents/${i.id}/notes`)
      .then((r) => r.notes).catch(() => []),
  ]);
  const md = [
    `## ${label(i)} ${i.title}`,
    "",
    timelineMarkdown(notes.length ? log_entries.filter((e) => e.type !== "annotate_log_entry") : log_entries) ||
    "_Nothing logged yet._",
    ...(notes.length
      ? [
        "",
        "### Notes",
        "",
        ...notes.map((n) =>
          `- **${n.user.summary}** · ${new Date(n.created_at).toLocaleString("en-GB")}\n  > ${n.content}`
        ),
      ]
      : []),
  ].join("\n");
  return detail({
    title: `${label(i)} · timeline`,
    markdown: md,
    metadata: incidentMetadata(a, i),
    status: `${log_entries.length} event${log_entries.length === 1 ? "" : "s"}${
      notes.length ? ` · ${notes.length} note${notes.length === 1 ? "" : "s"}` : ""
    }`,
    actions: [
      action("Add Note", () => noteForm(a, i), { icon: Icons.comment, shortcut: "<Ctrl>n" }),
      open(i.html_url, "Open in PagerDuty", { shortcut: "<Ctrl>o" }),
      action("Reload", () => timelineView(a, i), { icon: Icons.refresh, shortcut: "<Ctrl>r" }),
    ],
  });
}

function noteForm(a: Account, i: Incident) {
  return form({
    title: `Note on ${label(i)}`,
    submitTitle: "Add Note",
    fields: [field.textArea("content", "Note", { required: true, placeholder: "What you found, what you did…" })],
    async submit(values) {
      const content = String(values.content ?? "").trim();
      if (!content) throw new Error("Write something first");
      await pd(a, `/incidents/${i.id}/notes`, { method: "POST", body: noteBody(content) });
      await toast("Note added", { style: "success", message: `${label(i)} ${i.title}` });
      return pop();
    },
  });
}

function incidentMetadata(a: Account, i: Incident) {
  const s = STATUS[i.status];
  return [
    meta.text("Status", s.title, { icon: Icons.dot, color: s.color }),
    meta.text("Urgency", i.urgency === "high" ? "High" : "Low", {
      icon: i.urgency === "high" ? Icons.urgent : Icons.low,
      color: i.urgency === "high" ? "red" as const : undefined,
    }),
    ...(i.priority
      ? [meta.tags("Priority", [{ text: i.priority.summary, color: priorityColor(i.priority.color) }])]
      : []),
    meta.link("Service", i.service.summary, i.service.html_url ?? i.html_url),
    ...(i.escalation_policy
      ? [meta.link("Escalation policy", i.escalation_policy.summary, i.escalation_policy.html_url ?? i.html_url)]
      : []),
    ...assignees(i).map((p) => meta.person("Assigned to", p.summary)),
    ...(i.acknowledgements ?? []).slice(0, 3).map((x) => meta.person("Acknowledged by", x.acknowledger.summary)),
    ...(i.teams?.length ? [meta.tags("Teams", i.teams.map((t) => t.summary))] : []),
    meta.separator(),
    meta.text("Opened", `${new Date(i.created_at).toLocaleString("en-GB")} (${age(i.created_at)} ago)`, {
      icon: Icons.clock,
    }),
    meta.link("Incident", label(i), i.html_url),
    ...(i.incident_key ? [meta.text("Key", i.incident_key, { icon: Icons.key })] : []),
    meta.text("Region", a.host === "api.eu.pagerduty.com" ? "EU" : "US", { icon: Icons.globe }),
  ];
}

function reassignMenu(a: Account, i: Incident): Action {
  return submenu("Reassign", async () => {
    const [{ users }, { escalation_policies }, me] = await Promise.all([
      pd<{ users: (Ref & { name: string; email: string })[] }>(a, "/users?limit=100"),
      pd<{ escalation_policies: (Ref & { name: string })[] }>(a, "/escalation_policies?limit=100&sort_by=name"),
      currentUser(a).catch(() => undefined),
    ]);
    const people = [...users].sort((x, y) =>
      Number(y.id === me?.id) - Number(x.id === me?.id) || x.name.localeCompare(y.name)
    );
    return [
      ...people.filter((u) => !isAssignedTo(i, u.id)).map((u) =>
        action(
          u.id === me?.id ? `${u.name} (me)` : u.name,
          () => update(a, i, reassignToUser(u.id), `Reassigned to ${u.name}`),
          {
            icon: Icons.person,
            section: "People",
          },
        )
      ),
      ...escalation_policies.filter((p) => p.id !== i.escalation_policy?.id).map((p) =>
        action(p.name, () => update(a, i, reassignToPolicy(p.id), `Escalated to ${p.name}`), {
          icon: Icons.layers,
          section: "Escalation Policies",
        })
      ),
    ];
  }, { icon: Icons.person, shortcut: "<Ctrl><Shift>a", section: "Incident" });
}

function incidentItem(a: Account, i: Incident): Item {
  const s = STATUS[i.status];
  const people = assignees(i);
  const actions: Action[] = [
    ...(i.status === "triggered"
      ? [action("Acknowledge", () => update(a, i, statusBody("acknowledged"), "Acknowledged"), {
        icon: Icons.check,
        shortcut: "<Ctrl>k",
      })]
      : []),
    action("Show Timeline", () => timelineView(a, i), { icon: Icons.history, shortcut: "<Ctrl>t" }),
    open(i.html_url, "Open in PagerDuty", { shortcut: "<Ctrl>o" }),
    action("Add Note", () => noteForm(a, i), { icon: Icons.comment, shortcut: "<Ctrl>n", section: "Incident" }),
    reassignMenu(a, i),
    action("Resolve", () => update(a, i, statusBody("resolved"), "Resolved"), {
      icon: Icons.done,
      shortcut: "<Ctrl><Shift>r",
      confirm: `Resolve ${label(i)} ${i.title}?`,
      section: "Incident",
    }),
    copy(i.html_url, "Copy URL", { shortcut: "<Ctrl><Shift>c", section: "Copy" }),
    copy(`${label(i)} ${i.title}`, "Copy Title", { shortcut: "<Ctrl>period", section: "Copy" }),
    open(i.service.html_url ?? i.html_url, "Open Service", { icon: Icons.server, section: "PagerDuty" }),
  ];
  return {
    id: i.id,
    title: i.title,
    subtitle: `${label(i)} · ${i.service.summary}`,
    icon: { source: i.status === "triggered" ? Icons.alert : Icons.inProgress, tint: s.color },
    section: s.title,
    keywords: [String(i.incident_number), i.service.summary, ...people.map((p) => p.summary), i.urgency],
    accessories: [
      ...(i.priority ? [{ tag: i.priority.summary, color: priorityColor(i.priority.color) }] : []),
      ...(i.urgency === "high"
        ? [{ icon: { source: Icons.urgent, tint: "red" as const }, tooltip: "High urgency" }]
        : [{ icon: { source: Icons.low, tint: "gray" as const }, tooltip: "Low urgency" }]),
      ...people.slice(0, 2).map((p) => ({ avatar: p.summary, tooltip: p.summary })),
      { text: age(i.created_at), tooltip: `Opened ${new Date(i.created_at).toLocaleString("en-GB")}` },
    ],
    detail: {
      stats: [
        { label: "status", value: s.title, color: s.color },
        { label: "urgency", value: i.urgency, color: i.urgency === "high" ? "red" : undefined },
        { label: "open for", value: age(i.created_at) },
      ],
      metadata: incidentMetadata(a, i),
    },
    actions,
  };
}

let summary = "";

export default list({
  placeholder: "Filter incidents by title, number, service, assignee…",
  filter: {
    options: [{ value: "mine", title: "Mine" }, { value: "all", title: "All" }],
    default: "mine",
  },
  empty: { title: "No open incident", description: "Nothing triggered or acknowledged", icon: Icons.done },
  status: (items) => items[0]?.id === "setup" ? "Not connected" : summary,
  items: ({ preferences, filter, signal }) =>
    guarded(preferences, async () => {
      summary = "";
      const a = account(preferences);
      let userId: string | undefined;
      if (filter !== "all") {
        const me = await currentUser(a);
        if (!me) {
          return setupItems(new SetupError("Add your PagerDuty email to see your incidents"), a.app);
        }
        userId = me.id;
      }
      const { incidents, total } = await pd<{ incidents: Incident[]; total?: number }>(
        a,
        `/incidents?${incidentsQuery(userId)}`,
        { signal },
      );
      const triggered = incidents.filter((i) => i.status === "triggered").length;
      const acked = incidents.length - triggered;
      summary = [
        filter === "all" ? "Everyone" : "Assigned to me",
        `${triggered} triggered`,
        `${acked} acknowledged`,
        ...(total && total > incidents.length ? [`${incidents.length} of ${total} shown`] : []),
      ].join(" · ");
      updateCommandMetadata({ subtitle: triggered ? `${triggered} triggered` : null }).catch(() => {});
      return sortIncidents(incidents).map((i) => incidentItem(a, i));
    }),
});
