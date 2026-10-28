import {
  type Action,
  action,
  copy,
  exec,
  field,
  form,
  Icons,
  type Item,
  list,
  meta,
  type Metadata,
  open,
  pop,
  storage,
  toast,
  updateCommandMetadata,
} from "@backslash/api";
import {
  type Autostart,
  type DesktopFile,
  desktopFileName,
  type ExecOnce,
  mergeAutostart,
  newDesktopFile,
  parseHyprland,
  parseShow,
  parseUnitFiles,
  programName,
  resolveSource,
  tilde,
  toggledText,
  type UnitInfo,
} from "../lib.ts";

const HOME = Deno.env.get("HOME") ?? "";
const DESKTOP = Deno.env.get("XDG_CURRENT_DESKTOP") ?? "";
const USER_DIR = `${HOME}/.config/autostart`;
const SYSTEM_DIR = "/etc/xdg/autostart";
const HYPR_DIR = `${HOME}/.config/hypr`;

// --- Loading -------------------------------------------------------------------

async function readDir(dir: string): Promise<DesktopFile[]> {
  const files: DesktopFile[] = [];
  try {
    for await (const e of Deno.readDir(dir)) {
      if (!e.name.endsWith(".desktop") || e.isDirectory) continue;
      const path = `${dir}/${e.name}`;
      const text = await Deno.readTextFile(path).catch(() => undefined);
      if (text !== undefined) files.push({ path, text });
    }
  } catch (err) {
    if (!(err instanceof Deno.errors.NotFound)) throw err;
  }
  return files;
}

interface Unit extends UnitInfo {
  enabled: boolean;
  preset?: string;
}

const DISABLED_KEY = "disabled-units";

/** User units enabled at login, plus those turned off here (so they can be turned back on). */
async function loadUnits(): Promise<Unit[] | undefined> {
  let out: string;
  try {
    out = await exec("systemctl", [
      "--user",
      "list-unit-files",
      "--state=enabled",
      "--type=service",
      "--no-legend",
      "--plain",
      "--no-pager",
    ]);
  } catch {
    return undefined; // No systemd, or no user manager.
  }
  const files = parseUnitFiles(out);
  const disabledHere = (await storage.get<string[]>(DISABLED_KEY).catch(() => undefined)) ?? [];
  const names = [...new Set([...files.map((f) => f.unit), ...disabledHere])];
  if (names.length === 0) return [];
  const show = await exec("systemctl", [
    "--user",
    "show",
    "--property=Id,Description,ActiveState,SubState,FragmentPath,WantedBy,ExecStart,UnitFileState",
    "--no-pager",
    "--",
    ...names,
  ]).catch(() => undefined);
  const infos = new Map(parseShow(show ?? "").map((i) => [i.id, i]));
  const enabled = new Set(files.map((f) => f.unit));
  // A unit disabled here and later re-enabled elsewhere, or removed, needs no reminder.
  const stillDisabled = show === undefined
    ? disabledHere.filter((u) => !enabled.has(u))
    : disabledHere.filter((u) => !enabled.has(u) && infos.get(u)?.fragmentPath);
  if (stillDisabled.length !== disabledHere.length) storage.set(DISABLED_KEY, stillDisabled).catch(() => {});
  return [...enabled, ...stillDisabled].map((unit) => ({
    ...(infos.get(unit) ?? { id: unit, wantedBy: [] }),
    id: unit,
    enabled: enabled.has(unit),
    preset: files.find((f) => f.unit === unit)?.preset,
  }));
}

async function loadHyprland(): Promise<{ execs: ExecOnce[]; config?: string }> {
  const main = `${HYPR_DIR}/hyprland.conf`;
  const execs: ExecOnce[] = [];
  const seen = new Set<string>();
  const visit = async (file: string, depth: number) => {
    if (seen.has(file) || depth > 5 || !file.startsWith(HYPR_DIR + "/")) return;
    seen.add(file);
    const text = await Deno.readTextFile(file).catch(() => undefined);
    if (text === undefined) return;
    const parsed = parseHyprland(text, file);
    execs.push(...parsed.execs);
    for (const s of parsed.sources) await visit(resolveSource(s, file, HOME), depth + 1);
  };
  await visit(main, 0);
  return { execs, config: seen.size ? main : undefined };
}

// --- Changes -------------------------------------------------------------------

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

async function setAutostart(a: Autostart, on: boolean) {
  const userPath = `${USER_DIR}/${a.id}`;
  const userText = a.origin === "system" ? undefined : await Deno.readTextFile(userPath);
  const systemPath = a.origin === "system" ? a.path : a.systemPath;
  const systemText = systemPath ? await Deno.readTextFile(systemPath) : undefined;
  await Deno.mkdir(USER_DIR, { recursive: true });
  await Deno.writeTextFile(userPath, toggledText(userText, systemText, on));
}

async function setUnit(u: Unit, on: boolean) {
  await exec("systemctl", ["--user", on ? "enable" : "disable", "--", u.id]).catch((err) => {
    throw new Error(String(err?.message ?? err).replace(/^systemctl exited with \d+: /, ""));
  });
  const list = (await storage.get<string[]>(DISABLED_KEY).catch(() => undefined)) ?? [];
  await storage.set(DISABLED_KEY, on ? list.filter((x) => x !== u.id) : [...new Set([...list, u.id])]);
}

const addForm = () =>
  form({
    title: "Add Startup App",
    submitTitle: "Add",
    fields: [
      field.text("name", "Name", { required: true, placeholder: "Syncthing" }),
      field.text("command", "Command", { required: true, placeholder: "syncthing serve --no-browser" }),
      field.text("comment", "Description", { placeholder: "Optional" }),
    ],
    async submit(values) {
      const name = String(values.name).trim();
      const command = String(values.command).trim();
      if (!name || !command) throw new Error("A name and a command are needed");
      await Deno.mkdir(USER_DIR, { recursive: true });
      const taken = (await readDir(USER_DIR)).map((f) => f.path.split("/").pop()!);
      const file = desktopFileName(name, taken);
      await Deno.writeTextFile(`${USER_DIR}/${file}`, newDesktopFile(name, command, String(values.comment ?? "")));
      await toast(`${name} starts at login`, { style: "success" });
      changed();
      return pop();
    },
  });

// --- Items ---------------------------------------------------------------------

const ORIGIN: Record<Autostart["origin"], string> = {
  user: "Added by you",
  system: "Installed by the system",
  override: "System entry, changed by you",
};

function autostartItem(a: Autostart): Item {
  const toggle = action(a.enabled ? "Disable at Login" : "Enable at Login", async () => {
    await setAutostart(a, !a.enabled);
    await toast(`${a.name} ${a.enabled ? "won't start" : "starts"} at login`, { style: "success" });
    changed();
  }, { icon: a.enabled ? Icons.pause : Icons.play, shortcut: "<Ctrl>t" });
  const actions: Action[] = [
    toggle,
    open(a.path, "Open Desktop File", { icon: Icons.file, shortcut: "<Ctrl>o" }),
    ...(a.systemPath && a.systemPath !== a.path ? [open(a.systemPath, "Open System File", { icon: Icons.file })] : []),
    open(USER_DIR, "Open Autostart Folder", { icon: Icons.folder }),
    copy(a.exec, "Copy Command", { section: "Copy", shortcut: "<Ctrl><Shift>c" }),
    copy(a.path, "Copy File Path", { section: "Copy" }),
  ];
  if (a.origin === "user") {
    actions.push(action("Remove", async () => {
      await Deno.remove(a.path);
      await toast(`${a.name} removed`, { style: "success" });
      changed();
    }, {
      icon: Icons.trash,
      destructive: true,
      confirm: `Delete ${a.id} from ~/.config/autostart?`,
      shortcut: "<Ctrl>BackSpace",
      section: "Danger",
    }));
  } else if (a.origin === "override") {
    actions.push(action("Restore System Default", async () => {
      await Deno.remove(a.path);
      await toast(`${a.name} restored`, { style: "success" });
      changed();
    }, {
      icon: Icons.history,
      destructive: true,
      confirm: `Delete your copy of ${a.id} and use the system's again?`,
      section: "Danger",
    }));
  }
  const metadata: Metadata[] = [
    meta.text("Status", a.enabled ? "Starts at login" : "Disabled", {
      icon: a.enabled ? Icons.done : Icons.canceled,
      color: a.enabled ? "green" : "gray",
    }),
    meta.text("Program", programName(a.exec) || "–", { icon: Icons.terminal }),
    ...(a.delay ? [meta.text("Delay", `${a.delay} s`, { icon: Icons.timer })] : []),
    ...(a.entry.OnlyShowIn ? [meta.tags("Only in", a.entry.OnlyShowIn.split(";").filter(Boolean))] : []),
    ...(a.entry.NotShowIn ? [meta.tags("Not in", a.entry.NotShowIn.split(";").filter(Boolean))] : []),
    meta.separator(),
    meta.text("Origin", ORIGIN[a.origin], { icon: a.origin === "system" ? Icons.server : Icons.person }),
    meta.text("File", tilde(a.path, HOME), { icon: Icons.file }),
    ...(a.systemPath && a.systemPath !== a.path ? [meta.text("System file", a.systemPath)] : []),
  ];
  return {
    id: `xdg:${a.id}`,
    title: a.name,
    subtitle: a.comment ?? programName(a.exec),
    icon: { source: Icons.rocket, tint: a.enabled ? (a.otherDesktop ? "gray" : "green") : "gray" },
    section: "Autostart Apps",
    keywords: [a.id, a.exec, programName(a.exec), a.enabled ? "enabled" : "disabled"],
    accessories: [
      ...(a.otherDesktop && a.enabled ? [{ tag: "Other desktops", color: "gray" as const }] : []),
      ...(a.origin !== "system" ? [{ icon: Icons.person, tooltip: ORIGIN[a.origin] }] : []),
      a.enabled ? { tag: "On", color: "green" as const } : { tag: "Off", color: "gray" as const },
    ],
    detail: {
      markdown: [
        a.comment ?? "",
        a.otherDesktop
          ? `> Not started in this desktop (${DESKTOP || "unknown"}): its OnlyShowIn / NotShowIn rule leaves it out.`
          : "",
        "```\n" + (a.exec || "(no command)") + "\n```",
      ].filter(Boolean).join("\n\n"),
      metadata,
    },
    actions,
  };
}

function unitItem(u: Unit): Item {
  const running = u.activeState === "active";
  const failed = u.activeState === "failed";
  const kind = u.id.split(".").pop() ?? "service";
  const svc = (verb: string, done: string) =>
    action(`${verb[0].toUpperCase()}${verb.slice(1)} Now`, async () => {
      await exec("systemctl", ["--user", verb, "--", u.id]);
      await toast(`${u.id} ${done}`, { style: "success" });
      changed();
    }, {
      icon: verb === "stop" ? Icons.stop : verb === "start" ? Icons.play : Icons.refresh,
      section: "Service",
      ...(verb === "stop" ? { confirm: `Stop ${u.id} now?` } : {}),
    });
  return {
    id: `unit:${u.id}`,
    title: u.description && u.description !== u.id ? u.description : u.id,
    subtitle: u.description && u.description !== u.id ? u.id : undefined,
    icon: { source: Icons.server, tint: !u.enabled ? "gray" : failed ? "red" : running ? "blue" : "gray" },
    section: "Systemd User Services",
    keywords: [u.id, kind, "systemd", u.execStart ?? "", u.enabled ? "enabled" : "disabled"],
    accessories: [
      ...(failed ? [{ tag: "Failed", color: "red" as const }] : running ? [{ text: "running" }] : []),
      u.enabled ? { tag: "On", color: "green" as const } : { tag: "Off", color: "gray" as const },
    ],
    detail: {
      markdown: u.execStart ? "```\n" + u.execStart + "\n```" : undefined,
      metadata: [
        meta.text("Unit", u.id, { icon: Icons.server }),
        meta.text("At login", u.enabled ? "Enabled" : "Disabled", {
          icon: u.enabled ? Icons.done : Icons.canceled,
          color: u.enabled ? "green" : "gray",
        }),
        meta.text("State", [u.activeState, u.subState].filter(Boolean).join(" · ") || "unknown", {
          color: failed ? "red" : running ? "green" : undefined,
        }),
        ...(u.wantedBy.length ? [meta.tags("Wanted by", u.wantedBy)] : []),
        ...(u.preset ? [meta.text("Vendor preset", u.preset)] : []),
        meta.separator(),
        ...(u.fragmentPath ? [meta.text("File", tilde(u.fragmentPath, HOME), { icon: Icons.file })] : []),
      ],
    },
    actions: [
      action(u.enabled ? "Disable at Login" : "Enable at Login", async () => {
        await setUnit(u, !u.enabled);
        await toast(`${u.id} ${u.enabled ? "disabled" : "enabled"}`, { style: "success" });
        changed();
      }, { icon: u.enabled ? Icons.pause : Icons.play, shortcut: "<Ctrl>t" }),
      ...(u.fragmentPath ? [open(u.fragmentPath, "Open Unit File", { icon: Icons.file, shortcut: "<Ctrl>o" })] : []),
      running ? svc("stop", "stopped") : svc("start", "started"),
      ...(running ? [svc("restart", "restarted")] : []),
      copy(u.id, "Copy Unit Name", { section: "Copy" }),
      copy(`systemctl --user status ${u.id}`, "Copy Status Command", { section: "Copy" }),
    ],
  };
}

function hyprItem(e: ExecOnce, config: string): Item {
  const where = `${tilde(e.file, HOME)}:${e.line}`;
  return {
    id: `hypr:${e.file}:${e.line}`,
    title: programName(e.command) || e.command,
    subtitle: e.command !== programName(e.command) ? e.command : undefined,
    icon: { source: Icons.terminal, tint: "teal" },
    section: "Hyprland",
    keywords: [e.command, "hyprland", e.keyword],
    accessories: [{ text: where.split("/").pop(), tooltip: where }, { tag: e.keyword, color: "teal" }],
    detail: {
      markdown: [
        "```",
        e.command,
        "```",
        "",
        e.keyword === "exec-once"
          ? "Started once when Hyprland starts. Edit the line in your config to change it."
          : "Started at login and again each time the config is reloaded.",
      ].join("\n"),
      metadata: [
        meta.text("Program", programName(e.command), { icon: Icons.terminal }),
        meta.text("Keyword", e.keyword),
        meta.text("Defined in", where, { icon: Icons.file }),
        meta.text("Status", "Read-only here", { icon: Icons.lock, color: "gray" }),
      ],
    },
    actions: [
      open(e.file, "Open Config File", { icon: Icons.file }),
      ...(e.file !== config ? [open(config, "Open hyprland.conf", { icon: Icons.file })] : []),
      copy(e.command, "Copy Command", { section: "Copy", shortcut: "<Ctrl><Shift>c" }),
      copy(where, "Copy Location", { section: "Copy" }),
    ],
  };
}

let counts = { shown: 0, enabled: 0 };

const addAction = action("Add Startup App…", () => addForm(), { icon: Icons.plus, shortcut: "<Ctrl>n" });

export default list({
  placeholder: "Filter apps that start at login…",
  filter: {
    options: [
      { value: "all", title: "All" },
      { value: "enabled", title: "Enabled" },
      { value: "disabled", title: "Disabled" },
    ],
  },
  empty: {
    title: "Nothing starts at login",
    description: "Press Ctrl+N to add an app that starts when you log in",
    icon: Icons.rocket,
  },
  actions: [addAction, open(USER_DIR, "Open Autostart Folder", { icon: Icons.folder })],
  status: (items) =>
    `${counts.enabled} at login${items.length !== counts.shown ? ` · ${items.length} of ${counts.shown} shown` : ""}`,
  items: ({ filter, signal }) =>
    live(async () => {
      const [user, system, units, hypr] = await Promise.all([
        readDir(USER_DIR),
        readDir(SYSTEM_DIR),
        loadUnits(),
        loadHyprland(),
      ]);
      const autostart = mergeAutostart(user, system, DESKTOP);
      const on = (a: { enabled: boolean }) => filter !== "enabled" || a.enabled;
      const off = (a: { enabled: boolean }) => filter !== "disabled" || !a.enabled;
      const keep = (a: { enabled: boolean }) => on(a) && off(a);
      const enabled = autostart.filter((a) => a.enabled && !a.otherDesktop).length +
        (units ?? []).filter((u) => u.enabled).length + hypr.execs.length;
      updateCommandMetadata({ subtitle: `${enabled} at login` }).catch(() => {});
      const items = [
        ...autostart.filter(keep).map(autostartItem).map((i) => ({ ...i, actions: [...i.actions!, addAction] })),
        ...(units ?? []).filter(keep).map(unitItem),
        ...(filter === "disabled" ? [] : hypr.execs.map((e) => hyprItem(e, hypr.config!))),
      ];
      counts = { shown: items.length, enabled };
      return items;
    }, signal),
});
