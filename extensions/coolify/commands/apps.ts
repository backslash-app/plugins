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
  storage,
  toast,
  updateCommandMetadata,
} from "@backslash/api";
import {
  act,
  deployments,
  incomplete,
  type Instance,
  instances,
  PlatformError,
  platformErrorItem,
  type Prefs,
  resources,
  setupItem,
  type Verb,
} from "../api.ts";
import {
  ago,
  type Deployment,
  DEPLOYMENT_LOOK,
  matchesChip,
  PLATFORM_NAMES,
  type Resource,
  shortRepo,
  sortResources,
  STATE_LOOK,
  took,
} from "../lib.ts";

const KIND_NAMES = { application: "Application", service: "Service", database: "Database", compose: "Compose" };
const KIND_ICONS = { application: Icons.rocket, service: Icons.layers, database: Icons.database, compose: Icons.box };
const CACHE = "resources";
/** Parallel deployment lookups, to stay gentle with a small VPS. */
const CONCURRENCY = 6;

function verbAction(i: Instance, r: Resource, verb: Verb, o: Partial<Parameters<typeof action>[2]> = {}): Action {
  const titles: Record<Verb, string> = { deploy: "Deploy", restart: "Restart", stop: "Stop", start: "Start" };
  return action(titles[verb], async () => {
    const message = await act(i, r, verb);
    await toast(`${titles[verb]}: ${r.name}`, { style: "success", message });
    return refresh();
  }, o);
}

function deploymentsView(i: Instance, r: Resource) {
  return list({
    title: `${r.name}: deployments`,
    placeholder: "Filter deployments by commit or message…",
    empty: { title: "No deployment yet", description: "Deploy it once to see its history here.", icon: Icons.rocket },
    status: (items) => `${items.length} recent deployment${items.length === 1 ? "" : "s"}`,
    items: async ({ signal }) => {
      const list = await deployments(i, r, 30, signal);
      return list.map((d) => {
        const look = DEPLOYMENT_LOOK[d.status];
        const duration = took(d.created, d.finished);
        return {
          id: d.id,
          title: d.message || (d.commit ? `Commit ${d.commit.slice(0, 7)}` : `Deployment ${d.id}`),
          subtitle: d.commit ? d.commit.slice(0, 7) : undefined,
          icon: {
            source: d.status === "success"
              ? Icons.done
              : d.status === "failed"
              ? Icons.canceled
              : d.status === "running"
              ? Icons.inProgress
              : Icons.todo,
            tint: look.color,
          },
          keywords: [d.commit, d.trigger, look.label].filter(Boolean),
          accessories: [
            ...(d.trigger ? [{ tag: d.trigger, color: "gray" as const }] : []),
            { tag: look.label, color: look.color },
            ...(duration ? [{ text: duration, icon: Icons.timer }] : []),
            { text: ago(d.created) },
          ],
          detail: {
            metadata: [
              meta.text("Status", look.label, { icon: Icons.dot, color: look.color }),
              ...(d.commit ? [meta.text("Commit", d.commit, { icon: Icons.commit })] : []),
              ...(d.message ? [meta.text("Message", d.message)] : []),
              meta.text("Started", d.created ? new Date(d.created).toLocaleString() : "—", { icon: Icons.clock }),
              ...(duration ? [meta.text("Took", duration, { icon: Icons.timer })] : []),
              ...(d.trigger ? [meta.text("Trigger", d.trigger)] : []),
            ],
          },
          actions: [
            open(d.url, "Open Deployment Logs", { icon: Icons.note }),
            ...(d.commit ? [copy(d.commit, "Copy Commit", { section: "Copy" })] : []),
            copy(d.id, "Copy Deployment ID", { section: "Copy" }),
          ],
        };
      });
    },
  });
}

function resourceItem(i: Instance, r: Resource, last?: Deployment | null): Item {
  const look = STATE_LOOK[r.status.state];
  const running = r.status.state === "running" || r.status.state === "degraded" || r.status.state === "deploying";
  const hasDeployments = r.kind === "application" || (r.platform === "dokploy" && r.kind === "compose");
  const logs = r.platform === "coolify" ? `${r.ui}/logs` : `${r.ui}?tab=logs`;
  const where = [r.project, r.environment].filter(Boolean).join(" / ");
  const actions: Action[] = [];
  if (r.urls.length) actions.push(open(r.urls[0], "Open App", { icon: Icons.globe }));
  actions.push(open(r.ui, `Open in ${PLATFORM_NAMES[r.platform]}`, { icon: Icons.external, shortcut: "<Ctrl>o" }));
  if (r.kind !== "database") {
    actions.push(verbAction(i, r, "deploy", {
      icon: Icons.rocket,
      shortcut: "<Ctrl>d",
      confirm: r.status.state === "deploying" ? `${r.name} is deploying already. Deploy again?` : undefined,
    }));
  }
  if (running) {
    actions.push(verbAction(i, r, "restart", { icon: Icons.refresh, shortcut: "<Ctrl><Shift>r" }));
    actions.push(verbAction(i, r, "stop", {
      icon: Icons.stop,
      destructive: true,
      confirm: `Stop ${r.name}? It goes offline until started again.`,
      shortcut: "<Ctrl><Shift>s",
    }));
  } else {
    actions.push(verbAction(i, r, "start", { icon: Icons.play, shortcut: "<Ctrl><Shift>s" }));
  }
  actions.push(open(logs, "Open Logs", { icon: Icons.note, shortcut: "<Ctrl>l", section: "Logs" }));
  if (hasDeployments) {
    actions.push(action("Show Deployments", () => deploymentsView(i, r), {
      icon: Icons.history,
      shortcut: "<Ctrl>h",
      section: "Logs",
    }));
  }
  for (const url of r.urls.slice(1)) {
    actions.push(open(url, `Open ${url.replace(/^https?:\/\//, "")}`, { section: "Open" }));
  }
  if (r.urls.length) actions.push(copy(r.urls[0], "Copy URL", { section: "Copy", shortcut: "<Ctrl><Shift>c" }));
  actions.push(copy(r.id, r.platform === "coolify" ? "Copy UUID" : "Copy ID", { section: "Copy" }));
  actions.push(action("Refresh", () => refresh(), { icon: Icons.refresh, shortcut: "<Ctrl>r", section: "View" }));

  const deployLook = last ? DEPLOYMENT_LOOK[last.status] : undefined;
  return {
    id: `${r.platform}:${r.id}`,
    title: r.name,
    subtitle: r.urls[0]?.replace(/^https?:\/\//, "") || r.description || (r.kind === "database" ? r.type : undefined),
    icon: { source: KIND_ICONS[r.kind], tint: look.color },
    section: `${PLATFORM_NAMES[r.platform]}${where ? ` · ${where}` : ""}`,
    keywords: [r.kind, r.type, r.project, r.environment, shortRepo(r.repository), ...r.urls].filter(Boolean),
    accessories: [
      ...(last && deployLook
        ? [{ text: ago(last.created), icon: Icons.rocket, tooltip: `Last deployment: ${deployLook.label}` }]
        : []),
      ...(last?.status === "failed" ? [{ tag: "Deploy failed", color: "red" as const }] : []),
      { tag: look.label, color: look.color },
    ],
    detail: {
      metadata: [
        meta.text("Status", `${look.label}${r.status.health === "unknown" ? " (no health check)" : ""}`, {
          icon: look.icon,
          color: look.color,
        }),
        meta.text("Kind", `${KIND_NAMES[r.kind]}${r.type ? ` · ${r.type}` : ""}`, { icon: KIND_ICONS[r.kind] }),
        ...(where ? [meta.text("Project", where, { icon: Icons.project })] : []),
        ...r.urls.map((u, n) =>
          meta.link(n ? "" : r.urls.length > 1 ? "Domains" : "Domain", u.replace(/^https?:\/\//, ""), u)
        ),
        ...(r.repository
          ? [
            meta.text("Repository", `${shortRepo(r.repository)}${r.branch ? ` @ ${r.branch}` : ""}`, {
              icon: Icons.branch,
            }),
          ]
          : []),
        ...(r.buildPack ? [meta.text("Build", r.buildPack, { icon: Icons.package })] : []),
        ...(last && deployLook
          ? [
            meta.separator(),
            meta.text("Last deployment", `${deployLook.label}, ${ago(last.created)}`, {
              icon: Icons.rocket,
              color: deployLook.color,
            }),
            ...(last.commit ? [meta.text("Commit", last.commit.slice(0, 12), { icon: Icons.commit })] : []),
            ...(last.message ? [meta.text("Message", last.message)] : []),
          ]
          : []),
        meta.separator(),
        meta.link(PLATFORM_NAMES[r.platform], new URL(i.base).host, r.ui),
      ],
    },
    actions,
  };
}

export default list({
  placeholder: "Filter applications, services and databases…",
  filter: {
    options: [
      { value: "all", title: "All" },
      { value: "running", title: "Running" },
      { value: "stopped", title: "Stopped" },
      { value: "problems", title: "Problems" },
    ],
  },
  empty: { title: "Nothing here", description: "No resource matches this filter.", icon: Icons.rocket },
  status: (items) =>
    items[0]?.id === "setup" ? "Not connected" : `${items.length} resource${items.length === 1 ? "" : "s"}`,
  items: async function* ({ preferences, signal, filter }) {
    const prefs = preferences as Prefs;
    const all = instances(prefs);
    if (!all.length) {
      yield [setupItem(incomplete(prefs))];
      return;
    }
    const byPlatform = new Map(all.map((i) => [i.platform, i]));
    const rows = (list: Resource[], lasts = new Map<string, Deployment | null>()) =>
      sortResources(list).filter((r) => matchesChip(r, filter)).map((r) =>
        resourceItem(byPlatform.get(r.platform)!, r, lasts.get(r.id))
      );

    const cached = await storage.get(CACHE).catch(() => undefined) as Resource[] | undefined;
    if (cached?.length) yield rows(cached.filter((r) => byPlatform.has(r.platform)));

    const errors: Item[] = [];
    const loaded = (await Promise.all(all.map(async (i) => {
      try {
        return await resources(i, signal);
      } catch (e) {
        if (e instanceof PlatformError) {
          errors.push(platformErrorItem(e));
          return [];
        }
        throw e;
      }
    }))).flat();
    await storage.set(CACHE, loaded as any).catch(() => {});
    const problems = loaded.filter((r) => r.status.state === "degraded" || r.status.state === "error").length;
    updateCommandMetadata({ subtitle: problems ? `${problems} with problems` : null }).catch(() => {});
    yield [...errors, ...rows(loaded)];

    // Then the last deployment of each application, as it arrives.
    const lasts = new Map<string, Deployment | null>();
    const queue = loaded.filter((r) => r.kind === "application" || (r.platform === "dokploy" && r.kind === "compose"));
    for (let n = 0; n < queue.length && !signal.aborted; n += CONCURRENCY) {
      await Promise.all(
        queue.slice(n, n + CONCURRENCY).map(async (r) => {
          try {
            lasts.set(r.id, (await deployments(byPlatform.get(r.platform)!, r, 1, signal))[0] ?? null);
          } catch {
            lasts.set(r.id, null);
          }
        }),
      );
      yield [...errors, ...rows(loaded, lasts)];
    }
  },
});
