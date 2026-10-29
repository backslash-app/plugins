// Rows and pages of each provider: Neon projects and branches, Turso databases
// and groups, PlanetScale databases, branches and deploy requests.

import {
  type Action,
  action,
  clipboard,
  close,
  copy,
  field,
  form,
  Icons,
  type Item,
  list,
  type ListSpec,
  meta,
  open,
  pop,
  refresh,
  submenu,
  toast,
} from "@backslash/api";
import {
  neonBranches,
  neonConnectionUri,
  neonCreateBranch,
  neonDatabases,
  neonDeleteBranch,
  neonEndpoint,
  type NeonProjectEntry,
  psBranches,
  psDeploy,
  psDeployRequests,
  TOKEN_PAGES,
  TokenError,
  tursoCreateToken,
} from "./api.ts";
import {
  age,
  computeSize,
  type Credentials,
  deployState,
  endpointState,
  formatBytes,
  formatDate,
  isDefaultBranch,
  locationName,
  type NeonBranch,
  neonConsoleUrl,
  type NeonEndpoint,
  neonRegion,
  newBranchName,
  plural,
  type Provider,
  PROVIDER_COLORS,
  PROVIDER_NAMES,
  PROVIDERS,
  type PsDatabase,
  psState,
  sortBranches,
  sortDeployRequests,
  sortPsBranches,
  TOKEN_EXPIRATIONS,
  tursoDashboardUrl,
  type TursoDatabase,
  tursoEnv,
  type TursoGroup,
  tursoState,
  tursoUrl,
  validateBranchName,
} from "./lib.ts";

// ---------------------------------------------------------------------------
// Lists that reload after a change made from them (a branch created in a form).

const changes = new EventTarget();
const changed = () => changes.dispatchEvent(new Event("change"));

async function* live<T>(load: () => Promise<T>, signal: AbortSignal): AsyncGenerator<T> {
  while (!signal.aborted) {
    yield await load();
    await new Promise<void>((resolve) => {
      const done = () => {
        changes.removeEventListener("change", done);
        signal.removeEventListener("abort", done);
        resolve();
      };
      changes.addEventListener("change", done);
      signal.addEventListener("abort", done);
    });
  }
}

const reload = () => action("Reload", () => refresh(), { icon: Icons.refresh, shortcut: "<Ctrl>r" });

// ---------------------------------------------------------------------------
// Neon

async function copyUri(c: Credentials, projectId: string, branchId: string, pooled: boolean, database?: string) {
  const dbs = await neonDatabases(c, projectId, branchId);
  const db = dbs.find((d) => d.name === database) ?? dbs.find((d) => d.name !== "postgres") ?? dbs[0];
  if (!db) throw new Error("This branch has no database yet");
  const uri = await neonConnectionUri(c, projectId, branchId, db, pooled);
  await clipboard.write(uri, { concealed: true });
  return close(`${pooled ? "Pooled" : "Direct"} URI of ${db.name} copied`);
}

function uriMenu(c: Credentials, projectId: string, branchId: string): Action {
  return submenu("Copy Connection URI", async () => {
    const dbs = await neonDatabases(c, projectId, branchId);
    if (!dbs.length) return [action("No Database on This Branch", () => {}, { icon: Icons.info })];
    return dbs.flatMap((db) => [
      action(`${db.name} · pooled`, () => copyUri(c, projectId, branchId, true, db.name), { icon: Icons.link }),
      action(`${db.name} · direct`, () => copyUri(c, projectId, branchId, false, db.name), { icon: Icons.link }),
    ]);
  }, { icon: Icons.link, shortcut: "<Ctrl><Shift>c", section: "Copy" });
}

export function neonProjectItem(c: Credentials, e: NeonProjectEntry): Item {
  const p = e.project;
  const size = formatBytes(p.synthetic_storage_size);
  return {
    id: `neon:${p.id}`,
    title: p.name,
    subtitle: neonRegion(p.region_id),
    icon: { source: Icons.database, tint: PROVIDER_COLORS.neon },
    section: e.org ? `Neon · ${e.org}` : "Neon",
    keywords: ["neon", "postgres", p.id, p.region_id, e.org ?? ""],
    accessories: [
      { text: `Postgres ${p.pg_version}` },
      ...(size ? [{ text: size, tooltip: "Storage" }] : []),
      { text: age(p.updated_at ?? p.created_at), tooltip: "Last change" },
    ],
    detail: {
      metadata: [
        meta.text("Provider", "Neon", { icon: Icons.cloud, color: PROVIDER_COLORS.neon }),
        ...(e.org ? [meta.text("Organization", e.org, { icon: Icons.home })] : []),
        meta.text("Region", `${neonRegion(p.region_id)} (${p.region_id})`, { icon: Icons.globe }),
        meta.text("Postgres", String(p.pg_version), { icon: Icons.database }),
        ...(size ? [meta.text("Storage", size, { icon: Icons.drive })] : []),
        ...(p.history_retention_seconds
          ? [meta.text("History", `${Math.round(p.history_retention_seconds / 86400)} days`, { icon: Icons.history })]
          : []),
        meta.text("Created", formatDate(p.created_at), { icon: Icons.calendar }),
        meta.text("Project ID", p.id, { icon: Icons.hash }),
      ],
    },
    actions: [
      action("Show Branches", () => neonBranchesView(c, e), { icon: Icons.branch }),
      action("Copy Connection URI", async () => {
        const { branches } = await neonBranches(c, p.id);
        const main = branches.find(isDefaultBranch) ?? branches[0];
        if (!main) throw new Error("This project has no branch");
        return copyUri(c, p.id, main.id, true);
      }, { icon: Icons.link, shortcut: "<Ctrl><Shift>c", section: "Copy" }),
      open(neonConsoleUrl(p.id), "Open in Neon Console", { shortcut: "<Ctrl>o" }),
      copy(p.id, "Copy Project ID", { icon: Icons.hash, section: "Copy" }),
      reload(),
    ],
  };
}

function branchForm(c: Credentials, e: NeonProjectEntry, branches: NeonBranch[], parent: NeonBranch) {
  return form({
    title: `New Branch of ${e.project.name}`,
    submitTitle: "Create Branch",
    fields: [
      field.text("name", "Name", { required: true, value: newBranchName(branches.map((b) => b.name)) }),
      field.dropdown("parent", "From", branches.map((b) => ({ value: b.id, title: b.name })), { value: parent.id }),
      field.checkbox("compute", "Add a read-write compute", { value: true }),
    ],
    async submit(values) {
      const name = validateBranchName(String(values.name ?? ""));
      const b = await neonCreateBranch(c, e.project.id, name, String(values.parent || parent.id), !!values.compute);
      changed();
      await toast(`Created ${b.name}`, { style: "success", message: "Copy its connection URI from the list" });
      return pop();
    },
  });
}

function branchItem(
  c: Credentials,
  e: NeonProjectEntry,
  b: NeonBranch,
  all: NeonBranch[],
  endpoints: NeonEndpoint[],
): Item {
  const p = e.project;
  const ep = endpoints.find((x) => x.branch_id === b.id && x.type === "read_write") ??
    endpoints.find((x) => x.branch_id === b.id);
  const state = endpointState(ep);
  const parent = all.find((x) => x.id === b.parent_id);
  const size = formatBytes(b.logical_size);
  const main = isDefaultBranch(b);
  const actions: Action[] = [
    action("Copy Pooled Connection URI", () => copyUri(c, p.id, b.id, true), { icon: Icons.link }),
    uriMenu(c, p.id, b.id),
    action("New Branch from Here…", () => branchForm(c, e, all, b), { icon: Icons.plus, shortcut: "<Ctrl>n" }),
    open(neonConsoleUrl(p.id, b.id), "Open in Neon Console", { shortcut: "<Ctrl>o" }),
    ...(ep?.host ? [copy(ep.host, "Copy Host", { icon: Icons.server, section: "Copy" })] : []),
    copy(b.id, "Copy Branch ID", { icon: Icons.hash, section: "Copy" }),
  ];
  if (ep && !ep.disabled) {
    actions.push(
      ep.current_state === "active"
        ? action("Suspend Compute", async () => {
          await neonEndpoint(c, p.id, ep.id, "suspend");
          await toast(`Suspending ${b.name}`, { style: "success" });
          changed();
        }, {
          icon: Icons.pause,
          section: "Compute",
          confirm: `Suspend the compute of ${b.name}? Open connections are cut.`,
        })
        : action("Start Compute", async () => {
          await neonEndpoint(c, p.id, ep.id, "start");
          await toast(`Starting ${b.name}`, { style: "success" });
          changed();
        }, { icon: Icons.play, section: "Compute" }),
    );
  }
  if (!main && !b.protected) {
    actions.push(action("Delete Branch", async () => {
      await neonDeleteBranch(c, p.id, b.id);
      await toast(`Deleted ${b.name}`, { style: "success" });
      changed();
    }, {
      icon: Icons.trash,
      destructive: true,
      confirm: `Delete the branch ${b.name} of ${p.name}, its data and computes? This can't be undone.`,
      section: "Danger",
      shortcut: "<Ctrl>x",
    }));
  }
  actions.push(reload());
  return {
    id: b.id,
    title: b.name,
    subtitle: parent ? `from ${parent.name}` : undefined,
    icon: { source: Icons.branch, tint: main ? "green" : state.color === "green" ? "blue" : "gray" },
    keywords: [b.id, ep?.host ?? ""],
    accessories: [
      ...(main ? [{ tag: "default", color: "green" as const }] : []),
      ...(b.protected ? [{ icon: Icons.lock, tooltip: "Protected" }] : []),
      ...(b.expires_at ? [{ icon: Icons.hourglass, tooltip: `Expires ${formatDate(b.expires_at)}` }] : []),
      ...(size ? [{ text: size, tooltip: "Logical size" }] : []),
      { tag: state.label, color: state.color },
    ],
    detail: {
      metadata: [
        meta.text("Compute", state.label, { icon: Icons.cpu, color: state.color }),
        ...(ep && computeSize(ep) ? [meta.text("Size", computeSize(ep)!, { icon: Icons.activity })] : []),
        ...(ep?.host ? [meta.text("Host", ep.host, { icon: Icons.server })] : []),
        ...(ep?.last_active ? [meta.text("Last active", `${age(ep.last_active)} ago`, { icon: Icons.clock })] : []),
        meta.separator(),
        ...(parent ? [meta.text("Parent", parent.name, { icon: Icons.branch })] : []),
        ...(size ? [meta.text("Logical size", size, { icon: Icons.drive })] : []),
        meta.text("State", b.current_state, { icon: Icons.dot }),
        meta.text("Created", `${formatDate(b.created_at)} (${age(b.created_at)} ago)`, { icon: Icons.calendar }),
        ...(b.expires_at ? [meta.text("Expires", formatDate(b.expires_at), { icon: Icons.hourglass })] : []),
        meta.text("Branch ID", b.id, { icon: Icons.hash }),
      ],
    },
    actions,
  };
}

export function neonBranchesView(c: Credentials, e: NeonProjectEntry): ListSpec {
  return list({
    title: `${e.project.name} branches`,
    placeholder: `Filter branches of ${e.project.name}…`,
    empty: { title: "No branches", icon: Icons.branch },
    status: (items) => plural(items.length, "branch", "branches"),
    items: ({ signal }) =>
      live(async () => {
        const { branches, endpoints } = await neonBranches(c, e.project.id, signal);
        return sortBranches(branches).map((b) => branchItem(c, e, b, branches, endpoints));
      }, signal),
  });
}

// ---------------------------------------------------------------------------
// Turso

function tokenActions(c: Credentials, org: string, d: TursoDatabase): Action[] {
  const create = (expiration: string, readOnly: boolean, title: string) =>
    action(title, async () => {
      const jwt = await tursoCreateToken(c, org, d.Name, expiration, readOnly);
      await clipboard.write(jwt, { concealed: true });
      return close(`${readOnly ? "Read-only" : "Full-access"} token copied`);
    }, { icon: readOnly ? Icons.eye : Icons.key });
  return [
    submenu("Create Token", [
      ...TOKEN_EXPIRATIONS.map((x) => create(x.value, false, `Full access · ${x.title}`)),
      ...TOKEN_EXPIRATIONS.map((x) => create(x.value, true, `Read-only · ${x.title}`)),
    ], { icon: Icons.key, shortcut: "<Ctrl>t" }),
    action("Copy .env with a 30-Day Token", async () => {
      const jwt = await tursoCreateToken(c, org, d.Name, "30d", false);
      await clipboard.write(tursoEnv(d, jwt), { concealed: true });
      return close("TURSO_DATABASE_URL and TURSO_AUTH_TOKEN copied");
    }, { icon: Icons.text, section: "Copy", shortcut: "<Ctrl><Shift>e" }),
  ];
}

export function tursoDatabaseItem(
  c: Credentials,
  org: string,
  d: TursoDatabase,
  groups: TursoGroup[],
  locations: Record<string, string>,
  orgCount: number,
): Item {
  const state = tursoState(d);
  const group = groups.find((g) => g.name === d.group);
  const regions = d.regions?.length ? d.regions : group?.locations ?? [];
  const primary = d.primaryRegion ?? group?.primary;
  return {
    id: `turso:${org}/${d.Name}`,
    title: d.Name,
    subtitle: d.Hostname,
    icon: { source: Icons.database, tint: PROVIDER_COLORS.turso },
    section: orgCount > 1 ? `Turso · ${org}` : "Turso",
    keywords: ["turso", "libsql", "sqlite", d.group ?? "", ...regions],
    accessories: [
      ...(d.group ? [{ text: d.group, icon: Icons.layers, tooltip: "Group" }] : []),
      ...(primary ? [{ icon: Icons.pin, text: primary, tooltip: locationName(primary, locations) }] : []),
      { tag: state.label, color: state.color },
    ],
    detail: {
      metadata: [
        meta.text("Provider", "Turso", { icon: Icons.cloud, color: PROVIDER_COLORS.turso }),
        meta.text("Organization", org, { icon: Icons.home }),
        meta.text("URL", tursoUrl(d), { icon: Icons.link }),
        meta.text("State", state.label, { icon: Icons.dot, color: state.color }),
        ...(d.group ? [meta.text("Group", d.group, { icon: Icons.layers })] : []),
        ...(primary ? [meta.text("Primary", locationName(primary, locations), { icon: Icons.pin })] : []),
        ...(regions.length
          ? [meta.tags("Locations", regions.map((r) => r === primary ? { text: r, color: "teal" } : r))]
          : []),
        ...(d.version ? [meta.text("Version", d.version, { icon: Icons.tag })] : []),
        ...(d.schema ? [meta.text("Schema database", d.schema, { icon: Icons.braces })] : []),
        meta.text("Database ID", d.DbId, { icon: Icons.hash }),
      ],
    },
    actions: [
      copy(tursoUrl(d), "Copy Database URL", { icon: Icons.link }),
      ...tokenActions(c, org, d),
      open(tursoDashboardUrl(org, d.Name), "Open in Turso", { shortcut: "<Ctrl>o" }),
      copy(d.Hostname, "Copy Hostname", { icon: Icons.server, section: "Copy" }),
      action("Show Locations", () => locationsView(groups, locations), { icon: Icons.globe }),
      reload(),
    ],
  };
}

export function tursoGroupItem(
  org: string,
  g: TursoGroup,
  dbCount: number,
  locations: Record<string, string>,
  orgCount: number,
): Item {
  return {
    id: `turso-group:${org}/${g.name}`,
    title: g.name,
    subtitle: `Group · ${g.locations.map((l) => l === g.primary ? `${l} (primary)` : l).join(", ")}`,
    icon: { source: Icons.layers, tint: g.archived ? "gray" : PROVIDER_COLORS.turso },
    section: orgCount > 1 ? `Turso Groups · ${org}` : "Turso Groups",
    keywords: ["turso", "group", ...g.locations],
    accessories: [
      ...(g.delete_protection ? [{ icon: Icons.lock, tooltip: "Delete protection" }] : []),
      ...(g.archived ? [{ tag: "Archived", color: "gray" as const }] : []),
      { text: plural(dbCount, "database") },
    ],
    detail: {
      metadata: [
        meta.text("Primary", locationName(g.primary, locations), { icon: Icons.pin }),
        meta.tags("Locations", g.locations.map((l) => locationName(l, locations))),
        ...(g.version ? [meta.text("Version", g.version, { icon: Icons.tag })] : []),
        meta.text("Databases", String(dbCount), { icon: Icons.database }),
        ...(g.uuid ? [meta.text("ID", g.uuid, { icon: Icons.hash })] : []),
      ],
    },
    actions: [
      open(`${tursoDashboardUrl(org)}/groups/${encodeURIComponent(g.name)}`, "Open in Turso", { shortcut: "<Ctrl>o" }),
      copy(g.name, "Copy Group Name", { section: "Copy" }),
      reload(),
    ],
  };
}

/** Every Turso location, those used by a group first. */
function locationsView(groups: TursoGroup[], locations: Record<string, string>): ListSpec {
  return list({
    title: "Turso Locations",
    placeholder: "Filter locations…",
    status: (items) => plural(items.length, "location"),
    items: Object.entries(locations)
      .map(([code, name]) => ({
        code,
        name,
        used: groups.filter((g) => g.locations.includes(code)).map((g) => g.name),
      }))
      .sort((a, b) => b.used.length - a.used.length || a.name.localeCompare(b.name))
      .map((l) => ({
        id: l.code,
        title: l.name,
        subtitle: l.code,
        icon: { source: Icons.pin, tint: l.used.length ? "teal" : "gray" },
        section: l.used.length ? "Used by your groups" : "Available",
        accessories: l.used.length ? [{ text: l.used.join(", "), icon: Icons.layers }] : [],
        actions: [copy(l.code, "Copy Location Code")],
      })),
  });
}

// ---------------------------------------------------------------------------
// PlanetScale

export function psDatabaseItem(c: Credentials, org: string, d: PsDatabase, orgCount: number): Item {
  const state = psState(d.state);
  const url = d.html_url ?? `https://app.planetscale.com/${org}/${d.name}`;
  return {
    id: `planetscale:${org}/${d.name}`,
    title: d.name,
    subtitle: d.region?.display_name,
    icon: { source: Icons.database, tint: PROVIDER_COLORS.planetscale },
    section: orgCount > 1 ? `PlanetScale · ${org}` : "PlanetScale",
    keywords: ["planetscale", d.kind ?? "mysql", d.region?.slug ?? "", d.plan ?? ""],
    accessories: [
      ...(d.kind ? [{ text: d.kind === "postgresql" ? "Postgres" : d.kind === "mysql" ? "MySQL" : d.kind }] : []),
      ...(d.branches_count !== undefined ? [{ text: plural(d.branches_count, "branch", "branches") }] : []),
      { tag: state.label, color: state.color },
    ],
    detail: {
      metadata: [
        meta.text("Provider", "PlanetScale", { icon: Icons.cloud, color: PROVIDER_COLORS.planetscale }),
        meta.text("Organization", org, { icon: Icons.home }),
        meta.text("State", state.label, { icon: Icons.dot, color: state.color }),
        ...(d.region
          ? [meta.text("Region", `${d.region.display_name} (${d.region.slug})`, { icon: Icons.globe })]
          : []),
        ...(d.kind ? [meta.text("Engine", d.kind, { icon: Icons.database })] : []),
        ...(d.plan ? [meta.text("Plan", d.plan, { icon: Icons.coin })] : []),
        ...(d.production_branches_count !== undefined
          ? [
            meta.text(
              "Branches",
              `${d.production_branches_count} production, ${d.development_branches_count ?? 0} development`,
              {
                icon: Icons.branch,
              },
            ),
          ]
          : []),
        meta.text("Created", formatDate(d.created_at), { icon: Icons.calendar }),
      ],
    },
    actions: [
      action("Show Branches", () => psBranchesView(c, org, d), { icon: Icons.branch }),
      action("Show Deploy Requests", () => psDeployRequestsView(c, org, d), { icon: Icons.pullRequest }),
      open(url, "Open in PlanetScale", { shortcut: "<Ctrl>o" }),
      copy(d.name, "Copy Database Name", { section: "Copy" }),
      reload(),
    ],
  };
}

function psBranchesView(c: Credentials, org: string, d: PsDatabase): ListSpec {
  return list({
    title: `${d.name} branches`,
    placeholder: `Filter branches of ${d.name}…`,
    empty: { title: "No branches", icon: Icons.branch },
    status: (items) => plural(items.length, "branch", "branches"),
    async items({ signal }) {
      const branches = await psBranches(c, org, d.name, signal);
      return sortPsBranches(branches).map((b) => {
        const url = b.html_url ?? `https://app.planetscale.com/${org}/${d.name}/${b.name}`;
        const state = b.ready ? { label: "Ready", color: "green" as const } : psState(b.state ?? "pending");
        return {
          id: b.id,
          title: b.name,
          subtitle: b.parent_branch ? `from ${b.parent_branch}` : undefined,
          icon: { source: Icons.branch, tint: b.production ? "purple" : "gray" },
          section: b.production ? "Production" : "Development",
          accessories: [
            ...(b.safe_migrations ? [{ icon: Icons.shield, tooltip: "Safe migrations" }] : []),
            { text: age(b.created_at), tooltip: "Age" },
            { tag: state.label, color: state.color },
          ],
          detail: {
            metadata: [
              meta.text("Type", b.production ? "Production" : "Development", { icon: Icons.branch }),
              ...(b.parent_branch ? [meta.text("Parent", b.parent_branch)] : []),
              ...(b.region ? [meta.text("Region", b.region.display_name, { icon: Icons.globe })] : []),
              meta.text("Created", formatDate(b.created_at), { icon: Icons.calendar }),
            ],
          },
          actions: [
            open(url, "Open in PlanetScale"),
            copy(b.name, "Copy Branch Name"),
            reload(),
          ],
        };
      });
    },
  });
}

function psDeployRequestsView(c: Credentials, org: string, d: PsDatabase): ListSpec {
  return list({
    title: `${d.name} deploy requests`,
    placeholder: `Filter deploy requests of ${d.name}…`,
    empty: { title: "No deploy requests", description: "Open one from a development branch", icon: Icons.pullRequest },
    status: (items) => `${items.filter((i) => i.section === "Open").length} open`,
    items: ({ signal }) =>
      live(async () => {
        const all = await psDeployRequests(c, org, d.name, signal);
        return sortDeployRequests(all).map((r) => {
          const s = deployState(r);
          return {
            id: r.id,
            title: `#${r.number} ${r.branch} → ${r.into_branch}`,
            subtitle: r.notes?.split("\n")[0]?.slice(0, 80) || undefined,
            icon: {
              source: r.state === "open"
                ? Icons.pullRequest
                : s.label === "Deployed"
                ? Icons.merged
                : Icons.pullRequestClosed,
              tint: s.color,
            },
            section: r.state === "open" ? "Open" : "Closed",
            keywords: [r.branch, r.into_branch, r.actor?.display_name ?? ""],
            accessories: [
              ...(r.actor?.display_name ? [{ avatar: r.actor.display_name, tooltip: r.actor.display_name }] : []),
              { text: age(r.created_at) },
              { tag: s.label, color: s.color },
            ],
            detail: {
              markdown: r.notes || undefined,
              metadata: [
                meta.text("Status", s.label, { icon: Icons.dot, color: s.color }),
                meta.text("Branch", `${r.branch} → ${r.into_branch}`, { icon: Icons.branch }),
                ...(r.approved !== undefined
                  ? [meta.text("Approved", r.approved ? "Yes" : "No", { icon: Icons.check })]
                  : []),
                ...(r.actor?.display_name ? [meta.person("Opened by", r.actor.display_name)] : []),
                meta.text("Opened", formatDate(r.created_at), { icon: Icons.calendar }),
                ...(r.deployed_at ? [meta.text("Deployed", formatDate(r.deployed_at), { icon: Icons.rocket })] : []),
              ],
            },
            actions: [
              open(r.html_url, "Open in PlanetScale"),
              ...(s.deployable
                ? [action("Deploy", async () => {
                  await psDeploy(c, org, d.name, r.number);
                  await toast(`Deploying #${r.number}`, {
                    style: "success",
                    message: `${r.branch} → ${r.into_branch}`,
                  });
                  changed();
                }, {
                  icon: Icons.rocket,
                  destructive: true,
                  confirm: `Deploy the schema changes of ${r.branch} to ${r.into_branch}?`,
                  shortcut: "<Ctrl>d",
                })]
                : []),
              copy(r.html_url, "Copy Link", { icon: Icons.link, section: "Copy" }),
              reload(),
            ],
          };
        });
      }, signal),
  });
}

// ---------------------------------------------------------------------------
// Setup and errors

const SETUP_LINES: Record<Provider, string> = {
  neon: "**Neon**: Account settings → API keys → Create new API key",
  turso: "**Turso**: Account → API Tokens → Create (or `turso auth api-tokens mint backslash`)",
  planetscale:
    "**PlanetScale**: Organization settings → Service tokens → New token, with read_databases, read_branches, read_deploy_requests (and deploy_deploy_requests to deploy); its ID and token",
};

export function setupItem(): Item {
  return {
    id: "setup",
    title: "Connect a database provider",
    subtitle: "Add a Neon, Turso or PlanetScale token in Settings",
    icon: { source: Icons.key, tint: "orange" },
    detail: {
      markdown: [
        "## Connect your providers",
        "",
        "Set the token of each provider you use in **Settings → Extensions → Serverless Databases**:",
        "",
        ...PROVIDERS.map((p) => `- ${SETUP_LINES[p]}`),
      ].join("\n"),
    },
    actions: PROVIDERS.map((p) => open(TOKEN_PAGES[p], `Create a ${PROVIDER_NAMES[p]} Token`, { icon: Icons.key })),
  };
}

export function errorItem(provider: Provider, err: unknown): Item {
  const token = err instanceof TokenError;
  const message = err instanceof Error ? err.message : String(err);
  return {
    id: `error:${provider}`,
    title: token ? `${PROVIDER_NAMES[provider]} refused the token` : `${PROVIDER_NAMES[provider]} failed`,
    subtitle: token ? "Check it in Settings → Extensions → Serverless Databases" : message,
    icon: { source: token ? Icons.key : Icons.alert, tint: "orange" },
    section: PROVIDER_NAMES[provider],
    detail: { markdown: `${message}${token ? `\n\n${SETUP_LINES[provider]}` : ""}` },
    actions: [
      action("Retry", () => refresh(), { icon: Icons.refresh, shortcut: "<Ctrl>r" }),
      open(TOKEN_PAGES[provider], "Create a Token", { icon: Icons.key }),
      copy(message, "Copy Error", { section: "Copy" }),
    ],
  };
}
