import {
  type Action,
  action,
  type Color,
  copy,
  detail,
  field,
  form,
  Icons,
  type Item,
  list,
  meta,
  type Metadata,
  pop,
  toast,
  updateCommandMetadata,
} from "@backslash/api";
import {
  ago,
  changeRange,
  changesMarkdown,
  CLEANUP_LABELS,
  countChanges,
  diffMarkdown,
  formatBytes,
  formatDate,
  parseSnapperStatus,
  snapperDiffScript,
  snapperRollbackScript,
  snapperTitle,
  snapperUndoScript,
  type Snapshot,
  sortSnapshots,
  TAG_LABELS,
  timeshiftRestoreScript,
} from "../lib.ts";
import {
  btrfsAsRoot,
  createSnapshot,
  deleteSnapshot,
  load,
  type Loaded,
  snapper,
  snapperAsRoot,
  timeshiftAsRoot,
} from "../snapshots.ts";
import { launch, runInTerminal } from "../terminal.ts";

type Prefs = { terminal?: string };

// --- Live reload ---------------------------------------------------------------

const changes = new EventTarget();
const changed = (): void => {
  changes.dispatchEvent(new Event("change"));
};

async function* live<T>(next: () => Promise<T>, signal: AbortSignal): AsyncGenerator<T> {
  while (!signal.aborted) {
    yield await next();
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

async function step(message: string, fn: () => Promise<unknown>) {
  await fn();
  await toast(message, { style: "success" });
  changed();
}

// --- Forms and views -------------------------------------------------------------

function createForm(state: Loaded) {
  const tools = [
    ...(state.snapper ? [{ value: "snapper", title: "Snapper" }] : []),
    ...(state.timeshift ? [{ value: "timeshift", title: "Timeshift" }] : []),
  ];
  const configs = state.snapper?.configs ?? [];
  return form({
    title: "Create Snapshot",
    submitTitle: "Create",
    fields: [
      field.text("description", "Description", { placeholder: "Before upgrading the kernel", required: true }),
      ...(tools.length > 1 ? [field.dropdown("tool", "Tool", tools, { value: tools[0].value })] : []),
      ...(state.snapper
        ? [
          field.dropdown(
            "config",
            "Snapper config",
            configs.map((c) => ({ value: c.name, title: `${c.name} (${c.subvolume})` })),
            { value: configs.find((c) => c.name === "root")?.name ?? configs[0]?.name },
          ),
          field.dropdown("cleanup", "Cleanup", [
            { value: "number", title: "Number (kept among the last ones)" },
            { value: "timeline", title: "Timeline (hourly, daily… limits)" },
            { value: "none", title: "None (kept until deleted)" },
          ], { value: "number" }),
          field.checkbox("important", "Mark as important"),
        ]
        : []),
    ],
    async submit(values) {
      const tool = String(values.tool || tools[0]?.value) as "snapper" | "timeshift";
      await toast(tool === "timeshift" ? "Creating the Timeshift snapshot… this can take a while" : "Creating…");
      const id = await createSnapshot(tool, {
        description: String(values.description ?? "").trim(),
        config: String(values.config || "root"),
        cleanup: String(values.cleanup || "number"),
        important: values.important === true,
      });
      await toast(id ? `Snapshot ${id} created` : "Snapshot created", { style: "success" });
      changed();
      return pop();
    },
  });
}

async function changesView(s: Snapshot, all: Snapshot[], prefs: Prefs) {
  const config = s.config ?? "root";
  const range = changeRange(s, all);
  const out = await snapper(["-c", config, "status", `${range.from}..${range.to}`]);
  const files = parseSnapperStatus(out);
  const c = countChanges(files);
  return detail({
    title: `${snapperTitle(s, all)} · ${range.label}`,
    markdown: `## Changed files ${range.label}\n\n${changesMarkdown(files)}`,
    stats: [
      { label: "Modified", value: c.modified + c.type, color: "yellow" },
      { label: "Created", value: c.created, color: "green" },
      { label: "Deleted", value: c.deleted, color: "red" },
    ],
    status: `${files.length} files · ${config}`,
    actions: [
      action("Show Content Diff", async () => {
        const diff = await snapper(["-c", config, "diff", `${range.from}..${range.to}`]);
        return detail({
          title: `Diff ${range.label}`,
          markdown: diffMarkdown(diff),
          actions: [copy(diff, "Copy Diff")],
        });
      }, { icon: Icons.code }),
      action("Open Diff in Terminal", () => {
        runInTerminal(snapperDiffScript(config, range.from, range.to), prefs.terminal || undefined);
      }, { icon: Icons.terminal }),
      ...undoActions(s, all, prefs),
      copy(files.map((f) => f.path).join("\n"), "Copy File List", { section: "Copy" }),
    ],
  });
}

function undoActions(s: Snapshot, all: Snapshot[], prefs: Prefs): Action[] {
  const config = s.config ?? "root";
  const range = changeRange(s, all);
  const actions: Action[] = [
    action("Undo These Changes in Terminal…", () => {
      runInTerminal(snapperUndoScript(config, range.from, range.to), prefs.terminal || undefined);
    }, {
      icon: Icons.history,
      destructive: true,
      confirm: `Open a terminal to undo the changes ${range.label} in ${config}?`,
      section: "Restore",
    }),
  ];
  if (config === "root") {
    actions.push(action("Roll Back to This Snapshot in Terminal…", () => {
      runInTerminal(snapperRollbackScript(config, s.id), prefs.terminal || undefined);
    }, {
      icon: Icons.history,
      destructive: true,
      confirm: `Open a terminal to make snapshot #${s.id} the system booted next time?`,
      section: "Restore",
    }));
  }
  return actions;
}

// --- Items -------------------------------------------------------------------------

const KIND_COLOR: Record<string, Color> = { single: "blue", pre: "orange", post: "green" };
const TAG_COLOR: Record<string, Color> = {
  ondemand: "blue",
  boot: "purple",
  hourly: "teal",
  daily: "green",
  weekly: "yellow",
  monthly: "orange",
};

function common(state: Loaded): Action[] {
  return [
    ...(state.snapper || state.timeshift
      ? [action("Create Snapshot…", () => createForm(state), { icon: Icons.plus, shortcut: "<Ctrl>n" })]
      : []),
    action("Reload", () => changed(), { icon: Icons.refresh, shortcut: "<Ctrl>r" }),
  ];
}

function snapperItem(s: Snapshot, all: Snapshot[], state: Loaded, prefs: Prefs): Item {
  const title = snapperTitle(s, all);
  const range = changeRange(s, all);
  const kind = s.kind ?? "single";
  const important = s.userdata?.important === "yes";
  const metadata: Metadata[] = [
    meta.text("Number", `#${s.id}`, { icon: Icons.hash }),
    meta.text("Config", s.config ?? "root", { icon: Icons.layers }),
    meta.text("Type", kind, { icon: { source: Icons.todo, tint: KIND_COLOR[kind] } }),
    ...(s.preNumber !== undefined ? [meta.text("Pre snapshot", `#${s.preNumber}`, { icon: Icons.arrowRight })] : []),
    ...(s.date ? [meta.text("Date", `${formatDate(s.date)} (${ago(s.date)})`, { icon: Icons.calendar })] : []),
    meta.text("Cleanup", s.cleanup ? CLEANUP_LABELS[s.cleanup] ?? s.cleanup : "None (kept until deleted)", {
      icon: Icons.trash,
    }),
    ...(s.size !== undefined ? [meta.text("Exclusive size", formatBytes(s.size), { icon: Icons.drive })] : []),
    ...(s.user ? [meta.text("User", s.user, { icon: Icons.person })] : []),
    ...(s.userdata ? [meta.tags("User data", Object.entries(s.userdata).map(([k, v]) => `${k}=${v}`))] : []),
    ...(s.isDefault ? [meta.text("Boot", "Default snapshot", { icon: Icons.power, color: "blue" })] : []),
    ...(s.active ? [meta.text("Mounted", "Currently running system", { icon: Icons.check, color: "green" })] : []),
  ];
  return {
    id: `snapper:${s.config}:${s.id}`,
    title,
    subtitle: s.date ? formatDate(s.date) : undefined,
    icon: { source: Icons.history, tint: KIND_COLOR[kind] },
    section: `Snapper · ${s.config}`,
    keywords: [s.id, kind, s.cleanup ?? "", s.config ?? "", ...(important ? ["important"] : [])],
    accessories: [
      ...(important ? [{ icon: { source: Icons.starFilled, tint: "yellow" as const }, tooltip: "Important" }] : []),
      ...(s.active ? [{ tag: "Running", color: "green" as const }] : []),
      ...(s.isDefault && !s.active ? [{ tag: "Default", color: "blue" as const }] : []),
      ...(s.size !== undefined ? [{ text: formatBytes(s.size), tooltip: "Exclusive size" }] : []),
      ...(s.cleanup ? [{ tag: CLEANUP_LABELS[s.cleanup] ?? s.cleanup, color: "gray" as const }] : []),
      { tag: kind === "single" ? "Single" : kind === "pre" ? "Pre" : "Post", color: KIND_COLOR[kind] },
      { text: `#${s.id}` },
      ...(s.date ? [{ text: ago(s.date), tooltip: formatDate(s.date) }] : []),
    ],
    detail: { metadata },
    actions: [
      action(`Show Changes ${range.label}`, () => changesView(s, all, prefs), { icon: Icons.eye }),
      ...common(state),
      ...undoActions(s, all, prefs),
      copy(s.id, "Copy Number", { section: "Copy", shortcut: "<Ctrl><Shift>c" }),
      copy(`snapper -c ${s.config} status ${range.from}..${range.to}`, "Copy Status Command", { section: "Copy" }),
      action("Delete Snapshot", () => step(`Snapshot #${s.id} deleted`, () => deleteSnapshot(s)), {
        icon: Icons.trash,
        destructive: true,
        confirm: `Delete snapshot #${s.id} “${title}” of ${s.config}?`,
        shortcut: "<Ctrl>Delete",
        section: "Danger",
      }),
    ],
  };
}

function timeshiftItem(s: Snapshot, state: Loaded, prefs: Prefs): Item {
  const ts = state.timeshift!;
  const main = s.tags[0] ?? "ondemand";
  return {
    id: `timeshift:${s.id}`,
    title: s.description || s.id,
    subtitle: s.description ? s.id : undefined,
    icon: { source: Icons.history, tint: TAG_COLOR[main] ?? "blue" },
    section: "Timeshift",
    keywords: [s.id, ...s.tags, ...s.tags.map((t) => TAG_LABELS[t] ?? t)],
    accessories: [
      ...s.tags.map((t) => ({ tag: TAG_LABELS[t] ?? t, color: TAG_COLOR[t] ?? "gray" })),
      ...(s.date ? [{ text: ago(s.date), tooltip: formatDate(s.date) }] : []),
    ],
    detail: {
      metadata: [
        meta.text("Name", s.id, { icon: Icons.tag }),
        ...(s.date ? [meta.text("Date", `${formatDate(s.date)} (${ago(s.date)})`, { icon: Icons.calendar })] : []),
        meta.tags("Tags", s.tags.map((t) => ({ text: TAG_LABELS[t] ?? t, color: TAG_COLOR[t] }))),
        meta.text("Description", s.description || "None", { icon: Icons.comment }),
        meta.separator(),
        meta.text("Mode", ts.root?.device.mode ?? (ts.config?.btrfs ? "BTRFS" : "RSYNC"), { icon: Icons.layers }),
        ...(ts.root?.device.device ? [meta.text("Device", ts.root.device.device, { icon: Icons.drive })] : []),
      ],
    },
    actions: [
      action("Restore in Terminal…", () => {
        runInTerminal(timeshiftRestoreScript(s.id), prefs.terminal || undefined);
      }, {
        icon: Icons.history,
        destructive: true,
        confirm: `Open a terminal to restore the system to ${s.id}? Timeshift asks before changing anything`,
        section: "Restore",
      }),
      ...common(state),
      copy(s.id, "Copy Name", { section: "Copy", shortcut: "<Ctrl><Shift>c" }),
      action("Delete Snapshot", () => step(`Snapshot ${s.id} deleted`, () => deleteSnapshot(s)), {
        icon: Icons.trash,
        destructive: true,
        confirm: `Delete the Timeshift snapshot ${s.id}?`,
        shortcut: "<Ctrl>Delete",
        section: "Danger",
      }),
    ],
  };
}

function btrfsItem(s: Snapshot, state: Loaded): Item {
  return {
    id: `btrfs:${s.id}`,
    title: s.description,
    subtitle: s.path,
    icon: { source: Icons.history, tint: "gray" },
    section: "Btrfs Snapshots",
    keywords: [s.id, s.path ?? ""],
    accessories: [
      { text: `ID ${s.id}` },
      ...(s.date ? [{ text: ago(s.date), tooltip: formatDate(s.date) }] : []),
    ],
    detail: {
      markdown: "Listed read-only: install **Snapper** or **Timeshift** to create, compare and restore snapshots.",
      metadata: [
        meta.text("Subvolume ID", s.id, { icon: Icons.hash }),
        meta.text("Path", s.path ?? "?", { icon: Icons.folder }),
        ...(s.date ? [meta.text("Created", `${formatDate(s.date)} (${ago(s.date)})`, { icon: Icons.calendar })] : []),
      ],
    },
    actions: [
      copy(s.path ?? s.description, "Copy Path"),
      copy(s.id, "Copy Subvolume ID"),
      ...common(state),
    ],
  };
}

function statusItems(state: Loaded): Item[] {
  const items: Item[] = [];
  const ts = state.timeshift;
  if (ts) {
    const config = ts.config;
    const dev = ts.root?.device;
    const ok = !dev || /OK/i.test(dev.status ?? "OK");
    const schedule = config?.schedule ?? [];
    items.push({
      id: "timeshift",
      title: "Timeshift",
      subtitle: ts.root
        ? `${ts.root.snapshots.length} snapshots${dev?.free ? ` · ${dev.free} free` : ""}`
        : "Snapshots need your password",
      icon: { source: Icons.shield, tint: ok ? "green" : "orange" },
      section: "Status",
      keywords: ["timeshift", "status", "schedule"],
      accessories: [
        ...(!ts.root ? [{ icon: Icons.lock, tooltip: "Root only" }] : []),
        { tag: config?.btrfs ? "Btrfs" : "Rsync", color: "gray" },
        { tag: schedule.length ? schedule.map((s) => TAG_LABELS[s]).join(", ") : "No schedule", color: "blue" },
      ],
      detail: {
        stats: [
          { label: "Snapshots", value: ts.root ? ts.root.snapshots.length : "?" },
          { label: "Free", value: dev?.free ?? "?" },
          { label: "Mode", value: dev?.mode ?? (config?.btrfs ? "BTRFS" : "RSYNC") },
        ],
        markdown: ts.root
          ? ts.error ? `Couldn't list snapshots: ${ts.error}` : undefined
          : "Timeshift lists its snapshots only to root: **Enter** shows them after asking for your password.",
        metadata: [
          ...(dev?.device ? [meta.text("Device", dev.device, { icon: Icons.drive })] : []),
          ...(dev?.path ? [meta.text("Mounted at", dev.path, { icon: Icons.folder })] : []),
          ...(dev?.status ? [meta.text("Status", dev.status, { color: ok ? "green" : "orange" })] : []),
          meta.tags(
            "Schedule",
            schedule.length
              ? schedule.map((s) => ({
                text: `${TAG_LABELS[s]} · keep ${config?.counts[s] ?? "?"}`,
                color: TAG_COLOR[s],
              }))
              : ["None"],
          ),
          ...(config ? [meta.text("Home included", config.includeHome ? "Yes" : "No", { icon: Icons.home })] : []),
        ],
      },
      actions: [
        action(ts.root ? "Reload Snapshots" : "Show Snapshots", () => step("Snapshots loaded", timeshiftAsRoot), {
          icon: Icons.lock,
          shortcut: "<Ctrl><Shift>r",
        }),
        ...common(state),
        action("Open Timeshift", () => {
          if (!launch("timeshift-launcher") && !launch("timeshift-gtk")) {
            throw new Error("Timeshift's window isn't installed");
          }
        }, { icon: Icons.window, section: "Apps" }),
      ],
    });
  }
  const sn = state.snapper;
  if (sn) {
    const locked = sn.locked.filter((c) => !sn.unlocked.includes(c));
    items.push({
      id: "snapper",
      title: "Snapper",
      subtitle: `${sn.configs.map((c) => c.name).join(", ") || "No config"} · ${sn.snapshots.length} snapshots`,
      icon: { source: Icons.shield, tint: sn.configs.length ? "green" : "orange" },
      section: "Status",
      keywords: ["snapper", "status", ...sn.configs.map((c) => c.name)],
      accessories: [
        ...(locked.length ? [{ text: `${locked.join(", ")} need your password`, icon: Icons.lock }] : []),
        { tag: `${sn.configs.length} config${sn.configs.length === 1 ? "" : "s"}`, color: "blue" },
      ],
      detail: {
        stats: sn.configs.slice(0, 3).map((c) => ({
          label: c.name,
          value: sn.snapshots.filter((s) => s.config === c.name).length,
        })),
        markdown: [
          sn.configs.length ? "" : "Snapper has no config: create one with `sudo snapper -c root create-config /`.",
          locked.length
            ? `Snapshots of **${
              locked.join(", ")
            }** are readable by root only: **Enter** shows them after asking for your password. ` +
              "To skip the password, allow yourself with `sudo snapper -c root set-config ALLOW_USERS=$USER`."
            : "",
          sn.error ? `Couldn't list snapshots: ${sn.error}` : "",
        ].filter(Boolean).join("\n\n") || undefined,
        metadata: sn.configs.map((c) => meta.text(c.name, c.subvolume, { icon: Icons.folder })),
      },
      actions: [
        ...(locked.length
          ? [action("Show Snapshots", () => step("Snapshots loaded", () => snapperAsRoot(locked)), {
            icon: Icons.lock,
            shortcut: "<Ctrl><Shift>r",
          })]
          : []),
        ...common(state),
        action("Open Btrfs Assistant", () => {
          if (!launch("btrfs-assistant-launcher") && !launch("btrfs-assistant")) {
            throw new Error("Btrfs Assistant isn't installed");
          }
        }, { icon: Icons.window, section: "Apps" }),
      ],
    });
  }
  if (state.btrfs && !ts && !sn) {
    items.push({
      id: "btrfs",
      title: "Btrfs",
      subtitle: state.btrfs.snapshots ? `${state.btrfs.snapshots.length} snapshots` : "Snapshots need your password",
      icon: { source: Icons.drive, tint: "blue" },
      section: "Status",
      accessories: [{ tag: "Read-only", color: "gray" }],
      detail: {
        markdown: [
          "Your system is on **Btrfs** but neither Snapper nor Timeshift is installed.",
          state.btrfs.snapshots ? "" : "**Enter** lists the snapshot subvolumes after asking for your password.",
          "Install **Snapper** (with `snap-pac` or `dnf-plugin-snapper` for automatic pre/post snapshots) or " +
          "**Timeshift** to create and restore them from here.",
        ].filter(Boolean).join("\n\n"),
      },
      actions: [
        action(
          state.btrfs.snapshots ? "Reload Snapshots" : "Show Snapshots",
          () => step("Snapshots loaded", btrfsAsRoot),
          {
            icon: Icons.lock,
          },
        ),
        action("Reload", () => changed(), { icon: Icons.refresh, shortcut: "<Ctrl>r" }),
      ],
    });
  }
  return items;
}

function noToolItem(): Item {
  return {
    id: "none",
    title: "No snapshot tool found",
    subtitle: "Install Timeshift or Snapper",
    icon: { source: Icons.history, tint: "orange" },
    detail: {
      markdown: [
        "## No system snapshots",
        "",
        "Backslash shows the snapshots of **Timeshift** (any filesystem, rsync or Btrfs) and **Snapper** (Btrfs).",
        "",
        "- Ubuntu, Mint, Debian: `sudo apt install timeshift`",
        "- Fedora: `sudo dnf install snapper` or `timeshift`",
        "- Arch: `sudo pacman -S snapper snap-pac` or `timeshift`",
        "- openSUSE: Snapper is installed with Btrfs",
      ].join("\n"),
    },
    actions: [],
  };
}

export default list({
  placeholder: "Filter snapshots by description, date, type…",
  empty: { title: "No snapshot", description: "Ctrl+N creates one", icon: Icons.history },
  status: (items) => {
    const n = items.filter((i) => i.section !== "Status" && i.id !== "none").length;
    return n ? `${n} snapshot${n === 1 ? "" : "s"}` : "";
  },
  items: ({ signal, preferences }) =>
    live(async () => {
      const prefs = preferences as Prefs;
      const state = await load();
      if (!state.timeshift && !state.snapper && !state.btrfs) return [noToolItem()];
      const items = statusItems(state);
      const snaps: Snapshot[] = sortSnapshots([
        ...(state.snapper?.snapshots ?? []),
        ...(state.timeshift?.root?.snapshots ?? []),
        ...(state.btrfs?.snapshots ?? []),
      ]);
      const all = state.snapper?.snapshots ?? [];
      for (const s of snaps) {
        if (s.tool === "snapper") items.push(snapperItem(s, all, state, prefs));
        else if (s.tool === "timeshift") items.push(timeshiftItem(s, state, prefs));
        else items.push(btrfsItem(s, state));
      }
      const newest = snaps.find((s) => s.date);
      updateCommandMetadata({ subtitle: newest?.date ? `Last snapshot ${ago(newest.date)}` : null }).catch(() => {});
      return items;
    }, signal),
});
