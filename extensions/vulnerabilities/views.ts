// Rows shared by the two commands.

import { type Action, copy, Icons, type Item, meta, type Metadata, open } from "@backslash/api";
import {
  advisoryUrl,
  affectedFor,
  affectedRanges,
  age,
  cves,
  ecosystemTitle,
  fixedVersions,
  fixFor,
  headline,
  type OsvVuln,
  type Score,
  SEVERITY_COLOR,
  severityOf,
  shortUrl,
  sortedReferences,
  vulnMarkdown,
} from "./lib.ts";

export const severityIcon = (s: Score) => ({
  source: s.severity === "Critical" || s.severity === "High" ? Icons.alert : Icons.shield,
  tint: SEVERITY_COLOR[s.severity],
});

export const severityTag = (s: Score) => ({
  tag: s.score !== undefined ? `${s.severity} ${s.score.toFixed(1)}` : s.severity,
  color: SEVERITY_COLOR[s.severity],
  tooltip: s.vector ?? s.source,
});

export function vulnMetadata(v: OsvVuln, s: Score, fixed: string[]): Metadata[] {
  const aliases = (v.aliases ?? []).filter((a) => a !== v.id);
  const packages = [
    ...new Set(
      (v.affected ?? []).flatMap((a) => a.package ? [`${ecosystemTitle(a.package.ecosystem)} ${a.package.name}`] : []),
    ),
  ];
  return [
    meta.tags("Severity", [{
      text: s.score !== undefined ? `${s.severity} · ${s.score.toFixed(1)}` : s.severity,
      color: SEVERITY_COLOR[s.severity],
    }]),
    ...(s.source ? [meta.text("Rated by", s.source)] : []),
    ...(s.vector ? [meta.text("Vector", s.vector)] : []),
    meta.separator(),
    meta.text("ID", v.id, { icon: Icons.hash }),
    ...(aliases.length ? [meta.tags("Aliases", aliases.slice(0, 6))] : []),
    ...(packages.length
      ? [
        meta.text("Packages", packages.slice(0, 4).join(", ") + (packages.length > 4 ? "…" : ""), {
          icon: Icons.package,
        }),
      ]
      : []),
    ...(fixed.length ? [meta.tags("Fixed in", fixed.slice(-6).map((f) => ({ text: f, color: "green" as const })))] : [
      meta.text("Fixed in", "No fix released", { color: "red" }),
    ]),
    ...(v.published ? [meta.text("Published", v.published.slice(0, 10), { icon: Icons.calendar })] : []),
    meta.text("Modified", v.modified.slice(0, 10), { icon: Icons.history }),
    meta.separator(),
    meta.link("OSV", `osv.dev/vulnerability/${v.id}`, advisoryUrl(v)),
  ];
}

export function vulnActions(v: OsvVuln, fix?: string, extra: Action[] = []): Action[] {
  const refs = sortedReferences(v);
  const advisory = refs.find((r) => r.type === "ADVISORY");
  const ids = cves(v);
  return [
    open(advisoryUrl(v), "Open Advisory on OSV.dev"),
    copy(v.id, "Copy ID", { shortcut: "<Ctrl><Shift>c" }),
    ...(fix ? [copy(fix, "Copy Fixed Version", { icon: Icons.tag, shortcut: "<Ctrl><Shift>f" })] : []),
    ...extra,
    ...(ids.length && ids[0] !== v.id ? [copy(ids[0], `Copy ${ids[0]}`, { section: "Copy" })] : []),
    copy(headline(v), "Copy Summary", { icon: Icons.text, section: "Copy" }),
    ...(advisory
      ? [
        open(advisory.url, `Open on ${shortUrl(advisory.url).split("/")[0]}`, {
          section: "Links",
          shortcut: "<Ctrl>o",
        }),
      ]
      : []),
    ...refs.filter((r) => r !== advisory).slice(0, 8).map((r) =>
      open(r.url, `${r.type[0]}${r.type.slice(1).toLowerCase()}: ${shortUrl(r.url)}`, {
        section: "Links",
        icon: Icons.link,
      })
    ),
  ];
}

/** An advisory as a row, seen from one package (and version) when given. */
export function vulnItem(
  v: OsvVuln,
  options: { ecosystem?: string; name?: string; version?: string; section?: string; extra?: Action[] } = {},
): Item {
  const s = severityOf(v);
  const affected = affectedFor(v, options.ecosystem, options.name);
  const fixed = fixedVersions(affected);
  const fix = fixFor(affected, options.version);
  const ranges = affectedRanges(affected);
  return {
    id: v.id,
    title: headline(v),
    subtitle: v.id,
    icon: severityIcon(s),
    section: options.section,
    keywords: [...(v.aliases ?? []), ...ranges],
    accessories: [
      ...(v.withdrawn ? [{ tag: "Withdrawn", color: "gray" as const }] : []),
      fix
        ? { text: `fixed in ${fix}`, icon: { source: Icons.check, tint: "green" as const } }
        : { text: "no fix", icon: { source: Icons.cross, tint: "red" as const } },
      ...(v.published ? [{ text: age(v.published), tooltip: `Published ${v.published.slice(0, 10)}` }] : []),
      severityTag(s),
    ],
    detail: {
      markdown: vulnMarkdown(v, options.ecosystem, options.name, options.version),
      metadata: [
        ...(ranges.length
          ? [
            meta.text("Affected", ranges.slice(0, 3).join(", ") + (ranges.length > 3 ? "…" : ""), {
              icon: Icons.alert,
            }),
          ]
          : []),
        ...vulnMetadata(v, s, fixed),
      ],
    },
    actions: vulnActions(v, fix, options.extra),
  };
}
