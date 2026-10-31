import {
  type Accessory,
  type Action,
  action,
  copy,
  detail,
  type DetailSpec,
  Icons,
  type Item,
  list,
  meta,
  type Metadata,
  open,
  refresh,
  storage,
  submenu,
} from "@backslash/api";
import { bundleSize, history, installSize, measure, search, similar } from "../api.ts";
import {
  addRecent,
  bundlephobiaUrl,
  type BundleSize,
  bytes,
  candidates,
  compact,
  downloadTime,
  duration,
  type InstallSize,
  lighter,
  NETWORKS,
  npmUrl,
  packagephobiaUrl,
  parseSpec,
  type Recent,
  saving,
  sizeColor,
  type Spec,
  specText,
  type Suggestion,
  summaryLine,
} from "../lib.ts";

type Sizes = Record<string, { size: number; gzip: number }>;

const RECENT = "recent";
const SIZES = "sizes";

async function cached(): Promise<Sizes> {
  return (await storage.get<Sizes>(SIZES).catch(() => undefined)) ?? {};
}

async function remember(b: BundleSize): Promise<void> {
  const sizes = await cached();
  delete sizes[`${b.name}@${b.version}`];
  sizes[`${b.name}@${b.version}`] = { size: b.size, gzip: b.gzip };
  const keys = Object.keys(sizes);
  for (const k of keys.slice(0, Math.max(0, keys.length - 300))) delete sizes[k];
  const recent = (await storage.get<Recent[]>(RECENT).catch(() => undefined)) ?? [];
  await Promise.all([
    storage.set(SIZES, sizes),
    storage.set(
      RECENT,
      addRecent(recent, { name: b.name, version: b.version, size: b.size, gzip: b.gzip, at: Date.now() }),
    ),
  ]);
}

function sizeAccessories(s: { size: number; gzip: number } | undefined): Accessory[] {
  if (!s) return [];
  return [
    { text: bytes(s.size), tooltip: "Minified" },
    { tag: bytes(s.gzip), color: sizeColor(s.gzip), tooltip: "Minified + gzipped" },
  ];
}

// ---------------------------------------------------------------------------
// The size of one package

function downloadTable(gzip: number): string {
  return [
    "| Network | Download |",
    "| --- | --- |",
    ...NETWORKS.map((n) => `| ${n.title} | ${duration(downloadTime(gzip, n))} |`),
  ].join("\n");
}

function composition(b: BundleSize): string {
  const deps = b.dependencies.filter((d) => d.size > 0);
  if (deps.length < 2) return "";
  const total = deps.reduce((t, d) => t + d.size, 0);
  const shown = deps.slice(0, 8);
  const rest = deps.slice(8);
  return [
    "### Composition",
    "",
    "| Package | Share | Size |",
    "| --- | ---: | ---: |",
    ...shown.map((d) => `| ${d.name} | ${Math.round((d.size / total) * 100)} % | ${bytes(d.size)} |`),
    ...(rest.length
      ? [`| ${rest.length} more | ${Math.round((rest.reduce((t, d) => t + d.size, 0) / total) * 100)} % | |`]
      : []),
  ].join("\n");
}

function sizeView(spec: Spec, b: BundleSize, extra: {
  install?: InstallSize;
  category?: string;
  alternatives: { name: string; gzip?: number; size?: number; description?: string }[];
  versions: { version: string; size: number; gzip: number }[];
}): DetailSpec {
  const id = `${b.name}@${b.version}`;
  const lighterOnes = lighter(b.gzip, extra.alternatives);
  const heavier = extra.alternatives.filter((a) => a.gzip !== undefined && a.gzip >= b.gzip);
  const versions = extra.versions.slice(0, 8);
  const markdown = [
    `## ${b.name} \`${b.version}\``,
    "",
    b.description ?? "",
    "",
    downloadTable(b.gzip),
    "",
    lighterOnes.length
      ? [
        `### Lighter${extra.category ? ` ${extra.category}` : ""} alternatives`,
        "",
        "| Package | Min + gzip | Difference |",
        "| --- | ---: | ---: |",
        ...lighterOnes.map((a) => `| ${a.name} | ${bytes(a.gzip)} | ${saving(b.gzip, a.gzip)} |`),
      ].join("\n")
      : extra.alternatives.length
      ? `_None of the ${extra.alternatives.length} similar packages measured is lighter._`
      : "",
    "",
    composition(b),
    "",
    versions.length > 1
      ? [
        "### Earlier versions",
        "",
        "| Version | Minified | Min + gzip |",
        "| --- | ---: | ---: |",
        ...versions.map((v) =>
          `| ${v.version === b.version ? `**${v.version}**` : v.version} | ${bytes(v.size)} | ${bytes(v.gzip)} |`
        ),
      ].join("\n")
      : "",
  ].join("\n").replace(/\n{3,}/g, "\n\n").trim();

  const metadata: Metadata[] = [
    meta.text("Version", b.version, { icon: Icons.tag }),
    meta.text("Tree-shakeable", b.treeShakeable ? "Yes (ES modules)" : "No (CommonJS)", {
      icon: b.treeShakeable ? Icons.check : Icons.cross,
      color: b.treeShakeable ? "green" : "orange",
    }),
    meta.text(
      "Side effects",
      Array.isArray(b.sideEffects)
        ? `Only in ${b.sideEffects.length} file${b.sideEffects.length === 1 ? "" : "s"}`
        : b.sideEffects
        ? "Possible"
        : "None declared",
    ),
    meta.text("Dependencies", String(b.dependencyCount), { icon: Icons.layers }),
    ...(extra.install
      ? [
        meta.text("Publish size", bytes(extra.install.publishBytes), { icon: Icons.package }),
        meta.text(
          "Install size",
          `${bytes(extra.install.installBytes)}${
            extra.install.installFiles ? ` · ${compact(extra.install.installFiles)} files` : ""
          }`,
          { icon: Icons.download },
        ),
      ]
      : []),
    ...(extra.category ? [meta.text("Category", extra.category)] : []),
    meta.separator(),
    meta.link("Bundlephobia", `bundlephobia.com/package/${id}`, bundlephobiaUrl(id)),
    meta.link("npm", `npmjs.com/package/${b.name}`, npmUrl(b.name, b.version)),
    ...(b.repository ? [meta.link("Repository", b.repository.replace(/^https?:\/\//, ""), b.repository)] : []),
  ];

  const compare = [...lighterOnes, ...heavier].map((a) =>
    action(`${a.name}${a.gzip !== undefined ? ` · ${bytes(a.gzip)}` : ""}`, () => measureView({ name: a.name }), {
      icon: Icons.package,
    })
  );
  const actions: Action[] = [
    open(bundlephobiaUrl(id), "Open on Bundlephobia"),
    copy(summaryLine(b), "Copy Size Summary", { shortcut: "<Ctrl><Shift>c" }),
    copy(`npm install ${id}`, "Copy npm install", { icon: Icons.terminal, section: "Copy" }),
    copy(id, "Copy Name and Version", { section: "Copy" }),
    ...(compare.length
      ? [submenu("Measure an Alternative", compare, { icon: Icons.layers, shortcut: "<Ctrl>m" })]
      : []),
    open(npmUrl(b.name, b.version), "Open on npm", { shortcut: "<Ctrl>o", section: "Links" }),
    open(packagephobiaUrl(id), "Open on Packagephobia", { section: "Links" }),
    ...(b.repository ? [open(b.repository, "Open Repository", { icon: Icons.repository, section: "Links" })] : []),
  ];

  return detail({
    title: id,
    markdown,
    stats: [
      { label: "minified", value: bytes(b.size) },
      { label: "min + gzip", value: bytes(b.gzip), color: sizeColor(b.gzip) },
      ...(extra.install ? [{ label: "install", value: bytes(extra.install.installBytes) }] : []),
      { label: "dependencies", value: b.dependencyCount },
    ],
    metadata,
    status: spec.version && spec.version !== b.version ? `${specText(spec)} resolved to ${b.version}` : undefined,
    actions,
  });
}

/** Measures the package and everything around it. */
async function measureView(spec: Spec): Promise<DetailSpec> {
  const text = specText(spec);
  const [b, install, sim, versions] = await Promise.all([
    bundleSize(text),
    installSize(text).catch(() => undefined),
    similar(spec.name).catch(() => ({ category: undefined, packages: [] })),
    history(spec.name).catch(() => []),
  ]);
  const alternatives = await measure(candidates(b.name, sim.packages));
  await remember(b).catch(() => {});
  return sizeView(spec, b, { install, category: sim.category, alternatives, versions });
}

// ---------------------------------------------------------------------------
// The list

function measureAction(spec: Spec): Action {
  return action("Show Bundle Size", () => measureView(spec), { icon: Icons.package });
}

function suggestionItem(s: Suggestion, sizes: Sizes, exact: boolean): Item {
  const known = sizes[`${s.name}@${s.version}`];
  return {
    id: `npm:${s.name}`,
    title: s.name,
    subtitle: s.description,
    icon: { source: Icons.package, tint: known ? sizeColor(known.gzip) : "gray" },
    section: exact ? undefined : "npm",
    accessories: [
      ...(s.downloads ? [{ icon: Icons.download, text: compact(s.downloads), tooltip: "Weekly downloads" }] : []),
      ...(known ? sizeAccessories(known) : [{ text: s.version, tooltip: "Latest version: Enter to measure" }]),
    ],
    detail: {
      stats: known
        ? [
          { label: "minified", value: bytes(known.size) },
          { label: "min + gzip", value: bytes(known.gzip), color: sizeColor(known.gzip) },
        ]
        : undefined,
      markdown: [
        `## ${s.name}`,
        "",
        s.description ?? "",
        "",
        known ? downloadTable(known.gzip) : "Press **Enter** to measure it: Bundlephobia builds it if nobody has yet.",
      ].join("\n"),
      metadata: [
        meta.text("Latest version", s.version, { icon: Icons.tag }),
        ...(s.downloads ? [meta.text("Weekly downloads", compact(s.downloads), { icon: Icons.download })] : []),
        meta.link("npm", `npmjs.com/package/${s.name}`, npmUrl(s.name)),
      ],
    },
    actions: [
      measureAction({ name: s.name }),
      open(bundlephobiaUrl(s.name), "Open on Bundlephobia"),
      copy(`npm install ${s.name}`, "Copy npm install", { icon: Icons.terminal }),
      open(npmUrl(s.name), "Open on npm", { shortcut: "<Ctrl>o" }),
    ],
  };
}

function recentItem(r: Recent): Item {
  const id = `${r.name}@${r.version}`;
  return {
    id: `recent:${id}`,
    title: r.name,
    subtitle: r.version,
    icon: { source: Icons.history, tint: sizeColor(r.gzip) },
    section: "Recently Measured",
    accessories: sizeAccessories(r),
    detail: {
      stats: [
        { label: "minified", value: bytes(r.size) },
        { label: "min + gzip", value: bytes(r.gzip), color: sizeColor(r.gzip) },
      ],
      markdown: downloadTable(r.gzip),
      metadata: [
        meta.text("Version", r.version, { icon: Icons.tag }),
        meta.text("Measured", new Date(r.at).toLocaleDateString("en", { dateStyle: "medium" }), {
          icon: Icons.calendar,
        }),
      ],
    },
    actions: [
      action("Show Bundle Size", () => measureView({ name: r.name, version: r.version }), { icon: Icons.package }),
      copy(summaryLine(r), "Copy Size Summary"),
      measureAction({ name: r.name }),
      open(bundlephobiaUrl(id), "Open on Bundlephobia", { shortcut: "<Ctrl>o" }),
      action("Remove from Recent", async () => {
        const recent = (await storage.get<Recent[]>(RECENT)) ?? [];
        await storage.set(RECENT, recent.filter((x) => x.name !== r.name));
        return refresh();
      }, { icon: Icons.trash, section: "Recent", shortcut: "<Ctrl>x" }),
      action("Clear Recent", async () => {
        await storage.delete(RECENT);
        return refresh();
      }, { icon: Icons.trash, section: "Recent", destructive: true, confirm: "Forget every measured package?" }),
    ],
  };
}

let status = "";

export default list({
  placeholder: "Package, like react or lodash@4.17.21…",
  empty: {
    title: "No package found",
    description: "Type the exact name of an npm package, optionally with @version",
    icon: Icons.package,
  },
  status: () => status,
  async search(query, { signal }) {
    const sizes = await cached();
    if (!query.trim()) {
      const recent = (await storage.get<Recent[]>(RECENT).catch(() => undefined)) ?? [];
      status = recent.length ? `${recent.length} measured` : "";
      if (recent.length) return recent.map(recentItem);
      return [{
        id: "hint",
        title: "Type an npm package",
        subtitle: "react, date-fns@3, @tanstack/react-query…",
        icon: { source: Icons.package, tint: "blue" },
        detail: {
          markdown: [
            "## How heavy is this package?",
            "",
            "Type a package name, optionally with a version (`react@18.2.0`), then press **Enter**:",
            "",
            "- its **minified** and **gzipped** size, measured by Bundlephobia;",
            "- its **install size** (what `npm install` downloads), from Packagephobia;",
            "- the **download time** on slow 3G, 3G and 4G;",
            "- what it's made of, and **lighter alternatives**.",
          ].join("\n"),
        },
        actions: [open("https://bundlephobia.com", "Open Bundlephobia")],
      }];
    }
    const spec = parseSpec(query);
    if (!spec) {
      status = "";
      return [{
        id: "invalid",
        title: `“${query.trim()}” isn't an npm package name`,
        subtitle: "Like react, @scope/name or name@1.2.3",
        icon: { source: Icons.alert, tint: "orange" },
      }];
    }
    const suggestions = spec.version ? [] : await search(spec.name, signal).catch((e) => {
      if (signal.aborted) throw e;
      return [] as Suggestion[];
    });
    const exact = suggestions.find((s) => s.name === spec.name);
    const items: Item[] = [];
    if (spec.version || !exact) {
      // A version was typed, or npm search doesn't know the name (yet): measure it as typed.
      const text = specText(spec);
      const known = spec.version ? sizes[text] : undefined;
      items.push({
        id: `spec:${text}`,
        title: text,
        subtitle: spec.version ? "Enter to measure this version" : "Enter to measure",
        icon: { source: Icons.package, tint: known ? sizeColor(known.gzip) : "blue" },
        accessories: sizeAccessories(known),
        actions: [
          measureAction(spec),
          open(bundlephobiaUrl(text), "Open on Bundlephobia"),
          open(npmUrl(spec.name, spec.version), "Open on npm", { shortcut: "<Ctrl>o" }),
        ],
      });
    }
    if (exact) items.push(suggestionItem(exact, sizes, true));
    items.push(...suggestions.filter((s) => s !== exact).map((s) => suggestionItem(s, sizes, false)));
    status = suggestions.length ? `${suggestions.length} package${suggestions.length === 1 ? "" : "s"} on npm` : "";
    return items;
  },
});
