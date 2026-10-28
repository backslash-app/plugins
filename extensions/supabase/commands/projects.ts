import {
  type Action,
  action,
  clipboard,
  close,
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
  submenu,
  toast,
  updateCommandMetadata,
} from "@backslash/api";
import { guarded, supabase, tokenOf } from "../api.ts";
import {
  ago,
  anonKey,
  API_LOGS_SQL,
  type ApiKey,
  apiUrl,
  dashboardUrl,
  type EdgeFunction,
  formatBytes,
  formatCount,
  formatLogs,
  functionLogsSql,
  functionStatus,
  functionUrl,
  groupProjects,
  logWindow,
  maskKey,
  type Organization,
  parseLogs,
  parseTables,
  postgresVersion,
  type Project,
  regionName,
  statusInfo,
  STUDIO_PAGES,
  type Table,
  TABLES_SQL,
  tableUrl,
  toDate,
} from "../lib.ts";

const fence = (text: string) => `\`\`\`\n${text.replace(/```/g, "ʼʼʼ") || "(empty)"}\n\`\`\``;

// ---------------------------------------------------------------------------
// Shared actions

function studioMenu(ref: string): Action {
  return submenu(
    "Open in Studio",
    STUDIO_PAGES.map((p) => open(dashboardUrl(ref, p.page), p.title, { icon: p.icon })),
    { icon: Icons.external, shortcut: "<Ctrl>o", section: "Studio" },
  );
}

function powerActions(token: string, p: Project): Action[] {
  const s = statusInfo(p.status);
  if (s.health === "paused") {
    return [action("Restore Project", async () => {
      await supabase(token, `/projects/${p.ref}/restore`, { method: "POST" });
      await toast(`Restoring ${p.name}`, { style: "success", message: "It takes a few minutes" });
      return refresh();
    }, {
      icon: Icons.play,
      confirm: `Restore ${p.name}? It starts again and counts toward your plan.`,
      section: "Project",
    })];
  }
  if (s.health === "ok" || s.health === "failed") {
    return [action("Pause Project", async () => {
      await supabase(token, `/projects/${p.ref}/pause`, { method: "POST" });
      await toast(`Pausing ${p.name}`, { style: "success", message: "Restore it from here when you need it" });
      return refresh();
    }, {
      icon: Icons.pause,
      destructive: true,
      confirm: `Pause ${p.name}? Its database and APIs stop answering until you restore it.`,
      section: "Danger",
    })];
  }
  return [];
}

async function copyAnonKey(token: string, ref: string) {
  const keys = await supabase<ApiKey[]>(token, `/projects/${ref}/api-keys`);
  const key = anonKey(keys);
  if (!key) throw new Error("This project has no anon or publishable key");
  await clipboard.write(key, { concealed: true });
  return close("Anon key copied");
}

function projectMetadata(p: Project, org?: string): Metadata[] {
  const s = statusInfo(p.status);
  return [
    meta.text("Status", s.label, { icon: Icons.dot, color: s.color }),
    meta.text("Region", regionName(p.region), { icon: Icons.globe }),
    ...(p.database?.version ? [meta.text("Postgres", p.database.version, { icon: Icons.database })] : []),
    ...(p.database?.release_channel && p.database.release_channel !== "ga"
      ? [meta.text("Release channel", p.database.release_channel)]
      : []),
    ...(org ? [meta.text("Organization", org, { icon: Icons.home })] : []),
    meta.separator(),
    meta.link("API URL", apiUrl(p.ref).replace("https://", ""), apiUrl(p.ref)),
    ...(p.database?.host ? [meta.text("Database host", p.database.host, { icon: Icons.server })] : []),
    meta.text("Reference", p.ref, { icon: Icons.hash }),
    ...(p.created_at
      ? [meta.text("Created", new Date(p.created_at).toLocaleDateString("en-GB"), { icon: Icons.calendar })]
      : []),
    meta.link("Dashboard", "Open in Supabase", dashboardUrl(p.ref)),
  ];
}

// ---------------------------------------------------------------------------
// Logs

async function logsView(token: string, p: Project, fn?: EdgeFunction): Promise<DetailSpec> {
  const params = new URLSearchParams({ sql: fn ? functionLogsSql(fn.id) : API_LOGS_SQL, ...logWindow() });
  const body = await supabase<{ result?: unknown[]; error?: unknown }>(
    token,
    `/projects/${p.ref}/analytics/endpoints/logs.all?${params}`,
  );
  if (body?.error) {
    const e = body.error as { message?: string };
    throw new Error(`Logs: ${typeof e === "string" ? e : e.message ?? JSON.stringify(e)}`);
  }
  const lines = parseLogs(body);
  const text = formatLogs(lines);
  const errors = lines.filter((l) => (l.status ?? 0) >= 500 || l.level === "error").length;
  return detail({
    title: fn ? `${fn.name} · logs` : `${p.name} · API logs`,
    markdown: lines.length ? fence(text) : "_Nothing logged in the last hour._",
    stats: [
      { label: "entries", value: lines.length },
      { label: "errors", value: errors, color: errors ? "red" : undefined },
    ],
    status: `Last hour, newest first, times in UTC${lines.length === 50 ? " · first 50" : ""}`,
    actions: [
      action("Reload", () => logsView(token, p, fn), { icon: Icons.refresh, shortcut: "<Ctrl>r" }),
      copy(text, "Copy Logs", { shortcut: "<Ctrl><Shift>c" }),
      open(
        dashboardUrl(p.ref, fn ? `/functions/${fn.slug}/logs` : "/logs/edge-logs"),
        "Open in Logs Explorer",
        { shortcut: "<Ctrl>o" },
      ),
    ],
  });
}

// ---------------------------------------------------------------------------
// One project

function tableItem(p: Project, t: Table, shared: Action[]): Item {
  const unsafe = !t.rls && t.schema === "public";
  return {
    id: `table:${t.schema}.${t.name}`,
    title: t.name,
    subtitle: t.schema === "public" ? t.comment : t.schema,
    icon: { source: Icons.database, tint: unsafe ? "orange" : "teal" },
    section: "Tables",
    keywords: [t.schema, "table", t.comment ?? ""],
    accessories: [
      ...(unsafe ? [{ tag: "RLS off", color: "orange" as const }] : []),
      { text: `${formatCount(t.rows)} rows`, tooltip: "Estimated rows" },
      { text: formatBytes(t.bytes), tooltip: "Size with indexes" },
    ],
    detail: {
      stats: [
        { label: "rows (est.)", value: formatCount(t.rows) },
        { label: "size", value: formatBytes(t.bytes) },
      ],
      markdown: unsafe
        ? "Row Level Security is **off**: anyone with the anon key can read and write this table through the API."
        : t.comment,
      metadata: [
        meta.text("Schema", t.schema, { icon: Icons.layers }),
        meta.text("Row Level Security", t.rls ? "Enabled" : "Disabled", {
          icon: Icons.shield,
          color: t.rls ? "green" : "orange",
        }),
        meta.link("REST endpoint", `/rest/v1/${t.name}`, `${apiUrl(p.ref)}/rest/v1/${t.name}`),
      ],
    },
    actions: [
      open(tableUrl(p.ref, t), "Open in Table Editor", { icon: Icons.database }),
      open(dashboardUrl(p.ref, "/auth/policies"), "Open Policies", { icon: Icons.shield }),
      copy(t.schema === "public" ? t.name : `${t.schema}.${t.name}`, "Copy Table Name", {
        shortcut: "<Ctrl>period",
        section: "Copy",
      }),
      copy(`${apiUrl(p.ref)}/rest/v1/${t.name}`, "Copy REST URL", { icon: Icons.link, section: "Copy" }),
      ...shared,
    ],
  };
}

function functionItem(token: string, p: Project, fn: EdgeFunction, shared: Action[]): Item {
  const s = functionStatus(fn.status);
  const updated = toDate(fn.updated_at);
  return {
    id: `fn:${fn.slug}`,
    title: fn.name || fn.slug,
    subtitle: fn.name !== fn.slug ? fn.slug : undefined,
    icon: { source: Icons.bolt, tint: s.color },
    section: "Edge Functions",
    keywords: [fn.slug, "function", s.label],
    accessories: [
      ...(fn.status !== "ACTIVE" ? [{ tag: s.label, color: s.color }] : []),
      ...(fn.verify_jwt === false ? [{ icon: Icons.globe, tooltip: "Public: JWT not verified" }] : []),
      { text: `v${fn.version}`, tooltip: "Version" },
      { text: ago(updated), tooltip: "Last deployed" },
    ],
    detail: {
      stats: [
        { label: "version", value: fn.version },
        { label: "deployed", value: ago(updated) || "—" },
      ],
      metadata: [
        meta.text("Status", s.label, { icon: Icons.dot, color: s.color }),
        meta.text("Slug", fn.slug, { icon: Icons.hash }),
        meta.text("Verify JWT", fn.verify_jwt === false ? "No (public)" : "Yes", { icon: Icons.shield }),
        ...(fn.entrypoint_path ? [meta.text("Entrypoint", fn.entrypoint_path.replace(/^file:\/\//, ""))] : []),
        meta.link("URL", `/functions/v1/${fn.slug}`, functionUrl(p.ref, fn.slug)),
        ...(updated ? [meta.text("Updated", updated.toLocaleString("en-GB"), { icon: Icons.calendar })] : []),
      ],
    },
    actions: [
      action("Show Recent Logs", () => logsView(token, p, fn), { icon: Icons.text }),
      open(dashboardUrl(p.ref, `/functions/${fn.slug}`), "Open in Studio", { icon: Icons.external }),
      copy(functionUrl(p.ref, fn.slug), "Copy Function URL", { shortcut: "<Ctrl>period", section: "Copy" }),
      copy(`supabase functions deploy ${fn.slug} --project-ref ${p.ref}`, "Copy Deploy Command", {
        icon: Icons.terminal,
        section: "Copy",
      }),
      ...shared,
    ],
  };
}

function overviewItems(token: string, p: Project, keys: ApiKey[] | undefined, shared: Action[]): Item[] {
  const anon = keys ? anonKey(keys) : undefined;
  const service = keys?.find((k) => k.name === "service_role" && k.api_key)?.api_key;
  return [
    {
      id: "url",
      title: "API URL",
      subtitle: apiUrl(p.ref),
      icon: { source: Icons.globe, tint: "green" },
      section: "Connect",
      detail: { metadata: projectMetadata(p) },
      actions: [copy(apiUrl(p.ref), "Copy API URL"), open(apiUrl(p.ref), "Open API URL"), ...shared],
    },
    {
      id: "anon",
      title: "Anon Key",
      subtitle: anon ? maskKey(anon) : keys ? "None" : "Could not be read",
      icon: { source: Icons.key, tint: "blue" },
      section: "Connect",
      detail: {
        markdown: "The **public** key for browsers and apps. It respects Row Level Security.",
        metadata: projectMetadata(p),
      },
      actions: [
        anon
          ? copy(anon, "Copy Anon Key", { concealed: true })
          : action("Copy Anon Key", () => copyAnonKey(token, p.ref), { icon: Icons.copy }),
        copy(
          `SUPABASE_URL=${apiUrl(p.ref)}\nSUPABASE_ANON_KEY=${anon ?? ""}`,
          "Copy as .env Lines",
          { icon: Icons.text, concealed: true, section: "Copy" },
        ),
        ...shared,
      ],
    },
    ...(service
      ? [{
        id: "service",
        title: "Service Role Key",
        subtitle: maskKey(service),
        icon: { source: Icons.key, tint: "red" as const },
        section: "Connect",
        accessories: [{ tag: "Secret", color: "red" as const }],
        detail: {
          markdown:
            "This key **bypasses Row Level Security**. Keep it on servers; never ship it in a browser or an app.",
          metadata: projectMetadata(p),
        },
        actions: [copy(service, "Copy Service Role Key", { concealed: true }), ...shared],
      }]
      : []),
    {
      id: "logs",
      title: "Recent API Logs",
      subtitle: "Requests of the last hour",
      icon: { source: Icons.activity, tint: "purple" },
      section: "Connect",
      detail: { metadata: projectMetadata(p) },
      actions: [action("Show Recent API Logs", () => logsView(token, p), { icon: Icons.text }), ...shared],
    },
  ];
}

function projectView(token: string, p: Project): ListSpec {
  let summary = "";
  return list({
    title: p.name,
    placeholder: `Filter ${p.name}: tables, functions, keys…`,
    status: () => summary,
    actions: [studioMenu(p.ref)],
    async *items({ signal }) {
      const shared = [studioMenu(p.ref), copy(p.ref, "Copy Project Reference", { section: "Copy" })];
      const offline = statusInfo(p.status).health === "paused";
      const [keys, functions, tables] = await Promise.allSettled([
        supabase<ApiKey[]>(token, `/projects/${p.ref}/api-keys`, { signal }),
        supabase<EdgeFunction[]>(token, `/projects/${p.ref}/functions`, { signal }),
        offline
          ? Promise.reject(new Error("The project is paused"))
          : supabase<unknown>(token, `/projects/${p.ref}/database/query`, {
            method: "POST",
            body: { query: TABLES_SQL },
            signal,
          }).then(parseTables),
      ]);
      const fns = functions.status === "fulfilled" ? functions.value.filter((f) => f.status !== "REMOVED") : [];
      const tbls = tables.status === "fulfilled" ? tables.value : [];
      const items: Item[] = [
        ...overviewItems(token, p, keys.status === "fulfilled" ? keys.value : undefined, shared),
        ...tbls.map((t) => tableItem(p, t, shared)),
      ];
      if (tables.status === "rejected") {
        const message = tables.reason instanceof Error ? tables.reason.message : String(tables.reason);
        items.push({
          id: "tables-error",
          title: offline ? "Tables are unavailable while paused" : "Tables could not be read",
          subtitle: offline ? "Restore the project to see them" : message,
          icon: { source: Icons.database, tint: "gray" },
          section: "Tables",
          detail: {
            markdown: offline
              ? "The database of a paused project is stopped."
              : `The SQL endpoint answered:\n\n${fence(message)}\n\nThe token needs access to the project's database.`,
          },
          actions: [open(dashboardUrl(p.ref, "/editor"), "Open Table Editor"), ...shared],
        });
      }
      items.push(...fns.map((f) => functionItem(token, p, f, shared)));
      const unsafe = tbls.filter((t) => !t.rls && t.schema === "public").length;
      summary = [
        p.name,
        statusInfo(p.status).label,
        tables.status === "fulfilled" ? `${tbls.length} table${tbls.length === 1 ? "" : "s"}` : "",
        `${fns.length} function${fns.length === 1 ? "" : "s"}`,
        unsafe ? `${unsafe} without RLS` : "",
      ].filter(Boolean).join(" · ");
      yield items;
    },
  });
}

// ---------------------------------------------------------------------------
// The projects

function projectItem(token: string, p: Project, org: string): Item {
  const s = statusInfo(p.status);
  const pg = postgresVersion(p.database?.version);
  return {
    id: p.ref,
    title: p.name,
    subtitle: regionName(p.region),
    icon: { source: Icons.database, tint: s.color },
    section: org,
    keywords: [p.ref, p.region, s.label, org],
    accessories: [
      ...(s.health !== "ok" ? [{ tag: s.label, color: s.color }] : []),
      ...(pg ? [{ text: `PG ${pg}`, tooltip: `Postgres ${p.database?.version}` }] : []),
    ],
    detail: { metadata: projectMetadata(p, org) },
    actions: [
      action("Open Project", () => projectView(token, p), { icon: Icons.arrowRight }),
      open(dashboardUrl(p.ref), "Open Dashboard", { shortcut: "<Ctrl>o" }),
      submenu(
        "Open in Studio",
        STUDIO_PAGES.map((x) => open(dashboardUrl(p.ref, x.page), x.title, { icon: x.icon })),
        { icon: Icons.external, shortcut: "<Ctrl><Shift>o", section: "Studio" },
      ),
      copy(apiUrl(p.ref), "Copy API URL", { shortcut: "<Ctrl>period", section: "Copy" }),
      action("Copy Anon Key", () => copyAnonKey(token, p.ref), {
        icon: Icons.key,
        shortcut: "<Ctrl><Shift>c",
        section: "Copy",
      }),
      copy(p.ref, "Copy Project Reference", { section: "Copy" }),
      ...powerActions(token, p),
    ],
  };
}

export default list({
  placeholder: "Filter Supabase projects…",
  empty: {
    title: "No Supabase project",
    description: "Create one at supabase.com/dashboard",
    icon: Icons.database,
  },
  status: (items) => {
    if (items[0]?.id === "setup") return "Not connected";
    const paused = items.filter((i) => i.accessories?.some((a) => a.tag === "Paused")).length;
    return `${items.length} project${items.length === 1 ? "" : "s"}${paused ? ` · ${paused} paused` : ""}`;
  },
  actions: [open("https://supabase.com/dashboard/new", "New Project", { icon: Icons.plus })],
  items: ({ preferences, signal }) =>
    guarded(async () => {
      const token = tokenOf(preferences);
      const [projects, orgs] = await Promise.all([
        supabase<Project[]>(token, "/projects", { signal }),
        supabase<Organization[]>(token, "/organizations", { signal }).catch(() => []),
      ]);
      const groups = groupProjects(projects, orgs);
      const all = groups.flatMap(([, ps]) => ps);
      const unhealthy = all.filter((p) => statusInfo(p.status).health === "failed").length;
      const paused = all.filter((p) => statusInfo(p.status).health === "paused").length;
      updateCommandMetadata({
        subtitle: all.length
          ? [
            `${all.length} project${all.length === 1 ? "" : "s"}`,
            unhealthy && `${unhealthy} unhealthy`,
            paused && `${paused} paused`,
          ]
            .filter(Boolean).join(" · ")
          : null,
      }).catch(() => {});
      return groups.flatMap(([org, ps]) => ps.map((p) => projectItem(token, p, org)));
    }),
});
