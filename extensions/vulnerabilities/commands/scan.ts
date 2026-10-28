import { action, type Context, copy, Icons, type Item, list, meta, open, storage } from "@backslash/api";
import { findProjects, HOME, type Project, readDependencies, scan } from "../api.ts";
import {
  advisoryUrl,
  affectedFor,
  age,
  type Dependency,
  ecosystemTitle,
  type Finding,
  fixFor,
  headline,
  looseCompare,
  SEVERITY_COLOR,
  SEVERITY_ORDER,
  severityCounts,
  severityOf,
  sortFindings,
  tilde,
  upgradeCommand,
  worst,
} from "../lib.ts";
import { severityIcon, severityTag, vulnItem } from "../views.ts";

interface Prefs {
  folders?: string;
  depth?: number;
  dev?: boolean;
}

interface LastScan {
  at: number;
  packages: number;
  vulnerable: number;
  worst: string;
}

type Json = Parameters<typeof storage.set>[1];

const lastScans = async () =>
  ((await storage.get("lastScans").catch(() => undefined)) as Record<string, LastScan> | undefined) ?? {};

async function saveScan(path: string, scan: LastScan) {
  const all = await lastScans();
  all[path] = scan;
  await storage.set("lastScans", all as unknown as Json).catch(() => {});
}

/** The version that fixes every advisory of the package. */
function fixAll(f: Finding): string | undefined {
  const fixes = f.vulns.map((v) =>
    fixFor(affectedFor(v, f.dependency.ecosystem, f.dependency.name), f.dependency.version)
  );
  if (fixes.some((x) => !x)) return undefined;
  return (fixes as string[]).sort(looseCompare).pop();
}

function findingItem(f: Finding, lockfile: string, path: string): Item {
  const d = f.dependency;
  const id = `${d.ecosystem}:${d.name}@${d.version}`;
  const eco = ecosystemTitle(d.ecosystem);
  if (!f.vulns.length) {
    return {
      id,
      title: d.name,
      subtitle: d.version,
      icon: { source: Icons.check, tint: "gray" },
      section: "No known vulnerabilities",
      keywords: [eco, lockfile],
      accessories: [...(d.dev ? [{ tag: "dev" }] : []), { text: eco }],
      actions: [copy(`${d.name}@${d.version}`, "Copy Package and Version")],
    };
  }
  const scores = f.vulns.map(severityOf);
  const top = worst(scores);
  const sorted = [...f.vulns].sort((a, b) =>
    SEVERITY_ORDER.indexOf(severityOf(a).severity) - SEVERITY_ORDER.indexOf(severityOf(b).severity)
  );
  const fix = fixAll(f);
  const command = fix ? upgradeCommand(d, fix, lockfile) : undefined;
  const advisories = () =>
    list({
      title: `${d.name} ${d.version}`,
      placeholder: `Filter the advisories of ${d.name}…`,
      items: sorted.map((v) =>
        vulnItem(v, {
          ecosystem: d.ecosystem,
          name: d.name,
          version: d.version,
          section: `${d.name} ${d.version} · ${tilde(path, HOME)}`,
        })
      ),
    });
  return {
    id,
    title: d.name,
    subtitle: `${d.version} · ${headline(sorted[0])}`,
    icon: severityIcon(top),
    section: `Vulnerable · ${eco} (${lockfile})`,
    keywords: [eco, lockfile, ...f.vulns.map((v) => v.id), ...f.vulns.flatMap((v) => v.aliases ?? [])],
    accessories: [
      ...(d.dev ? [{ tag: "dev" }] : []),
      fix
        ? { text: `→ ${fix}`, icon: { source: Icons.arrowUp, tint: "green" as const }, tooltip: "Fixes every advisory" }
        : { text: "no full fix", icon: { source: Icons.cross, tint: "red" as const } },
      { tag: `${f.vulns.length}`, tooltip: `${f.vulns.length} advisor${f.vulns.length === 1 ? "y" : "ies"}` },
      severityTag(top),
    ],
    detail: {
      stats: [
        { label: "Advisories", value: f.vulns.length },
        {
          label: "Worst",
          value: top.score !== undefined ? top.score.toFixed(1) : top.severity,
          color: SEVERITY_COLOR[top.severity],
        },
        { label: "Upgrade to", value: fix ?? "—", color: fix ? "green" : "red" },
      ],
      markdown: [
        `## ${d.name} ${d.version}`,
        "",
        command ? `Upgrade with \`${command}\`.` : "At least one advisory has no fixed version yet.",
        "",
        "| Severity | Advisory | Fixed in |",
        "|---|---|---|",
        ...sorted.map((v) => {
          const s = severityOf(v);
          const fixed = fixFor(affectedFor(v, d.ecosystem, d.name), d.version);
          return `| ${s.severity}${s.score !== undefined ? ` ${s.score.toFixed(1)}` : ""} | [${v.id}](${
            advisoryUrl(v)
          }) ${headline(v).replace(/\|/g, "\\|")} | ${fixed ?? "not fixed"} |`;
        }),
      ].join("\n"),
      metadata: [
        meta.text("Package", `${eco} ${d.name}`, { icon: Icons.package }),
        meta.text("Version", d.version, { icon: Icons.tag }),
        meta.text("Lockfile", lockfile, { icon: Icons.file }),
        ...(d.dev ? [meta.text("Scope", "Development only")] : []),
      ],
    },
    actions: [
      action("Show Advisories", advisories, { icon: Icons.shield }),
      ...(command ? [copy(command, "Copy Upgrade Command", { icon: Icons.terminal })] : []),
      open(advisoryUrl(sorted[0]), "Open Worst Advisory", { shortcut: "<Ctrl>o" }),
      ...(fix ? [copy(fix, "Copy Fixed Version", { icon: Icons.tag, shortcut: "<Ctrl><Shift>f" })] : []),
      copy(sorted.map((v) => v.id).join("\n"), "Copy Advisory IDs", { section: "Copy" }),
    ],
  };
}

function resultsView(project: Project, prefs: Prefs) {
  const where = tilde(project.path, HOME);
  let summary = "";
  return list({
    title: where,
    placeholder: `Filter the dependencies of ${where.split("/").pop()}…`,
    empty: {
      title: "No dependency to check",
      description: "The lockfiles list no registry package.",
      icon: Icons.package,
    },
    status: () => summary,
    async items({ signal }) {
      const read = await readDependencies(project);
      const errors = read.filter((r) => r.error);
      const entries = read.flatMap((r) =>
        r.deps.filter((d) => prefs.dev !== false || !d.dev).map((d) => ({ dep: d, lockfile: r.lockfile.file }))
      );
      const findings = await scan(entries.map((e) => e.dep), signal);
      const lockOf = new Map<Dependency, string>(entries.map((e) => [e.dep, e.lockfile]));
      const sorted = sortFindings(findings);
      const vulnerable = sorted.filter((f) => f.vulns.length);
      const counts = severityCounts(sorted);
      const bySeverity = SEVERITY_ORDER.filter((s) => counts[s]).map((s) => `${counts[s]} ${s.toLowerCase()}`);
      summary = `${vulnerable.length} vulnerable of ${findings.length} packages${
        bySeverity.length ? ` · ${bySeverity.join(", ")}` : ""
      }`;
      await saveScan(project.path, {
        at: Date.now(),
        packages: findings.length,
        vulnerable: vulnerable.length,
        worst: vulnerable.length ? worst(vulnerable.flatMap((f) => f.vulns.map(severityOf))).severity : "None",
      });
      const head: Item[] = errors.map((e) => ({
        id: `error:${e.lockfile.file}`,
        title: `Couldn't read ${e.lockfile.file}`,
        subtitle: e.error,
        icon: { source: Icons.alert, tint: "orange" },
        section: "Problems",
      }));
      if (!vulnerable.length && findings.length) {
        head.push({
          id: "clean",
          title: "No known vulnerability",
          subtitle: `${findings.length} packages checked against OSV.dev`,
          icon: { source: Icons.done, tint: "green" },
          section: "Summary",
          actions: [open(project.path, "Open Project Folder")],
        });
      }
      return [...head, ...sorted.map((f) => findingItem(f, lockOf.get(f.dependency) ?? "", project.path))];
    },
  });
}

export default (ctx: Context) => {
  const prefs = ctx.preferences as Prefs;
  return list({
    placeholder: "Pick a project to scan its lockfiles…",
    empty: {
      title: "No project with a lockfile",
      description:
        "Set the folders to look in under Settings → Extensions → Vulnerabilities (package-lock.json, Cargo.lock, poetry.lock, go.mod, Gemfile.lock…)",
      icon: Icons.folder,
    },
    status: (items) => `${items.length} project${items.length === 1 ? "" : "s"} · newest change first`,
    async items() {
      const [projects, scans] = await Promise.all([
        findProjects(prefs.folders, Math.max(1, Math.min(5, Number(prefs.depth ?? 2)))),
        lastScans(),
      ]);
      return projects.map((p): Item => {
        const last = scans[p.path];
        const name = p.path.split("/").pop() ?? p.path;
        return {
          id: p.path,
          title: name,
          subtitle: tilde(p.path, HOME),
          icon: { source: Icons.project, tint: "blue" },
          keywords: p.lockfiles.map((l) => l.file),
          accessories: [
            ...p.lockfiles.map((l) => ({ tag: l.file })),
            ...(last
              ? [{
                tag: last.vulnerable ? `${last.vulnerable} vulnerable` : "clean",
                color: last.vulnerable
                  ? SEVERITY_COLOR[last.worst as keyof typeof SEVERITY_COLOR] ?? "orange"
                  : "green",
                tooltip: `Last scan ${age(new Date(last.at).toISOString())} ago: ${last.packages} packages`,
              }]
              : []),
            { text: age(new Date(p.modified).toISOString()), tooltip: "Lockfile last changed" },
          ],
          detail: {
            markdown: [
              `## ${name}`,
              "",
              "Enter checks every locked package against OSV.dev (only names and versions are sent).",
              "",
              ...p.lockfiles.map((l) => `- \`${l.file}\` · ${ecosystemTitle(l.ecosystem)}`),
            ].join("\n"),
            metadata: [
              meta.text("Folder", tilde(p.path, HOME), { icon: Icons.folder }),
              meta.text("Lockfile changed", new Date(p.modified).toLocaleString(), { icon: Icons.clock }),
              ...(last
                ? [
                  meta.text("Last scan", new Date(last.at).toLocaleString(), { icon: Icons.history }),
                  meta.text("Result", `${last.vulnerable} vulnerable of ${last.packages}`),
                ]
                : []),
            ],
          },
          actions: [
            action("Scan Dependencies", () => resultsView(p, prefs), { icon: Icons.shield }),
            open(p.path, "Open Folder", { icon: Icons.folder }),
            copy(p.path, "Copy Path", { section: "Copy" }),
          ],
        };
      });
    },
  });
};
