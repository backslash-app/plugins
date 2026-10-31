import {
  type Action,
  action,
  close,
  type Color,
  copy,
  Icons,
  type Item,
  list,
  meta,
  type Metadata,
  open,
  refresh,
  submenu,
  toast,
  updateCommandMetadata,
} from "@backslash/api";
import {
  type Connection,
  endpoint,
  formatBytes,
  groupSnaps,
  type Info,
  interfaceTitle,
  isHeld,
  isLocal,
  isSensitive,
  NOTE_TITLES,
  removeOldCommands,
  type Revision,
  type Snap,
  storeUrl,
  type Update,
} from "../lib.ts";
import { asRoot, connections, infos, launch, NotInstalled, revisions, sizes, updates } from "../system.ts";

const KIND_TITLES = {
  app: "Apps",
  base: "Bases & Runtimes",
  snapd: "Bases & Runtimes",
  kernel: "System",
  gadget: "System",
};

let summary = "";

async function change(label: string, commands: string[][], done: string) {
  await toast(label);
  await asRoot(commands);
  await toast(done, { style: "success" });
  return refresh();
}

const sizeOf = (sizes: Map<string, number>, name: string, r: Revision) => sizes.get(`${name}_${r.rev}`);
const oldSize = (sizes: Map<string, number>, s: Snap) => s.old.reduce((t, r) => t + (sizeOf(sizes, s.name, r) ?? 0), 0);

function removeOldAction(all: Snap[], sizes: Map<string, number>): Action | undefined {
  const withOld = all.filter((s) => s.old.length);
  if (!withOld.length) return undefined;
  const count = withOld.reduce((t, s) => t + s.old.length, 0);
  const bytes = withOld.reduce((t, s) => t + oldSize(sizes, s), 0);
  return action(
    `Remove All Old Revisions (${formatBytes(bytes)})`,
    () => change("Removing old revisions…", removeOldCommands(withOld), `${count} old revisions removed`),
    {
      icon: Icons.trash,
      destructive: true,
      section: "Danger",
      shortcut: "<Ctrl><Shift>Delete",
      confirm: `Remove ${count} disabled revision${count === 1 ? "" : "s"} of ${withOld.length} snap${
        withOld.length === 1 ? "" : "s"
      }? You can't revert to them afterwards.`,
    },
  );
}

const refreshAll = action("Update All Snaps", () => change("Updating snaps…", [["refresh"]], "Snaps are up to date"), {
  icon: Icons.download,
  section: "All Snaps",
  shortcut: "<Ctrl>u",
});

function connectionItem(c: Connection, name: string): Item {
  const end = endpoint(c, name);
  const sensitive = isSensitive(c);
  return {
    id: `${c.interface}:${c.plug}:${c.slot}`,
    title: interfaceTitle(c.interface),
    subtitle: `${c.plug || "—"} → ${c.slot || "—"}`,
    icon: {
      source: c.connected ? Icons.plug : Icons.dottedCircle,
      tint: c.connected ? (sensitive ? "orange" : "green") : "gray",
    },
    section: c.connected ? "Connected" : "Not Connected",
    keywords: [c.interface, ...c.notes],
    accessories: [
      ...(c.notes.includes("manual") ? [{ tag: "Manual", color: "blue" as const, tooltip: "Connected by hand" }] : []),
      ...(sensitive
        ? [{ icon: { source: Icons.shield, tint: "orange" as const }, tooltip: "Reaches outside the sandbox" }]
        : []),
    ],
    detail: {
      metadata: [
        meta.text("Interface", c.interface, { icon: Icons.plug }),
        meta.text("Plug", c.plug || "—"),
        meta.text("Slot", c.slot || "—"),
        meta.text("State", c.connected ? "Connected" : "Not connected", {
          color: c.connected ? "green" : "gray",
        }),
        ...(c.notes.length ? [meta.tags("Notes", c.notes)] : []),
      ],
    },
    actions: [
      c.connected
        ? action("Disconnect", async () => {
          await asRoot([["disconnect", end]]);
          await toast(`${interfaceTitle(c.interface)} disconnected`, { style: "success" });
          return refresh();
        }, { icon: Icons.cross, confirm: `Disconnect ${end}? The app may stop working as it did.` })
        : action("Connect", async () => {
          await asRoot([["connect", end]]);
          await toast(`${interfaceTitle(c.interface)} connected`, { style: "success" });
          return refresh();
        }, {
          icon: Icons.plug,
          ...(sensitive ? { confirm: `Give ${name} ${interfaceTitle(c.interface)} access?` } : {}),
        }),
      copy(`snap ${c.connected ? "disconnect" : "connect"} ${end}`, "Copy Command", { section: "Copy" }),
      action("Refresh", () => refresh(), { icon: Icons.refresh, shortcut: "<Ctrl>r", section: "View" }),
    ],
  };
}

function connectionsView(s: Snap) {
  return list({
    title: `${s.name}: Connections`,
    placeholder: `Filter ${s.name}'s interfaces…`,
    empty: { title: "No interfaces", description: `${s.name} asks for no access`, icon: Icons.plug },
    status: (items) => `${items.filter((i) => i.section === "Connected").length} of ${items.length} connected`,
    async items() {
      const found = await connections(s.name);
      return found
        .sort((a, b) => Number(b.connected) - Number(a.connected) || a.interface.localeCompare(b.interface))
        .map((c) => connectionItem(c, s.name));
    },
  });
}

function snapItem(
  s: Snap,
  info: Info | undefined,
  update: Update | undefined,
  sizes: Map<string, number>,
  all: Snap[],
): Item {
  const r = s.current;
  const held = isHeld(info, r);
  const size = sizeOf(sizes, s.name, r) ?? info?.installedSize;
  const old = oldSize(sizes, s);
  const runnable = s.kind === "app" && (info?.commands.length ?? 0) > 0;
  const mainCommand = info?.commands.find((c) => c === s.name) ?? info?.commands[0];
  const special = r.notes.filter((n) => ["classic", "devmode", "jailmode", "try", "broken"].includes(n));
  const store = !isLocal(r) && r.tracking;
  const otherChannels = (info?.channels ?? []).filter((c) => c.name !== r.tracking).slice(0, 6);

  const metadata: Metadata[] = [
    meta.text("Version", r.version || "—", { icon: Icons.tag }),
    meta.text("Revision", r.rev, { icon: Icons.hash }),
    meta.text("Channel", r.tracking || "Installed from a file", { icon: Icons.branch }),
    ...(r.publisher
      ? [
        meta.text(
          "Publisher",
          r.publisher + (r.verified === "verified" ? " ✓" : r.verified === "starred" ? " ✪" : ""),
          {
            icon: Icons.person,
            ...(r.verified ? { color: "green" as const } : {}),
          },
        ),
      ]
      : []),
    ...(special.length || held
      ? [meta.tags("Notes", [
        ...special.map((n) => ({ text: NOTE_TITLES[n] ?? n, color: (n === "broken" ? "red" : "orange") as Color })),
        ...(held ? [{ text: "Updates paused", color: "gray" as const }] : []),
      ])]
      : []),
    ...(info?.refreshDate ? [meta.text("Updated", info.refreshDate, { icon: Icons.clock })] : []),
    ...(info?.license ? [meta.text("License", info.license)] : []),
    ...(update
      ? [meta.text("Update", `${update.version} (${update.rev})`, { icon: Icons.download, color: "orange" })]
      : []),
    ...(s.old.length
      ? [meta.tags("Old revisions", s.old.map((o) => ({ text: `${o.rev} · ${o.version}`, color: "gray" as const })))]
      : []),
    ...(info?.commands.length ? [meta.tags("Commands", info.commands.slice(0, 8))] : []),
    ...(info?.services.length ? [meta.tags("Services", info.services.slice(0, 6))] : []),
    ...(otherChannels.length
      ? [meta.tags("Other channels", otherChannels.map((c) => `${c.name.replace(/^latest\//, "")} ${c.version}`))]
      : []),
    meta.separator(),
    ...(store ? [meta.link("Snap Store", `snapcraft.io/${s.name}`, info?.storeUrl ?? storeUrl(s.name))] : []),
    ...(info?.contact && /^https?:/.test(info.contact)
      ? [meta.link("Contact", info.contact.replace(/^https?:\/\/(www\.)?/, ""), info.contact)]
      : []),
  ];

  const revert = s.old[0];
  const actions: Action[] = [
    ...(update
      ? [
        action(`Update to ${update.version}`, () =>
          change(`Updating ${s.name}…`, [["refresh", s.name]], `${s.name} updated to ${update.version}`), {
          icon: Icons.download,
        }),
      ]
      : []),
    ...(runnable && mainCommand
      ? [action(`Run ${mainCommand}`, () => {
        launch(mainCommand);
        return close();
      }, { icon: Icons.play })]
      : []),
    action("Show Connections", () => connectionsView(s), { icon: Icons.plug, shortcut: "<Ctrl>i" }),
    ...(store
      ? [open(info?.storeUrl ?? storeUrl(s.name), "Open in Snap Store", { icon: Icons.globe, shortcut: "<Ctrl>o" })]
      : []),
    ...(revert
      ? [
        action(`Revert to ${revert.version} (${revert.rev})`, () =>
          change(
            `Reverting ${s.name}…`,
            [["revert", s.name, `--revision=${revert.rev}`]],
            `${s.name} reverted to ${revert.version}`,
          ), {
          icon: Icons.history,
          section: "Revisions",
          confirm: `Go back to ${s.name} ${revert.version}? It stays there until the next update.`,
        }),
      ]
      : []),
    ...(s.old.length > 1
      ? [submenu(
        "Revert to Revision…",
        s.old.map((o) =>
          action(`${o.version} (${o.rev})`, () =>
            change(
              `Reverting ${s.name}…`,
              [["revert", s.name, `--revision=${o.rev}`]],
              `${s.name} reverted to ${o.version}`,
            ), {
            icon: Icons.history,
            confirm: `Go back to ${s.name} ${o.version}?`,
          })
        ),
        { icon: Icons.history, section: "Revisions" },
      )]
      : []),
    ...(store
      ? [
        held
          ? action("Resume Automatic Updates", () =>
            change(`Resuming updates of ${s.name}…`, [["refresh", "--unhold", s.name]], `${s.name} updates again`), {
            icon: Icons.play,
            section: "Revisions",
          })
          : action("Pause Automatic Updates", () =>
            change(
              `Pausing updates of ${s.name}…`,
              [["refresh", "--hold", s.name]],
              `${s.name} won't update by itself`,
            ), {
            icon: Icons.pause,
            section: "Revisions",
          }),
      ]
      : []),
    copy(s.name, "Copy Name", { section: "Copy", shortcut: "<Ctrl><Shift>c" }),
    ...(store
      ? [
        copy(
          `snap install ${s.name}${r.tracking && r.tracking !== "latest/stable" ? ` --channel=${r.tracking}` : ""}${
            r.notes.includes("classic") ? " --classic" : ""
          }`,
          "Copy Install Command",
          { section: "Copy" },
        ),
      ]
      : []),
    ...(s.old.length
      ? [
        action(`Remove Old Revisions of ${s.name} (${formatBytes(old)})`, () =>
          change(`Removing old revisions of ${s.name}…`, removeOldCommands([s]), "Old revisions removed"), {
          icon: Icons.trash,
          destructive: true,
          section: "Danger",
          confirm: `Remove ${s.old.length} disabled revision${
            s.old.length === 1 ? "" : "s"
          } of ${s.name}? You can't revert to ${s.old.length === 1 ? "it" : "them"} afterwards.`,
        }),
      ]
      : []),
    action("Remove", () => change(`Removing ${s.name}…`, [["remove", s.name]], `${s.name} removed`), {
      icon: Icons.trash,
      destructive: true,
      section: "Danger",
      shortcut: "<Ctrl>Delete",
      confirm: `Remove ${s.name}? snapd keeps a snapshot of its data for 31 days.`,
    }),
    action(
      "Remove Without Snapshot",
      () => change(`Removing ${s.name}…`, [["remove", "--purge", s.name]], `${s.name} and its data removed`),
      {
        icon: Icons.trash,
        destructive: true,
        section: "Danger",
        confirm: `Remove ${s.name} and delete its data now, without a snapshot?`,
      },
    ),
    refreshAll,
    ...[removeOldAction(all, sizes)].filter((a): a is Action => !!a),
    action("Refresh", () => refresh(), { icon: Icons.refresh, shortcut: "<Ctrl>r", section: "View" }),
  ];

  const tint: Color = r.notes.includes("broken") ? "red" : update ? "orange" : s.kind === "app" ? "blue" : "gray";
  return {
    id: s.name,
    title: s.name,
    subtitle: info?.summary ?? r.version,
    icon: { source: s.kind === "app" ? Icons.package : Icons.layers, tint },
    section: KIND_TITLES[s.kind],
    keywords: [r.publisher, r.tracking, ...r.notes, ...(update ? ["update", "mise à jour"] : [])],
    accessories: [
      ...(update ? [{ tag: `→ ${update.version}`, color: "orange" as const, tooltip: "Update available" }] : []),
      ...(r.notes.includes("broken") ? [{ tag: "Broken", color: "red" as const }] : []),
      ...(r.notes.includes("classic") ? [{ tag: "Classic", color: "orange" as const, tooltip: "Not sandboxed" }] : []),
      ...(r.notes.includes("devmode") ? [{ tag: "Devmode", color: "red" as const }] : []),
      ...(held ? [{ icon: { source: Icons.pause, tint: "gray" as const }, tooltip: "Automatic updates paused" }] : []),
      ...(s.old.length
        ? [{ text: `+${s.old.length} old`, color: "gray" as const, tooltip: `${formatBytes(old)} of older revisions` }]
        : []),
      { text: r.tracking ? r.tracking.replace(/^latest\//, "") : "local", tooltip: "Channel" },
      ...(size !== undefined ? [{ text: formatBytes(size), tooltip: "Size of this revision" }] : []),
    ],
    detail: {
      stats: [
        { label: "Version", value: r.version || "—" },
        { label: "Size", value: formatBytes(size) },
        ...(s.old.length ? [{ label: "Old revisions", value: formatBytes(old), color: "orange" as const }] : []),
      ],
      markdown: info?.description,
      metadata,
    },
    actions,
  };
}

function notInstalledItem(): Item {
  return {
    id: "install",
    title: "Snap isn't installed",
    subtitle: "Install snapd, or use Flatpak apps",
    icon: { source: Icons.download, tint: "orange" },
    detail: {
      markdown:
        "The `snap` command wasn't found. snapd comes with Ubuntu; on other distributions follow the guide for yours.",
    },
    actions: [
      open("https://snapcraft.io/docs/installing-snapd", "Open the Installation Guide", { icon: Icons.globe }),
      action("Check Again", () => refresh(), { icon: Icons.refresh }),
    ],
  };
}

export default list({
  placeholder: "Filter snaps…",
  filter: {
    options: [
      { value: "all", title: "All" },
      { value: "apps", title: "Apps" },
      { value: "updates", title: "Updates" },
      { value: "old", title: "Old Revisions" },
    ],
  },
  empty: { title: "No snap here", description: "Nothing matches this view", icon: Icons.package },
  status: () => summary,
  actions: [refreshAll, open("https://snapcraft.io/store", "Browse the Snap Store", { icon: Icons.globe })],
  async *items({ filter, signal }) {
    let all: Snap[];
    try {
      all = groupSnaps(await revisions(signal));
    } catch (e) {
      if (!(e instanceof NotInstalled)) throw e;
      summary = "snap isn't installed";
      yield [notInstalledItem()];
      return;
    }
    const sz = await sizes(all);
    let info = new Map<string, Info>();
    let ups = new Map<string, Update>();
    const f = filter ?? "all";
    const render = () => {
      const shown = all.filter((s) =>
        f === "all" || (f === "apps" && s.kind === "app") || (f === "updates" && ups.has(s.name)) ||
        (f === "old" && s.old.length)
      ).sort((a, b) =>
        Number(b.kind === "app") - Number(a.kind === "app") || Number(ups.has(b.name)) - Number(ups.has(a.name)) ||
        a.name.localeCompare(b.name)
      );
      const total = all.reduce((t, s) => t + (sz.get(`${s.name}_${s.current.rev}`) ?? 0), 0);
      const old = all.reduce((t, s) => t + oldSize(sz, s), 0);
      summary = [
        `${all.length} snaps · ${formatBytes(total)}`,
        ...(ups.size ? [`${ups.size} update${ups.size === 1 ? "" : "s"}`] : []),
        ...(old ? [`${formatBytes(old)} in old revisions`] : []),
      ].join(" · ");
      return shown.map((s) => snapItem(s, info.get(s.name), ups.get(s.name), sz, all));
    };
    yield render();
    // snapd asks the store for these: show the list first, then fill them in.
    [info, ups] = await Promise.all([infos(all.map((s) => s.name), signal), updates(signal)]);
    if (signal.aborted) return;
    updateCommandMetadata({
      subtitle: ups.size ? `${ups.size} update${ups.size === 1 ? "" : "s"} available` : `${all.length} snaps`,
    }).catch(() => {});
    yield render();
  },
});
