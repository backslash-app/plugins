import { action, copy, Icons, type Item, list, meta, open, refresh, storage } from "@backslash/api";
import { type Account, account, appUrl, dd, SetupError, setupItems } from "../api.ts";
import { age, type Dashboard, formatDate, parseDashboards } from "../lib.ts";

function item(a: Account, d: Dashboard): Item {
  const url = appUrl(a, d.url);
  return {
    id: d.id,
    title: d.title,
    subtitle: d.description?.split("\n")[0],
    icon: { source: d.layout === "free" ? Icons.layers : Icons.chartUp, tint: "purple" },
    keywords: [d.author ?? "", d.id, d.description ?? ""],
    accessories: [
      ...(d.readOnly ? [{ icon: Icons.lock, tooltip: "Read-only" }] : []),
      ...(d.author ? [{ avatar: d.author, tooltip: d.author }] : []),
      ...(d.modified ? [{ text: age(d.modified), tooltip: `Modified ${formatDate(d.modified)}` }] : []),
    ],
    detail: {
      markdown: d.description,
      metadata: [
        ...(d.author ? [meta.person("Author", d.author)] : []),
        meta.text("Layout", d.layout === "free" ? "Screenboard (free)" : "Timeboard (ordered)", { icon: Icons.layers }),
        ...(d.modified ? [meta.text("Modified", formatDate(d.modified), { icon: Icons.clock })] : []),
        ...(d.created ? [meta.text("Created", formatDate(d.created), { icon: Icons.calendar })] : []),
        meta.text("ID", d.id, { icon: Icons.hash }),
      ],
    },
    actions: [
      open(url, "Open Dashboard", { icon: Icons.external }),
      copy(url, "Copy Link", { shortcut: "<Ctrl><Shift>c" }),
      copy(d.id, "Copy Dashboard ID", { shortcut: "<Ctrl>period" }),
      open(appUrl(a, "/dashboard/lists"), "Open Dashboard List", { icon: Icons.apps, section: "Open" }),
      action("Reload", () => refresh(), { icon: Icons.refresh, shortcut: "<Ctrl>r" }),
    ],
  };
}

export default list({
  placeholder: "Search dashboards by title, author, description…",
  empty: {
    title: "No dashboards",
    description: "This organization has none, or the application key can't read them (dashboards_read)",
    icon: Icons.chartUp,
  },
  status: (items) => items[0]?.id === "setup" ? "Not connected" : `${items.length} dashboards`,
  async *items({ preferences, signal }) {
    let a: Account;
    try {
      a = account(preferences);
    } catch (e) {
      if (e instanceof SetupError) {
        yield setupItems(e);
        return;
      }
      throw e;
    }
    // Dashboards change rarely: the cached list shows at once, then the fresh one.
    const key = `dashboards:${a.site.id}`;
    const cached = await storage.get(key).catch(() => undefined) as Dashboard[] | undefined;
    if (cached?.length) yield cached.map((d) => item(a, d));
    try {
      const fresh = parseDashboards(await dd(a, "/api/v1/dashboard?filter[deleted]=false", { signal }));
      await storage.set(key, fresh as never).catch(() => {});
      yield fresh.map((d) => item(a, d));
    } catch (e) {
      if (e instanceof SetupError) {
        yield setupItems(e);
        return;
      }
      if (signal.aborted || !cached?.length) throw e;
    }
  },
});
