import { action, Icons, type Item, list, meta, open, refresh, toast } from "@backslash/api";
import { allDocs, chosen, enabledDocs, setChosen } from "../devdocs.ts";
import { devdocsUrl, type Doc, docTitle, size } from "../lib.ts";

interface Prefs {
  docs?: string;
}

let counts = { enabled: 0, all: 0 };

function item(doc: Doc, enabled: boolean, fromPrefs: boolean, current: string[]): Item {
  const toggle = action(enabled ? "Disable" : "Enable", async () => {
    if (enabled && fromPrefs) {
      await toast(`${doc.name} is set in the preferences`, {
        style: "failure",
        message: "Remove it from Settings → Extensions → Docs",
      });
      return;
    }
    await setChosen(enabled ? current.filter((s) => s !== doc.slug) : [...current, doc.slug]);
    return refresh();
  }, { icon: enabled ? Icons.minus : Icons.plus });
  return {
    id: doc.slug,
    title: doc.name,
    subtitle: doc.version,
    icon: { source: enabled ? Icons.squareCheck : Icons.square, tint: enabled ? "green" : "gray" },
    section: enabled ? "Enabled" : "Available",
    keywords: [doc.slug, doc.release ?? ""],
    accessories: [
      ...(fromPrefs ? [{ tag: "Preferences", color: "blue" as const }] : []),
      ...(size(doc.db_size) ? [{ text: size(doc.db_size)! }] : []),
    ],
    detail: {
      metadata: [
        meta.text("Documentation", docTitle(doc), { icon: Icons.book }),
        ...(doc.release ? [meta.text("Release", doc.release, { icon: Icons.tag })] : []),
        meta.text("Slug", doc.slug, { icon: Icons.code }),
        ...(size(doc.db_size) ? [meta.text("Size", size(doc.db_size)!, { icon: Icons.download })] : []),
        ...(doc.mtime
          ? [meta.text("Updated", new Date(doc.mtime * 1000).toLocaleDateString("en-GB"), { icon: Icons.calendar })]
          : []),
        meta.text("Status", enabled ? (fromPrefs ? "Enabled in preferences" : "Enabled") : "Not enabled", {
          icon: Icons.dot,
          color: enabled ? "green" : "gray",
        }),
        meta.separator(),
        meta.link("DevDocs", `devdocs.io/${doc.slug}`, devdocsUrl(doc.slug)),
        ...(doc.links?.home ? [meta.link("Homepage", doc.links.home.replace(/^https?:\/\//, ""), doc.links.home)] : []),
        ...(doc.links?.code ? [meta.link("Source", doc.links.code.replace(/^https?:\/\//, ""), doc.links.code)] : []),
      ],
    },
    actions: [toggle, open(devdocsUrl(doc.slug), "Open in DevDocs", { shortcut: "<Ctrl>o" })],
  };
}

export default list({
  title: "Choose DevDocs",
  placeholder: "Find a documentation to enable…",
  filter: { options: [{ value: "all", title: "All" }, { value: "enabled", title: "Enabled" }], default: "all" },
  status: () => `${counts.enabled} enabled · ${counts.all} available`,
  actions: [
    action("Reload the DevDocs List", async () => {
      await allDocs(true);
      return refresh();
    }, { icon: Icons.refresh }),
  ],
  async items({ preferences, filter }) {
    const all = await allDocs();
    const { docs, fromPrefs } = await enabledDocs(preferences as Prefs);
    const enabled = new Set(docs.map((d) => d.slug));
    // The first pick starts from what is enabled now (the defaults), not from nothing.
    const current = (await chosen()) ?? docs.filter((d) => !fromPrefs.has(d.slug)).map((d) => d.slug);
    counts = { enabled: enabled.size, all: all.length };
    const shown = filter === "enabled" ? all.filter((d) => enabled.has(d.slug)) : all;
    return [...shown]
      .sort((a, b) => Number(enabled.has(b.slug)) - Number(enabled.has(a.slug)))
      .map((d) => item(d, enabled.has(d.slug), fromPrefs.has(d.slug), current));
  },
});
