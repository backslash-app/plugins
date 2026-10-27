import { copy, Icons, list, meta, open } from "@backslash/api";
import { profiles } from "../browsers.ts";
import { ago, domain, firefoxTabs, mozLz4, type Tab } from "../lib.ts";

function readTabs(): Tab[] {
  const tabs: Tab[] = [];
  for (const p of profiles().filter((p) => p.kind === "firefox")) {
    for (const file of ["sessionstore-backups/recovery.jsonlz4", "sessionstore.jsonlz4"]) {
      try {
        tabs.push(...firefoxTabs(JSON.parse(mozLz4(Deno.readFileSync(`${p.dir}/${file}`)))));
        break;
      } catch { /* try the next one */ }
    }
  }
  return tabs;
}

export default list({
  placeholder: "Search open tabs…",
  empty: { title: "No open tabs", description: "Firefox's session file was not found", icon: "bs-window" },
  status: (items) => `${items.length} open tab${items.length === 1 ? "" : "s"}`,
  items: () =>
    readTabs().map((t) => ({
      id: t.url,
      title: t.title,
      subtitle: domain(t.url),
      icon: t.pinned ? { source: Icons.pin, tint: "orange" as const } : { source: Icons.globe, tint: "gray" as const },
      section: t.pinned ? "Pinned" : "Tabs",
      keywords: [t.url],
      accessories: t.lastAccessed ? [{ text: ago(t.lastAccessed) }] : [],
      detail: {
        metadata: [
          meta.link("Address", t.url.length > 80 ? `${t.url.slice(0, 80)}…` : t.url, t.url),
          meta.text("Site", domain(t.url), { icon: Icons.globe }),
          ...(t.lastAccessed ? [meta.text("Last seen", ago(t.lastAccessed), { icon: Icons.clock })] : []),
          ...(t.pinned ? [meta.text("Pinned", "Yes", { icon: Icons.pin })] : []),
        ],
      },
      actions: [
        open(t.url, "Open in Browser"),
        copy(t.url, "Copy URL", { shortcut: "<Ctrl><Shift>c" }),
        copy(`[${t.title}](${t.url})`, "Copy as Markdown Link"),
      ],
    })),
});
