import {
  type Action,
  action,
  copy,
  Icons,
  type Item,
  list,
  meta,
  open,
  refresh,
  toast,
  updateCommandMetadata,
} from "@backslash/api";
import { type Account, account, appUrl, dd, guarded } from "../api.ts";
import {
  age,
  cleanMessage,
  type Downtime,
  downtimesOf,
  filterMonitors,
  formatDate,
  isMuted,
  isTriggered,
  type Monitor,
  MONITOR_COLORS,
  type MonitorFilter,
  muteLabel,
  notifiedHandles,
  parseDowntimes,
  type RawMonitor,
  sortMonitors,
  toMonitor,
  withDowntimes,
} from "../lib.ts";

const PAGE = 500;

async function loadMonitors(a: Account, signal: AbortSignal): Promise<Monitor[]> {
  const out: Monitor[] = [];
  for (let page = 0; page < 6; page++) {
    const params = new URLSearchParams({
      group_states: "alert,warn,no data",
      page: String(page),
      page_size: String(PAGE),
    });
    const batch = await dd<RawMonitor[]>(a, `/api/v1/monitor?${params}`, { signal });
    out.push(...batch.map(toMonitor));
    if (batch.length < PAGE) break;
  }
  return out;
}

async function loadDowntimes(a: Account, signal?: AbortSignal): Promise<Downtime[]> {
  return parseDowntimes(await dd(a, "/api/v2/downtime?current_only=true&page[limit]=500", { signal }));
}

function mute(a: Account, m: Monitor, hours: number, title: string, shortcut?: string): Action {
  return action(title, async () => {
    await dd(a, "/api/v2/downtime", {
      method: "POST",
      body: {
        data: {
          type: "downtime",
          attributes: {
            monitor_identifier: { monitor_id: m.id },
            scope: "*",
            message: "Muted from Backslash",
            schedule: { start: null, end: new Date(Date.now() + hours * 3_600_000).toISOString() },
          },
        },
      },
    });
    await toast(`Muted ${m.name} for ${hours === 1 ? "1 hour" : hours === 24 ? "1 day" : `${hours} hours`}`, {
      style: "success",
    });
    return refresh();
  }, { icon: Icons.bellOff, shortcut, section: "Mute" });
}

function unmute(a: Account, m: Monitor): Action {
  return action("Unmute", async () => {
    const mine = downtimesOf(m, await loadDowntimes(a)).filter((d) => d.monitorId === m.id);
    if (!mine.length) {
      throw new Error("This monitor is muted by a downtime on its tags, or the old way: unmute it in Datadog");
    }
    await Promise.all(mine.map((d) => dd(a, `/api/v2/downtime/${d.id}`, { method: "DELETE" })));
    await toast(`Unmuted ${m.name}`, { style: "success" });
    return refresh();
  }, { icon: Icons.bell, shortcut: "<Ctrl><Shift>u", section: "Mute" });
}

function item(a: Account, m: Monitor): Item {
  const color = MONITOR_COLORS[m.state];
  const muted = isMuted(m);
  const url = appUrl(a, `/monitors/${m.id}`);
  const message = cleanMessage(m.message);
  const handles = notifiedHandles(m.message);
  const groupLines = m.groups.slice(0, 15).map((g) =>
    `- **${g.status}** \`${g.name.replace(/`/g, "'")}\`${g.since ? ` · ${age(g.since)}` : ""}`
  );
  return {
    id: String(m.id),
    title: m.name,
    subtitle: m.groups.length ? `${m.groups.length} group${m.groups.length === 1 ? "" : "s"} triggered` : m.type,
    icon: { source: muted ? Icons.bellOff : isTriggered(m) ? Icons.alert : Icons.bell, tint: color },
    section: isTriggered(m) ? m.state : "Other monitors",
    keywords: [m.type, m.state, ...m.tags, m.query ?? "", String(m.id)],
    accessories: [
      ...(m.priority ? [{ text: `P${m.priority}`, tooltip: "Priority" }] : []),
      ...(muted
        ? [{ icon: Icons.bellOff, text: muteLabel(m), tooltip: formatDate(m.mutedUntil) || "Until unmuted" }]
        : []),
      ...(m.stateSince && isTriggered(m)
        ? [{ text: age(m.stateSince), tooltip: `Since ${formatDate(m.stateSince)}` }]
        : []),
      { tag: m.state, color },
    ],
    detail: {
      markdown: [
        ...(groupLines.length ? ["**Triggered groups**", "", ...groupLines, ""] : []),
        ...(m.query ? ["```", m.query.replace(/```/g, "ʼʼʼ"), "```", ""] : []),
        message,
      ].join("\n").trim() || undefined,
      metadata: [
        meta.text("State", m.state, { icon: Icons.dot, color }),
        ...(muted
          ? [
            meta.text("Muted", m.mutedUntil === Infinity ? "Until unmuted" : `Until ${formatDate(m.mutedUntil)}`, {
              icon: Icons.bellOff,
            }),
          ]
          : []),
        meta.text("Type", m.type, { icon: Icons.activity }),
        ...(m.priority ? [meta.text("Priority", `P${m.priority}`, { icon: Icons.flag })] : []),
        ...(m.tags.length ? [meta.tags("Tags", m.tags.slice(0, 10))] : []),
        ...(handles.length ? [meta.tags("Notifies", handles.slice(0, 6))] : []),
        meta.separator(),
        ...(m.stateSince ? [meta.text("State changed", formatDate(m.stateSince), { icon: Icons.clock })] : []),
        ...(m.creator ? [meta.person("Created by", m.creator)] : []),
        meta.text("ID", String(m.id), { icon: Icons.hash }),
      ],
    },
    actions: [
      open(url, "Open in Datadog", { icon: Icons.external }),
      ...(muted ? [unmute(a, m)] : []),
      mute(a, m, 1, muted ? "Mute for 1 Hour From Now" : "Mute for 1 Hour", muted ? undefined : "<Ctrl><Shift>m"),
      mute(a, m, 24, muted ? "Mute for 1 Day From Now" : "Mute for 1 Day"),
      open(appUrl(a, `/monitors/${m.id}/edit`), "Edit in Datadog", { icon: Icons.settings, section: "Open" }),
      copy(url, "Copy Link", { shortcut: "<Ctrl><Shift>c", section: "Copy" }),
      copy(String(m.id), "Copy Monitor ID", { shortcut: "<Ctrl>period", section: "Copy" }),
      ...(m.query ? [copy(m.query, "Copy Query", { icon: Icons.code, section: "Copy" })] : []),
      action("Reload", () => refresh(), { icon: Icons.refresh, shortcut: "<Ctrl>r" }),
    ],
  };
}

let summary = "";

export default list({
  placeholder: "Filter monitors by name, tag, type, query…",
  filter: {
    options: [
      { value: "triggered", title: "Triggered" },
      { value: "muted", title: "Muted" },
      { value: "all", title: "All" },
    ],
    default: "triggered",
  },
  empty: { title: "All clear", description: "No monitor matches this filter", icon: Icons.done },
  status: () => summary,
  items: ({ preferences, filter, signal }) =>
    guarded(async () => {
      summary = "";
      const a = account(preferences);
      const [monitors, downtimes] = await Promise.all([
        loadMonitors(a, signal),
        loadDowntimes(a, signal).catch((e) => {
          if (signal.aborted) throw e;
          return [] as Downtime[];
        }),
      ]);
      const all = withDowntimes(monitors, downtimes);
      const count = (s: string) => all.filter((m) => m.state === s).length;
      const alert = count("Alert"), warn = count("Warn"), noData = count("No Data");
      summary = [
        `${a.site.label}`,
        `${all.length} monitors`,
        alert ? `${alert} alert` : "",
        warn ? `${warn} warn` : "",
        noData ? `${noData} no data` : "",
      ].filter(Boolean).join(" · ");
      await updateCommandMetadata({
        subtitle: alert || warn
          ? [alert ? `${alert} alert` : "", warn ? `${warn} warn` : ""].filter(Boolean).join(" · ")
          : "All OK",
      }).catch(() => {});
      return sortMonitors(filterMonitors(all, (filter ?? "triggered") as MonitorFilter)).map((m) => item(a, m));
    }),
});
