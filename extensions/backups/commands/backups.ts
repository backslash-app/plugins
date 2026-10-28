import {
  type Action,
  action,
  close,
  type Color,
  copy,
  detail,
  Icons,
  type Item,
  list,
  meta,
  type Metadata,
  open,
  openExternal,
  refresh,
  storage,
  toast,
  updateCommandMetadata,
} from "@backslash/api";
import {
  ago,
  BACKEND_LABELS,
  type Backup,
  backupFolder,
  checkArgs,
  dejaDupPath,
  duration,
  formatBytes,
  formatDate,
  type Freshness,
  freshness,
  type Repo,
  repoLabel,
  type RepoStats,
  restoreCommand,
  tildify,
  unitName,
} from "../lib.ts";
import {
  backUp,
  backupPaths,
  borgArchive,
  checkInTerminal,
  dejaDup,
  type DejaDupState,
  HOME,
  launchDejaDup,
  listBackups,
  maxAge,
  mount,
  mounted,
  mountpoint,
  type Prefs,
  repos,
  repoStats,
  runningUnits,
  unmount,
} from "../backups.ts";

interface RepoState {
  repo: Repo;
  backups?: Backup[];
  stats?: RepoStats;
  encryption?: string;
  error?: string;
  loading: boolean;
  /** When the cached data was loaded. */
  cachedAt?: number;
  mounted: boolean;
  running: boolean;
}

interface Cached {
  at: number;
  backups: Backup[];
  stats?: RepoStats;
  encryption?: string;
}

const CACHE_LIMIT = 300;
const FRESH_COLOR: Record<Freshness, Color> = { fresh: "green", stale: "red", never: "orange" };

const label = (r: Repo) => repoLabel(r.location);
const kindTitle = (r: Repo) => r.kind === "restic" ? "restic" : "Borg";

function lastTime(backups?: Backup[]): number | undefined {
  return backups?.length ? Math.max(...backups.map((b) => b.time)) : undefined;
}

// --- Actions ---------------------------------------------------------------------------

function backupActions(r: Repo, p: Prefs): Action[] {
  const name = `${kindTitle(r)} ${label(r)}`;
  const inTerminal = action("Back Up Now in Terminal", async () => {
    await backUp(r, p, "terminal", name);
    return close(`Backing up to ${name}`);
  }, { icon: Icons.upload, shortcut: "<Ctrl>b", section: "Back Up" });
  const inBackground = action("Back Up in Background", async () => {
    await backUp(r, p, "background", name);
    await toast(`Backing up to ${name}: a notification tells when it's done`, { style: "success" });
    return refresh();
  }, { icon: Icons.upload, shortcut: "<Ctrl><Shift>b", section: "Back Up" });
  return p.background ? [inBackground, inTerminal] : [inTerminal, inBackground];
}

function browse(r: Repo, b?: Backup): Action {
  return action(b ? "Browse Files" : "Browse Backups", async () => {
    await toast(`Mounting ${label(r)}…`);
    const folder = await mount(r, b ? backupFolder(mountpoint(r), b, r.kind) : undefined);
    await openExternal(folder);
    return close();
  }, { icon: Icons.folder, shortcut: "<Ctrl>o" });
}

function unmountAction(r: Repo): Action {
  return action("Unmount", async () => {
    await unmount(r);
    await toast(`${label(r)} unmounted`, { style: "success" });
    return refresh();
  }, { icon: Icons.eyeOff, shortcut: "<Ctrl>u", section: "Mount" });
}

function repoActions(s: RepoState, p: Prefs): Action[] {
  const r = s.repo;
  return [
    action("Check Repository in Terminal", () => checkInTerminal(r, p, label(r), checkArgs(r)), {
      icon: Icons.shield,
      section: "Repository",
    }),
    ...(s.mounted
      ? [open(mountpoint(r), "Open Mounted Folder", { icon: Icons.folder, section: "Mount" }), unmountAction(r)]
      : []),
    copy(r.location, "Copy Repository Location", { section: "Copy", shortcut: "<Ctrl><Shift>l" }),
    action("Reload", () => refresh(), { icon: Icons.refresh, shortcut: "<Ctrl>r" }),
  ];
}

// --- Items -------------------------------------------------------------------------------

function repoItem(s: RepoState, p: Prefs): Item {
  const r = s.repo;
  const last = lastTime(s.backups);
  const fresh = s.error ? "never" : freshness(last, maxAge(p));
  const tint: Color = s.error ? "red" : FRESH_COLOR[fresh];
  const count = s.backups?.length;
  const hosts = [...new Set((s.backups ?? []).map((b) => b.hostname).filter(Boolean))] as string[];
  const metadata: Metadata[] = [
    meta.text("Tool", kindTitle(r), { icon: Icons.database }),
    meta.text("Location", r.location, { icon: Icons.drive }),
    ...(last
      ? [meta.text("Last backup", `${formatDate(last)} (${ago(last)})`, { icon: Icons.clock, color: tint })]
      : []),
    ...(s.stats?.size !== undefined
      ? [meta.text("Size on disk", formatBytes(s.stats.size), { icon: Icons.database })]
      : []),
    ...(s.stats?.originalSize !== undefined
      ? [meta.text(r.kind === "restic" ? "Uncompressed" : "Original size", formatBytes(s.stats.originalSize), {
        icon: Icons.layers,
      })]
      : []),
    ...(s.stats?.compressionRatio
      ? [meta.text("Compression", `${s.stats.compressionRatio.toFixed(2)}×`, { icon: Icons.archive })]
      : []),
    ...(s.encryption ?? s.stats?.encryption
      ? [meta.text("Encryption", String(s.encryption ?? s.stats?.encryption), { icon: Icons.lock })]
      : []),
    ...(hosts.length ? [meta.tags("Hosts", hosts)] : []),
    meta.text("Backs up", backupPaths(p).map((x) => tildify(x, HOME)).join(", "), { icon: Icons.folder }),
    ...(s.mounted ? [meta.text("Mounted at", mountpoint(r), { icon: Icons.folder, color: "blue" })] : []),
    ...(s.cachedAt && s.loading
      ? [meta.text("Showing", `cached from ${ago(s.cachedAt)}`, { icon: Icons.history })]
      : []),
  ];
  return {
    id: `repo:${r.id}`,
    title: `${kindTitle(r)} · ${label(r)}`,
    subtitle: s.error ? s.error : last ? `Last backup ${ago(last)}` : s.loading ? "Loading…" : "No backup yet",
    icon: { source: Icons.database, tint },
    section: "Repositories",
    keywords: [r.kind, r.location, ...hosts],
    accessories: [
      ...(s.running ? [{ tag: "Backing up…", color: "blue" as const }] : []),
      ...(s.mounted ? [{ icon: Icons.folder, tooltip: `Mounted at ${mountpoint(r)}` }] : []),
      ...(s.stats?.size !== undefined ? [{ text: formatBytes(s.stats.size), tooltip: "Size on disk" }] : []),
      ...(count !== undefined ? [{ text: `${count} ${r.kind === "restic" ? "snapshots" : "archives"}` }] : []),
      ...(s.error
        ? [{ tag: "Error", color: "red" as const }]
        : last
        ? [{ tag: ago(last), color: tint, tooltip: formatDate(last) }]
        : []),
    ],
    detail: {
      stats: [
        { label: "Last backup", value: last ? ago(last) : "Never", color: tint },
        { label: r.kind === "restic" ? "Snapshots" : "Archives", value: count ?? "?" },
        { label: "Size", value: s.stats?.size !== undefined ? formatBytes(s.stats.size) : "…" },
      ],
      markdown: s.error
        ? `**${s.error}**`
        : fresh === "stale"
        ? `The last backup is older than ${maxAge(p)} days.`
        : undefined,
      metadata,
    },
    actions: [...backupActions(r, p), browse(r), ...repoActions(s, p)],
  };
}

function backupItem(b: Backup, s: RepoState, p: Prefs): Item {
  const r = s.repo;
  const sum = b.summary;
  const isRestic = r.kind === "restic";
  const target = `${HOME}/Restored`;
  const metadata: Metadata[] = [
    meta.text(isRestic ? "Snapshot" : "Archive", b.id, { icon: Icons.hash }),
    meta.text("Date", `${formatDate(b.time)} (${ago(b.time)})`, { icon: Icons.calendar }),
    ...(b.end && b.end > b.time ? [meta.text("Took", duration(b.end - b.time), { icon: Icons.timer })] : []),
    ...(b.hostname ? [meta.text("Host", b.hostname, { icon: Icons.monitor })] : []),
    ...(b.username ? [meta.text("User", b.username, { icon: Icons.person })] : []),
    ...(b.tags.length
      ? [meta.tags(isRestic ? "Tags" : "Comment", b.tags.map((t) => ({ text: t, color: "blue" })))]
      : []),
    ...(sum
      ? [
        meta.separator(),
        meta.text("Added", formatBytes(sum.dataAdded), { icon: Icons.plus }),
        meta.text("Files", `${sum.filesNew} new · ${sum.filesChanged} changed · ${sum.filesUnmodified} unchanged`, {
          icon: Icons.file,
        }),
        meta.text("Processed", `${sum.totalFiles} files · ${formatBytes(sum.totalBytes)}`, { icon: Icons.layers }),
      ]
      : []),
    ...(b.program ? [meta.text("Made with", b.program, { icon: Icons.package })] : []),
    ...(b.parent ? [meta.text("Parent", b.parent.slice(0, 8), { icon: Icons.branch })] : []),
  ];
  const markdown = [
    b.paths.length ? `**Paths**\n\n${b.paths.map((x) => `- \`${tildify(x, HOME)}\``).join("\n")}` : "",
    b.excludes?.length ? `**Excluded**\n\n${b.excludes.map((x) => `- \`${x}\``).join("\n")}` : "",
  ].filter(Boolean).join("\n\n");
  return {
    id: `${r.id}:${b.id}`,
    title: isRestic ? formatDate(b.time) : b.id,
    subtitle: isRestic ? b.paths.map((x) => tildify(x, HOME)).join(", ") : formatDate(b.time),
    icon: { source: Icons.archive, tint: "blue" },
    section: `${kindTitle(r)} · ${label(r)}`,
    keywords: [b.shortId, b.hostname ?? "", ...b.tags, ...b.paths],
    accessories: [
      ...(sum ? [{ text: `+${formatBytes(sum.dataAdded)}`, tooltip: "Data added" }] : []),
      ...b.tags.slice(0, 3).map((t) => ({ tag: t, color: "blue" as const })),
      ...(b.hostname ? [{ tag: b.hostname, color: "gray" as const }] : []),
      ...(isRestic ? [{ text: b.shortId }] : []),
      { text: ago(b.time), tooltip: formatDate(b.time) },
    ],
    detail: { markdown: markdown || undefined, metadata },
    actions: [
      browse(r, b),
      copy(isRestic ? b.id : `${r.location}::${b.id}`, isRestic ? "Copy Snapshot ID" : "Copy Archive", {
        shortcut: "<Ctrl><Shift>c",
        section: "Copy",
      }),
      ...(isRestic ? [copy(b.shortId, "Copy Short ID", { section: "Copy" })] : []),
      copy(restoreCommand(r, b, target), "Copy Restore Command", { section: "Copy" }),
      ...(!isRestic
        ? [action("Show Archive Details", async () => {
          const info = await borgArchive(r, b.id);
          return detail({
            title: b.id,
            markdown: info.commandLine ? `\`\`\`\n${info.commandLine.join(" ")}\n\`\`\`` : "",
            stats: [
              { label: "Files", value: info.files ?? "?" },
              { label: "Original", value: info.originalSize !== undefined ? formatBytes(info.originalSize) : "?" },
              {
                label: "Deduplicated",
                value: info.deduplicatedSize !== undefined ? formatBytes(info.deduplicatedSize) : "?",
              },
            ],
            metadata: [
              ...(info.hostname ? [meta.text("Host", info.hostname, { icon: Icons.monitor })] : []),
              ...(info.username ? [meta.text("User", info.username, { icon: Icons.person })] : []),
              ...(info.duration !== undefined
                ? [meta.text("Took", duration(info.duration * 1000), { icon: Icons.timer })]
                : []),
              ...(info.compressedSize !== undefined
                ? [meta.text("Compressed", formatBytes(info.compressedSize), { icon: Icons.archive })]
                : []),
              ...(info.comment ? [meta.text("Comment", info.comment, { icon: Icons.comment })] : []),
            ],
            actions: [browse(r, b), copy(`${r.location}::${b.id}`, "Copy Archive")],
          });
        }, { icon: Icons.info, shortcut: "<Ctrl>i" })]
        : []),
      ...backupActions(r, p),
      ...(s.mounted ? [unmountAction(r)] : []),
      action("Reload", () => refresh(), { icon: Icons.refresh, shortcut: "<Ctrl>r" }),
    ],
  };
}

function dejaDupItem(d: DejaDupState, p: Prefs): Item {
  const x = d.data;
  const fresh = freshness(x.lastBackup, maxAge(p));
  const tint = FRESH_COLOR[fresh];
  const failed = x.lastRun && x.lastBackup && x.lastRun > x.lastBackup + 60_000;
  return {
    id: "deja-dup",
    title: "Déjà Dup",
    subtitle: x.lastBackup ? `Last backup ${ago(x.lastBackup)}` : "No backup yet",
    icon: { source: Icons.archive, tint },
    section: "Repositories",
    keywords: ["deja dup", "déjà dup", "gnome backups", "sauvegardes", x.backend ?? ""],
    accessories: [
      ...(failed ? [{ tag: "Last run failed", color: "red" as const, tooltip: `Tried ${ago(x.lastRun!)}` }] : []),
      ...(x.periodic === false ? [{ tag: "Manual", color: "gray" as const }] : []),
      ...(x.backend ? [{ text: BACKEND_LABELS[x.backend] ?? x.backend }] : []),
      ...(x.lastBackup ? [{ tag: ago(x.lastBackup), color: tint, tooltip: formatDate(x.lastBackup) }] : []),
    ],
    detail: {
      stats: [
        { label: "Last backup", value: x.lastBackup ? ago(x.lastBackup) : "Never", color: tint },
        {
          label: "Schedule",
          value: x.periodic ? `Every ${x.periodDays ?? 7} day${x.periodDays === 1 ? "" : "s"}` : "Manual",
        },
      ],
      markdown: [
        x.include.length ? `**Backs up**\n\n${x.include.map((i) => `- \`${dejaDupPath(i)}\``).join("\n")}` : "",
        x.exclude.length ? `**Excluded**\n\n${x.exclude.map((i) => `- \`${dejaDupPath(i)}\``).join("\n")}` : "",
      ].filter(Boolean).join("\n\n") || undefined,
      metadata: [
        ...(x.lastBackup
          ? [meta.text("Last backup", formatDate(x.lastBackup), { icon: Icons.clock, color: tint })]
          : []),
        ...(x.lastRun ? [meta.text("Last attempt", formatDate(x.lastRun), { icon: Icons.history })] : []),
        ...(x.backend ? [meta.text("Storage", BACKEND_LABELS[x.backend] ?? x.backend, { icon: Icons.cloud })] : []),
        ...(x.destination ? [meta.text("Destination", x.destination, { icon: Icons.drive })] : []),
        meta.text("Installed as", d.flatpak ? "Flatpak" : "System package", { icon: Icons.package }),
      ],
    },
    actions: [
      action("Back Up Now", () => {
        launchDejaDup(d.flatpak, ["--backup"]);
        return close("Déjà Dup is backing up");
      }, { icon: Icons.upload, shortcut: "<Ctrl>b" }),
      action("Open Déjà Dup", () => {
        launchDejaDup(d.flatpak);
        return close();
      }, { icon: Icons.window, shortcut: "<Ctrl>o" }),
      action("Restore Files…", () => {
        launchDejaDup(d.flatpak, ["--restore"]);
        return close();
      }, { icon: Icons.history }),
      action("Reload", () => refresh(), { icon: Icons.refresh, shortcut: "<Ctrl>r" }),
    ],
  };
}

function setupItem(): Item {
  return {
    id: "setup",
    title: "No backup configured",
    subtitle: "Set a restic or Borg repository in Settings, or install Déjà Dup",
    icon: { source: Icons.archive, tint: "orange" },
    detail: {
      markdown: [
        "## Backups",
        "",
        "Backslash shows your **restic** and **BorgBackup** repositories, and **Déjà Dup** (GNOME Backups).",
        "",
        "Set a repository and its password in **Settings → Extensions → Backups**, for instance:",
        "",
        "- restic: `/run/media/me/Backup/restic`, `sftp:nas:/srv/restic`, `rest:https://host:8000/`",
        "- Borg: `/run/media/me/Backup/borg`, `ssh://me@nas/./borg`",
        "",
        "`RESTIC_REPOSITORY`, `RESTIC_PASSWORD_FILE` and `BORG_REPO` from your environment work too.",
      ].join("\n"),
    },
    actions: [
      open("https://restic.readthedocs.io/en/stable/030_preparing_a_new_repo.html", "restic: Create a Repository", {
        icon: Icons.book,
      }),
      open("https://borgbackup.readthedocs.io/en/stable/quickstart.html", "Borg Quick Start", { icon: Icons.book }),
    ],
  };
}

// --- Command ---------------------------------------------------------------------------

function build(states: RepoState[], dd: DejaDupState | undefined, p: Prefs): Item[] {
  if (!states.length && !dd) return [setupItem()];
  const items: Item[] = [];
  if (dd) items.push(dejaDupItem(dd, p));
  for (const s of states) items.push(repoItem(s, p));
  for (const s of states) for (const b of s.backups ?? []) items.push(backupItem(b, s, p));
  return items;
}

async function subtitle(states: RepoState[], dd: DejaDupState | undefined) {
  const times = [...states.map((s) => lastTime(s.backups)), dd?.data.lastBackup].filter((t) => t !== undefined);
  const last = times.length ? Math.max(...times as number[]) : undefined;
  await updateCommandMetadata({ subtitle: last ? `Last backup ${ago(last)}` : null }).catch(() => {});
}

export default list({
  placeholder: "Filter snapshots by date, host, path, tag…",
  empty: { title: "No backup yet", description: "Ctrl+B backs up now", icon: Icons.archive },
  status: (items) => {
    const n = items.filter((i) => i.section !== "Repositories" && i.id !== "setup").length;
    return n ? `${n} backups` : "";
  },
  async *items({ preferences, signal }) {
    const p = preferences as Prefs;
    const list = repos(p);
    const [units, ddState, ...mounts] = await Promise.all([
      runningUnits(),
      dejaDup(),
      ...list.map((r) => mounted(r)),
    ]);
    const states: RepoState[] = await Promise.all(list.map(async (repo, i) => {
      const cached = await storage.get(`repo:${repo.id}`).catch(() => undefined) as unknown as Cached | undefined;
      return {
        repo,
        backups: cached?.backups,
        stats: cached?.stats,
        encryption: cached?.encryption,
        cachedAt: cached?.at,
        loading: true,
        mounted: mounts[i] as boolean,
        running: units.some((u) => u.startsWith(unitName("backup", repo))),
      };
    }));
    yield build(states, ddState, p);

    const save = (s: RepoState) =>
      storage.set(`repo:${s.repo.id}`, {
        at: Date.now(),
        backups: (s.backups ?? []).slice(0, CACHE_LIMIT),
        ...(s.stats ? { stats: s.stats } : {}),
        ...(s.encryption ? { encryption: s.encryption } : {}),
      } as never).catch(() => {});

    // Snapshot lists first (fast), then sizes (restic stats can take a while).
    const pending = new Map<number, Promise<number>>();
    states.forEach((s, i) => {
      pending.set(
        i,
        listBackups(s.repo, signal).then(({ backups, encryption }) => {
          s.backups = backups;
          s.encryption = encryption ?? s.encryption;
          s.error = undefined;
        }, (e) => {
          s.error = e instanceof Error ? e.message : String(e);
        }).then(async () => {
          s.loading = false;
          if (!s.error) await save(s);
          return i;
        }),
      );
      pending.set(
        states.length + i,
        repoStats(s.repo, signal).then((stats) => {
          s.stats = stats;
        }, () => {}).then(async () => {
          await pending.get(i);
          if (!s.error) await save(s);
          return states.length + i;
        }),
      );
    });
    while (pending.size && !signal.aborted) {
      const done = await Promise.race(pending.values());
      pending.delete(done);
      yield build(states, ddState, p);
    }
    await subtitle(states, ddState);
  },
});
