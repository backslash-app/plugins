import {
  type Action,
  action,
  copy,
  field,
  form,
  type FormSpec,
  Icons,
  type Item,
  list,
  meta,
  type Metadata,
  open,
  pop,
  refresh,
  submenu,
  toast,
  updateCommandMetadata,
} from "@backslash/api";
import { alertmanagers, call, errorItem, fromEach, guarded, type Server } from "../api.ts";
import {
  type Alert,
  type AlertGroup,
  alertName,
  commonLabels,
  duration,
  DURATIONS,
  groupTitle,
  hostLabel,
  type Matcher,
  matchersOf,
  matcherText,
  mergeAlerts,
  mergeGroups,
  mergeSilences,
  parseAlerts,
  parseDuration,
  parseGroups,
  parseMatchers,
  parseSilences,
  SEVERITIES,
  severityOf,
  type Silence,
  silenceBody,
  since,
  sortAlerts,
  sortGroups,
  sortSilences,
  visibleLabels,
  worstSeverity,
} from "../lib.ts";

type Prefs = Record<string, unknown>;

const author = (p: Prefs) => String(p.author ?? "").trim() || "Backslash";
const when = (d?: Date) => d?.toLocaleString("en-GB") ?? "";
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

// --- Silences ------------------------------------------------------------------------

/** One silence on one Alertmanager: an HA cluster shares it with the others. */
async function createSilence(server: Server, matchers: Matcher[], ms: number, by: string, comment: string) {
  const body = silenceBody(matchers, ms, by, comment);
  const res = await call<{ silenceID?: string }>(server, "/api/v2/silences", { method: "POST", body });
  return res?.silenceID;
}

async function expire(servers: Server[], s: Silence) {
  const targets = servers.filter((x) => s.sources.includes(x.base));
  // In an HA cluster, expiring on one member is enough; separate Alertmanagers each need it.
  for (const server of targets.length ? targets : servers.slice(0, 1)) {
    await call(server, `/api/v2/silence/${encodeURIComponent(s.id)}`, { method: "DELETE" }).catch((e) => {
      if (!/not found|already expired/i.test(String(e?.message))) throw e;
    });
  }
  await toast("Silence expired", { style: "success", message: "Its alerts notify again" });
  return refresh();
}

function customSilence(server: Server, matchers: Matcher[], prefs: Prefs, what: string): FormSpec {
  return form({
    title: `Silence ${what}`,
    submitTitle: "Create Silence",
    fields: [
      field.text("duration", "Duration", {
        required: true,
        value: "2h",
        placeholder: "2h, 90m, 1d12h, 1w, or an end date: 2026-11-02 18:00",
      }),
      field.textArea("matchers", "Matchers", {
        required: true,
        value: matchers.map(matcherText).join("\n"),
        placeholder: 'One per line: alertname="HighCPU", instance=~"web-.*", env!="dev"',
      }),
      field.text("comment", "Comment", { placeholder: "Why: maintenance, known issue, ticket…" }),
      field.text("createdBy", "Created by", { value: author(prefs) }),
    ],
    async submit(values) {
      const ms = parseDuration(String(values.duration ?? ""));
      const parsed = parseMatchers(String(values.matchers ?? ""));
      await createSilence(server, parsed, ms, String(values.createdBy ?? ""), String(values.comment ?? ""));
      await toast(`Silenced ${what} for ${duration(ms)}`, { style: "success" });
      return pop();
    },
  });
}

/** "Silence ›" with the usual durations and a custom one. */
function silenceMenu(server: Server, matchers: Matcher[], prefs: Prefs, what: string): Action {
  return submenu("Silence", [
    ...DURATIONS.map((d) =>
      action(`For ${d.title}`, async () => {
        await createSilence(
          server,
          matchers,
          d.ms,
          author(prefs),
          `Silenced from Backslash for ${d.title.toLowerCase()}`,
        );
        await toast(`Silenced ${what} for ${d.title.toLowerCase()}`, { style: "success" });
        return refresh();
      }, { icon: Icons.bellOff })
    ),
    action("Custom…", () => customSilence(server, matchers, prefs, what), { icon: Icons.settings }),
  ], { icon: Icons.bellOff, shortcut: "<Ctrl>s", section: "Silence" });
}

// --- Items ---------------------------------------------------------------------------

const serverOf = (servers: Server[], sources: string[]) => servers.find((s) => sources.includes(s.base)) ?? servers[0];

function alertMetadata(alert: Alert, silenced: boolean, multi: boolean): Metadata[] {
  const sev = SEVERITIES[severityOf(alert)];
  const runbook = alert.annotations.runbook_url ?? alert.annotations.runbook;
  return [
    meta.text("Severity", sev.title, { icon: Icons.alert, color: sev.color }),
    meta.text(
      "State",
      silenced ? "Silenced" : alert.inhibitedBy.length ? "Inhibited" : "Firing",
      { icon: silenced ? Icons.bellOff : Icons.bell, color: silenced ? "gray" : "red" },
    ),
    ...(alert.startsAt
      ? [meta.text("Since", `${when(alert.startsAt)} (${since(alert.startsAt)})`, { icon: Icons.clock })]
      : []),
    ...(alert.receivers.length ? [meta.tags("Receivers", alert.receivers)] : []),
    ...(multi ? [meta.tags("Alertmanagers", alert.sources.map(hostLabel))] : []),
    meta.separator(),
    ...visibleLabels(alert).map(([k, v]) => meta.text(k, v, { icon: Icons.tag })),
    ...(runbook && /^https?:\/\//.test(runbook)
      ? [meta.link("Runbook", runbook.replace(/^https?:\/\//, ""), runbook)]
      : []),
  ];
}

function alertMarkdown(alert: Alert): string | undefined {
  const a = alert.annotations;
  const summary = a.summary ?? a.message ?? a.title;
  const rest = Object.entries(a).filter(([k]) =>
    !["summary", "message", "title", "description", "runbook_url"].includes(k)
  );
  return [
    summary && `**${summary}**`,
    a.description,
    rest.length ? rest.map(([k, v]) => `- **${k}**: ${v}`).join("\n") : undefined,
  ].filter(Boolean).join("\n\n") || undefined;
}

function alertActions(servers: Server[], alert: Alert, silenced: boolean, silences: Silence[], prefs: Prefs): Action[] {
  const server = serverOf(servers, alert.sources);
  const runbook = alert.annotations.runbook_url;
  const labels = visibleLabels(alert);
  const filter = encodeURIComponent(`{${matchersOf(alert.labels).map(matcherText).join(",")}}`);
  return [
    ...(alert.generatorURL ? [open(alert.generatorURL, "Open in Prometheus")] : []),
    silenced
      ? submenu(
        "Expire Silence",
        alert.silencedBy.map((id) => {
          const s = silences.find((x) => x.id === id) ?? {
            id,
            state: "active",
            matchers: [],
            createdBy: "",
            comment: "",
            sources: alert.sources,
          };
          return action(s.comment ? s.comment.slice(0, 60) : `Silence ${id.slice(0, 8)}`, () => expire(servers, s), {
            icon: Icons.bell,
            confirm: "Expire this silence? Its alerts notify again.",
          });
        }),
        { icon: Icons.bell, shortcut: "<Ctrl>s", section: "Silence" },
      )
      : silenceMenu(server, matchersOf(alert.labels), prefs, alertName(alert)),
    ...(runbook ? [open(runbook, "Open Runbook", { icon: Icons.book, shortcut: "<Ctrl>r" })] : []),
    open(`${server.base}/#/alerts?filter=${filter}`, "Open in Alertmanager", { icon: Icons.bell, shortcut: "<Ctrl>o" }),
    copy(alertName(alert), "Copy Alert Name", { shortcut: "<Ctrl>period", section: "Copy" }),
    copy(labels.map(([k, v]) => `${k}=${JSON.stringify(v)}`).join("\n"), "Copy Labels", {
      icon: Icons.tag,
      section: "Copy",
    }),
    copy(
      `amtool silence add ${
        matchersOf(alert.labels).map((m) => `'${matcherText(m)}'`).join(" ")
      } --duration=2h --comment=''`,
      "Copy amtool Command",
      { icon: Icons.terminal, section: "Copy" },
    ),
  ];
}

function alertItem(servers: Server[], alert: Alert, silenced: boolean, silences: Silence[], prefs: Prefs): Item {
  const sev = SEVERITIES[severityOf(alert)];
  const labels = visibleLabels(alert);
  const summary = alert.annotations.summary ?? alert.annotations.message;
  return {
    id: alert.fingerprint,
    title: alertName(alert),
    subtitle: summary ?? labels.slice(0, 3).map(([k, v]) => `${k}=${v}`).join(" "),
    icon: { source: silenced ? Icons.bellOff : Icons.alert, tint: silenced ? "gray" : sev.color },
    section: silenced ? "Silenced" : sev.title,
    keywords: [...labels.flatMap(([k, v]) => [k, v, `${k}=${v}`]), summary ?? "", sev.title],
    accessories: [
      ...(alert.labels.instance ? [{ text: alert.labels.instance, tooltip: "Instance" }] : []),
      ...(alert.labels.job ? [{ tag: alert.labels.job, tooltip: "Job" }] : []),
      ...(alert.inhibitedBy.length ? [{ tag: "Inhibited", color: "gray" as const }] : []),
      { text: since(alert.startsAt), tooltip: "Firing for" },
    ],
    detail: { markdown: alertMarkdown(alert), metadata: alertMetadata(alert, silenced, servers.length > 1) },
    actions: alertActions(servers, alert, silenced, silences, prefs),
  };
}

function groupItem(servers: Server[], g: AlertGroup, prefs: Prefs): Item {
  const sev = SEVERITIES[worstSeverity(g.alerts)];
  const title = groupTitle(g);
  const common = commonLabels(g.alerts);
  const server = serverOf(servers, g.alerts[0]?.sources ?? []);
  const rows = g.alerts.slice(0, 50).map((a) => {
    const s = SEVERITIES[severityOf(a)];
    const own = visibleLabels(a).filter(([k]) => common[k] === undefined).map(([k, v]) => `${k}=${v}`).join(" ");
    return `- **${s.title}** ${a.annotations.summary ?? alertName(a)}${own ? ` · \`${own}\`` : ""} · ${
      since(a.startsAt)
    }`;
  });
  return {
    id: `group:${g.receiver}:${title}`,
    title,
    subtitle: g.alerts.length === 1
      ? (g.alerts[0].annotations.summary ?? alertName(g.alerts[0]))
      : `${g.alerts.length} alerts`,
    icon: { source: Icons.layers, tint: sev.color },
    section: sev.title,
    keywords: [g.receiver, ...g.alerts.flatMap((a) => [alertName(a), ...Object.values(a.labels)])],
    accessories: [
      ...(g.receiver ? [{ tag: g.receiver, tooltip: "Receiver" }] : []),
      { text: String(g.alerts.length), icon: Icons.bell, tooltip: "Alerts" },
    ],
    detail: {
      markdown: [`**${plural(g.alerts.length, "alert")}**`, rows.join("\n"), g.alerts.length > 50 ? "…" : ""]
        .filter(Boolean).join("\n\n"),
      metadata: [
        meta.text("Worst severity", sev.title, { icon: Icons.alert, color: sev.color }),
        ...(g.receiver ? [meta.text("Receiver", g.receiver, { icon: Icons.mail })] : []),
        meta.separator(),
        ...Object.entries(common).filter(([k]) => k !== "alertname").map(([k, v]) =>
          meta.text(k, v, { icon: Icons.tag })
        ),
      ],
    },
    actions: [
      silenceMenu(server, matchersOf(common), prefs, title),
      open(`${server.base}/#/alerts`, "Open in Alertmanager", { icon: Icons.bell, shortcut: "<Ctrl>o" }),
      copy(Object.entries(common).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join("\n"), "Copy Common Labels", {
        icon: Icons.tag,
        section: "Copy",
      }),
    ],
  };
}

function silenceItem(servers: Server[], s: Silence): Item {
  const live = s.state !== "expired";
  const color = s.state === "active" ? "purple" as const : s.state === "pending" ? "blue" as const : "gray" as const;
  const name = s.matchers.find((m) => m.name === "alertname" && m.isEqual && !m.isRegex)?.value;
  const rest = s.matchers.filter((m) => m.name !== "alertname");
  const left = s.endsAt ? s.endsAt.getTime() - Date.now() : 0;
  const server = serverOf(servers, s.sources);
  return {
    id: `silence:${s.id}`,
    title: name ?? (rest.map(matcherText).join(", ") || s.id),
    subtitle: s.comment || (name ? rest.map(matcherText).join(", ") : undefined),
    icon: { source: Icons.bellOff, tint: color },
    section: live ? "Silences" : "Expired Silences",
    keywords: [...s.matchers.map(matcherText), s.createdBy, s.state, s.comment],
    accessories: [
      ...(s.state !== "active" ? [{ tag: s.state === "pending" ? "Pending" : "Expired", color }] : []),
      ...(s.createdBy ? [{ avatar: s.createdBy, tooltip: `By ${s.createdBy}` }] : []),
      { text: live ? `${duration(left)} left` : `${since(s.endsAt)} ago`, tooltip: when(s.endsAt) },
    ],
    detail: {
      markdown: s.comment || undefined,
      metadata: [
        meta.text("State", s.state.charAt(0).toUpperCase() + s.state.slice(1), { icon: Icons.dot, color }),
        meta.tags("Matchers", s.matchers.map((m) => ({ text: matcherText(m), color: "purple" as const }))),
        ...(s.createdBy ? [meta.person("Created by", s.createdBy)] : []),
        ...(s.startsAt ? [meta.text("Starts", when(s.startsAt), { icon: Icons.calendar })] : []),
        ...(s.endsAt ? [meta.text("Ends", when(s.endsAt), { icon: Icons.clock })] : []),
        ...(servers.length > 1 ? [meta.tags("Alertmanagers", s.sources.map(hostLabel))] : []),
        meta.text("ID", s.id, { icon: Icons.hash }),
      ],
    },
    actions: [
      open(`${server.base}/#/silences/${s.id}`, "Open in Alertmanager"),
      copy(s.id, "Copy Silence ID", { section: "Copy" }),
      copy(s.matchers.map(matcherText).join(", "), "Copy Matchers", { section: "Copy" }),
      ...(live
        ? [action("Expire Silence", () => expire(servers, s), {
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

// --- The list -------------------------------------------------------------------------

const QUERIES: Record<string, string> = {
  firing: "active=true&silenced=false&inhibited=false&unprocessed=false",
  grouped: "active=true&silenced=false&inhibited=false&unprocessed=false",
  silenced: "active=false&silenced=true&inhibited=false&unprocessed=false",
};

let summary = "";

export default list({
  placeholder: "Filter alerts by name, label, summary…",
  filter: {
    options: [
      { value: "firing", title: "Firing" },
      { value: "grouped", title: "Grouped" },
      { value: "silenced", title: "Silenced" },
      { value: "silences", title: "Silences" },
    ],
    default: "firing",
  },
  empty: { title: "All quiet", description: "Nothing in this view of Alertmanager", icon: Icons.check },
  status: () => summary,
  items: ({ preferences, filter, signal }) =>
    guarded(async () => {
      summary = "";
      const servers = alertmanagers(preferences);
      const view = filter ?? "firing";
      const silencesOf = () =>
        fromEach(servers, async (s) => parseSilences(await call(s, "/api/v2/silences", { signal }), s.base));
      const failed = (errors: { server: Server; error: unknown }[]) => errors.map((e) => errorItem(e.error, e.server));

      if (view === "silences") {
        const { results, errors } = await silencesOf();
        const silences = sortSilences(mergeSilences(results));
        const live = silences.filter((s) => s.state !== "expired").length;
        summary = `${plural(live, "active silence")}`;
        return [...failed(errors), ...silences.map((s) => silenceItem(servers, s))];
      }

      if (view === "grouped") {
        const { results, errors } = await fromEach(
          servers,
          async (s) => parseGroups(await call(s, `/api/v2/alerts/groups?${QUERIES.grouped}`, { signal }), s.base),
        );
        const groups = sortGroups(mergeGroups(results));
        const total = groups.reduce((n, g) => n + g.alerts.length, 0);
        summary = `${plural(total, "alert")} in ${plural(groups.length, "group")}`;
        return [...failed(errors), ...groups.map((g) => groupItem(servers, g, preferences))];
      }

      const silenced = view === "silenced";
      const [alerts, silences] = await Promise.all([
        fromEach(
          servers,
          async (s) => parseAlerts(await call(s, `/api/v2/alerts?${QUERIES[view]}`, { signal }), s.base),
        ),
        silenced ? silencesOf() : Promise.resolve({ results: [] as Silence[][], errors: [] }),
      ]);
      const shown = sortAlerts(mergeAlerts(alerts.results)).filter((a) => silenced ? a.silencedBy.length : true);
      const known = mergeSilences(silences.results);
      if (!silenced) {
        const critical = shown.filter((a) => severityOf(a) === "critical").length;
        summary = `${shown.length} firing${critical ? ` · ${critical} critical` : ""}${
          servers.length > 1 ? ` · ${plural(servers.length, "Alertmanager")}` : ""
        }`;
        updateCommandMetadata({ subtitle: shown.length ? `${shown.length} firing` : null }).catch(() => {});
      } else summary = `${shown.length} silenced`;
      return [...failed(alerts.errors), ...shown.map((a) => alertItem(servers, a, silenced, known, preferences))];
    }, signal),
});
