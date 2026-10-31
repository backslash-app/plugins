import { action, Icons, type Item, list, updateCommandMetadata } from "@backslash/api";
import { loadSites, options, testSite } from "../api.ts";
import { latest, looksLikeUrl, normalizeUrl, shortUrl, sortSites, type Strategy } from "../lib.ts";
import { resultView, siteItem } from "../views.ts";

let status = "";

export default list({
  placeholder: "Filter your sites, or type a URL to test…",
  filter: {
    options: [{ value: "mobile", title: "Mobile" }, { value: "desktop", title: "Desktop" }],
    default: "mobile",
  },
  empty: {
    title: "No site yet",
    description: "Type the address of a page, like example.com, and press Enter to test it",
    icon: Icons.chartUp,
  },
  status: () => status,
  async search(query, { preferences, filter, signal }) {
    const strategy: Strategy = filter === "desktop" ? "desktop" : "mobile";
    const o = options(preferences);
    const sites = sortSites(await loadSites());
    const q = query.trim().toLowerCase();
    const matching = q ? sites.filter((s) => s.url.toLowerCase().includes(q.replace(/^https?:\/\//, ""))) : sites;
    const items: Item[] = [];

    if (q && looksLikeUrl(q)) {
      const target = normalizeUrl(query);
      const known = "url" in target && sites.some((s) => s.url === target.url);
      if ("error" in target) {
        items.push({
          id: "invalid",
          title: target.error,
          icon: { source: Icons.alert, tint: "orange" },
        });
      } else if (!known) {
        items.push({
          id: "test",
          title: `Test ${shortUrl(target.url)}`,
          subtitle: "Mobile and desktop, about 30 seconds",
          icon: { source: Icons.bolt, tint: "blue" },
          detail: {
            markdown: [
              `## ${shortUrl(target.url)}`,
              "",
              "Press **Enter** to run Lighthouse on Google's servers, on a throttled phone and on a desktop.",
              "",
              "You get the **Performance**, **Accessibility**, **Best Practices** and **SEO** scores, the",
              "**Core Web Vitals** of real Chrome users when the page has enough visits, and the biggest",
              "opportunities. The site is saved here, with its history.",
            ].join("\n"),
          },
          actions: [
            action("Test Page Speed", async () => {
              const { site, errors } = await testSite(target.url, o);
              return resultView(site, strategy, o, errors);
            }, { icon: Icons.bolt }),
          ],
        });
      }
    }
    items.push(...matching.map((s) => siteItem(s, strategy, o)));

    const tested = sites.filter((s) => latest(s, strategy));
    status = sites.length ? `${sites.length} site${sites.length === 1 ? "" : "s"} · ${strategy}` : "";
    if (!q && !signal.aborted) {
      const poor = tested.filter((s) => (latest(s, strategy)?.scores.performance ?? 100) < 50).length;
      updateCommandMetadata({ subtitle: poor ? `${poor} slow on ${strategy}` : null }).catch(() => {});
    }
    return items;
  },
});
