import {
  type Action,
  action,
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
  toast,
  updateCommandMetadata,
} from "@backslash/api";
import {
  errorRow,
  fly,
  FlyMissing,
  flyMissingItem,
  flyProgram,
  flySignInItem,
  inTerminal,
  type Prefs,
  railway,
  RailwayAuthError,
  railwaySetupItem,
  railwayToken,
} from "../api.ts";
import {
  ago,
  DEPLOYMENTS_QUERY,
  type FlyApp,
  flyDashboard,
  flyHealth,
  type FlyStatus,
  flyUrl,
  formatLogs,
  HEALTH_COLORS,
  isFlySignedOut,
  type LogLine,
  LOGS_QUERY,
  type MachineSummary,
  parseDeployments,
  parseFlyApps,
  parseFlyStatus,
  parseRailwayProjects,
  parseReleases,
  PROJECTS_QUERY,
  railwayDashboard,
  type RailwayDeployment,
  railwayHealth,
  type RailwayService,
  REDEPLOY_MUTATION,
  RESTART_MUTATION,
  statusLabel,
  summarizeMachines,
} from "../lib.ts";

const fence = (text: string) => `\`\`\`\n${text.replace(/```/g, "ʼʼʼ") || "(empty)"}\n\`\`\``;

// ---------------------------------------------------------------------------
// Fly.io

function releasesView(app: FlyApp): ListSpec {
  return list({
    title: `${app.name} · releases`,
    placeholder: `Filter releases of ${app.name}…`,
    status: (items) => `${items.length} release${items.length === 1 ? "" : "s"}`,
    async items({ signal }) {
      const releases = parseReleases(await fly(["releases", "-a", app.name, "--json"], signal));
      return releases.map((r, i): Item => {
        const failed = /fail|cancel/.test(r.status);
        const color = r.inProgress ? "yellow" : failed ? "red" : i === 0 ? "green" : "gray";
        return {
          id: String(r.version),
          title: `v${r.version}`,
          subtitle: r.description || r.strategy,
          icon: { source: i === 0 ? Icons.rocket : Icons.history, tint: color },
          keywords: [r.status, r.user ?? "", r.image ?? ""],
          accessories: [
            ...(r.status ? [{ tag: statusLabel(r.status), color: color as "red" }] : []),
            ...(r.user ? [{ avatar: r.user, tooltip: r.user }] : []),
            { text: ago(r.created), tooltip: r.created?.toLocaleString("en-GB") },
          ],
          detail: {
            metadata: [
              meta.text("Status", statusLabel(r.status), { icon: Icons.dot, color }),
              ...(r.strategy ? [meta.text("Strategy", r.strategy)] : []),
              ...(r.user ? [meta.person("By", r.user)] : []),
              ...(r.image ? [meta.text("Image", r.image, { icon: Icons.box })] : []),
              ...(r.created ? [meta.text("Created", r.created.toLocaleString("en-GB"), { icon: Icons.calendar })] : []),
            ],
          },
          actions: [
            open(flyDashboard(app.name, "/releases"), "Open Releases on Fly.io"),
            ...(r.image ? [copy(r.image, "Copy Image Reference", { section: "Copy" })] : []),
          ],
        };
      });
    },
  });
}

function flyItem(app: FlyApp, status: FlyStatus | undefined, prefs: Prefs, program: string): Item {
  const s: MachineSummary | undefined = status ? summarizeMachines(status.machines) : undefined;
  const health = flyHealth(app, s);
  const color = HEALTH_COLORS[health];
  const url = flyUrl(app);
  const metadata: Metadata[] = [
    meta.text("Status", statusLabel(app.status), { icon: Icons.dot, color }),
    meta.text("Organization", app.org, { icon: Icons.home }),
    meta.link("URL", url.replace("https://", ""), url),
    ...(s?.regions.length ? [meta.tags("Regions", s.regions)] : []),
    ...(status?.version ? [meta.text("Release", `v${status.version}`, { icon: Icons.tag })] : []),
    ...(status?.machines.length
      ? [
        meta.separator(),
        ...status.machines.slice(0, 10).map((m) =>
          meta.text(
            `${m.processGroup ?? "machine"} ${m.id.slice(0, 8)}`,
            `${m.state} · ${m.region}${m.checks.some((c) => c.status === "critical") ? " · check failing" : ""}`,
            {
              icon: Icons.server,
              color: m.state === "failed"
                ? "red"
                : m.checks.some((c) => c.status === "critical")
                ? "orange"
                : m.state === "started"
                ? "green"
                : "gray",
            },
          )
        ),
      ]
      : []),
    ...(status?.machines[0]?.image ? [meta.text("Image", status.machines[0].image, { icon: Icons.box })] : []),
  ];
  const actions: Action[] = [
    open(url, "Open App", { icon: Icons.globe }),
    open(flyDashboard(app.name), "Open Dashboard", { shortcut: "<Ctrl>o" }),
    inTerminal("Logs in Terminal", [program, "logs", "-a", app.name], prefs, { shortcut: "<Ctrl>l" }),
    inTerminal("SSH Console", [program, "ssh", "console", "-a", app.name], prefs, { shortcut: "<Ctrl>s" }),
    action("Deploy History", () => releasesView(app), { icon: Icons.history, shortcut: "<Ctrl>h", section: "App" }),
    open(flyDashboard(app.name, "/monitoring"), "Open Monitoring", { icon: Icons.activity, section: "App" }),
    copy(url, "Copy URL", { shortcut: "<Ctrl><Shift>c", section: "Copy" }),
    copy(app.name, "Copy App Name", { shortcut: "<Ctrl>period", section: "Copy" }),
    action("Restart App", async () => {
      await fly(["apps", "restart", app.name], undefined, 120);
      await toast(`Restarted ${app.name}`, { style: "success" });
      return refresh();
    }, {
      icon: Icons.refresh,
      destructive: true,
      shortcut: "<Ctrl><Shift>r",
      confirm: `Restart every machine of ${app.name}? Requests fail while they start.`,
      section: "Danger",
    }),
  ];
  return {
    id: `fly:${app.name}`,
    title: app.name,
    subtitle: app.hostname,
    icon: { source: Icons.rocket, tint: color },
    section: `Fly.io · ${app.org}`,
    keywords: ["fly", app.org, app.status, ...(s?.regions ?? [])],
    accessories: [
      ...(health !== "ok"
        ? [{ tag: health === "failed" && s?.failing ? "Failing" : statusLabel(app.status), color }]
        : []),
      ...(s?.regions.length ? [{ icon: Icons.globe, text: s.regions.slice(0, 3).join(" "), tooltip: "Regions" }] : []),
      ...(s ? [{ icon: Icons.server, text: `${s.started}/${s.total}`, tooltip: "Machines started" }] : []),
    ],
    detail: {
      stats: s
        ? [
          { label: "machines", value: `${s.started}/${s.total}`, color: s.failing ? "red" : undefined },
          { label: "regions", value: s.regions.length },
          ...(status?.version ? [{ label: "release", value: `v${status.version}` }] : []),
        ]
        : [],
      metadata,
    },
    actions,
  };
}

async function loadFly(prefs: Prefs, signal: AbortSignal): Promise<{ apps: FlyApp[]; program?: string; rows: Item[] }> {
  let program: string;
  try {
    program = await flyProgram();
  } catch (e) {
    if (e instanceof FlyMissing) return { apps: [], rows: [await flyMissingItem()] };
    throw e;
  }
  try {
    return { apps: parseFlyApps(await fly(["apps", "list", "--json"], signal)), program, rows: [] };
  } catch (e) {
    if (signal.aborted) throw e;
    const message = e instanceof Error ? e.message : String(e);
    return { apps: [], program, rows: [isFlySignedOut(message) ? flySignInItem(prefs, program) : errorRow("fly", e)] };
  }
}

/** Machines of each app, a few at a time. */
async function flyStatuses(apps: FlyApp[], signal: AbortSignal): Promise<Map<string, FlyStatus>> {
  const out = new Map<string, FlyStatus>();
  const queue = apps.filter((a) => a.deployed || a.status !== "pending").slice(0, 30);
  const worker = async () => {
    for (let app = queue.shift(); app; app = queue.shift()) {
      try {
        out.set(app.name, parseFlyStatus(await fly(["status", "-a", app.name, "--json"], signal)));
      } catch {
        // The row stays without machine details.
      }
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  return out;
}

// ---------------------------------------------------------------------------
// Railway

const DEPLOY_COLOR = (status?: string) => HEALTH_COLORS[railwayHealth(status)];

async function railwayLogsView(token: string, s: RailwayService, d: RailwayDeployment): Promise<DetailSpec> {
  const data = await railway<{ deploymentLogs: LogLine[] }>(token, LOGS_QUERY, { deploymentId: d.id });
  const lines = data.deploymentLogs ?? [];
  const text = formatLogs(lines);
  return detail({
    title: `${s.serviceName} · logs`,
    markdown: lines.length ? fence(text) : "_No log lines for this deployment._",
    status: `Deployment ${d.id.slice(0, 8)} · last ${lines.length} lines · times in UTC`,
    metadata: deploymentMetadata(s, d),
    actions: [
      action("Reload", () => railwayLogsView(token, s, d), { icon: Icons.refresh, shortcut: "<Ctrl>r" }),
      copy(text, "Copy Logs", { shortcut: "<Ctrl><Shift>c" }),
      open(`${railwayDashboard(s)}&id=${d.id}`, "Open in Railway", { shortcut: "<Ctrl>o" }),
    ],
  });
}

function deploymentMetadata(s: RailwayService, d?: RailwayDeployment): Metadata[] {
  return [
    ...(d
      ? [
        meta.text("Deploy", statusLabel(d.status), { icon: Icons.dot, color: DEPLOY_COLOR(d.status) }),
        ...(d.commitMessage ? [meta.text("Commit", d.commitMessage, { icon: Icons.commit })] : []),
        ...(d.branch ? [meta.text("Branch", d.branch, { icon: Icons.branch })] : []),
        ...(d.author ? [meta.person("Author", d.author)] : []),
        ...(d.created ? [meta.text("Deployed", d.created.toLocaleString("en-GB"), { icon: Icons.calendar })] : []),
      ]
      : [meta.text("Deploy", "Never deployed", { icon: Icons.dot, color: "gray" })]),
    meta.separator(),
    meta.text("Project", s.projectName, { icon: Icons.project }),
    meta.text("Environment", s.environmentName, { icon: Icons.layers }),
    ...s.domains.slice(0, 4).map((x) => meta.link("Domain", x, `https://${x}`)),
  ];
}

function railwayHistoryView(token: string, s: RailwayService): ListSpec {
  return list({
    title: `${s.serviceName} · deploys`,
    placeholder: `Filter deploys of ${s.serviceName}…`,
    status: (items) => `${items.length} deploy${items.length === 1 ? "" : "s"} · ${s.environmentName}`,
    async items({ signal }) {
      const data = await railway<unknown>(token, DEPLOYMENTS_QUERY, {
        serviceId: s.serviceId,
        environmentId: s.environmentId,
      }, signal);
      return parseDeployments(data).map((d, i): Item => ({
        id: d.id,
        title: d.commitMessage ?? `Deploy ${d.id.slice(0, 8)}`,
        subtitle: d.commitHash?.slice(0, 7),
        icon: { source: i === 0 ? Icons.rocket : Icons.history, tint: DEPLOY_COLOR(d.status) },
        keywords: [d.status, d.branch ?? "", d.author ?? ""],
        accessories: [
          { tag: statusLabel(d.status), color: DEPLOY_COLOR(d.status) },
          ...(d.branch ? [{ icon: Icons.branch, text: d.branch }] : []),
          { text: ago(d.created), tooltip: d.created?.toLocaleString("en-GB") },
        ],
        detail: { metadata: deploymentMetadata(s, d) },
        actions: [
          action("Show Logs", () => railwayLogsView(token, s, d), { icon: Icons.text }),
          open(`${railwayDashboard(s)}&id=${d.id}`, "Open in Railway"),
          action("Redeploy This Version", async () => {
            await railway(token, REDEPLOY_MUTATION, { id: d.id });
            await toast(`Redeploying ${s.serviceName}`, { style: "success", message: d.commitMessage });
            return refresh();
          }, {
            icon: Icons.rocket,
            confirm: `Redeploy ${s.serviceName} (${s.environmentName}) from this deploy?`,
            section: "Deploy",
          }),
          copy(d.id, "Copy Deployment ID", { section: "Copy" }),
        ],
      }));
    },
  });
}

function railwayItem(token: string, s: RailwayService): Item {
  const d = s.deployment;
  const health = railwayHealth(d?.status);
  const color = HEALTH_COLORS[health];
  const url = s.domains[0] ? `https://${s.domains[0]}` : d?.url;
  const actions: Action[] = [
    ...(url ? [open(url, "Open App", { icon: Icons.globe })] : []),
    open(railwayDashboard(s), "Open in Railway", { shortcut: "<Ctrl>o" }),
    ...(d ? [action("Show Logs", () => railwayLogsView(token, s, d), { icon: Icons.text, shortcut: "<Ctrl>l" })] : []),
    action("Deploy History", () => railwayHistoryView(token, s), {
      icon: Icons.history,
      shortcut: "<Ctrl>h",
      section: "Service",
    }),
    ...(url ? [copy(url, "Copy URL", { shortcut: "<Ctrl><Shift>c", section: "Copy" })] : []),
    copy(s.serviceId, "Copy Service ID", { section: "Copy" }),
    ...(d
      ? [
        action("Redeploy", async () => {
          await railway(token, REDEPLOY_MUTATION, { id: d.id });
          await toast(`Redeploying ${s.serviceName}`, { style: "success", message: s.environmentName });
          return refresh();
        }, {
          icon: Icons.rocket,
          confirm: `Redeploy ${s.serviceName} in ${s.environmentName}?`,
          section: "Danger",
        }),
        action("Restart", async () => {
          await railway(token, RESTART_MUTATION, { id: d.id });
          await toast(`Restarting ${s.serviceName}`, { style: "success", message: s.environmentName });
          return refresh();
        }, {
          icon: Icons.refresh,
          destructive: true,
          shortcut: "<Ctrl><Shift>r",
          confirm: `Restart ${s.serviceName} in ${s.environmentName}? It is down while it starts.`,
          section: "Danger",
        }),
      ]
      : []),
  ];
  return {
    id: `railway:${s.serviceId}:${s.environmentId}`,
    title: s.serviceName,
    subtitle: [s.environmentName, s.domains[0]].filter(Boolean).join(" · "),
    icon: { source: Icons.box, tint: color },
    section: `Railway · ${s.projectName}`,
    keywords: ["railway", s.projectName, s.environmentName, d?.status ?? "", ...s.domains],
    accessories: [
      ...(health !== "ok" ? [{ tag: d ? statusLabel(d.status) : "Not deployed", color }] : []),
      ...(d?.branch ? [{ icon: Icons.branch, text: d.branch, tooltip: d.commitMessage }] : []),
      ...(d?.created ? [{ text: ago(d.created), tooltip: "Latest deploy" }] : []),
    ],
    detail: { metadata: deploymentMetadata(s, d) },
    actions,
  };
}

async function loadRailway(prefs: Prefs, signal: AbortSignal): Promise<Item[]> {
  const token = await railwayToken(prefs);
  if (!token) return [railwaySetupItem()];
  try {
    const services = parseRailwayProjects(await railway(token, PROJECTS_QUERY, {}, signal));
    return services.map((s) => railwayItem(token, s));
  } catch (e) {
    if (signal.aborted) throw e;
    if (e instanceof RailwayAuthError) return [railwaySetupItem(e.message)];
    return [errorRow("railway", e)];
  }
}

// ---------------------------------------------------------------------------

const isRow = (i: Item) => !i.section?.startsWith("Connect");
const failing = (i: Item) => isRow(i) && (i.icon as { tint?: string })?.tint === "red";

export default list({
  placeholder: "Filter Fly.io apps and Railway services…",
  empty: { title: "No apps", description: "Nothing deployed on Fly.io or Railway yet", icon: Icons.rocket },
  status: (items) => {
    const n = items.filter(isRow).length;
    const bad = items.filter(failing).length;
    return n ? `${n} app${n === 1 ? "" : "s"}${bad ? ` · ${bad} failing` : ""}` : "Not connected";
  },
  async *items({ preferences, signal }) {
    const prefs = preferences as Prefs;
    const [f, railwayRows] = await Promise.all([loadFly(prefs, signal), loadRailway(prefs, signal)]);
    const assemble = (statuses?: Map<string, FlyStatus>) => {
      const rows = [
        ...f.apps.map((a) => flyItem(a, statuses?.get(a.name), prefs, f.program!)),
        ...railwayRows.filter(isRow),
      ];
      return [...rows, ...f.rows, ...railwayRows.filter((i) => !isRow(i))];
    };
    yield assemble();
    const statuses = f.apps.length ? await flyStatuses(f.apps, signal) : undefined;
    const items = assemble(statuses);
    if (statuses) yield items;
    const n = items.filter(isRow).length;
    const bad = items.filter(failing).length;
    updateCommandMetadata({ subtitle: n ? bad ? `${bad} failing` : `${n} app${n === 1 ? "" : "s"}` : null })
      .catch(() => {});
  },
});
