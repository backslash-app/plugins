import {
  action,
  copy,
  Icons,
  type Item,
  list,
  type ListSpec,
  meta,
  open,
  refresh,
  toast,
  updateCommandMetadata,
} from "@backslash/api";
import { cf, cfAll, guarded, token } from "../api.ts";
import {
  age,
  DEPLOY_COLORS,
  DEPLOY_LABELS,
  type Deployment,
  deploymentDashboardUrl,
  deployState,
  formatDate,
  mapDeployment,
  mapProject,
  pagesDashboardUrl,
  type PagesProject,
} from "../lib.ts";

const STAGES: Record<string, string> = {
  queued: "Queued",
  initialize: "Initializing",
  clone_repo: "Cloning",
  build: "Building",
  deploy: "Deploying",
};

function deploymentMeta(d: Deployment) {
  const state = deployState(d);
  return [
    meta.text("State", `${DEPLOY_LABELS[state]}${state === "building" ? ` · ${STAGES[d.stage] ?? d.stage}` : ""}`, {
      icon: Icons.dot,
      color: DEPLOY_COLORS[state],
    }),
    meta.tags("Environment", [{ text: d.environment, color: d.environment === "production" ? "green" : "blue" }]),
    ...(d.branch ? [meta.text("Branch", d.branch, { icon: Icons.branch })] : []),
    ...(d.commit
      ? [meta.text("Commit", `${d.commit}${d.message ? ` ${d.message}` : ""}`, { icon: Icons.commit })]
      : []),
    ...(d.url ? [meta.link("Preview", d.url.replace(/^https:\/\//, ""), d.url)] : []),
    ...(d.trigger ? [meta.text("Trigger", d.trigger.replace(/_/g, " "), { icon: Icons.bolt })] : []),
    ...(d.created ? [meta.text("Created", formatDate(d.created), { icon: Icons.calendar })] : []),
  ];
}

function retry(tok: string, p: PagesProject, d: Deployment) {
  return action("Retry Deployment", async () => {
    await cf(tok, `/accounts/${p.accountId}/pages/projects/${p.name}/deployments/${d.id}/retry`, { method: "POST" });
    await toast(`Retrying ${p.name} ${d.shortId}`, { style: "success" });
    return refresh();
  }, { icon: Icons.refresh, shortcut: "<Ctrl><Shift>r", section: "Deployment" });
}

function deploymentsView(tok: string, p: PagesProject): ListSpec {
  return list({
    title: `${p.name} · deployments`,
    placeholder: "Filter deployments by branch, commit, environment…",
    empty: { title: "No deployments", icon: Icons.rocket },
    status: (items) => `${items.length} recent deployments of ${p.name}`,
    items: ({ signal }) =>
      guarded(async () => {
        const all =
          (await cfAll<any>(tok, `/accounts/${p.accountId}/pages/projects/${p.name}/deployments`, signal, 25, 50))
            .map(mapDeployment);
        return all.map((d) => {
          const state = deployState(d);
          return {
            id: d.id,
            title: d.message ?? d.shortId,
            subtitle: [d.branch, d.commit].filter(Boolean).join(" · "),
            icon: { source: Icons.rocket, tint: DEPLOY_COLORS[state] },
            section: d.environment === "production" ? "Production" : "Preview",
            keywords: [d.shortId, d.environment, d.branch ?? "", d.commit ?? ""],
            accessories: [
              ...(d.created ? [{ text: age(d.created), tooltip: formatDate(d.created) }] : []),
              { tag: DEPLOY_LABELS[state], color: DEPLOY_COLORS[state] },
            ],
            detail: { metadata: deploymentMeta(d) },
            actions: [
              ...(d.url ? [open(d.url, "Open Deployment", { icon: Icons.globe })] : []),
              open(deploymentDashboardUrl(p, d), "Open in Dashboard", { icon: Icons.external, shortcut: "<Ctrl>o" }),
              ...(d.url ? [copy(d.url, "Copy Deployment URL", { shortcut: "<Ctrl><Shift>c", section: "Copy" })] : []),
              copy(d.id, "Copy Deployment ID", { section: "Copy" }),
              ...(state === "failure" || state === "canceled" ? [retry(tok, p, d)] : []),
            ],
          } satisfies Item;
        });
      }, signal),
  });
}

function item(tok: string, p: PagesProject): Item {
  const d = p.latest;
  const state = deployState(d);
  const color = DEPLOY_COLORS[state];
  const site = `https://${p.domains[0] ?? p.subdomain}`;
  return {
    id: `${p.accountId}/${p.name}`,
    title: p.name,
    subtitle: p.domains[0] ?? p.subdomain,
    icon: { source: Icons.rocket, tint: color },
    section: state === "failure" ? "Failed" : state === "building" || state === "queued" ? "Building" : "Projects",
    keywords: [p.subdomain, ...p.domains, p.repo ?? "", d?.branch ?? ""],
    accessories: [
      ...(d?.branch ? [{ icon: Icons.branch, text: d.branch, tooltip: "Branch" }] : []),
      ...(d?.created ? [{ text: age(d.created), tooltip: `Deployed ${formatDate(d.created)}` }] : []),
      { tag: DEPLOY_LABELS[state], color },
    ],
    detail: {
      markdown: d?.message ? `**Latest:** ${d.message}` : undefined,
      metadata: [
        ...(d ? deploymentMeta(d) : [meta.text("State", "No deployment yet", { icon: Icons.dot, color: "gray" })]),
        meta.separator(),
        meta.link("Site", site.replace(/^https:\/\//, ""), site),
        ...(p.domains.length > 1 ? [meta.tags("Domains", p.domains)] : []),
        ...(p.repo ? [meta.link("Repository", p.repo, `https://github.com/${p.repo}`)] : []),
        ...(p.productionBranch ? [meta.text("Production branch", p.productionBranch, { icon: Icons.branch })] : []),
      ],
    },
    actions: [
      open(site, "Open Site", { icon: Icons.globe }),
      action("Show Deployments", () => deploymentsView(tok, p), { icon: Icons.history, shortcut: "<Ctrl>d" }),
      open(pagesDashboardUrl(p), "Open in Dashboard", { icon: Icons.external, shortcut: "<Ctrl>o" }),
      ...(d?.url ? [open(d.url, "Open Latest Deployment", { icon: Icons.rocket, section: "Open" })] : []),
      copy(site, "Copy Site URL", { shortcut: "<Ctrl><Shift>c", section: "Copy" }),
      ...(d?.url ? [copy(d.url, "Copy Deployment URL", { section: "Copy" })] : []),
      ...(d && (state === "failure" || state === "canceled") ? [retry(tok, p, d)] : []),
      action("Reload", () => refresh(), { icon: Icons.refresh, shortcut: "<Ctrl>r" }),
    ],
  };
}

let summary = "";

export default list({
  placeholder: "Filter Pages projects…",
  empty: { title: "No Pages projects", description: "This token sees no Cloudflare Pages project", icon: Icons.rocket },
  status: () => summary,
  items: ({ preferences, signal }) =>
    guarded(async () => {
      summary = "";
      const tok = token(preferences);
      const accounts = await cfAll<{ id: string; name: string }>(tok, "/accounts", signal);
      const projects = (await Promise.all(accounts.map(async (a) =>
        (await cfAll<any>(tok, `/accounts/${a.id}/pages/projects`, signal, 10, 200)).map((p) => mapProject(p, a.id))
      ))).flat();
      const failed = projects.filter((p) =>
        deployState(p.latest) === "failure"
      ).length;
      summary = `${projects.length} project${projects.length === 1 ? "" : "s"}${failed ? ` · ${failed} failed` : ""}`;
      await updateCommandMetadata({ subtitle: failed ? `${failed} failed` : null }).catch(() => {});
      const order = ["Failed", "Building", "Projects"];
      return projects.map((p) =>
        item(tok, p)
      ).sort((a, b) => order.indexOf(a.section!) - order.indexOf(b.section!) || a.title.localeCompare(b.title));
    }, signal),
});
