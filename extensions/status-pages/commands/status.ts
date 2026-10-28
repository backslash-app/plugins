import {
  action,
  copy,
  Icons,
  type Item,
  list,
  meta,
  open,
  refresh,
  storage,
  updateCommandMetadata,
} from "@backslash/api";
import {
  affected,
  ago,
  componentLook,
  components,
  groups,
  impactColor,
  incidentMarkdown,
  LOADING,
  type Look,
  overall,
  parseCustom,
  type Service,
  serviceMarkdown,
  serviceMetadata,
  SERVICES,
  serviceStats,
  subtitle,
  type Summary,
  UNREACHABLE,
} from "../lib.ts";

type Result = { summary: Summary; at: number } | { error: string; at: number };

/** Views of this command share one process: reloading after a watchlist change reuses fresh results. */
const cache = new Map<string, Result>();
const FRESH_MS = 60_000;

async function fetchSummary(service: Service, signal: AbortSignal): Promise<Result> {
  const timeout = AbortSignal.timeout(10_000);
  try {
    const res = await fetch(`https://${service.host}/api/v2/summary.json`, {
      signal: AbortSignal.any([signal, timeout]),
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return { error: `The page answered ${res.status}`, at: Date.now() };
    const summary = await res.json() as Summary;
    if (!summary?.status || !Array.isArray(summary.components)) {
      return { error: "Not a Statuspage feed", at: Date.now() };
    }
    summary.incidents ??= [];
    return { summary, at: Date.now() };
  } catch (e) {
    if (signal.aborted) throw e;
    const message = timeout.aborted ? "No answer within 10 s" : e instanceof Error ? e.message : String(e);
    return { error: message.split("\n")[0], at: Date.now() };
  }
}

const watchlist = async () => ((await storage.get<string[]>("watchlist")) ?? []);

async function toggleWatch(id: string) {
  const list = await watchlist();
  await storage.set("watchlist", list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
}

function componentsView(service: Service, s: Summary) {
  const group = groups(s);
  const incidentItems: Item[] = [...s.incidents, ...(s.scheduled_maintenances ?? [])].map((i) => ({
    id: i.id,
    title: i.name,
    subtitle: i.incident_updates[0] ? ago(i.incident_updates[0].display_at ?? i.incident_updates[0].created_at) : "",
    icon: { source: i.scheduled_for ? Icons.calendar : Icons.alert, tint: impactColor(i.impact) },
    section: i.scheduled_for ? "Maintenance" : "Incidents",
    tags: [i.status.replace(/_/g, " ")],
    detail: { markdown: incidentMarkdown(i) },
    actions: i.shortlink
      ? [open(i.shortlink, "Open Incident"), copy(i.shortlink, "Copy Link", { section: "Copy" })]
      : [open(s.page.url, "Open Status Page")],
  }));
  const componentItems: Item[] = components(s).map((c) => {
    const look = componentLook(c.status);
    return {
      id: c.id,
      title: c.name,
      subtitle: c.description ?? undefined,
      icon: { source: look.icon, tint: look.color },
      section: group.get(c.id) ?? "Components",
      accessories: [{ tag: look.label, color: look.color }],
      detail: {
        markdown: c.description ?? undefined,
        metadata: [
          meta.text("Status", look.label, { icon: { source: look.icon, tint: look.color }, color: look.color }),
          ...(group.has(c.id) ? [meta.text("Group", group.get(c.id)!, { icon: Icons.layers })] : []),
          ...(c.updated_at ? [meta.text("Changed", ago(c.updated_at), { icon: Icons.clock })] : []),
        ],
      },
      actions: [open(s.page.url, "Open Status Page")],
    };
  });
  return list({
    title: `${service.name} Components`,
    placeholder: `Filter ${service.name} components…`,
    status: `${affected(s).length} of ${components(s).length} affected · ${s.status.description}`,
    items: [...incidentItems, ...componentItems],
  });
}

function serviceItem(service: Service, result: Result | undefined, watched: boolean): Item {
  const look: Look = !result ? LOADING : "error" in result ? UNREACHABLE : overall(result.summary);
  const s = result && "summary" in result ? result.summary : undefined;
  const pageUrl = s?.page.url ?? `https://${service.host}`;
  const firstIncident = s?.incidents[0];
  const bad = s ? affected(s) : [];
  const watch = action(watched ? "Remove from Watchlist" : "Add to Watchlist", async () => {
    await toggleWatch(service.id);
    return refresh();
  }, { icon: watched ? Icons.starFilled : Icons.star, shortcut: "<Ctrl>s", section: "Watchlist" });
  return {
    id: service.id,
    title: service.name,
    subtitle: s
      ? firstIncident?.name ?? (bad.length ? bad.slice(0, 2).map((c) => c.name).join(", ") : s.status.description)
      : result && "error" in result
      ? result.error
      : "Checking…",
    icon: { source: look.icon, tint: look.color },
    section: look.rank >= 1
      ? "Needs Attention"
      : look.rank === 0
      ? "Operational"
      : look === LOADING
      ? "Checking"
      : "Unreachable",
    keywords: [service.host, ...(service.keywords ?? []), look.label],
    accessories: [
      ...(watched
        ? [{ icon: { source: Icons.starFilled, tint: "yellow" as const }, tooltip: "In your watchlist" }]
        : []),
      ...(s && s.incidents.length
        ? [{ text: `${s.incidents.length} incident${s.incidents.length === 1 ? "" : "s"}`, icon: Icons.alert }]
        : []),
      { tag: look.label, color: look.color },
    ],
    detail: s
      ? { stats: serviceStats(s), markdown: serviceMarkdown(service, s), metadata: serviceMetadata(service, s) }
      : {
        markdown: result && "error" in result
          ? `**${service.name}'s status page could not be read.**\n\n${result.error}\n\nIt may be blocked by your network, or the service is having a bad day.`
          : "Reading the status page…",
        metadata: [meta.text("Feed", service.host, { icon: Icons.globe })],
      },
    actions: [
      firstIncident?.shortlink ? open(firstIncident.shortlink, "Open Incident") : open(pageUrl, "Open Status Page"),
      ...(s ? [action("Show Components", () => componentsView(service, s), { icon: Icons.layers })] : []),
      ...(firstIncident?.shortlink ? [open(pageUrl, "Open Status Page")] : []),
      watch,
      action("Check Again", () => {
        cache.clear();
        return refresh();
      }, { icon: Icons.refresh, shortcut: "<Ctrl>r" }),
      copy(pageUrl, "Copy Status Page URL", { section: "Copy" }),
      ...(firstIncident?.shortlink ? [copy(firstIncident.shortlink, "Copy Incident Link", { section: "Copy" })] : []),
    ],
  };
}

const sortItems = (items: { item: Item; rank: number; watched: boolean; order: number }[]) =>
  items.sort((a, b) => b.rank - a.rank || Number(b.watched) - Number(a.watched) || a.order - b.order).map((x) =>
    x.item
  );

let shown = { total: 0, bad: 0, unreachable: 0 };

export default () =>
  list({
    placeholder: "Filter services, components, incidents…",
    filter: {
      options: [
        { value: "all", title: "All Services" },
        { value: "watchlist", title: "Watchlist" },
        { value: "issues", title: "Issues" },
      ],
    },
    empty: {
      title: "Nothing to show here",
      description:
        "Issues lists services with an incident or a degraded component; Ctrl+S adds a service to the Watchlist",
      icon: Icons.star,
    },
    status: () =>
      shown.total === 0
        ? "Atlassian Statuspage feeds"
        : `${shown.bad ? `${shown.bad} with issues` : "All operational"} · ${shown.total} service${
          shown.total === 1 ? "" : "s"
        }${shown.unreachable ? ` · ${shown.unreachable} unreachable` : ""}`,
    async *items({ preferences, filter, signal }) {
      const custom = parseCustom(preferences.custom);
      const all = [...SERVICES, ...custom.services];
      const watched = await watchlist();
      let services = filter === "watchlist" ? all.filter((s) => watched.includes(s.id)) : all;
      const extra: Item[] = custom.errors.map((e) => ({
        id: `bad-${e}`,
        title: `“${e}” is not a Statuspage page id`,
        subtitle: "Fix it in the preferences: Name=page id",
        icon: { source: Icons.alert, tint: "orange" },
        section: "Custom Pages",
        detail: {
          markdown: [
            "## Custom status pages",
            "",
            "Every Atlassian Statuspage page is also served at `<page id>.statuspage.io`. Find the id in",
            "the page's feed, `https://status.example.com/api/v2/summary.json`, under `page.id`, then add",
            "`Example=<page id>` to **Settings → Extensions → Status Pages → Custom status pages**.",
            "",
            "Pages on other providers (incident.io, Instatus, status.io…) can't be read.",
          ].join("\n"),
        },
      }));
      if (filter === "watchlist" && !services.length) {
        yield [];
        return;
      }
      if (filter === "issues") services = all;

      const results = new Map<string, Result>();
      for (const s of services) {
        const hit = cache.get(s.id);
        if (hit && Date.now() - hit.at < FRESH_MS) results.set(s.id, hit);
      }
      const render = () => {
        const rows = services.map((service, order) => {
          const r = results.get(service.id);
          const look = !r ? LOADING : "error" in r ? UNREACHABLE : overall(r.summary);
          return {
            item: serviceItem(service, r, watched.includes(service.id)),
            rank: look.rank,
            watched: watched.includes(service.id),
            order,
            look,
            service,
          };
        });
        const kept = filter === "issues" ? rows.filter((r) => r.rank >= 1 || r.rank === -2) : rows;
        shown = {
          total: services.length,
          bad: rows.filter((r) => r.rank >= 1).length,
          unreachable: rows.filter((r) => r.rank === -1).length,
        };
        return { items: [...sortItems(kept), ...extra], rows };
      };

      const pending = new Map(
        services.filter((s) => !results.has(s.id)).map((service) => [
          service.id,
          fetchSummary(service, signal).then((r) => {
            cache.set(service.id, r);
            results.set(service.id, r);
            pending.delete(service.id);
          }),
        ]),
      );
      // Most pages answer within a second: show them all at once, then the slow ones as they land.
      await Promise.race([Promise.all(pending.values()), new Promise((r) => setTimeout(r, 1500))]);
      yield render().items;
      while (pending.size) {
        await Promise.race(pending.values());
        yield render().items;
      }

      // The root subtitle follows the watchlist, or every service when it is empty.
      const { rows } = render();
      const tracked = watched.length ? rows.filter((r) => r.watched) : rows;
      const summary = subtitle(tracked.filter((r) => r.rank >= 0).map((r) => ({ service: r.service, look: r.look })));
      if (filter !== "watchlist" || watched.length) updateCommandMetadata({ subtitle: summary }).catch(() => {});
    },
  });
