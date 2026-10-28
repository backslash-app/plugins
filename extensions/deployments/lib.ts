// Vercel deployments and Netlify deploys in one shape, and how they look in the launcher.

import {
  type Accessory,
  type Action,
  action,
  type Color,
  type Context,
  copy,
  detail,
  type DetailSpec,
  Icons,
  type Item,
  list,
  type ListSpec,
  meta,
  type Metadata,
  open,
  refresh,
  type Stat,
  toast,
} from "@backslash/api";
import { guarded, isProblem, NAMES, netlify, type Provider, vercel } from "./api.ts";

// ---------------------------------------------------------------------------
// Shapes

export type State = "ready" | "building" | "queued" | "error" | "canceled";

export interface Deployment {
  provider: Provider;
  id: string;
  project: string;
  projectId: string;
  state: State;
  /** The provider's own word for it ("READY", "processing"…). */
  rawState: string;
  /** The deployed site. */
  url?: string;
  /** The deployment's page in the dashboard. */
  dashboardUrl: string;
  createdAt: number;
  /** Seconds. */
  duration?: number;
  production: boolean;
  environment: string;
  branch?: string;
  commitMessage?: string;
  commitSha?: string;
  commitUrl?: string;
  author?: string;
  authorAvatar?: string;
  error?: string;
  source?: string;
}

/** `GET /v6/deployments` entries. */
export interface VercelDeployment {
  uid: string;
  name: string;
  url?: string | null;
  created: number;
  createdAt?: number;
  buildingAt?: number;
  ready?: number;
  state?: string;
  readyState?: string;
  target?: "production" | "staging" | null;
  source?: string;
  projectId?: string;
  inspectorUrl?: string | null;
  errorMessage?: string | null;
  creator?: { uid: string; username?: string; email?: string; githubLogin?: string };
  meta?: Record<string, string | undefined>;
}

/** `GET /api/v1/sites/{id}/deploys` entries. */
export interface NetlifyDeploy {
  id: string;
  site_id: string;
  name: string;
  state: string;
  error_message?: string | null;
  created_at: string;
  updated_at?: string;
  published_at?: string | null;
  deploy_time?: number | null;
  branch?: string | null;
  commit_ref?: string | null;
  commit_url?: string | null;
  title?: string | null;
  committer?: string | null;
  context?: string | null;
  deploy_ssl_url?: string | null;
  ssl_url?: string | null;
  admin_url?: string | null;
  review_url?: string | null;
  framework?: string | null;
}

export interface NetlifySite {
  id: string;
  name: string;
  ssl_url?: string | null;
  url?: string | null;
  admin_url: string;
  updated_at: string;
  screenshot_url?: string | null;
  build_settings?: { repo_url?: string | null; repo_branch?: string | null } | null;
  published_deploy?: NetlifyDeploy | null;
}

export interface VercelProject {
  id: string;
  name: string;
  framework?: string | null;
  updatedAt: number;
  link?: { type?: string; org?: string; repo?: string; productionBranch?: string } | null;
  latestDeployments?: (Partial<VercelDeployment> & { id?: string })[];
  targets?: { production?: { id?: string; url?: string; alias?: string[]; readyState?: string; createdAt?: number } };
}

// ---------------------------------------------------------------------------
// Mapping

export function vercelState(state: string | undefined): State {
  switch ((state ?? "").toUpperCase()) {
    case "READY":
      return "ready";
    case "ERROR":
      return "error";
    case "CANCELED":
      return "canceled";
    case "QUEUED":
    case "INITIALIZING":
      return "queued";
    default:
      return "building";
  }
}

export function netlifyState(deploy: Pick<NetlifyDeploy, "state" | "error_message">): State {
  switch (deploy.state) {
    case "ready":
      return "ready";
    case "error":
    case "rejected":
      return /cancel|skipped/i.test(deploy.error_message ?? "") ? "canceled" : "error";
    case "new":
    case "enqueued":
    case "pending_review":
      return "queued";
    case "skipped":
    case "canceled":
      return "canceled";
    default:
      return "building";
  }
}

/** The commit behind a Vercel deployment, whatever git host it came from. */
function vercelCommit(m: Record<string, string | undefined>) {
  for (const host of ["github", "gitlab", "bitbucket"]) {
    const sha = m[`${host}CommitSha`];
    if (!sha && !m[`${host}CommitMessage`]) continue;
    let commitUrl: string | undefined;
    if (host === "github" && m.githubOrg && m.githubRepo && sha) {
      commitUrl = `https://github.com/${m.githubOrg}/${m.githubRepo}/commit/${sha}`;
    }
    return {
      commitMessage: m[`${host}CommitMessage`],
      branch: m[`${host}CommitRef`],
      commitSha: sha,
      commitUrl,
      author: m[`${host}CommitAuthorName`] ?? m[`${host}CommitAuthorLogin`],
    };
  }
  return { branch: m.branchAlias };
}

export function fromVercel(d: VercelDeployment): Deployment {
  const commit = vercelCommit(d.meta ?? {});
  const duration = d.ready && d.buildingAt && d.ready > d.buildingAt ? (d.ready - d.buildingAt) / 1000 : undefined;
  const raw = d.state ?? d.readyState ?? "";
  return {
    provider: "vercel",
    id: d.uid,
    project: d.name,
    projectId: d.projectId ?? d.name,
    state: vercelState(raw),
    rawState: raw,
    url: d.url ? `https://${d.url}` : undefined,
    dashboardUrl: d.inspectorUrl ?? `https://vercel.com/deployments/${d.url ?? d.uid}`,
    createdAt: d.createdAt ?? d.created,
    duration,
    production: d.target === "production",
    environment: d.target === "production" ? "Production" : d.target === "staging" ? "Staging" : "Preview",
    ...commit,
    author: commit.author ?? d.creator?.username,
    authorAvatar: d.creator?.uid ? `https://vercel.com/api/www/avatar/${d.creator.uid}?s=64` : undefined,
    error: d.errorMessage ?? undefined,
    source: d.source,
  };
}

const NETLIFY_CONTEXTS: Record<string, string> = {
  production: "Production",
  "deploy-preview": "Deploy Preview",
  "branch-deploy": "Branch Deploy",
  dev: "Dev",
};

export function fromNetlify(d: NetlifyDeploy): Deployment {
  const admin = d.admin_url ?? `https://app.netlify.com/sites/${d.name}`;
  const production = d.context === "production";
  return {
    provider: "netlify",
    id: d.id,
    project: d.name,
    projectId: d.site_id,
    state: netlifyState(d),
    rawState: d.state,
    url: (production && d.state === "ready" ? d.ssl_url : d.deploy_ssl_url) ?? d.deploy_ssl_url ?? undefined,
    dashboardUrl: `${admin}/deploys/${d.id}`,
    createdAt: Date.parse(d.created_at),
    duration: d.deploy_time ?? undefined,
    production,
    environment: NETLIFY_CONTEXTS[d.context ?? ""] ?? (d.context ?? "Deploy"),
    branch: d.branch ?? undefined,
    commitMessage: d.title ?? undefined,
    commitSha: d.commit_ref ?? undefined,
    commitUrl: d.commit_url ?? undefined,
    author: d.committer ?? undefined,
    error: d.state === "error" ? d.error_message ?? undefined : undefined,
  };
}

// ---------------------------------------------------------------------------
// Formatting

export function stateLook(state: State): { icon: string; tint: Color; text: string } {
  switch (state) {
    case "ready":
      return { icon: Icons.done, tint: "green", text: "Ready" };
    case "building":
      return { icon: Icons.inProgress, tint: "orange", text: "Building" };
    case "queued":
      return { icon: Icons.clock, tint: "gray", text: "Queued" };
    case "error":
      return { icon: Icons.canceled, tint: "red", text: "Error" };
    case "canceled":
      return { icon: Icons.canceled, tint: "gray", text: "Canceled" };
  }
}

export const inProgress = (d: Deployment) => d.state === "building" || d.state === "queued";

/** 75 → "1m 15s". */
export function duration(seconds: number | undefined): string {
  if (seconds == null || !Number.isFinite(seconds)) return "";
  const s = Math.round(seconds);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}

/** "just now", "5m", "3h", "2d", "25 Oct". */
export function since(ms: number, now = Date.now()): string {
  const s = Math.max(0, (now - ms) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h`;
  if (s < 7 * 86_400) return `${Math.floor(s / 86_400)}d`;
  return new Date(ms).toLocaleDateString("en", { day: "numeric", month: "short" });
}

/** "In progress", then "Today", "Yesterday", "Monday 26 Oct". */
export function daySection(d: Deployment, now = new Date()): string {
  if (inProgress(d)) return "In progress";
  const day = (t: Date) => new Date(t.getFullYear(), t.getMonth(), t.getDate()).getTime();
  const diff = Math.round((day(now) - day(new Date(d.createdAt))) / 86_400_000);
  if (diff <= 0) return "Today";
  if (diff === 1) return "Yesterday";
  return new Date(d.createdAt).toLocaleDateString("en", { weekday: "long", day: "numeric", month: "short" });
}

const host = (url: string | undefined) => url?.replace(/^https?:\/\//, "").replace(/\/$/, "");

/** In progress first, then newest first. */
export function sortDeployments(all: Deployment[]): Deployment[] {
  return [...all].sort((a, b) => Number(inProgress(b)) - Number(inProgress(a)) || b.createdAt - a.createdAt);
}

// ---------------------------------------------------------------------------
// Items

export function deploymentMetadata(d: Deployment): Metadata[] {
  const look = stateLook(d.state);
  const lines: Metadata[] = [
    meta.text("Status", look.text, { icon: look.icon, color: look.tint }),
    meta.tags("Environment", [{ text: d.environment, color: d.production ? "blue" : "gray" }]),
    meta.text("Project", d.project, { icon: Icons.project }),
    meta.text("Provider", NAMES[d.provider], { icon: Icons.cloud }),
  ];
  if (d.url) lines.push(meta.link("URL", host(d.url)!, d.url));
  if (d.branch) lines.push(meta.text("Branch", d.branch, { icon: Icons.branch }));
  if (d.commitSha) {
    const short = d.commitSha.slice(0, 7);
    lines.push(
      d.commitUrl ? meta.link("Commit", short, d.commitUrl) : meta.text("Commit", short, { icon: Icons.commit }),
    );
  }
  if (d.author) lines.push(meta.person("Author", d.author, d.authorAvatar));
  if (d.error) lines.push(meta.text("Error", d.error, { icon: Icons.alert, color: "red" }));
  lines.push(meta.separator());
  lines.push(
    meta.text("Created", new Date(d.createdAt).toLocaleString("en", { dateStyle: "medium", timeStyle: "short" })),
  );
  if (d.duration) lines.push(meta.text("Build time", duration(d.duration), { icon: Icons.timer }));
  return lines;
}

function stats(d: Deployment): Stat[] {
  const look = stateLook(d.state);
  return [
    { label: "status", value: look.text, color: look.tint },
    { label: "build", value: duration(d.duration) || (inProgress(d) ? "…" : "—") },
    { label: "created", value: since(d.createdAt) },
  ];
}

export function deploymentActions(d: Deployment, ctx: Context, page = false): Action[] {
  const prefs = ctx.preferences;
  const actions: Action[] = [];
  if (d.url && d.state === "ready") actions.push(open(d.url, "Open Deployment"));
  actions.push(open(d.dashboardUrl, `Open in ${NAMES[d.provider]}`, { icon: Icons.external }));
  if (d.url && d.state !== "ready") actions.push(open(d.url, "Open Deployment URL", { section: "Open" }));
  if (d.provider === "vercel" && !page) {
    actions.push(action("Show Build Logs", () => vercelLogs(d, ctx), { icon: Icons.terminal, shortcut: "<Ctrl>l" }));
  }
  if (d.commitUrl) actions.push(open(d.commitUrl, "Open Commit", { icon: Icons.commit, section: "Open" }));

  if (d.provider === "vercel" && !inProgress(d)) {
    actions.push(action("Redeploy", async () => {
      const created = await vercel<{ id: string; url: string }>(prefs, "/v13/deployments?forceNew=1", {
        method: "POST",
        body: { name: d.project, deploymentId: d.id, ...(d.production ? { target: "production" } : {}) },
      });
      await toast(`Redeploying ${d.project}`, { style: "success", message: created?.url });
      return refresh();
    }, {
      icon: Icons.refresh,
      shortcut: "<Ctrl>r",
      confirm: `Redeploy ${d.project}${d.production ? " to production" : ""}?`,
      section: "Deployment",
    }));
  }
  if (d.provider === "netlify" && d.production && !inProgress(d)) {
    const retry = (clearCache: boolean) => async () => {
      await netlify(prefs, `/sites/${d.projectId}/builds`, { method: "POST", body: { clear_cache: clearCache } });
      await toast(`Deploying ${d.project}`, { style: "success" });
      return refresh();
    };
    actions.push(
      action("Retry Deploy", retry(false), {
        icon: Icons.refresh,
        shortcut: "<Ctrl>r",
        confirm: `Deploy ${d.project} again from its production branch?`,
        section: "Deployment",
      }),
      action("Clear Cache and Retry", retry(true), {
        icon: Icons.refresh,
        confirm: `Clear the build cache and deploy ${d.project}?`,
        section: "Deployment",
      }),
    );
  }
  if (inProgress(d)) {
    actions.push(action("Cancel Deployment", async () => {
      if (d.provider === "vercel") await vercel(prefs, `/v12/deployments/${d.id}/cancel`, { method: "PATCH" });
      else await netlify(prefs, `/deploys/${d.id}/cancel`, { method: "POST" });
      await toast(`Canceled ${d.project}`, { style: "success" });
      return refresh();
    }, {
      icon: Icons.stop,
      destructive: true,
      confirm: `Cancel this deployment of ${d.project}?`,
      section: "Deployment",
    }));
  }
  if (d.url) actions.push(copy(d.url, "Copy URL", { shortcut: "<Ctrl><Shift>c", section: "Copy" }));
  actions.push(copy(d.dashboardUrl, "Copy Dashboard URL", { section: "Copy" }));
  if (d.commitSha) actions.push(copy(d.commitSha, "Copy Commit SHA", { icon: Icons.commit, section: "Copy" }));
  if (d.branch) actions.push(copy(d.branch, "Copy Branch", { icon: Icons.branch, section: "Copy" }));
  return actions;
}

export function deploymentItem(d: Deployment, ctx: Context, options: { section?: string } = {}): Item {
  const look = stateLook(d.state);
  const accessories: Accessory[] = [
    { tag: d.production ? "Production" : d.environment, color: d.production ? "blue" : "gray" },
  ];
  if (d.branch) accessories.push({ icon: Icons.branch, text: d.branch, tooltip: "Branch" });
  if (d.duration) accessories.push({ icon: Icons.timer, text: duration(d.duration), tooltip: "Build time" });
  if (d.author) accessories.push({ avatar: d.authorAvatar ?? d.author, tooltip: d.author });
  accessories.push({ text: since(d.createdAt), tooltip: new Date(d.createdAt).toLocaleString("en") });
  return {
    id: `${d.provider}:${d.id}`,
    title: d.project,
    subtitle: d.commitMessage?.split("\n")[0] ?? host(d.url) ?? look.text,
    icon: { source: look.icon, tint: look.tint },
    section: options.section,
    keywords: [
      NAMES[d.provider],
      d.branch ?? "",
      d.author ?? "",
      d.environment,
      look.text,
      d.commitSha?.slice(0, 7) ?? "",
    ]
      .filter(Boolean),
    accessories,
    detail: {
      stats: stats(d),
      markdown: [d.commitMessage ? `**${d.commitMessage.trim()}**` : "", d.error ? `\`\`\`\n${d.error}\n\`\`\`` : ""]
        .filter(Boolean).join("\n\n") || undefined,
      metadata: deploymentMetadata(d),
    },
    actions: deploymentActions(d, ctx),
  };
}

// ---------------------------------------------------------------------------
// Vercel build logs

interface VercelEvent {
  type: string;
  created: number;
  text?: string;
  payload?: { text?: string };
}

/** Terminal colors in build output. */
const ANSI = new RegExp(String.fromCharCode(27) + "\\[[0-9;]*m", "g");

/** Build output as plain lines, the commands prefixed with `$`. */
export function logLines(events: VercelEvent[]): string[] {
  return events
    .filter((e) => ["stdout", "stderr", "command"].includes(e.type))
    .map((e) => {
      const text = (e.payload?.text ?? e.text ?? "").replace(ANSI, "").trimEnd();
      return e.type === "command" ? `$ ${text}` : text;
    });
}

export async function vercelLogs(d: Deployment, ctx: Context): Promise<DetailSpec> {
  const events = await vercel<VercelEvent[]>(ctx.preferences, `/v3/deployments/${d.id}/events?builds=1&limit=-1`);
  const lines = logLines(events ?? []);
  const tail = lines.slice(-300);
  const look = stateLook(d.state);
  return detail({
    title: `${d.project} build logs`,
    markdown: lines.length
      ? `${lines.length > tail.length ? `_Last ${tail.length} of ${lines.length} lines._\n\n` : ""}\`\`\`\n${
        tail.join("\n")
      }\n\`\`\``
      : "_No build output yet._",
    stats: stats(d),
    metadata: deploymentMetadata(d),
    status: `${look.text} · ${d.environment}`,
    actions: deploymentActions(d, ctx, true),
  });
}

// ---------------------------------------------------------------------------
// Loading

/** Recent Vercel deployments (all projects, or one). */
export async function loadVercel(ctx: Context, projectId?: string, limit = 40): Promise<Deployment[]> {
  const q = new URLSearchParams({ limit: String(limit) });
  if (projectId) q.set("projectId", projectId);
  const data = await vercel<{ deployments: VercelDeployment[] }>(ctx.preferences, `/v6/deployments?${q}`, {
    signal: ctx.signal,
  });
  return data.deployments.map(fromVercel);
}

/** Recent Netlify deploys: those of the most recently updated sites (Netlify has no account-wide list). */
export async function loadNetlify(ctx: Context, siteId?: string): Promise<Deployment[]> {
  const sites = siteId
    ? [{ id: siteId }]
    : await netlify<NetlifySite[]>(ctx.preferences, "/sites?filter=all&sort_by=updated_at&per_page=8", {
      signal: ctx.signal,
    });
  const perSite = siteId ? 30 : 8;
  const lists = await Promise.all(
    sites.map((s) =>
      netlify<NetlifyDeploy[]>(ctx.preferences, `/sites/${s.id}/deploys?per_page=${perSite}`, { signal: ctx.signal })
    ),
  );
  return lists.flat().map(fromNetlify);
}

/** The deployments of one project or site. */
export function projectDeployments(provider: Provider, id: string, name: string, ctx: Context): ListSpec {
  return list({
    title: `${name} deployments`,
    placeholder: `Filter deployments of ${name} by branch, commit, author, status…`,
    empty: { title: "No deployments yet", icon: Icons.rocket },
    status: (items) => `${items.filter((i) => !isProblem(i)).length} deployments · ${NAMES[provider]}`,
    items: (c) =>
      guarded(provider, async () => {
        const all = provider === "vercel" ? await loadVercel(c, id, 40) : await loadNetlify(c, id);
        return sortDeployments(all).map((d) => deploymentItem(d, ctx, { section: daySection(d) }));
      }),
  });
}

// ---------------------------------------------------------------------------
// Projects and sites

export function vercelItem(p: VercelProject, ctx: Context): Item {
  const prod = p.targets?.production;
  const latest = p.latestDeployments?.[0];
  const look = stateLook(vercelState(prod?.readyState ?? latest?.readyState ?? latest?.state ?? "READY"));
  const domain = prod?.alias?.[0] ?? `${p.name}.vercel.app`;
  const repo = p.link?.org && p.link.repo ? `${p.link.org}/${p.link.repo}` : undefined;
  const accessories: Accessory[] = [];
  if (p.framework) accessories.push({ tag: p.framework });
  accessories.push({ text: since(p.updatedAt), tooltip: "Updated" });
  return {
    id: `vercel:${p.id}`,
    title: p.name,
    subtitle: domain,
    icon: { source: look.icon, tint: look.tint },
    section: "Vercel",
    keywords: ["vercel", repo ?? "", p.framework ?? ""].filter(Boolean),
    accessories,
    detail: {
      metadata: [
        meta.text("Production", look.text, { icon: look.icon, color: look.tint }),
        meta.link("Domain", domain, `https://${domain}`),
        ...(prod?.alias && prod.alias.length > 1 ? [meta.tags("Aliases", prod.alias.slice(1, 6))] : []),
        ...(p.framework ? [meta.text("Framework", p.framework, { icon: Icons.code })] : []),
        ...(repo ? [meta.text("Repository", repo, { icon: Icons.repository })] : []),
        ...(p.link?.productionBranch
          ? [meta.text("Production branch", p.link.productionBranch, { icon: Icons.branch })]
          : []),
        meta.separator(),
        ...(prod?.createdAt ? [meta.text("Last production deploy", since(prod.createdAt))] : []),
        meta.text("Updated", since(p.updatedAt)),
      ],
    },
    actions: [
      action("Show Deployments", () => projectDeployments("vercel", p.id, p.name, ctx), { icon: Icons.rocket }),
      open(`https://${domain}`, "Open Production Site"),
      open(`https://vercel.com/~/${p.name}`, "Open in Vercel", { icon: Icons.external }),
      ...(repo && p.link?.type === "github"
        ? [open(`https://github.com/${repo}`, "Open Repository", { icon: Icons.repository, section: "Open" })]
        : []),
      copy(`https://${domain}`, "Copy Production URL", { shortcut: "<Ctrl><Shift>c", section: "Copy" }),
    ],
  };
}

export function netlifyItem(s: NetlifySite, ctx: Context): Item {
  const deploy = s.published_deploy;
  const look = stateLook(deploy ? netlifyState(deploy) : "ready");
  const url = s.ssl_url ?? s.url ?? undefined;
  const repo = s.build_settings?.repo_url?.replace(/^https?:\/\/(www\.)?/, "");
  return {
    id: `netlify:${s.id}`,
    title: s.name,
    subtitle: url?.replace(/^https?:\/\//, ""),
    icon: { source: look.icon, tint: look.tint },
    section: "Netlify",
    keywords: ["netlify", repo ?? ""].filter(Boolean),
    accessories: [
      ...(s.build_settings?.repo_branch ? [{ icon: Icons.branch, text: s.build_settings.repo_branch }] : []),
      { text: since(Date.parse(s.updated_at)), tooltip: "Updated" },
    ],
    detail: {
      metadata: [
        meta.text("Published", deploy ? look.text : "Never", { icon: look.icon, color: look.tint }),
        ...(url ? [meta.link("URL", url.replace(/^https?:\/\//, ""), url)] : []),
        ...(repo ? [meta.text("Repository", repo, { icon: Icons.repository })] : []),
        ...(s.build_settings?.repo_branch
          ? [meta.text("Production branch", s.build_settings.repo_branch, { icon: Icons.branch })]
          : []),
        ...(deploy?.title ? [meta.text("Last commit", deploy.title.split("\n")[0], { icon: Icons.commit })] : []),
        meta.separator(),
        ...(deploy?.published_at ? [meta.text("Published", since(Date.parse(deploy.published_at)))] : []),
        meta.text("Updated", since(Date.parse(s.updated_at))),
      ],
    },
    actions: [
      action("Show Deploys", () => projectDeployments("netlify", s.id, s.name, ctx), { icon: Icons.rocket }),
      ...(url ? [open(url, "Open Site")] : []),
      open(s.admin_url, "Open in Netlify", { icon: Icons.external }),
      action("Trigger Deploy", async () => {
        await netlify(ctx.preferences, `/sites/${s.id}/builds`, { method: "POST", body: {} });
        await toast(`Deploying ${s.name}`, { style: "success" });
        return refresh();
      }, { icon: Icons.rocket, confirm: `Deploy ${s.name} from its production branch?`, section: "Site" }),
      ...(url ? [copy(url, "Copy URL", { shortcut: "<Ctrl><Shift>c", section: "Copy" })] : []),
    ],
  };
}
