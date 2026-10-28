import {
  action,
  type Context,
  copy,
  Icons,
  type Item,
  list,
  open,
  refresh,
  updateCommandMetadata,
} from "@backslash/api";
import {
  change,
  compact,
  type Period,
  periodOf,
  PERIODS,
  type ProviderId,
  PROVIDERS,
  type Row,
  type Site,
  siteMarkdown,
  siteMetadata,
  type Stats,
  statsCards,
  subtitle,
  thousands,
} from "../lib.ts";
import { type Provider, PROVIDER_LIST, SetupError } from "../providers.ts";

type Prefs = Record<string, unknown>;

const SETUP: Record<ProviderId, { link: string; linkTitle: string; markdown: string[] }> = {
  plausible: {
    link: "https://plausible.io/settings/api-keys",
    linkTitle: "Create Plausible API Key",
    markdown: [
      "## Connect Plausible",
      "",
      "1. In Plausible, **Account settings → API Keys → New API Key**, type **Stats API** (Enter opens it).",
      "2. In **Settings → Extensions → Web Analytics → Configure**:",
      "   - **Plausible API key**: the key",
      "   - **Plausible sites**: your site domains as in Plausible, comma-separated (`example.com, blog.example.com`)",
      "   - **Plausible host**: only for self-hosted Plausible CE (`https://plausible.example.com`)",
    ],
  },
  umami: {
    link: "https://cloud.umami.is/settings/api-keys",
    linkTitle: "Create Umami Cloud API Key",
    markdown: [
      "## Connect Umami",
      "",
      "**Umami Cloud**: create a key in **Settings → API keys** (Enter opens it) and paste it in",
      "**Settings → Extensions → Web Analytics → Configure → Umami Cloud API key**.",
      "",
      "**Self-hosted Umami**: set **Umami URL** (`https://umami.example.com`), **Umami username** and",
      "**Umami password**. A view-only user is enough.",
      "",
      "**Umami websites** optionally limits the list to some website IDs or domains.",
    ],
  },
  posthog: {
    link: "https://us.posthog.com/settings/user-api-keys",
    linkTitle: "Create PostHog Personal API Key",
    markdown: [
      "## Connect PostHog",
      "",
      "1. In PostHog, **Settings → Personal API keys → Create** (Enter opens the US cloud;",
      "   use eu.posthog.com for the EU cloud) with the scopes **Project: Read** and **Query: Read**.",
      "2. In **Settings → Extensions → Web Analytics → Configure**:",
      "   - **PostHog personal API key**: `phx_…`",
      "   - **PostHog projects**: project IDs (in **Project settings**), comma-separated; empty for all",
      "   - **PostHog host**: `us`, `eu`, or your instance's URL",
    ],
  },
};

const CONNECT_HINT: Record<ProviderId, string> = {
  plausible: "API key and site domains",
  umami: "Umami Cloud API key, or your instance's URL and login",
  posthog: "Personal API key and project",
};

function connectItem(provider: ProviderId, problem?: string): Item {
  const s = SETUP[provider];
  return {
    id: `connect-${provider}`,
    title: problem ?? `Connect ${PROVIDERS[provider].title}`,
    subtitle: problem ? "Fix it in the extension's preferences" : CONNECT_HINT[provider],
    icon: { source: problem ? Icons.alert : Icons.plug, tint: problem ? "orange" : "gray" },
    section: problem ? PROVIDERS[provider].title : "Add a Provider",
    detail: { markdown: [...(problem ? [`**${problem}.**`, ""] : []), ...s.markdown].join("\n") },
    actions: [open(s.link, s.linkTitle, { icon: Icons.key })],
  };
}

/** Bigger lists of pages or sources, pushed from a site. */
function rowsView(site: Site, provider: Provider, prefs: Prefs, period: Period, kind: "pages" | "sources") {
  const label = PERIODS.find((p) => p.value === period)!.title;
  const domain = /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(site.name) ? site.name : undefined;
  return list({
    title: `${site.name}: top ${kind}`,
    placeholder: `Filter ${kind}…`,
    status: `${label} · ${PROVIDERS[site.provider].title}`,
    empty: { title: "Nothing yet", icon: Icons.chartUp },
    items: async ({ signal }) => {
      const stats = await provider.stats(prefs, site, period, signal, 50);
      const rows: Row[] = stats[kind];
      const total = rows.reduce((s, r) => s + r.value, 0) || 1;
      return rows.map((r, i) => ({
        id: `${kind}-${i}-${r.label}`,
        title: r.label,
        icon: { source: kind === "pages" ? Icons.file : Icons.link, tint: PROVIDERS[site.provider].color },
        accessories: [{ text: `${Math.round((r.value / total) * 100)}%` }, {
          text: thousands(r.value),
          tooltip: "Visitors",
        }],
        actions: [
          ...(kind === "pages" && domain && r.label.startsWith("/")
            ? [open(`https://${domain}${r.label}`, "Open Page")]
            : []),
          ...(kind === "sources" && /\./.test(r.label)
            ? [open(`https://${r.label.replace(/^https?:\/\//, "")}`, "Open Source")]
            : []),
          copy(r.label, kind === "pages" ? "Copy Path" : "Copy Source"),
        ],
      }));
    },
  });
}

function siteItem(site: Site, provider: Provider, prefs: Prefs, period: Period, result?: Stats | Error): Item {
  const color = PROVIDERS[site.provider].color;
  const stats = result instanceof Error ? undefined : result;
  const delta = stats ? change(stats.visitors, stats.previous?.visitors) : undefined;
  return {
    id: `${site.provider}:${site.id}`,
    title: site.name,
    subtitle: result instanceof Error ? result.message : stats ? `${thousands(stats.pageviews)} pageviews` : "Loading…",
    icon: {
      source: result instanceof Error ? Icons.alert : Icons.chartUp,
      tint: result instanceof Error ? "red" : color,
    },
    section: PROVIDERS[site.provider].title,
    keywords: [site.id, PROVIDERS[site.provider].title],
    accessories: stats
      ? [
        ...(stats.realtime
          ? [{
            text: `${stats.realtime} now`,
            icon: { source: Icons.dot, tint: "green" as const },
            tooltip: "Visitors right now",
          }]
          : []),
        ...(delta ? [{ tag: delta.text, color: delta.color }] : []),
        { text: `${compact(stats.visitors)} visitor${stats.visitors === 1 ? "" : "s"}` },
      ]
      : [],
    detail: stats
      ? { stats: statsCards(stats, period), markdown: siteMarkdown(stats), metadata: siteMetadata(site, stats, period) }
      : { markdown: result instanceof Error ? `**${result.message}**` : "Loading…" },
    actions: [
      open(site.url, "Open Dashboard"),
      action("Show Top Pages", () => rowsView(site, provider, prefs, period, "pages"), {
        icon: Icons.file,
        shortcut: "<Ctrl>p",
      }),
      action("Show Top Sources", () => rowsView(site, provider, prefs, period, "sources"), {
        icon: Icons.link,
        shortcut: "<Ctrl>u",
      }),
      action("Refresh", () => refresh(), { icon: Icons.refresh, shortcut: "<Ctrl>r" }),
      copy(site.id, "Copy Site ID", { section: "Copy" }),
      ...(stats
        ? [
          copy(
            `${site.name}: ${thousands(stats.visitors)} visitors, ${thousands(stats.pageviews)} pageviews`,
            "Copy Summary",
            { section: "Copy" },
          ),
        ]
        : []),
    ],
  };
}

let status = "";

export default (_ctx: Context) =>
  list({
    placeholder: "Filter sites…",
    filter: { options: PERIODS, default: "today" },
    empty: { title: "No site", description: "Your configured providers have no site yet", icon: Icons.chartUp },
    status: () => status,
    async *items({ preferences, filter, signal }) {
      const period = periodOf(filter);
      const active = PROVIDER_LIST.filter((p) => p.configured(preferences));
      const connect = PROVIDER_LIST.filter((p) => !p.configured(preferences)).map((p) => connectItem(p.id));
      if (!active.length) {
        status = "No provider connected";
        yield connect;
        return;
      }
      const problems = new Map<ProviderId, Item>();
      const sites: { site: Site; provider: Provider }[] = [];
      await Promise.all(active.map(async (provider) => {
        try {
          sites.push(...(await provider.sites(preferences, signal)).map((site) => ({ site, provider })));
        } catch (e) {
          if (signal.aborted) throw e;
          problems.set(provider.id, connectItem(provider.id, e instanceof Error ? e.message : String(e)));
        }
      }));
      const order = (s: Site) => PROVIDER_LIST.findIndex((p) => p.id === s.provider);
      sites.sort((a, b) => order(a.site) - order(b.site));
      const results = new Map<string, Stats | Error>();
      const render = () => {
        const done = [...results.values()].filter((r): r is Stats => !(r instanceof Error));
        const total = done.reduce((s, r) => s + r.visitors, 0);
        const now = done.reduce((s, r) => s + (r.realtime ?? 0), 0);
        const n = sites.filter(({ site }) =>
          !(results.get(`${site.provider}:${site.id}`) instanceof SetupError)
        ).length;
        status = `${n} site${n === 1 ? "" : "s"} · ${thousands(total)} visitors${now ? ` · ${now} right now` : ""}`;
        return [
          // A provider whose credentials were rejected shows one row saying so, not one per site.
          ...sites
            .filter(({ site }) => !(results.get(`${site.provider}:${site.id}`) instanceof SetupError))
            .map(({ site, provider }) =>
              siteItem(site, provider, preferences, period, results.get(`${site.provider}:${site.id}`))
            ),
          ...problems.values(),
          ...connect,
        ];
      };
      const pending = new Map<string, Promise<void>>(sites.map(({ site, provider }): [string, Promise<void>] => {
        const key = `${site.provider}:${site.id}`;
        return [
          key,
          provider.stats(preferences, site, period, signal).then(
            (s) => void results.set(key, s),
            (e) => {
              if (e instanceof SetupError) problems.set(e.provider, connectItem(e.provider, e.message));
              results.set(key, e instanceof Error ? e : new Error(String(e)));
            },
          ).finally(() => pending.delete(key)),
        ];
      }));
      await Promise.race([Promise.all(pending.values()), new Promise((r) => setTimeout(r, 1200))]);
      yield render();
      while (pending.size) {
        await Promise.race(pending.values());
        if (signal.aborted) return;
        yield render();
      }
      const done = [...results.values()].filter((r): r is Stats => !(r instanceof Error));
      if (done.length) {
        updateCommandMetadata({ subtitle: subtitle(done.reduce((s, r) => s + r.visitors, 0), period) }).catch(() => {});
      }
    },
  });
