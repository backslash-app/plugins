import {
  type Action,
  action,
  type Context,
  copy,
  exec,
  Icons,
  type Item,
  list,
  meta,
  type Metadata,
  open,
  toast,
  updateCommandMetadata,
} from "@backslash/api";
import { guarded, HOME, type Server, server, SetupError, st } from "../api.ts";
import {
  ago,
  basename,
  bytes,
  type Completion,
  type Conflict,
  conflictFindArgs,
  type Connection,
  type DeviceConfig,
  deviceState,
  type DeviceView,
  dirname,
  duration,
  expandHome,
  FOLDER_TYPES,
  type FolderConfig,
  folderState,
  type FolderStatus,
  type FolderView,
  isLocalBase,
  isNever,
  labelOf,
  parseConflicts,
  plural,
  shortId,
  sortDevices,
  sortFolders,
  summary,
  type SystemStatus,
  tildify,
} from "../lib.ts";

const POLL_MS = 10_000;
/** Faster while something moves, so the percentage follows. */
const BUSY_POLL_MS = 2_500;

interface Snapshot {
  folders: FolderView[];
  devices: DeviceView[];
  me?: DeviceConfig;
  system: SystemStatus;
  version: string;
}

async function load(s: Server, signal: AbortSignal): Promise<Snapshot> {
  const [folders, devices, connections, system, version, deviceStats, folderStats] = await Promise.all([
    st<FolderConfig[]>(s, "/rest/config/folders", { signal }),
    st<DeviceConfig[]>(s, "/rest/config/devices", { signal }),
    st<{ connections: Record<string, Connection> }>(s, "/rest/system/connections", { signal }),
    st<SystemStatus>(s, "/rest/system/status", { signal }),
    st<{ version: string }>(s, "/rest/system/version", { signal }),
    st<Record<string, { lastSeen?: string }>>(s, "/rest/stats/device", { signal })
      .catch(() => ({} as Record<string, { lastSeen?: string }>)),
    st<Record<string, { lastScan?: string; lastFile?: FolderView["lastFile"] }>>(s, "/rest/stats/folder", { signal })
      .catch(() => ({} as Record<string, { lastScan?: string; lastFile?: FolderView["lastFile"] }>)),
  ]);
  const statuses = await Promise.all(
    folders.map((f) =>
      f.paused
        ? undefined
        : st<FolderStatus>(s, `/rest/db/status?folder=${encodeURIComponent(f.id)}`, { signal }).catch(() => undefined)
    ),
  );
  const others = devices.filter((d) => d.deviceID !== system.myID);
  const completions = await Promise.all(
    others.map((d) =>
      connections.connections[d.deviceID]?.connected
        ? st<Completion>(s, `/rest/db/completion?device=${encodeURIComponent(d.deviceID)}`, { signal })
          .catch(() => undefined)
        : undefined
    ),
  );
  return {
    folders: folders.map((config, i) => ({
      config,
      status: statuses[i],
      lastScan: folderStats[config.id]?.lastScan,
      lastFile: folderStats[config.id]?.lastFile,
    })),
    devices: others.map((config, i) => ({
      config,
      connection: connections.connections[config.deviceID],
      lastSeen: deviceStats[config.deviceID]?.lastSeen,
      completion: completions[i],
    })),
    me: devices.find((d) => d.deviceID === system.myID),
    system,
    version: version.version,
  };
}

// --- Live reload ---------------------------------------------------------------

const changes = new EventTarget();
const changed = () => changes.dispatchEvent(new Event("change"));

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      changes.removeEventListener("change", done);
      signal.removeEventListener("abort", done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    changes.addEventListener("change", done);
    signal.addEventListener("abort", done);
  });
}

async function mutate(s: Server, path: string, method: string, body: unknown, message: string) {
  await st(s, path, { method, body });
  await toast(message, { style: "success" });
  changed();
}

// --- Items -------------------------------------------------------------------

const deviceName = (snap: Snapshot, id: string) =>
  snap.devices.find((d) => d.config.deviceID === id)?.config.name ??
    (id === snap.system.myID ? "This device" : shortId(id));

function common(s: Server): Action[] {
  return [
    open(s.base, "Open Web UI", { icon: Icons.globe, shortcut: "<Ctrl>o", section: "Syncthing" }),
    action("Rescan All Folders", async () => {
      await mutate(s, "/rest/db/scan", "POST", undefined, "Rescanning all folders");
    }, { icon: Icons.refresh, shortcut: "<Ctrl><Shift>r", section: "Syncthing" }),
  ];
}

function folderItem(f: FolderView, snap: Snapshot, s: Server, local: boolean): Item {
  const c = f.config, status = f.status, look = folderState(f);
  const path = expandHome(c.path, HOME);
  const shared = c.devices.map((d) => d.deviceID).filter((id) => id !== snap.system.myID);
  const metadata: Metadata[] = [
    meta.text("State", look.label, { icon: { source: look.icon, tint: look.tint }, color: look.tint }),
  ];
  if (status) {
    metadata.push(meta.progress("In sync", status.globalBytes ? status.inSyncBytes / status.globalBytes : 1));
  }
  metadata.push(
    meta.text("Type", FOLDER_TYPES[c.type] ?? c.type, { icon: Icons.cycle }),
    meta.text("Path", tildify(path, HOME), { icon: Icons.folder }),
    meta.text("Folder ID", c.id, { icon: Icons.hash }),
    meta.tags(
      "Shared with",
      shared.length ? shared.map((id) => ({ text: deviceName(snap, id), color: "blue" as const })) : ["Nobody"],
    ),
    meta.separator(),
    meta.text("Last scan", isNever(f.lastScan) ? "Never" : ago(f.lastScan), { icon: Icons.clock }),
  );
  if (f.lastFile && !isNever(f.lastFile.at) && f.lastFile.filename) {
    metadata.push(meta.text(
      f.lastFile.deleted ? "Last deleted" : "Last change",
      `${basename(f.lastFile.filename)} · ${ago(f.lastFile.at)}`,
      { icon: f.lastFile.deleted ? Icons.trash : Icons.file },
    ));
  }
  metadata.push(meta.text(
    "Watching",
    c.fsWatcherEnabled === false ? `Rescans every ${duration(c.rescanIntervalS ?? 3600)}` : "Changes detected live",
    { icon: Icons.eye },
  ));
  if (status?.error) metadata.push(meta.text("Error", status.error, { icon: Icons.alert, color: "red" }));

  const actions: Action[] = [];
  if (local) actions.push(open(path, "Open Folder", { icon: Icons.folder }));
  actions.push(
    action("Rescan", async () => {
      await mutate(
        s,
        `/rest/db/scan?folder=${encodeURIComponent(c.id)}`,
        "POST",
        undefined,
        `Rescanning ${labelOf(c)}`,
      );
    }, { icon: Icons.refresh, shortcut: "<Ctrl>r" }),
    action(c.paused ? "Resume Folder" : "Pause Folder", async () => {
      await mutate(
        s,
        `/rest/config/folders/${encodeURIComponent(c.id)}`,
        "PATCH",
        { paused: !c.paused },
        `${labelOf(c)} ${c.paused ? "resumed" : "paused"}`,
      );
    }, { icon: c.paused ? Icons.play : Icons.pause, shortcut: "<Ctrl>p" }),
  );
  if (local) {
    actions.push(action("Show Conflicts", () => conflictList([f], snap, s), {
      icon: Icons.layers,
      shortcut: "<Ctrl><Shift>c",
    }));
  }
  if (status && (status.pullErrors > 0 || status.errors > 0)) {
    actions.push(action("Show Failed Items", () => errorList(f, s), { icon: Icons.alert }));
  }
  actions.push(
    ...common(s),
    copy(tildify(path, HOME), "Copy Path", { section: "Copy", shortcut: "<Ctrl><Shift>p" }),
    copy(c.id, "Copy Folder ID", { section: "Copy" }),
  );

  return {
    id: `folder:${c.id}`,
    title: labelOf(c),
    subtitle: tildify(path, HOME),
    icon: { source: look.tint === "green" ? Icons.folder : look.icon, tint: look.tint },
    section: "Folders",
    keywords: [c.id, c.path, look.label, FOLDER_TYPES[c.type] ?? ""],
    accessories: [
      ...(shared.length
        ? [{ text: String(shared.length), icon: Icons.person, tooltip: plural(shared.length, "device") }]
        : []),
      ...(status ? [{ text: bytes(status.globalBytes), tooltip: `${status.globalFiles} files` }] : []),
      { tag: look.label, color: look.tint },
    ],
    detail: {
      stats: status
        ? [
          { label: "Size", value: bytes(status.globalBytes) },
          { label: "Files", value: status.globalFiles.toLocaleString("en") },
          status.needBytes > 0
            ? { label: "To sync", value: bytes(status.needBytes), color: "blue" }
            : { label: "Here", value: bytes(status.localBytes), color: "green" },
        ]
        : undefined,
      metadata,
    },
    actions,
  };
}

function deviceItem(d: DeviceView, snap: Snapshot, s: Server): Item {
  const c = d.config, look = deviceState(d), conn = d.connection;
  const folders = snap.folders.filter((f) => f.config.devices.some((x) => x.deviceID === c.deviceID));
  const metadata: Metadata[] = [
    meta.text("State", look.detail, { icon: { source: look.icon, tint: look.tint }, color: look.tint }),
  ];
  if (d.completion && conn?.connected) metadata.push(meta.progress("Their copy", d.completion.completion / 100));
  if (conn?.connected) {
    if (conn.address) metadata.push(meta.text("Address", conn.address, { icon: Icons.globe }));
    if (conn.type) {
      metadata.push(
        meta.text(
          "Connection",
          `${conn.type.replace(/-(client|server)$/, "").toUpperCase()}${conn.isLocal ? " · LAN" : ""}`,
          {
            icon: conn.type.startsWith("relay") ? Icons.cloud : Icons.plug,
          },
        ),
      );
    }
    if (conn.clientVersion) metadata.push(meta.text("Version", conn.clientVersion, { icon: Icons.tag }));
    metadata.push(
      meta.text("Traffic", `↓ ${bytes(conn.inBytesTotal)} · ↑ ${bytes(conn.outBytesTotal)}`, { icon: Icons.activity }),
    );
  } else {
    metadata.push(meta.text("Last seen", isNever(d.lastSeen) ? "Never" : ago(d.lastSeen), { icon: Icons.clock }));
  }
  metadata.push(
    meta.separator(),
    meta.tags(
      "Folders",
      folders.length ? folders.map((f) => ({ text: labelOf(f.config), color: "blue" as const })) : ["None"],
    ),
    meta.text("Device ID", c.deviceID, { icon: Icons.key }),
  );
  if (c.introducer) metadata.push(meta.text("Introducer", "Yes", { icon: Icons.person }));

  return {
    id: `device:${c.deviceID}`,
    title: c.name || shortId(c.deviceID),
    subtitle: look.detail,
    icon: { source: c.paused ? Icons.pause : Icons.monitor, tint: look.tint },
    section: "Devices",
    keywords: [c.deviceID, shortId(c.deviceID), look.label, conn?.address ?? ""],
    accessories: [{ tag: look.label, color: look.tint }],
    detail: {
      stats: d.completion && conn?.connected
        ? [
          { label: "Their copy", value: `${Math.floor(d.completion.completion)} %`, color: look.tint },
          { label: "To send", value: bytes(d.completion.needBytes) },
          { label: "Folders", value: folders.length },
        ]
        : [{ label: "Folders", value: folders.length }],
      metadata,
    },
    actions: [
      action(c.paused ? "Resume Device" : "Pause Device", async () => {
        await mutate(
          s,
          `/rest/config/devices/${encodeURIComponent(c.deviceID)}`,
          "PATCH",
          { paused: !c.paused },
          `${c.name} ${c.paused ? "resumed" : "paused"}`,
        );
      }, { icon: c.paused ? Icons.play : Icons.pause, shortcut: "<Ctrl>p" }),
      ...common(s),
      copy(c.deviceID, "Copy Device ID", { section: "Copy", shortcut: "<Ctrl><Shift>c" }),
    ],
  };
}

function meItem(snap: Snapshot, s: Server): Item {
  const pausedAll = snap.devices.length > 0 && snap.devices.every((d) => d.config.paused);
  const connected = snap.devices.filter((d) => d.connection?.connected).length;
  const total = snap.folders.reduce((n, f) => n + (f.status?.globalBytes ?? 0), 0);
  const line = summary(snap.folders) ?? "No folder";
  return {
    id: "me",
    title: snap.me?.name || "This Device",
    subtitle: `Syncthing ${snap.version} · ${line}`,
    icon: {
      source: Icons.cloud,
      tint: line.startsWith("Syncing") ? "blue" : line === "Up to date" ? "green" : "orange",
    },
    section: "This Device",
    keywords: ["this device", "syncthing", snap.system.myID],
    accessories: [{ text: `${connected}/${snap.devices.length}`, icon: Icons.wifi, tooltip: "Devices connected" }],
    detail: {
      stats: [
        { label: "Folders", value: snap.folders.length },
        { label: "Devices", value: `${connected}/${snap.devices.length}` },
        { label: "Data", value: bytes(total) },
      ],
      metadata: [
        meta.text("Status", line, { icon: Icons.info }),
        meta.text("Version", snap.version, { icon: Icons.tag }),
        meta.text("Uptime", duration(snap.system.uptime), { icon: Icons.clock }),
        meta.link("Web UI", new URL(s.base).host, s.base),
        meta.text("Device ID", snap.system.myID, { icon: Icons.key }),
      ],
    },
    actions: [
      open(s.base, "Open Web UI", { icon: Icons.globe }),
      action("Rescan All Folders", async () => {
        await mutate(s, "/rest/db/scan", "POST", undefined, "Rescanning all folders");
      }, { icon: Icons.refresh, shortcut: "<Ctrl>r" }),
      action(pausedAll ? "Resume All Devices" : "Pause All Devices", async () => {
        await mutate(
          s,
          `/rest/system/${pausedAll ? "resume" : "pause"}`,
          "POST",
          undefined,
          pausedAll ? "Resumed" : "Paused",
        );
      }, { icon: pausedAll ? Icons.play : Icons.pause, shortcut: "<Ctrl>p" }),
      copy(snap.system.myID, "Copy My Device ID", { section: "Copy", shortcut: "<Ctrl><Shift>c" }),
    ],
  };
}

// --- Conflicts and errors ------------------------------------------------------

async function findConflicts(f: FolderView, signal: AbortSignal): Promise<Conflict[]> {
  const root = expandHome(f.config.path, HOME).replace(/\/+$/, "");
  try {
    return parseConflicts(await exec("find", conflictFindArgs(root), { signal }));
  } catch (e) {
    // find exits 1 for unreadable subfolders but still prints what it found.
    if (e instanceof Deno.errors.NotFound) throw new Error("find is needed to look for conflicts");
    if (signal.aborted) throw e;
    return [];
  }
}

function conflictItem(cf: Conflict, f: FolderView, snap: Snapshot): Item {
  const root = expandHome(f.config.path, HOME).replace(/\/+$/, "");
  const rel = (p: string) => p.startsWith(`${root}/`) ? p.slice(root.length + 1) : p;
  const from = snap.devices.find((d) => shortId(d.config.deviceID) === cf.device)?.config.name ??
    (shortId(snap.system.myID) === cf.device ? "This device" : cf.device);
  const when = cf.date ?? new Date(cf.modified);
  return {
    id: cf.path,
    title: basename(cf.original),
    subtitle: rel(dirname(cf.path)) === dirname(cf.path) ? tildify(dirname(cf.path), HOME) : rel(dirname(cf.path)),
    icon: { source: Icons.layers, tint: "orange" },
    section: labelOf(f.config),
    keywords: [basename(cf.path), from],
    accessories: [
      { text: from, icon: Icons.monitor, tooltip: "Device whose change lost" },
      { text: when.toLocaleDateString("en", { day: "numeric", month: "short" }), tooltip: when.toLocaleString("en") },
    ],
    detail: {
      stats: [{ label: "Size", value: bytes(cf.size) }, { label: "Saved", value: ago(when.toISOString()) }],
      metadata: [
        meta.text("Conflict copy", basename(cf.path), { icon: Icons.file }),
        meta.text("Original", rel(cf.original), { icon: Icons.file }),
        meta.text("From device", from, { icon: Icons.monitor }),
        meta.text("Saved", when.toLocaleString("en", { dateStyle: "medium", timeStyle: "short" }), {
          icon: Icons.clock,
        }),
        meta.text("Folder", labelOf(f.config), { icon: Icons.folder }),
      ],
      markdown:
        "Syncthing kept both versions: the newer change stayed in the original file, the other one in this copy. Compare them, keep what you need and delete the copy.",
    },
    actions: [
      open(cf.path, "Open Conflict Copy", { icon: Icons.file }),
      open(cf.original, "Open Original", { icon: Icons.file, shortcut: "<Ctrl>o" }),
      open(dirname(cf.path), "Open Containing Folder", { icon: Icons.folder, shortcut: "<Ctrl><Shift>o" }),
      copy(cf.path, "Copy Conflict Path", { section: "Copy" }),
      copy(cf.original, "Copy Original Path", { section: "Copy" }),
    ],
  };
}

async function* conflictItems(folders: FolderView[], snap: Snapshot, signal: AbortSignal): AsyncGenerator<Item[]> {
  const items: Item[] = [];
  for (const f of folders) {
    const found = await findConflicts(f, signal);
    items.push(...found.map((cf) => conflictItem(cf, f, snap)));
    yield [...items];
  }
  if (!folders.length) yield [];
}

function conflictList(folders: FolderView[], snap: Snapshot, s: Server) {
  return list({
    title: folders.length === 1 ? `Conflicts in ${labelOf(folders[0].config)}` : "Conflicts",
    placeholder: "Filter conflict copies…",
    empty: { title: "No conflict", description: "Every file has a single version", icon: Icons.done },
    status: (items) => plural(items.length, "conflict copy", "conflict copies"),
    actions: common(s),
    items: ({ signal }) => conflictItems(folders, snap, signal),
  });
}

async function errorList(f: FolderView, s: Server) {
  const res = await st<{ errors: { path: string; error: string }[] | null }>(
    s,
    `/rest/folder/errors?folder=${encodeURIComponent(f.config.id)}&perpage=200`,
  );
  const root = expandHome(f.config.path, HOME).replace(/\/+$/, "");
  return list({
    title: `Failed Items in ${labelOf(f.config)}`,
    empty: { title: "No failed item", icon: Icons.done },
    items: (res.errors ?? []).map((e) => ({
      id: e.path,
      title: basename(e.path),
      subtitle: e.error,
      icon: { source: Icons.alert, tint: "red" as const },
      keywords: [e.path],
      detail: {
        markdown: `\`\`\`\n${e.error}\n\`\`\``,
        metadata: [
          meta.text("Path", e.path, { icon: Icons.file }),
          meta.text("Folder", labelOf(f.config), { icon: Icons.folder }),
        ],
      },
      actions: [
        ...(isLocalBase(s.base)
          ? [open(dirname(`${root}/${e.path}`), "Open Containing Folder", { icon: Icons.folder })]
          : []),
        copy(e.error, "Copy Error"),
        copy(e.path, "Copy Path", { section: "Copy" }),
      ],
    })),
  });
}

// --- Command -------------------------------------------------------------------

export default (_ctx: Context) => {
  let shown = "";
  return list({
    placeholder: "Filter folders and devices…",
    filter: {
      options: [
        { value: "all", title: "All" },
        { value: "folders", title: "Folders" },
        { value: "devices", title: "Devices" },
        { value: "conflicts", title: "Conflicts" },
      ],
    },
    empty: { title: "Nothing here", description: "Add folders and devices in the Syncthing Web UI", icon: Icons.cloud },
    status: (items) => items[0]?.id === "setup" ? "Not connected" : shown,
    async *items({ preferences, signal, filter }) {
      let s: Server;
      try {
        s = await server(preferences);
      } catch (e) {
        yield await guarded(() => Promise.reject(e));
        return;
      }
      const local = isLocalBase(s.base);
      if (filter === "conflicts") {
        if (!local) {
          shown = "";
          yield [{
            id: "remote",
            title: "Conflicts are looked for on this computer only",
            subtitle: `Syncthing runs at ${new URL(s.base).host}`,
            icon: { source: Icons.info, tint: "blue" },
            actions: [open(s.base, "Open Web UI", { icon: Icons.globe })],
          }];
          return;
        }
        const snap = await load(s, signal).catch((e) => e);
        if (snap instanceof SetupError) {
          yield await guarded(() => Promise.reject(snap));
          return;
        }
        if (snap instanceof Error) throw snap;
        shown = "Looking for conflicts…";
        let last: Item[] = [];
        for await (
          const items of conflictItems(snap.folders.filter((f: FolderView) => !f.config.paused), snap, signal)
        ) {
          yield (last = items);
        }
        shown = plural(last.length, "conflict copy", "conflict copies");
        yield last.length ? last : [{
          id: "no-conflict",
          title: "No conflict copy",
          subtitle: "Every synced file has a single version",
          icon: { source: Icons.done, tint: "green" },
          actions: common(s),
        }];
        return;
      }
      while (!signal.aborted) {
        let busy = false;
        const items = await guarded(async () => {
          const snap = await load(s, signal);
          const line = summary(snap.folders);
          updateCommandMetadata({ subtitle: line }).catch(() => {});
          busy = snap.folders.some((f) => folderState(f).busy) || snap.devices.some((d) => deviceState(d).busy);
          const connected = snap.devices.filter((d) => d.connection?.connected).length;
          shown = [
            plural(snap.folders.length, "folder"),
            `${connected} of ${plural(snap.devices.length, "device")} connected`,
            line,
          ].filter(Boolean).join(" · ");
          const out: Item[] = [];
          if (filter !== "devices" && filter !== "folders") out.push(meItem(snap, s));
          if (filter !== "devices") out.push(...sortFolders(snap.folders).map((f) => folderItem(f, snap, s, local)));
          if (filter !== "folders") out.push(...sortDevices(snap.devices).map((d) => deviceItem(d, snap, s)));
          return out;
        });
        yield items;
        if (items[0]?.id === "setup") return;
        await wait(busy ? BUSY_POLL_MS : POLL_MS, signal);
      }
    },
  });
};
