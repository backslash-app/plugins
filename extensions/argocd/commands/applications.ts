import {
  type Action,
  action,
  copy,
  Icons,
  type Item,
  list,
  meta,
  open,
  refresh,
  submenu,
  toast,
  updateCommandMetadata,
} from "@backslash/api";
import { argo, guarded, type Server, server } from "../api.ts";
import {
  age,
  type App,
  type AppFilter,
  type Application,
  appPath,
  appUrl,
  attention,
  ATTENTION_TITLES,
  describeSource,
  destinationName,
  filterApps,
  formatDate,
  HEALTH_COLORS,
  isSyncing,
  md,
  parseApplications,
  problemResources,
  repoName,
  resourceCounts,
  revisionUrl,
  rollbackTargets,
  shortRevision,
  sortApps,
  SYNC_COLORS,
  SYNC_LABELS,
} from "../lib.ts";

function syncAction(s: Server, a: App, prune: boolean): Action {
  return action(prune ? "Sync and Prune" : "Sync", async () => {
    await argo(s, appPath(a, "/sync"), {
      method: "POST",
      body: { prune, dryRun: false, appNamespace: a.namespace },
    });
    await toast(`Syncing ${a.name}`, { style: "success", message: prune ? "Extra resources are deleted" : undefined });
    return refresh();
  }, {
    icon: Icons.refresh,
    shortcut: prune ? undefined : "<Ctrl><Shift>s",
    section: "Sync",
    ...(prune
      ? { destructive: true, confirm: `Sync ${a.name} and delete the resources that are no longer in Git?` }
      : {}),
  });
}

function rollbackMenu(s: Server, a: App): Action {
  return submenu("Roll Back To", () => {
    const targets = rollbackTargets(a);
    if (!targets.length) {
      return [action("No earlier deployment", () => {}, { icon: Icons.info })];
    }
    return targets.slice(0, 15).map((h) => {
      const rev = shortRevision(h.revision ?? h.revisions?.[0]);
      const who = h.initiatedBy?.automated ? "auto" : h.initiatedBy?.username;
      return action(
        `#${h.id} · ${rev || "?"} · ${age(h.deployedAt) || formatDate(h.deployedAt)}${who ? ` · ${who}` : ""}`,
        async () => {
          await argo(s, appPath(a, "/rollback"), {
            method: "POST",
            body: { id: h.id, dryRun: false, prune: false, appNamespace: a.namespace },
          });
          await toast(`Rolling back ${a.name} to #${h.id}`, { style: "success" });
          return refresh();
        },
        {
          icon: Icons.history,
          destructive: true,
          confirm: `Roll back ${a.name} to deployment #${h.id} (${rev})?${
            a.automated ? " Auto-sync is on: Argo CD refuses rollbacks until it's disabled." : ""
          }`,
        },
      );
    });
  }, { icon: Icons.history, shortcut: "<Ctrl><Shift>b", section: "Sync" });
}

function markdown(a: App): string | undefined {
  const parts: string[] = [];
  if (a.operation && a.operation.phase !== "Succeeded" && a.operation.message) {
    parts.push(`**Last sync ${a.operation.phase.toLowerCase()}**: ${md(a.operation.message)}`);
  }
  if (a.healthMessage && a.health !== "Healthy") parts.push(`**${a.health}**: ${md(a.healthMessage)}`);
  for (const c of a.conditions) parts.push(`**${c.type}**: ${md(c.message ?? "")}`);
  const problems = problemResources(a.resources).slice(0, 12);
  if (problems.length) {
    parts.push(
      [
        "| Resource | Sync | Health |",
        "| --- | --- | --- |",
        ...problems.map((r) =>
          `| ${md(`${r.kind}/${r.name}`)} | ${r.status ?? ""}${r.requiresPruning ? " (prune)" : ""} | ${
            r.health?.status ?? ""
          } |`
        ),
      ].join("\n"),
    );
  }
  return parts.length ? parts.join("\n\n") : undefined;
}

function item(s: Server, a: App): Item {
  const group = attention(a);
  const syncColor = SYNC_COLORS[a.sync];
  const healthColor = HEALTH_COLORS[a.health];
  const counts = resourceCounts(a.resources);
  const source = a.sources[0];
  const commit = revisionUrl(source?.repoURL, a.revision);
  const url = appUrl(s.base, a);
  const syncing = isSyncing(a);
  const failed = group === "failed";
  const tint = failed || a.health === "Degraded" ? "red" : a.sync === "OutOfSync" ? "orange" : healthColor;
  return {
    id: `${a.namespace}/${a.name}`,
    title: a.name,
    subtitle: destinationName(a),
    icon: { source: syncing ? Icons.inProgress : Icons.rocket, tint },
    section: ATTENTION_TITLES[group],
    keywords: [a.project, a.namespace, a.sync, a.health, ...a.sources.map((x) => repoName(x.repoURL))],
    accessories: [
      ...(a.automated ? [{ icon: Icons.bolt, tooltip: `Auto-sync${a.selfHeal ? ", self-heal" : ""}` }] : []),
      ...(a.revision ? [{ icon: Icons.commit, text: shortRevision(a.revision), tooltip: "Synced revision" }] : []),
      { text: a.project, tooltip: "Project" },
      ...(syncing ? [{ tag: "Syncing", color: "blue" as const }] : []),
      ...(failed ? [{ tag: "Sync failed", color: "red" as const }] : []),
      { tag: SYNC_LABELS[a.sync], color: syncColor },
      { tag: a.health, color: healthColor },
    ],
    detail: {
      stats: [
        { label: "resources", value: counts.total },
        { label: "out of sync", value: counts.outOfSync, color: counts.outOfSync ? "orange" : undefined },
        { label: "unhealthy", value: counts.unhealthy, color: counts.unhealthy ? "red" : undefined },
      ],
      markdown: markdown(a),
      metadata: [
        meta.tags("Status", [
          { text: SYNC_LABELS[a.sync], color: syncColor },
          { text: a.health, color: healthColor },
        ]),
        ...a.sources.map((x, i) =>
          meta.link(
            a.sources.length > 1 ? `Source ${i + 1}` : "Source",
            describeSource(x),
            x.repoURL && /^https?:\/\//.test(x.repoURL) ? x.repoURL : url,
          )
        ),
        ...(a.revision
          ? [commit ? meta.link("Revision", shortRevision(a.revision), commit) : meta.text("Revision", a.revision)]
          : []),
        meta.text("Destination", destinationName(a), { icon: Icons.server }),
        meta.text("Project", a.project, { icon: Icons.project }),
        meta.text(
          "Sync policy",
          a.automated ? `Automated${a.selfHeal ? " · self-heal" : ""}${a.autoPrune ? " · prune" : ""}` : "Manual",
          { icon: Icons.bolt },
        ),
        ...(counts.byKind.length
          ? [meta.tags("Resources", counts.byKind.slice(0, 8).map(([k, n]) => `${k} ${n}`))]
          : []),
        ...(counts.prune ? [meta.text("To prune", String(counts.prune), { icon: Icons.trash, color: "orange" })] : []),
        meta.separator(),
        ...(a.operation
          ? [meta.text(
            "Last sync",
            `${a.operation.phase}${a.operation.finishedAt ? ` · ${age(a.operation.finishedAt)} ago` : ""}${
              a.operation.by ? ` · ${a.operation.by}` : ""
            }`,
            { icon: Icons.history, color: failed ? "red" : undefined },
          )]
          : []),
        ...(a.reconciledAt ? [meta.text("Reconciled", formatDate(a.reconciledAt), { icon: Icons.clock })] : []),
        ...(a.images.length ? [meta.tags("Images", a.images.slice(0, 4).map((i) => i.split("/").pop()!))] : []),
        ...a.urls.slice(0, 3).map((u) => meta.link("URL", u.replace(/^https?:\/\//, ""), u)),
        ...(a.history.length ? [meta.text("Deployments", String(a.history.length), { icon: Icons.layers })] : []),
      ],
    },
    actions: [
      open(url, "Open in Argo CD", { icon: Icons.external }),
      syncAction(s, a, false),
      action("Hard Refresh", async () => {
        await argo(s, appPath(a, "", { refresh: "hard" }));
        await toast(`Refreshed ${a.name}`, { style: "success", message: "Manifests regenerated from Git" });
        return refresh();
      }, { icon: Icons.refresh, shortcut: "<Ctrl><Shift>h", section: "Sync" }),
      rollbackMenu(s, a),
      ...(syncing
        ? [action("Terminate Sync", async () => {
          await argo(s, appPath(a, "/operation"), { method: "DELETE" });
          await toast(`Terminating the sync of ${a.name}`, { style: "success" });
          return refresh();
        }, { icon: Icons.stop, destructive: true, confirm: `Stop the running sync of ${a.name}?`, section: "Sync" })]
        : []),
      syncAction(s, a, true),
      ...(commit ? [open(commit, "Open Commit", { icon: Icons.commit, section: "Open" })] : []),
      ...(source?.repoURL && /^https?:\/\//.test(source.repoURL)
        ? [open(source.repoURL.replace(/\.git$/, ""), "Open Repository", { icon: Icons.repository, section: "Open" })]
        : []),
      ...a.urls.slice(0, 1).map((u) => open(u, "Open App URL", { icon: Icons.globe, section: "Open" })),
      copy(url, "Copy Link", { shortcut: "<Ctrl><Shift>c", section: "Copy" }),
      copy(a.name, "Copy Name", { shortcut: "<Ctrl>period", section: "Copy" }),
      ...(a.revision ? [copy(a.revision, "Copy Revision", { icon: Icons.commit, section: "Copy" })] : []),
      action("Reload", () => refresh(), { icon: Icons.refresh, shortcut: "<Ctrl>r" }),
    ],
  };
}

let summary = "";

export default list({
  placeholder: "Filter applications by name, project, cluster, repository…",
  filter: {
    options: [
      { value: "all", title: "All" },
      { value: "attention", title: "Needs attention" },
      { value: "outOfSync", title: "Out of sync" },
      { value: "unhealthy", title: "Unhealthy" },
    ],
    default: "all",
  },
  empty: {
    title: "No applications",
    description: "Nothing matches, or the token's account can't see any application",
    icon: Icons.rocket,
  },
  status: () => summary,
  items: ({ preferences, filter, signal }) =>
    guarded(async () => {
      summary = "";
      const s = server(preferences);
      const project = String(preferences.project ?? "").trim();
      const query = project ? `?${new URLSearchParams({ projects: project })}` : "";
      const apps = parseApplications(
        await argo<{ items?: Application[] | null }>(s, `/api/v1/applications${query}`, { signal }),
      );
      const outOfSync = apps.filter((a) => a.sync !== "Synced").length;
      const degraded = apps.filter((a) => a.health === "Degraded" || a.health === "Missing").length;
      summary = [
        new URL(s.base).host,
        `${apps.length} app${apps.length === 1 ? "" : "s"}`,
        outOfSync ? `${outOfSync} out of sync` : "",
        degraded ? `${degraded} degraded` : "",
      ].filter(Boolean).join(" · ");
      await updateCommandMetadata({
        subtitle: outOfSync || degraded
          ? [outOfSync ? `${outOfSync} out of sync` : "", degraded ? `${degraded} degraded` : ""].filter(Boolean)
            .join(" · ")
          : apps.length
          ? "All synced"
          : null,
      }).catch(() => {});
      return sortApps(filterApps(apps, (filter ?? "all") as AppFilter)).map((a) => item(s, a));
    }),
});
