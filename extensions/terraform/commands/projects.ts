import {
  type Action,
  action,
  copy,
  detail,
  Icons,
  type Item,
  list,
  type ListSpec,
  meta,
  type Metadata,
  open,
  refresh,
  storage,
  submenu,
  toast,
} from "@backslash/api";
import {
  attributes,
  display,
  findArgs,
  groupByType,
  type Output,
  outputText,
  parseAddress,
  parseFolders,
  parseOutputs,
  parseShow,
  parseStateList,
  parseWorkspaces,
  type Project,
  projectsFromFind,
  relativeTime,
  resourceId,
  shorten,
  type StateResource,
  tilde,
  type Workspaces,
} from "../lib.ts";
import {
  errorItem,
  HOME,
  inTerminal,
  Missing,
  missingItem,
  type Prefs,
  type Program,
  program,
  PROGRAM_NAMES,
  run,
  tf,
  tfArgv,
} from "../tf.ts";
import { shellLine } from "../terminal.ts";

const RECENT = "recent";
const fence = (text: string) => `\`\`\`\n${text.replace(/```/g, "ʼʼʼ") || "(empty)"}\n\`\`\``;

async function remember(path: string) {
  const recent = (await storage.get<string[]>(RECENT).catch(() => undefined)) ?? [];
  await storage.set(RECENT, [path, ...recent.filter((p) => p !== path)].slice(0, 8)).catch(() => {});
}

// ---------------------------------------------------------------------------
// Actions shared by every row of a project

function projectActions(p: Program, project: Project, prefs: Prefs, workspace?: string): Action[] {
  const where = workspace && workspace !== "default" ? ` (workspace ${workspace})` : "";
  const t = (title: string, args: string[], o: Parameters<typeof inTerminal>[3] = {}) =>
    inTerminal(title, tfArgv(p, project.path, args), prefs, o);
  return [
    t("Plan", ["plan"], { icon: Icons.search, shortcut: "<Ctrl>p" }),
    t("Apply", ["apply"], {
      icon: Icons.rocket,
      shortcut: "<Ctrl><Shift>a",
      confirm: `Apply ${project.name}${where}? ${PROGRAM_NAMES[p]} shows the plan and asks again.`,
      destructive: true,
    }),
    t("Init", ["init"], { icon: Icons.download, shortcut: "<Ctrl>i" }),
    t("Init and Upgrade Providers", ["init", "-upgrade"], { icon: Icons.download }),
    t("Validate", ["validate"], { icon: Icons.check, shortcut: "<Ctrl><Shift>v" }),
    t("Format Files", ["fmt", "-diff"], { icon: Icons.text, shortcut: "<Ctrl><Shift>f" }),
    submenu("Switch Workspace", async () => {
      const ws = parseWorkspaces(await tf(p, project.path, ["workspace", "list"]));
      return ws.names.map((name) =>
        action(name, async () => {
          await tf(p, project.path, ["workspace", "select", name]);
          await toast(`Workspace ${name}`, { style: "success", message: project.name });
          return refresh();
        }, { icon: name === ws.current ? Icons.check : Icons.layers })
      );
    }, { icon: Icons.layers, shortcut: "<Ctrl>w", section: "Workspace" }),
    open(project.path, "Open Folder", { icon: Icons.folder, shortcut: "<Ctrl>o", section: "Project" }),
    copy(project.path, "Copy Path", { shortcut: "<Ctrl><Shift>c", section: "Copy" }),
  ];
}

// ---------------------------------------------------------------------------
// One project: workspaces, outputs, resources

function workspaceItem(p: Program, project: Project, ws: Workspaces, name: string, shared: Action[]): Item {
  const current = name === ws.current;
  return {
    id: `ws:${name}`,
    title: name,
    subtitle: current ? "Current workspace" : undefined,
    icon: { source: current ? Icons.check : Icons.layers, tint: current ? "green" : "purple" },
    section: "Workspaces",
    keywords: ["workspace"],
    accessories: current ? [{ tag: "Current", color: "green" }] : [],
    detail: {
      metadata: [
        meta.text("Workspace", name, { icon: Icons.layers }),
        meta.text("Status", current ? "Selected" : "Available", {
          icon: Icons.dot,
          color: current ? "green" : "gray",
        }),
        meta.text("Project", project.name, { icon: Icons.folder }),
      ],
    },
    actions: [
      ...(current ? [] : [action("Switch to Workspace", async () => {
        await tf(p, project.path, ["workspace", "select", name]);
        await toast(`Workspace ${name}`, { style: "success", message: project.name });
        return refresh();
      }, { icon: Icons.arrowRight })]),
      copy(name, "Copy Workspace Name", { section: "Copy" }),
      ...shared,
    ],
  };
}

function outputItem(p: Program, project: Project, o: Output, shared: Action[]): Item {
  const text = outputText(o);
  const preview = o.sensitive ? "••••••••" : shorten(display(o.value).replace(/\s+/g, " "), 60);
  return {
    id: `out:${o.name}`,
    title: o.name,
    subtitle: preview,
    icon: { source: o.sensitive ? Icons.lock : Icons.braces, tint: o.sensitive ? "orange" : "teal" },
    section: "Outputs",
    keywords: ["output", o.type],
    accessories: [
      ...(o.sensitive ? [{ tag: "Sensitive", color: "orange" as const }] : []),
      { text: o.type, tooltip: "Type" },
    ],
    detail: {
      markdown: o.sensitive ? "This output is **sensitive**: copy it to see it." : fence(text),
      metadata: [
        meta.text("Output", o.name, { icon: Icons.braces }),
        meta.text("Type", o.type),
        meta.text("Sensitive", o.sensitive ? "Yes" : "No", {
          icon: o.sensitive ? Icons.lock : Icons.eye,
          color: o.sensitive ? "orange" : undefined,
        }),
      ],
    },
    actions: [
      copy(text, o.sensitive ? "Copy Sensitive Value" : "Copy Value", { concealed: o.sensitive }),
      copy(o.name, "Copy Output Name", { section: "Copy" }),
      copy(`$(${shellLine(tfArgv(p, project.path, ["output", "-raw", o.name]))})`, "Copy Shell Substitution", {
        icon: Icons.terminal,
        section: "Copy",
      }),
      ...shared,
    ],
  };
}

function resourceItem(
  p: Program,
  project: Project,
  address: string,
  section: string,
  r: StateResource | undefined,
  prefs: Prefs,
  shared: Action[],
): Item {
  const a = parseAddress(address);
  const id = r ? resourceId(r) : undefined;
  const attrs = r ? attributes(r) : [];
  const metadata: Metadata[] = [
    meta.text(a.mode === "data" ? "Data source" : "Resource", a.type, {
      icon: a.mode === "data" ? Icons.search : Icons.box,
    }),
    meta.text("Name", `${a.name}${a.index !== undefined ? `[${a.index}]` : ""}`),
    ...(a.module ? [meta.text("Module", a.module, { icon: Icons.package })] : []),
    meta.text("Provider", r?.provider ?? a.type.split("_")[0], { icon: Icons.plug }),
    ...(r?.dependsOn.length ? [meta.tags("Depends on", r.dependsOn.slice(0, 6))] : []),
    ...(attrs.length ? [meta.separator()] : []),
    ...attrs.slice(0, 24).map((x) =>
      meta.text(x.key, x.value, x.sensitive ? { icon: Icons.lock, color: "orange" } : {})
    ),
  ];
  const stateShow = () =>
    tf(p, project.path, ["state", "show", "-no-color", address]).then((text) =>
      detail({
        title: address,
        markdown: fence(text),
        metadata,
        status: `${p} state show ${address}`,
        actions: [
          copy(text, "Copy State", { shortcut: "<Ctrl><Shift>c" }),
          ...(id ? [copy(id, "Copy ID", { shortcut: "<Ctrl>period" })] : []),
        ],
      })
    );
  return {
    id: `res:${address}`,
    title: a.module ? address.slice(a.module.length + 1) : address,
    subtitle: a.module || undefined,
    icon: {
      source: a.mode === "data" ? Icons.search : Icons.box,
      tint: a.mode === "data" ? "gray" : "blue",
    },
    section,
    keywords: [a.type, a.name, a.module, id ?? "", r?.provider ?? ""],
    accessories: [
      ...(id ? [{ text: shorten(id, 28), tooltip: "ID" }] : []),
      ...(r?.sensitive.length
        ? [{ icon: { source: Icons.lock, tint: "orange" as const }, tooltip: "Sensitive values" }]
        : []),
    ],
    detail: { metadata, markdown: r ? undefined : "Loading attributes…" },
    actions: [
      action("Show State", stateShow, { icon: Icons.info }),
      copy(address, "Copy Address", { shortcut: "<Ctrl>period", section: "Copy" }),
      ...(id ? [copy(id, "Copy ID", { icon: Icons.hash, section: "Copy" })] : []),
      copy(shellLine([p, "state", "show", address]), "Copy state show Command", {
        icon: Icons.terminal,
        section: "Copy",
      }),
      ...(a.mode === "managed"
        ? [inTerminal("Plan This Resource Only", tfArgv(p, project.path, ["plan", `-target=${address}`]), prefs, {
          icon: Icons.search,
          section: "Resource",
        })]
        : []),
      ...shared,
    ],
  };
}

function projectView(p: Program, project: Project, prefs: Prefs): ListSpec {
  let summary = "";
  return list({
    title: project.name,
    placeholder: `Filter ${project.name}: resources, outputs, workspaces…`,
    empty: { title: "Nothing in the state", description: "Run plan and apply to create resources", icon: Icons.layers },
    status: () => summary,
    actions: projectActions(p, project, prefs),
    async *items({ signal }) {
      summary = "";
      let ws: Workspaces;
      let addresses: string[];
      try {
        [ws, addresses] = await Promise.all([
          tf(p, project.path, ["workspace", "list"], signal).then(parseWorkspaces),
          tf(p, project.path, ["state", "list"], signal).then(parseStateList),
        ]);
      } catch (err) {
        if (signal.aborted) return;
        const item = errorItem(err, p, project.path, prefs);
        summary = `${project.name} · ${item.title}`;
        yield [item];
        return;
      }
      const outputs = await tf(p, project.path, ["output", "-json"], signal).then(parseOutputs).catch(() => []);
      const shared = projectActions(p, project, prefs, ws.current);
      const groups = groupByType(addresses.map(parseAddress));
      summary = [
        project.name,
        `workspace ${ws.current}`,
        `${addresses.length} resource${addresses.length === 1 ? "" : "s"}`,
        `${outputs.length} output${outputs.length === 1 ? "" : "s"}`,
      ].join(" · ");
      const build = (state?: Map<string, StateResource>): Item[] => [
        ...ws.names.map((name) => workspaceItem(p, project, ws, name, shared)),
        ...outputs.map((o) => outputItem(p, project, o, shared)),
        ...groups.flatMap(([type, rs]) =>
          rs.map((a) =>
            resourceItem(p, project, a.address, `${type} (${rs.length})`, state?.get(a.address), prefs, shared)
          )
        ),
      ];
      yield build();
      if (!addresses.length) return;
      try {
        const state = parseShow(await tf(p, project.path, ["show", "-json"], signal));
        yield build(new Map(state.resources.map((r) => [r.address, r])));
      } catch {
        // The addresses are still useful without their attributes.
      }
    },
  });
}

// ---------------------------------------------------------------------------
// The projects

function projectItem(p: Program, project: Project, prefs: Prefs, recent: boolean): Item {
  const open_ = action("Open Project", async () => {
    await remember(project.path);
    return projectView(p, project, prefs);
  }, { icon: Icons.arrowRight });
  const parent = tilde(project.path.slice(0, -project.name.length - 1) || "/", HOME);
  return {
    id: project.path,
    title: project.name,
    subtitle: parent,
    icon: {
      source: project.module ? Icons.package : Icons.layers,
      tint: project.module ? "gray" : project.initialized ? "purple" : "orange",
    },
    section: recent ? "Recent" : project.module ? "Modules" : "Projects",
    keywords: [project.path, ...project.files],
    accessories: [
      ...(!project.initialized && !project.module ? [{ tag: "Not initialized", color: "orange" as const }] : []),
      ...(project.localState ? [{ icon: Icons.file, tooltip: "Local state (terraform.tfstate)" }] : []),
      { text: `${project.files.length} file${project.files.length === 1 ? "" : "s"}`, tooltip: "Configuration files" },
      { text: relativeTime(project.modified), tooltip: "Last change" },
    ],
    detail: {
      stats: [
        { label: "files", value: project.files.length },
        { label: "changed", value: relativeTime(project.modified) },
      ],
      metadata: [
        meta.text("Folder", tilde(project.path, HOME), { icon: Icons.folder }),
        meta.text("Initialized", project.initialized ? "Yes (.terraform)" : "No: run init", {
          icon: project.initialized ? Icons.check : Icons.alert,
          color: project.initialized ? "green" : "orange",
        }),
        meta.text("State", project.localState ? "Local (terraform.tfstate)" : "Remote backend or none", {
          icon: Icons.database,
        }),
        ...(project.module ? [meta.text("Kind", "Module (under modules/)", { icon: Icons.package })] : []),
        meta.text("Program", PROGRAM_NAMES[p], { icon: Icons.terminal }),
        meta.separator(),
        meta.tags("Files", project.files.slice(0, 12)),
      ],
    },
    actions: [open_, ...projectActions(p, project, prefs)],
  };
}

export default list({
  placeholder: "Filter Terraform projects…",
  empty: {
    title: "No Terraform project found",
    description: "Set the folders to scan in Settings → Extensions → Terraform",
    icon: Icons.layers,
  },
  status: (items) => {
    const n = items.filter((i) => i.id?.startsWith("/")).length;
    return items[0]?.id === "missing" ? "Not installed" : `${n} project${n === 1 ? "" : "s"}`;
  },
  async items({ preferences, signal }) {
    const prefs = preferences as Prefs;
    let p: Program;
    try {
      p = await program(prefs);
    } catch (e) {
      if (e instanceof Missing) return [await missingItem()];
      throw e;
    }
    const roots = parseFolders(prefs.folders, HOME);
    // find exits with 1 when a folder doesn't exist; what it found is still good.
    const projects = projectsFromFind(
      await run("find", findArgs(roots, Number(prefs.depth) || 4), { signal, allowFailure: true }),
    );
    const recent = (await storage.get<string[]>(RECENT).catch(() => undefined)) ?? [];
    const rank = (x: Project) => {
      const i = recent.indexOf(x.path);
      return i === -1 ? recent.length : i;
    };
    return [...projects]
      .sort((a, b) => rank(a) - rank(b) || Number(a.module) - Number(b.module))
      .map((x) => projectItem(p, x, prefs, recent.includes(x.path)));
  },
});
