import { copy, list, open } from "@backslash/api";
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
  empty: { title: "No open tabs", description: "Firefox's session file was not found" },
  items: () =>
    readTabs().map((t) => ({
      id: t.url,
      title: t.title,
      subtitle: domain(t.url),
      icon: t.pinned ? "📌" : "web-browser",
      keywords: [t.url],
      accessories: t.lastAccessed ? [{ text: ago(t.lastAccessed) }] : [],
      actions: [open(t.url, "Open in Browser"), copy(t.url, "Copy URL")],
    })),
});
