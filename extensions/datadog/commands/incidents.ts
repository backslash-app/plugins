import { action, copy, Icons, type Item, list, meta, open, refresh, updateCommandMetadata } from "@backslash/api";
import { type Account, account, appUrl, dd, guarded } from "../api.ts";
import {
  age,
  capitalize,
  duration,
  formatDate,
  type Incident,
  type IncidentsBody,
  parseIncidents,
  severityColor,
  sortIncidents,
  STATE_COLORS,
} from "../lib.ts";

const md = (s: string) => s.replace(/([\\`*_[\]|<>])/g, "\\$1");

function item(a: Account, i: Incident): Item {
  const url = appUrl(a, `/incidents/${i.publicId ?? i.id}`);
  const stateColor = STATE_COLORS[i.state] ?? "gray";
  const sevColor = severityColor(i.severity);
  const open_ = i.state !== "resolved" && i.state !== "completed";
  return {
    id: i.id,
    title: i.title,
    subtitle: i.publicId ? `#${i.publicId}` : undefined,
    icon: { source: open_ ? Icons.alert : Icons.done, tint: open_ ? sevColor : "green" },
    section: capitalize(i.state),
    keywords: [i.severity, i.state, i.commander ?? "", String(i.publicId ?? ""), ...i.fields.map((f) => f.value)],
    accessories: [
      ...(i.customerImpacted ? [{ icon: Icons.person, text: "Customer impact", color: "red" as const }] : []),
      ...(i.commander ? [{ avatar: i.commander, tooltip: `Commander: ${i.commander}` }] : []),
      ...(i.created ? [{ text: age(i.created), tooltip: `Declared ${formatDate(i.created)}` }] : []),
      { tag: i.severity, color: sevColor },
      { tag: capitalize(i.state), color: stateColor },
    ],
    detail: {
      stats: [
        { label: "severity", value: i.severity, color: sevColor },
        { label: "state", value: capitalize(i.state), color: stateColor },
        {
          label: open_ ? "open for" : "resolved in",
          value: i.timeToResolve
            ? duration(i.timeToResolve * 1000)
            : i.created
            ? duration((i.resolved ? Date.parse(i.resolved) : Date.now()) - Date.parse(i.created))
            : "—",
        },
      ],
      markdown: i.impactScope ? `**Customer impact**: ${md(i.impactScope)}` : undefined,
      metadata: [
        ...(i.commander ? [meta.person("Commander", i.commander)] : []),
        ...(i.createdBy ? [meta.person("Declared by", i.createdBy)] : []),
        ...i.fields.slice(0, 8).map((f) => meta.text(capitalize(f.name.replace(/_/g, " ")), f.value)),
        meta.separator(),
        ...(i.detected ? [meta.text("Detected", formatDate(i.detected), { icon: Icons.eye })] : []),
        ...(i.created ? [meta.text("Declared", formatDate(i.created), { icon: Icons.calendar })] : []),
        ...(i.resolved ? [meta.text("Resolved", formatDate(i.resolved), { icon: Icons.done })] : []),
        ...(i.modified ? [meta.text("Updated", formatDate(i.modified), { icon: Icons.clock })] : []),
      ],
    },
    actions: [
      open(url, "Open in Datadog", { icon: Icons.external }),
      copy(url, "Copy Link", { shortcut: "<Ctrl><Shift>c" }),
      ...(i.publicId ? [copy(`#${i.publicId}`, "Copy Incident Number", { shortcut: "<Ctrl>period" })] : []),
      copy(`${i.severity} · ${i.title} · ${url}`, "Copy Summary", { icon: Icons.text }),
      action("Reload", () => refresh(), { icon: Icons.refresh, shortcut: "<Ctrl>r" }),
    ],
  };
}

let summary = "";

export default list({
  placeholder: "Filter incidents by title, severity, commander…",
  filter: {
    options: [
      { value: "open", title: "Open" },
      { value: "all", title: "All" },
    ],
    default: "open",
  },
  empty: { title: "No open incident", description: "Nothing is on fire", icon: Icons.done },
  status: () => summary,
  items: ({ preferences, filter, signal }) =>
    guarded(async () => {
      summary = "";
      const a = account(preferences);
      const query = filter === "all" ? "state:(active OR stable OR resolved)" : "state:(active OR stable)";
      const params = new URLSearchParams({ query, sort: "-created", include: "users", "page[size]": "100" });
      const incidents = parseIncidents(
        await dd<IncidentsBody>(a, `/api/v2/incidents/search?${params}`, { signal }).catch((e) => {
          // Organizations without incident search get the plain list.
          if (signal.aborted || !/answered (400|404)/.test(String(e))) throw e;
          return dd<IncidentsBody>(a, `/api/v2/incidents?include=commander_user,created_by_user&page[size]=100`, {
            signal,
          });
        }),
      );
      const open = incidents.filter((i) => i.state === "active" || i.state === "stable");
      summary = `${a.site.label} · ${open.length} open · ${incidents.length} recent`;
      const active = incidents.filter((i) => i.state === "active").length;
      await updateCommandMetadata({ subtitle: active ? `${active} active` : null }).catch(() => {});
      return sortIncidents(filter === "all" ? incidents : open).map((i) => item(a, i));
    }),
});
