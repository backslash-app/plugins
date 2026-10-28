import { type Action, copy, Icons, type Item, list, meta, open } from "@backslash/api";
import { searchRegistry } from "../api.ts";
import {
  compact,
  type Package,
  parseQuery,
  rank,
  REGISTRIES,
  registry,
  type RegistryId,
  relativeDate,
} from "../lib.ts";

function packageItem(p: Package): Item {
  const r = registry(p.registry)!;
  const updated = relativeDate(p.updated);
  const [mainTitle, mainCommand] = p.install[0];
  const links: Action[] = [
    ...(p.repository ? [open(p.repository, "Open Repository", { icon: Icons.repository, shortcut: "<Ctrl>r" })] : []),
    ...(p.docs ? [open(p.docs, "Open Documentation", { icon: Icons.book, shortcut: "<Ctrl>d" })] : []),
    ...(p.homepage && p.homepage !== p.repository ? [open(p.homepage, "Open Homepage", { icon: Icons.home })] : []),
  ];
  return {
    id: `${p.registry}:${p.name}`,
    title: p.name,
    subtitle: p.description,
    icon: { source: p.deprecated ? Icons.alert : Icons.package, tint: p.deprecated ? "red" : r.tint },
    keywords: p.keywords,
    accessories: [
      ...(p.deprecated ? [{ tag: "Deprecated", color: "red" as const, tooltip: p.deprecated }] : []),
      ...(p.downloads !== undefined
        ? [{ icon: Icons.download, text: compact(p.downloads), tooltip: `Downloads, ${p.downloadsPeriod}` }]
        : []),
      ...(p.version ? [{ tag: p.version, color: r.tint }] : []),
    ],
    detail: {
      stats: [
        ...(p.version ? [{ label: "Version", value: p.version }] : []),
        ...(p.downloads !== undefined
          ? [{ label: `Downloads · ${p.downloadsPeriod}`, value: compact(p.downloads) }]
          : []),
        ...(updated ? [{ label: "Released", value: updated }] : []),
      ],
      markdown: [
        p.description ?? "",
        ...(p.deprecated ? ["", `> ${p.deprecated}`] : []),
        "",
        `**${mainTitle}**`,
        "",
        "```",
        mainCommand,
        "```",
      ].join("\n").trim(),
      metadata: [
        meta.text("Registry", `${r.title} · ${r.ecosystem}`, { icon: Icons.package }),
        ...(p.license ? [meta.text("License", p.license, { icon: Icons.shield })] : []),
        ...(p.updated
          ? [
            meta.text("Updated", new Date(p.updated).toLocaleDateString("en", { dateStyle: "medium" }), {
              icon: Icons.calendar,
            }),
          ]
          : []),
        ...(p.facts ?? []).map(([label, value]) => meta.text(label, value)),
        ...(p.keywords?.length ? [meta.tags("Keywords", p.keywords.slice(0, 8))] : []),
        meta.separator(),
        meta.link(r.title, p.page.replace(/^https:\/\/(www\.)?/, ""), p.page),
        ...(p.repository
          ? [meta.link("Repository", p.repository.replace(/^https:\/\/(www\.)?/, ""), p.repository)]
          : []),
        ...(p.docs ? [meta.link("Docs", p.docs.replace(/^https:\/\/(www\.)?/, ""), p.docs)] : []),
      ],
    },
    actions: [
      copy(mainCommand, `Copy ${mainTitle} Command`),
      open(p.page, `Open on ${r.title}`, { shortcut: "<Ctrl>o" }),
      ...p.install.slice(1).map(([title, text], i) =>
        copy(text, `Copy ${title}`, {
          icon: Icons.code,
          section: "Install",
          ...(i === 0 ? { shortcut: "<Ctrl><Shift>c" } : {}),
        })
      ),
      ...links.map((a) => ({ ...a, section: "Links" })),
      copy(p.name, "Copy Name", { section: "Copy" }),
      ...(p.version ? [copy(p.version, "Copy Version", { section: "Copy" })] : []),
    ],
  };
}

function hint(id: RegistryId): Item[] {
  return REGISTRIES.map((r) => ({
    id: `hint:${r.id}`,
    title: `${r.aliases[0]} ${r.example}`,
    subtitle: `${r.title} · ${r.ecosystem}`,
    icon: { source: Icons.package, tint: r.tint },
    section: r.id === id ? "Selected Registry" : "Type a Registry Name First",
    accessories: r.id === id ? [{ tag: "Selected", color: r.tint }] : [{ text: r.aliases.slice(1, 4).join(", ") }],
    detail: r.note ? { markdown: r.note } : undefined,
    actions: [open(r.webSearch(""), `Open ${r.title}`)],
  })).sort((a, b) => Number(b.id === `hint:${id}`) - Number(a.id === `hint:${id}`));
}

let last = "";

export default list({
  placeholder: "Search packages… (prefix with cargo, pip, go, gem, composer, maven, hex, pub, nuget)",
  filter: { options: REGISTRIES.map((r) => ({ value: r.id, title: r.title })), default: "crates" },
  empty: {
    title: "No package found",
    description: "Check the spelling, or try another registry.",
    icon: Icons.package,
  },
  status: () => last,
  async search(input, { filter, signal }) {
    const { registry: id, query } = parseQuery(input, (filter as RegistryId) ?? "crates");
    const r = registry(id)!;
    if (!query) {
      last = `${r.title} · ${r.ecosystem}`;
      return hint(id);
    }
    let found: Package[];
    try {
      found = rank(await searchRegistry(id, query, signal), query);
    } catch (e) {
      if (signal.aborted) throw e;
      last = `${r.title} is unreachable`;
      return [{
        id: "error",
        title: `${r.title} can't be reached`,
        subtitle: e instanceof Error ? e.message : String(e),
        icon: { source: Icons.wifiOff, tint: "red" },
        actions: [open(r.webSearch(query), `Search on ${r.title}`)],
      }];
    }
    last = `${found.length} result${found.length === 1 ? "" : "s"} on ${r.title}`;
    const items = found.map(packageItem);
    // What the API can't find, the website might.
    items.push({
      id: "web",
      title: `Search “${query}” on ${r.title}`,
      subtitle: r.note ?? "Open the registry's own search",
      icon: { source: Icons.search, tint: "gray" },
      section: found.length ? "More" : undefined,
      actions: [open(r.webSearch(query), `Search on ${r.title}`)],
    });
    return items;
  },
});
