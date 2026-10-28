import { action, type Color, copy, Icons, type Item, list, meta, open } from "@backslash/api";
import { docIndex, enabledDocs } from "../devdocs.ts";
import { devdocsUrl, type Doc, docTitle, type Entry, rank, scopeQuery, size } from "../lib.ts";
import chooseDocs from "./choose-docs.ts";

interface Prefs {
  docs?: string;
}

const TINTS: Color[] = ["blue", "purple", "teal", "orange", "pink", "green", "yellow", "red"];
const tint = (slug: string) => TINTS[[...slug].reduce((n, c) => n + c.charCodeAt(0), 0) % TINTS.length];

const choose = action("Choose DevDocs", () => chooseDocs, {
  icon: Icons.settings,
  shortcut: "<Ctrl>e",
  section: "DevDocs",
});

function docItem(doc: Doc, entries?: number): Item {
  return {
    id: `doc:${doc.slug}`,
    title: doc.name,
    subtitle: doc.version,
    icon: { source: Icons.book, tint: tint(doc.slug) },
    section: "Enabled Docs",
    keywords: [doc.slug],
    accessories: entries !== undefined ? [{ text: `${entries.toLocaleString("en")} entries` }] : [],
    detail: {
      markdown: `Type **${doc.slug.split("~")[0]} ‹query›** to search only this documentation.`,
      metadata: [
        meta.text("Documentation", docTitle(doc), { icon: Icons.book }),
        ...(doc.release ? [meta.text("Release", doc.release, { icon: Icons.tag })] : []),
        ...(entries !== undefined ? [meta.text("Entries", entries.toLocaleString("en"))] : []),
        ...(size(doc.db_size) ? [meta.text("Size", size(doc.db_size)!, { icon: Icons.download })] : []),
        meta.separator(),
        meta.link("DevDocs", `devdocs.io/${doc.slug}`, devdocsUrl(doc.slug)),
        ...(doc.links?.home ? [meta.link("Homepage", doc.links.home.replace(/^https?:\/\//, ""), doc.links.home)] : []),
      ],
    },
    actions: [open(devdocsUrl(doc.slug), "Open in DevDocs"), choose],
  };
}

function entryItem(doc: Doc, e: Entry): Item {
  const url = devdocsUrl(doc.slug, e.path);
  return {
    id: `${doc.slug}/${e.path}`,
    title: e.name,
    subtitle: e.type,
    icon: { source: Icons.book, tint: tint(doc.slug) },
    accessories: [{ tag: docTitle(doc) }],
    detail: {
      metadata: [
        meta.text("Entry", e.name, { icon: Icons.code }),
        meta.text("Type", e.type, { icon: Icons.tag }),
        meta.text("Documentation", docTitle(doc), { icon: Icons.book, color: tint(doc.slug) }),
        meta.separator(),
        meta.link("Page", `devdocs.io/${doc.slug}/${e.path}`.slice(0, 60), url),
      ],
    },
    actions: [
      open(url, "Open in Browser"),
      copy(url, "Copy URL", { shortcut: "<Ctrl><Shift>c", section: "Copy" }),
      copy(`[${e.name}](${url})`, "Copy as Markdown Link", { section: "Copy" }),
      copy(e.name, "Copy Name", { shortcut: "<Ctrl>period", section: "Copy" }),
      open(devdocsUrl(doc.slug), `Open ${doc.name} Home`, { icon: Icons.book, section: "DevDocs" }),
      choose,
    ],
  };
}

let summary = "";

export default list({
  placeholder: "Search DevDocs… (prefix with a doc to narrow: “py dict”)",
  empty: {
    title: "No match in the enabled docs",
    description: "Press Ctrl+E to enable more documentations",
    icon: Icons.search,
  },
  status: () => summary,
  actions: [choose, open("https://devdocs.io", "Open DevDocs", { icon: Icons.globe })],
  async search(query, { preferences }) {
    const { docs } = await enabledDocs(preferences as Prefs);
    if (!docs.length) {
      summary = "";
      return [{
        id: "none",
        title: "No documentation enabled",
        subtitle: "Choose the ones you use",
        icon: { source: Icons.settings, tint: "orange" },
        actions: [choose],
      }];
    }
    const loaded = await Promise.allSettled(docs.map(docIndex));
    const failed = docs.filter((_, i) => loaded[i].status === "rejected").map((d) => d.name);
    const indexOf = (i: number) =>
      loaded[i].status === "fulfilled" ? (loaded[i] as PromiseFulfilledResult<Entry[]>).value : [];
    if (failed.length === docs.length) {
      throw new Error(`Could not load the DevDocs indexes (${(loaded[0] as PromiseRejectedResult).reason})`);
    }
    const total = docs.reduce((n, _, i) => n + indexOf(i).length, 0);
    summary = `${docs.length} docs · ${total.toLocaleString("en")} entries${
      failed.length ? ` · ${failed.join(", ")} unavailable` : ""
    }`;
    if (!query.trim()) {
      return docs.map((d, i) => docItem(d, loaded[i].status === "fulfilled" ? indexOf(i).length : undefined));
    }
    const scope = scopeQuery(query, docs);
    const pool = docs.flatMap((
      doc,
      i,
    ) => (scope.slug && doc.slug !== scope.slug ? [] : indexOf(i).map((e) => ({ doc, e }))));
    return rank(pool, scope.text, (x) => x.e.name, 60).map(({ doc, e }) => entryItem(doc, e));
  },
});
