import {
  type Action,
  action,
  type Color,
  type Context,
  copy,
  Icons,
  type Item,
  list,
  meta,
  open,
  refresh,
  updateCommandMetadata,
} from "@backslash/api";
import { type Report, report, Setup } from "../api.ts";
import { activityUrl, before, duration, periods, type Row, share, summaryText, trend, type Usage } from "../lib.ts";

const FILTER = { options: [{ value: "today", title: "Today" }, { value: "week", title: "This Week" }] };

const COLORS: Color[] = ["blue", "purple", "teal", "orange", "pink", "green", "yellow", "red"];

interface View {
  label: string;
  /** Compared with this, at the same point of the earlier day or week. */
  versus: string;
  now: Usage;
  then: Usage;
  link: string;
}

function viewOf(r: Report, filter: string): View {
  const spans = periods(r.now, r.dayOffset);
  if (filter === "week") {
    return {
      label: "This week",
      versus: "last week",
      now: r.usage.week,
      then: r.usage.lastWeekSoFar,
      link: activityUrl(r.base, r.sources.hostname, "week", spans.week[0]),
    };
  }
  return {
    label: "Today",
    versus: "yesterday",
    now: r.usage.today,
    then: r.usage.yesterdaySoFar,
    link: activityUrl(r.base, r.sources.hostname, "day", spans.today[0]),
  };
}

function common(v: View, r: Report): Action[] {
  return [
    open(v.link, "Open in ActivityWatch", { icon: Icons.external, shortcut: "<Ctrl>o", section: "ActivityWatch" }),
    open(`${r.base}/#/timeline`, "Open Timeline", { icon: Icons.history, section: "ActivityWatch" }),
    copy(summaryText(v.label, v.now), "Copy Summary", { shortcut: "<Ctrl><Shift>c", section: "ActivityWatch" }),
    action("Refresh", () => refresh(), { icon: Icons.refresh, shortcut: "<Ctrl>r", section: "ActivityWatch" }),
  ];
}

function summaryItem(v: View, r: Report): Item {
  const t = trend(v.now.total, v.then.total, `${v.versus} at this time`);
  const top = v.now.apps[0];
  const site = v.now.sites[0];
  return {
    id: "summary",
    title: `${duration(v.now.total)} active`,
    subtitle: v.label,
    icon: { source: Icons.activity, tint: "blue" },
    section: "Summary",
    accessories: [{ tag: t.text, color: t.color }],
    detail: {
      stats: [
        { label: v.label.toLowerCase(), value: duration(v.now.total), color: "blue" },
        { label: `${v.versus} so far`, value: duration(v.then.total) },
        ...(v.now.web ? [{ label: "in the browser", value: duration(v.now.web) }] : []),
      ],
      metadata: [
        meta.text("Trend", t.text, { color: t.color, icon: t.delta >= 0 ? Icons.chartUp : Icons.chartDown }),
        ...(v.label === "Today"
          ? [meta.text("All of yesterday", duration(r.usage.yesterday.total), { icon: Icons.calendar })]
          : []),
        ...(top ? [meta.text("Top app", `${top.key} · ${duration(top.seconds)}`, { icon: Icons.apps })] : []),
        ...(site ? [meta.text("Top website", `${site.key} · ${duration(site.seconds)}`, { icon: Icons.globe })] : []),
        meta.separator(),
        meta.text("Computer", r.sources.hostname, { icon: Icons.monitor }),
        meta.text("Away time", r.sources.afk ? "Left out (aw-watcher-afk)" : "Counted: no AFK watcher found", {
          icon: Icons.coffee,
          color: r.sources.afk ? undefined : "orange",
        }),
        meta.text("Browsers", r.sources.web.length ? `${r.sources.web.length} watched` : "No browser extension", {
          icon: Icons.globe,
        }),
        ...(r.dayOffset
          ? [meta.text("Day starts", `${Math.floor(r.dayOffset / 60)}:${String(r.dayOffset % 60).padStart(2, "0")}`)]
          : []),
      ],
    },
    actions: common(v, r),
  };
}

function rowItems(
  rows: Row[],
  previous: Row[],
  total: number,
  v: View,
  r: Report,
  kind: { section: string; icon: string; id: string; open?: (key: string) => Action },
): Item[] {
  return rows.map((row, i) => {
    const t = trend(row.seconds, before(previous, row.key), v.versus);
    const pct = share(row.seconds, total);
    return {
      id: `${kind.id}:${row.key}`,
      title: row.key,
      subtitle: duration(row.seconds),
      icon: { source: kind.icon, tint: COLORS[i % COLORS.length] },
      section: kind.section,
      accessories: [
        ...(t.color !== "gray"
          ? [{ text: t.text.replace(` vs ${v.versus}`, ""), color: t.color, tooltip: t.text }]
          : []),
        { tag: pct, color: "gray" as const },
      ],
      detail: {
        stats: [
          { label: v.label.toLowerCase(), value: duration(row.seconds) },
          { label: `of ${kind.section === "Websites" ? "browser" : "active"} time`, value: pct },
        ],
        metadata: [
          meta.progress("Share", total ? row.seconds / total : 0, pct),
          meta.text(`${v.versus[0].toUpperCase()}${v.versus.slice(1)} so far`, duration(before(previous, row.key))),
          meta.text("Trend", t.text, { color: t.color }),
          meta.text("Rank", `#${i + 1}`),
        ],
      },
      actions: [...(kind.open ? [kind.open(row.key)] : []), copy(row.key, "Copy Name"), ...common(v, r)],
    };
  });
}

function setupItem(message: string): Item {
  return {
    id: "setup",
    title: message,
    icon: { source: Icons.alert, tint: "orange" },
    detail: {
      markdown: [
        "## Set up ActivityWatch",
        "",
        "1. Install ActivityWatch from [activitywatch.net](https://activitywatch.net/downloads/) or your",
        "   distribution (`activitywatch-bin` on the AUR, Flathub's `net.activitywatch.ActivityWatch`).",
        "2. Start **aw-qt**: it runs the server on port 5600 with the window and AFK watchers.",
        "   On Wayland, use [awatcher](https://github.com/2e3s/awatcher) for windows.",
        "3. For websites, add the **ActivityWatch Web Watcher** extension to your browser.",
        "",
        "Categories come from the web UI's **Settings → Categorization**.",
      ].join("\n"),
    },
    actions: [
      open("https://activitywatch.net/downloads/", "Download ActivityWatch", { icon: Icons.download }),
      action("Try Again", () => refresh(), { icon: Icons.refresh, shortcut: "<Ctrl>r" }),
    ],
  };
}

let status = "";

export default (ctx: Context) =>
  list({
    placeholder: "Filter apps, websites, categories…",
    filter: FILTER,
    empty: { title: "No activity recorded in this period", icon: Icons.activity },
    status: () => status,
    async items({ signal, filter }) {
      let r: Report;
      try {
        r = await report(ctx.preferences, signal);
      } catch (e) {
        if (e instanceof Setup) {
          status = "Not connected";
          return [setupItem(e.message)];
        }
        throw e;
      }
      const v = viewOf(r, filter ?? "today");
      status = `${v.label}: ${duration(v.now.total)} active · ${r.sources.hostname}`;
      updateCommandMetadata({ subtitle: `Today ${duration(r.usage.today.total)}` }).catch(() => {});
      if (!v.now.total && !v.now.web) return [summaryItem(v, r)];
      return [
        summaryItem(v, r),
        ...rowItems(v.now.categories.slice(0, 15), v.then.categories, v.now.total, v, r, {
          section: "Categories",
          icon: Icons.tag,
          id: "cat",
        }),
        ...rowItems(v.now.apps.slice(0, 25), v.then.apps, v.now.total, v, r, {
          section: "Applications",
          icon: Icons.apps,
          id: "app",
        }),
        ...rowItems(v.now.sites.slice(0, 25), v.then.sites, v.now.web || v.now.total, v, r, {
          section: "Websites",
          icon: Icons.globe,
          id: "site",
          open: (domain) => open(`https://${domain}`, "Open Website", { icon: Icons.globe }),
        }),
      ];
    },
  });
