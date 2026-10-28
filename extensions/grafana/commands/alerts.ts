import {
  type Action,
  action,
  copy,
  Icons,
  type Item,
  list,
  meta,
  type Metadata,
  open,
  refresh,
  submenu,
  toast,
  updateCommandMetadata,
} from "@backslash/api";
import { type Account, account, grafana, guarded } from "../api.ts";
import {
  type Alert,
  alertName,
  duration,
  DURATIONS,
  matcherText,
  panelUrl,
  parseAlerts,
  parseSilences,
  SEVERITIES,
  severityOf,
  type Silence,
  silenceBody,
  since,
  sortAlerts,
  sortSilences,
  visibleLabels,
} from "../lib.ts";

const AM = "/api/alertmanager/grafana/api/v2";

const ago = (d?: Date) => !d ? "" : Date.now() - d.getTime() < 60_000 ? "just now" : `${since(d)} ago`;

let me: Promise<string> | undefined;
/** Who the silences are created by: the service account's login. */
const createdBy = (a: Account) =>
  me ??= grafana<{ login?: string; name?: string }>(a, "/api/user")
    .then((u) => u?.login || u?.name || "Backslash")
    .catch(() => "Backslash");

async function expire(a: Account, id: string) {
  await grafana(a, `${AM}/silence/${encodeURIComponent(id)}`, { method: "DELETE" });
  await toast("Silence expired", { style: "success", message: "Its alerts notify again" });
  return refresh();
}

const silenceUrl = (a: Account, id: string) => `${a.base}/alerting/silence/${id}/edit?alertmanager=grafana`;

function alertItem(a: Account, alert: Alert, silenced: boolean): Item {
  const sev = SEVERITIES[severityOf(alert)];
  const labels = visibleLabels(alert);
  const summary = alert.annotations.summary ?? alert.annotations.message;
  const description = alert.annotations.description;
  const runbook = alert.annotations.runbook_url;
  const panel = panelUrl(a.base, alert);
  const folder = alert.labels.grafana_folder;
  const metadata: Metadata[] = [
    meta.text("Severity", sev.title, { icon: Icons.alert, color: sev.color }),
    meta.text("State", silenced ? "Silenced" : "Firing", {
      icon: silenced ? Icons.bellOff : Icons.bell,
      color: silenced ? "gray" : "red",
    }),
    ...(alert.startsAt
      ? [meta.text("Since", `${alert.startsAt.toLocaleString("en-GB")} (${since(alert.startsAt)})`, {
        icon: Icons.clock,
      })]
      : []),
    ...(folder ? [meta.text("Folder", folder, { icon: Icons.folder })] : []),
    ...(alert.receivers.length ? [meta.tags("Contact points", alert.receivers)] : []),
    ...(labels.length ? [meta.separator(), ...labels.map(([k, v]) => meta.text(k, v, { icon: Icons.tag }))] : []),
    ...(runbook ? [meta.link("Runbook", runbook.replace(/^https?:\/\//, ""), runbook)] : []),
  ];
  const actions: Action[] = [
    ...(alert.generatorURL ? [open(alert.generatorURL, "Open Alert Rule")] : []),
    ...(panel ? [open(panel, "Open Dashboard Panel", { icon: Icons.chartUp, shortcut: "<Ctrl>d" })] : []),
    ...(runbook ? [open(runbook, "Open Runbook", { icon: Icons.book, shortcut: "<Ctrl>r" })] : []),
    silenced
      ? submenu(
        "Expire Silence",
        alert.silencedBy.map((id) =>
          action(`Silence ${id.slice(0, 8)}`, () => expire(a, id), {
            icon: Icons.bell,
            confirm: "Expire this silence? Its alerts notify again.",
          })
        ),
        { icon: Icons.bell, shortcut: "<Ctrl>s", section: "Silence" },
      )
      : submenu(
        "Silence",
        DURATIONS.map((d) =>
          action(`For ${d.title}`, async () => {
            const body = silenceBody(alert, d.hours, await createdBy(a));
            await grafana(a, `${AM}/silences`, { method: "POST", body });
            await toast(`Silenced ${alertName(alert)} for ${d.title.toLowerCase()}`, { style: "success" });
            return refresh();
          }, { icon: Icons.bellOff })
        ),
        { icon: Icons.bellOff, shortcut: "<Ctrl>s", section: "Silence" },
      ),
    open(
      `${a.base}/alerting/silence/new?alertmanager=grafana&${
        Object.entries(alert.labels).filter(([k]) => !k.startsWith("__")).map(([k, v]) =>
          `matcher=${encodeURIComponent(`${k}=${v}`)}`
        ).join("&")
      }`,
      "Custom Silence in Grafana",
      { icon: Icons.settings, section: "Silence" },
    ),
    copy(alertName(alert), "Copy Alert Name", { shortcut: "<Ctrl>period", section: "Copy" }),
    copy(labels.map(([k, v]) => `${k}=${v}`).join("\n"), "Copy Labels", { icon: Icons.tag, section: "Copy" }),
    open(`${a.base}/alerting/list`, "Open Alert Rules", { icon: Icons.bell, section: "Grafana" }),
  ];
  return {
    id: alert.fingerprint,
    title: alertName(alert),
    subtitle: summary ?? labels.slice(0, 2).map(([k, v]) => `${k}=${v}`).join(" "),
    icon: { source: silenced ? Icons.bellOff : Icons.alert, tint: silenced ? "gray" : sev.color },
    section: silenced ? "Silenced" : sev.title,
    keywords: [...labels.flatMap(([k, v]) => [k, v]), summary ?? "", sev.title],
    accessories: [
      ...(alert.labels.instance ? [{ text: alert.labels.instance, tooltip: "Instance" }] : []),
      ...(folder ? [{ icon: Icons.folder, text: folder, tooltip: "Folder" }] : []),
      { text: since(alert.startsAt), tooltip: "Firing for" },
    ],
    detail: {
      markdown: [summary && `**${summary}**`, description].filter(Boolean).join("\n\n") || undefined,
      metadata,
    },
    actions,
  };
}

function silenceItem(a: Account, s: Silence): Item {
  const live = s.state !== "expired";
  const color = s.state === "active" ? "purple" as const : s.state === "pending" ? "blue" as const : "gray" as const;
  const name = s.matchers.find((m) => m.name === "alertname")?.value;
  const rest = s.matchers.filter((m) => m.name !== "alertname" && !m.name.startsWith("__"));
  const left = s.endsAt ? s.endsAt.getTime() - Date.now() : 0;
  return {
    id: `silence:${s.id}`,
    title: name ?? (rest.map(matcherText).join(", ") || s.id),
    subtitle: s.comment || undefined,
    icon: { source: Icons.bellOff, tint: color },
    section: live ? "Silences" : "Expired Silences",
    keywords: [...s.matchers.map(matcherText), s.createdBy, s.state],
    accessories: [
      ...(s.state !== "active" ? [{ tag: s.state === "pending" ? "Pending" : "Expired", color }] : []),
      ...(s.createdBy ? [{ avatar: s.createdBy, tooltip: `By ${s.createdBy}` }] : []),
      {
        text: live ? `${duration(left)} left` : ago(s.endsAt),
        tooltip: s.endsAt?.toLocaleString("en-GB"),
      },
    ],
    detail: {
      markdown: s.comment || undefined,
      metadata: [
        meta.text("State", s.state.charAt(0).toUpperCase() + s.state.slice(1), { icon: Icons.dot, color }),
        meta.tags("Matchers", s.matchers.map((m) => ({ text: matcherText(m), color: "purple" as const }))),
        ...(s.createdBy ? [meta.person("Created by", s.createdBy)] : []),
        ...(s.startsAt ? [meta.text("Starts", s.startsAt.toLocaleString("en-GB"), { icon: Icons.calendar })] : []),
        ...(s.endsAt ? [meta.text("Ends", s.endsAt.toLocaleString("en-GB"), { icon: Icons.clock })] : []),
      ],
    },
    actions: [
      open(silenceUrl(a, s.id), live ? "Edit in Grafana" : "Recreate in Grafana"),
      copy(s.id, "Copy Silence ID", { section: "Copy" }),
      copy(s.matchers.map(matcherText).join(", "), "Copy Matchers", { section: "Copy" }),
      ...(live
        ? [action("Expire Silence", () => expire(a, s.id), {
          icon: Icons.bell,
          destructive: true,
          shortcut: "<Ctrl><Shift>Delete",
          confirm: "Expire this silence? Its alerts notify again.",
          section: "Danger",
        })]
        : []),
    ],
  };
}

let summary = "";

export default list({
  placeholder: "Filter alerts by name, label, summary…",
  filter: {
    options: [
      { value: "firing", title: "Firing" },
      { value: "silenced", title: "Silenced" },
      { value: "silences", title: "Silences" },
    ],
    default: "firing",
  },
  empty: { title: "All quiet", description: "Nothing in this view of Grafana Alerting", icon: Icons.check },
  status: () => summary,
  actions: [],
  items: ({ preferences, filter, signal }) =>
    guarded(preferences, async () => {
      summary = "";
      const a = account(preferences);
      const view = filter ?? "firing";
      if (view === "silences") {
        const silences = sortSilences(parseSilences(await grafana(a, `${AM}/silences`, { signal })));
        const live = silences.filter((s) => s.state !== "expired").length;
        summary = `${live} active silence${live === 1 ? "" : "s"}`;
        return silences.map((s) => silenceItem(a, s));
      }
      const params = view === "silenced"
        ? "active=false&silenced=true&inhibited=false"
        : "active=true&silenced=false&inhibited=false";
      const alerts = sortAlerts(
        parseAlerts(await grafana(a, `${AM}/alerts?${params}`, { signal })).filter((x) =>
          view === "silenced" ? x.silencedBy.length : x.state === "active"
        ),
      );
      if (view === "firing") {
        const critical = alerts.filter((x) => severityOf(x) === "critical").length;
        summary = `${alerts.length} firing${critical ? ` · ${critical} critical` : ""}`;
        updateCommandMetadata({ subtitle: alerts.length ? `${alerts.length} firing` : null }).catch(() => {});
      } else summary = `${alerts.length} silenced`;
      return alerts.map((x) => alertItem(a, x, view === "silenced"));
    }),
});
