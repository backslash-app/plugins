import { copy, Icons, type Item, list, meta, open } from "@backslash/api";
import { type Account, account, grafana, guarded } from "../api.ts";
import { absolute, type Dashboard, parseDashboards, sortDashboards } from "../lib.ts";

function dashboardItem(a: Account, d: Dashboard): Item {
  const url = absolute(a.base, d.url);
  const folder = d.folderTitle ?? "General";
  return {
    id: d.uid,
    title: d.title,
    subtitle: d.isStarred ? folder : undefined,
    icon: { source: d.isStarred ? Icons.starFilled : Icons.chartUp, tint: d.isStarred ? "yellow" : "orange" },
    section: d.isStarred ? "Starred" : folder,
    keywords: [folder, ...d.tags, d.uid],
    accessories: d.tags.slice(0, 3).map((t) => ({ tag: t })),
    detail: {
      metadata: [
        meta.text("Folder", folder, { icon: Icons.folder }),
        ...(d.tags.length ? [meta.tags("Tags", d.tags.map((t) => ({ text: t, color: "blue" as const })))] : []),
        meta.text("UID", d.uid, { icon: Icons.hash }),
        ...(d.isStarred ? [meta.text("Starred", "Yes", { icon: Icons.starFilled, color: "yellow" })] : []),
        meta.separator(),
        meta.link("Open", url.replace(/^https?:\/\//, ""), url),
      ],
    },
    actions: [
      open(url, "Open Dashboard"),
      open(`${url}${url.includes("?") ? "&" : "?"}kiosk`, "Open in Kiosk Mode", { icon: Icons.monitor }),
      ...(d.folderUid
        ? [open(`${a.base}/dashboards/f/${d.folderUid}`, "Open Folder", { icon: Icons.folder, shortcut: "<Ctrl>f" })]
        : []),
      copy(url, "Copy URL", { shortcut: "<Ctrl><Shift>c", section: "Copy" }),
      copy(d.uid, "Copy UID", { shortcut: "<Ctrl>period", section: "Copy" }),
      copy(`[${d.title}](${url})`, "Copy as Markdown Link", { icon: Icons.link, section: "Copy" }),
    ],
  };
}

export default list({
  placeholder: "Search Grafana dashboards by title, folder or tag…",
  empty: { title: "No dashboard", description: "Nothing visible to this service account", icon: Icons.chartUp },
  status: (items) =>
    items[0]?.id === "setup" || items[0]?.id === "error"
      ? "Not connected"
      : `${items.length} dashboard${items.length === 1 ? "" : "s"}${
        items.some((i) => i.section === "Starred")
          ? ` · ${items.filter((i) => i.section === "Starred").length} starred`
          : ""
      }`,
  items: ({ preferences, signal }) =>
    guarded(preferences, async () => {
      const a = account(preferences);
      const data = await grafana<unknown>(a, "/api/search?type=dash-db&limit=5000", { signal });
      return sortDashboards(parseDashboards(data)).map((d) => dashboardItem(a, d));
    }),
});
