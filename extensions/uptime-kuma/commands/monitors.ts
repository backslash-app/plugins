import {
  type Accessory,
  type Action,
  action,
  copy,
  detail,
  Icons,
  type Item,
  list,
  meta,
  type Metadata,
  open,
  refresh,
  toast,
  updateCommandMetadata,
} from "@backslash/api";
import {
  BETTERSTACK,
  betterstack,
  betterstackMonitors,
  type Config,
  config,
  kuma,
  setPaused,
  SetupError,
  setupItem,
} from "../api.ts";
import {
  ago,
  beatBar,
  certColor,
  duration,
  latestResponseTime,
  type Monitor,
  ms,
  outages,
  percent,
  sortMonitors,
  STATUS,
} from "../lib.ts";

const SOURCE = { kuma: "Uptime Kuma", betterstack: "Better Stack" };

function dashboard(c: Config, m: Monitor): string {
  if (m.source === "betterstack") return `${BETTERSTACK}/monitors/${m.id}`;
  return m.id ? `${c.kuma}/dashboard/${m.id}` : `${c.kuma}/dashboard`;
}

async function betterstackDetail(c: Config, m: Monitor) {
  const [times, sla] = await Promise.all([
    betterstack(c, `/monitors/${m.id}/response-times`).catch(() => undefined),
    betterstack(c, `/monitors/${m.id}/sla`).catch(() => undefined),
  ]);
  const rt = latestResponseTime(times);
  const a = sla?.data?.attributes ?? {};
  const lines: Metadata[] = [
    meta.text("Status", STATUS[m.status].title, { icon: Icons.dot, color: STATUS[m.status].color }),
    ...(typeof a.availability === "number" ? [meta.text("Availability (30 d)", `${a.availability} %`)] : []),
    ...(typeof a.number_of_incidents === "number" ? [meta.text("Incidents", String(a.number_of_incidents))] : []),
    ...(typeof a.total_downtime === "number" ? [meta.text("Downtime", duration(a.total_downtime * 1000))] : []),
    ...(typeof a.longest_incident === "number" ? [meta.text("Longest", duration(a.longest_incident * 1000))] : []),
    meta.separator(),
    ...rt.regions.map((r) => meta.text(`Response (${r.region})`, ms(r.ms), { icon: Icons.clock })),
  ];
  return detail({
    title: m.name,
    markdown: [
      `## ${m.name}`,
      "",
      m.target ? `\`${m.target}\`` : "",
      "",
      rt.ms !== undefined
        ? `Latest response time **${ms(rt.ms)}**, averaged over ${rt.regions.length} region${
          rt.regions.length === 1 ? "" : "s"
        }.`
        : "_No response times yet._",
    ].join("\n"),
    stats: [
      { label: "status", value: STATUS[m.status].title, color: STATUS[m.status].color },
      ...(rt.ms !== undefined ? [{ label: "response", value: ms(rt.ms) }] : []),
      ...(typeof a.availability === "number" ? [{ label: "availability", value: `${a.availability} %` }] : []),
    ],
    metadata: lines,
    actions: [open(dashboard(c, m), "Open in Better Stack")],
  });
}

function historyMarkdown(m: Monitor): string {
  const beats = m.beats ?? [];
  if (!beats.length) return "";
  const downs = outages(beats).reverse().slice(0, 5);
  const last = beats[beats.length - 1];
  return [
    `${beatBar(beats)}`,
    "",
    `Last ${Math.min(40, beats.length)} heartbeat${beats.length === 1 ? "" : "s"}${
      last ? `, the latest ${ago(last.time)}` : ""
    }.`,
    ...(last?.msg ? ["", `> ${last.msg}`] : []),
    ...(downs.length
      ? [
        "",
        "### Recent outages",
        "",
        ...downs.map((o) =>
          `- ${new Date(o.start).toLocaleString("en-GB")} · ${o.end ? duration(o.end - o.start) : "ongoing"}${
            o.msg ? ` · ${o.msg}` : ""
          }`
        ),
      ]
      : []),
  ].join("\n");
}

function item(c: Config, m: Monitor): Item {
  const s = STATUS[m.status];
  const cert = certColor(m.certDays, m.certValid);
  const accessories: Accessory[] = [
    ...(m.responseTime !== undefined && m.status !== "down"
      ? [{ text: ms(m.responseTime), tooltip: "Response time" }]
      : []),
    ...(m.certDays !== undefined && m.certDays >= 0 && (m.target?.startsWith("https") ?? true)
      ? [{
        icon: { source: Icons.lock, tint: cert ?? "gray" },
        text: `${Math.floor(m.certDays)} d`,
        tooltip: "Days until the certificate expires",
      }]
      : []),
    ...(m.certValid === false ? [{ tag: "bad cert", color: "red" as const }] : []),
    ...(m.uptime24 !== undefined ? [{ text: percent(m.uptime24), tooltip: "Uptime, last 24 hours" }] : []),
    { tag: s.title, color: s.color },
  ];
  const actions: Action[] = [
    open(dashboard(c, m), m.source === "kuma" ? "Open in Uptime Kuma" : "Open in Better Stack"),
    ...(m.target?.startsWith("http") ? [open(m.target, "Open Monitored URL", { icon: Icons.globe })] : []),
    ...(m.source === "betterstack"
      ? [
        action("Show Response Times & SLA", () => betterstackDetail(c, m), {
          icon: Icons.chartUp,
          shortcut: "<Ctrl>d",
        }),
        m.paused
          ? action("Resume Monitor", async () => {
            await setPaused(c, m.id!, false);
            await toast(`${m.name} resumed`, { style: "success" });
            return refresh();
          }, { icon: Icons.play, shortcut: "<Ctrl>p", section: "Monitor" })
          : action("Pause Monitor", async () => {
            await setPaused(c, m.id!, true);
            await toast(`${m.name} paused`, { style: "success" });
            return refresh();
          }, {
            icon: Icons.pause,
            shortcut: "<Ctrl>p",
            destructive: true,
            confirm: `Pause ${m.name}? It won't be checked or alert anyone until resumed.`,
            section: "Monitor",
          }),
      ]
      : []),
    ...(m.source === "kuma" && m.pages?.length
      ? m.pages.map((p) =>
        open(`${c.kuma}/status/${p}`, `Open Status Page ${p}`, { icon: Icons.globe, section: "Kuma" })
      )
      : []),
    ...(m.target ? [copy(m.target, "Copy Monitored Address", { section: "Copy" })] : []),
    copy(dashboard(c, m), "Copy Dashboard Link", { section: "Copy" }),
  ];
  const history = historyMarkdown(m);
  return {
    id: m.key,
    title: m.name,
    subtitle: m.target,
    icon: {
      source: m.status === "down" ? Icons.alert : m.status === "paused" ? Icons.pause : Icons.activity,
      tint: s.color,
    },
    section: m.status === "down" ? "Down" : SOURCE[m.source],
    keywords: [m.type ?? "", m.group ?? "", s.title, SOURCE[m.source]],
    accessories,
    detail: {
      stats: [
        { label: "status", value: s.title, color: s.color },
        ...(m.responseTime !== undefined ? [{ label: "response", value: ms(m.responseTime) }] : []),
        ...(m.uptime24 !== undefined ? [{ label: "uptime 24 h", value: percent(m.uptime24) }] : []),
        ...(m.certDays !== undefined && m.certDays >= 0
          ? [{ label: "cert days", value: Math.floor(m.certDays), color: cert }]
          : []),
      ],
      markdown: history || undefined,
      metadata: [
        meta.text("Status", s.title, { icon: Icons.dot, color: s.color }),
        ...(m.target ? [meta.text("Checks", m.target, { icon: Icons.globe })] : []),
        ...(m.type ? [meta.text("Type", m.type)] : []),
        ...(m.group ? [meta.text("Group", m.group, { icon: Icons.layers })] : []),
        ...(m.certDays !== undefined && m.certDays >= 0
          ? [meta.text(
            "Certificate",
            `${m.certValid === false ? "invalid, " : ""}expires in ${Math.floor(m.certDays)} days`,
            { icon: Icons.lock, color: cert },
          )]
          : []),
        ...(m.lastChecked ? [meta.text("Last check", ago(m.lastChecked), { icon: Icons.clock })] : []),
        ...(m.checkEvery ? [meta.text("Every", `${m.checkEvery} s`)] : []),
        ...(m.pages?.length ? [meta.tags("Status pages", m.pages)] : []),
        meta.text("From", SOURCE[m.source], { icon: Icons.server }),
      ],
    },
    actions,
  };
}

let summary = "";

export default list({
  placeholder: "Filter monitors…",
  filter: {
    options: [
      { value: "all", title: "All" },
      { value: "problems", title: "Problems" },
      { value: "kuma", title: "Uptime Kuma" },
      { value: "betterstack", title: "Better Stack" },
    ],
    default: "all",
  },
  empty: {
    title: "No monitor here",
    description: "Everything is filtered out, or nothing is monitored yet",
    icon: Icons.activity,
  },
  status: (items) => items[0]?.id === "setup" ? "Not connected" : summary,
  actions: [action("Reload", () => refresh(), { icon: Icons.refresh, shortcut: "<Ctrl>r" })],
  async items({ preferences, filter, signal }) {
    summary = "";
    try {
      const c = config(preferences);
      const [k, b] = await Promise.all([
        filter === "betterstack" ? Promise.resolve({ monitors: [], pages: [], errors: [] }) : kuma(c, signal),
        filter === "kuma" ? Promise.resolve([]) : betterstackMonitors(c, signal),
      ]);
      let all = sortMonitors([...k.monitors, ...b]);
      const down = all.filter((m) => m.status === "down").length;
      if (filter === "problems") {
        all = all.filter((m) =>
          m.status === "down" || m.status === "pending" || (certColor(m.certDays, m.certValid) === "red")
        );
      }
      summary = [
        `${all.length} monitor${all.length === 1 ? "" : "s"}`,
        down ? `${down} down` : "all up",
        ...k.errors,
      ].join(" · ");
      if (filter === "all" || !filter) {
        updateCommandMetadata({ subtitle: down ? `${down} down` : null }).catch(() => {});
      }
      if (k.errors.length) await toast(k.errors[0], { style: "failure" }).catch(() => {});
      return all.map((m) => item(c, m));
    } catch (e) {
      if (e instanceof SetupError) return [setupItem(e)];
      throw e;
    }
  },
});
