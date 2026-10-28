import { copy, Icons, type Item, list, meta, open } from "@backslash/api";
import { type Account, account, guarded, pd } from "../api.ts";
import { type OnCall, type OnCallRow, onCallRows, short } from "../lib.ts";

function onCallItem(a: Account, r: OnCallRow): Item {
  const left = r.end ? short(r.end.getTime() - Date.now()) : undefined;
  const userUrl = `https://${a.app}/users/${r.userId}`;
  return {
    id: r.key,
    title: r.name,
    subtitle: r.scheduleId ? r.policy.summary : undefined,
    icon: { source: Icons.person, tint: r.level === 1 ? "green" : "blue" },
    section: r.group,
    keywords: [r.email ?? "", r.policy.summary, r.group],
    accessories: [
      { tag: `Level ${r.level}`, color: r.level === 1 ? "green" : "blue" },
      { text: left ? `${left} left` : "Always", tooltip: r.end ? `Until ${r.end.toLocaleString("en-GB")}` : undefined },
      { avatar: r.avatar ?? r.name, tooltip: r.name },
    ],
    detail: {
      metadata: [
        meta.person("On call", r.name, r.avatar),
        ...(r.email ? [meta.link("Email", r.email, `mailto:${r.email}`)] : []),
        meta.text("Escalation level", r.level, { icon: Icons.layers }),
        ...(r.scheduleId
          ? [meta.link("Schedule", r.group, r.scheduleUrl ?? `https://${a.app}/schedules/${r.scheduleId}`)]
          : [meta.text("Schedule", "None: on call directly", { icon: Icons.calendar })]),
        meta.link(
          "Escalation policy",
          r.policy.summary,
          r.policy.html_url ?? `https://${a.app}/escalation_policies/${r.policy.id}`,
        ),
        meta.separator(),
        ...(r.start ? [meta.text("Since", r.start.toLocaleString("en-GB"), { icon: Icons.clock })] : []),
        meta.text("Until", r.end ? `${r.end.toLocaleString("en-GB")} (${left})` : "No end", { icon: Icons.clock }),
      ],
    },
    actions: [
      ...(r.scheduleId
        ? [
          open(r.scheduleUrl ?? `https://${a.app}/schedules/${r.scheduleId}`, "Open Schedule", {
            icon: Icons.calendar,
          }),
        ]
        : []),
      open(userUrl, "Open Profile", { icon: Icons.person }),
      ...(r.email ? [open(`mailto:${r.email}`, "Send Email", { icon: Icons.mail, shortcut: "<Ctrl>e" })] : []),
      ...(r.email ? [copy(r.email, "Copy Email", { shortcut: "<Ctrl>period", section: "Copy" })] : []),
      copy(r.name, "Copy Name", { section: "Copy" }),
      open(`https://${a.app}/schedules`, "Open All Schedules", { icon: Icons.calendar, section: "PagerDuty" }),
    ],
  };
}

export default list({
  placeholder: "Filter by person, schedule or escalation policy…",
  empty: {
    title: "Nobody is on call",
    description: "No schedule or escalation policy has anyone now",
    icon: Icons.person,
  },
  status: (items) => {
    if (items[0]?.id === "setup") return "Not connected";
    const people = new Set(items.map((i) => i.title)).size;
    const groups = new Set(items.map((i) => i.section)).size;
    return `${people} on call · ${groups} schedule${groups === 1 ? "" : "s"}`;
  },
  items: ({ preferences, signal }) =>
    guarded(preferences, async () => {
      const a = account(preferences);
      const { oncalls } = await pd<{ oncalls: OnCall[] }>(
        a,
        "/oncalls?earliest=true&limit=100&include[]=users&time_zone=UTC",
        { signal },
      );
      return onCallRows(oncalls).map((r) => onCallItem(a, r));
    }),
});
