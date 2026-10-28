import {
  type Action,
  action,
  close,
  type Color,
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
  openExternal,
  refresh,
  toast,
  updateCommandMetadata,
} from "@backslash/api";
import {
  COLUMNS,
  COLUMNS_SHORT,
  type Disk,
  diskName,
  effective,
  explainUdisksError,
  fsName,
  isEncrypted,
  isPlumbing,
  isSwap,
  isSystemMount,
  parseLsblk,
  parseMounted,
  parseUnlocked,
  size,
  transportName,
  usageColor,
  type Volume,
  volumeName,
} from "../lib.ts";

async function lsblk(): Promise<Disk[]> {
  const run = (columns: string) => exec("lsblk", ["-J", "-b", "-o", columns]);
  const out = await run(COLUMNS).catch(() => run(COLUMNS_SHORT));
  return parseLsblk(out);
}

async function udisks(...args: string[]): Promise<string> {
  try {
    return await exec("udisksctl", args);
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) {
      throw new Error("udisksctl was not found: install udisks2 (it ships with every desktop)");
    }
    throw new Error(explainUdisksError(err instanceof Error ? err.message : String(err)));
  }
}

async function mount(v: Volume): Promise<string> {
  const out = await udisks("mount", "-b", v.path);
  return parseMounted(out) ?? "";
}

const unmount = (v: Volume) => udisks("unmount", "-b", v.path);

/** Unmounts every volume of the disk, locks encrypted ones, then cuts the power so it can be pulled out. */
async function eject(d: Disk) {
  for (const v of d.volumes) {
    const e = effective(v);
    if (e.mountpoint && !isSwap(e)) await unmount(e);
    if (v.inner) await udisks("lock", "-b", v.path);
  }
  await udisks("power-off", "-b", d.path);
}

const unlockForm = (v: Volume, title: string) =>
  form({
    title: `Unlock ${title}`,
    submitTitle: "Unlock and Mount",
    fields: [field.password("passphrase", "Passphrase", { required: true })],
    async submit(values) {
      await toast(`Unlocking ${title}…`);
      // The passphrase goes through stdin, never on a command line.
      const out = await exec("udisksctl", ["unlock", "-b", v.path, "--key-file", "/dev/stdin"], {
        stdin: String(values.passphrase),
      }).catch((err) => {
        throw new Error(explainUdisksError(String(err?.message ?? err)));
      });
      const cleartext = parseUnlocked(out);
      if (!cleartext) return close(`${title} unlocked`);
      const at = parseMounted(await udisks("mount", "-b", cleartext));
      if (at) await openExternal(at);
      return close(at ? `${title} mounted at ${at}` : `${title} unlocked`);
    },
  });

function actionsFor(v: Volume, d: Disk, title: string): Action[] {
  const e = effective(v);
  const mounted = e.mountpoint && !isSwap(e) ? e.mountpoint : undefined;
  const system = isSystemMount(e.mountpoint);
  const out: Action[] = [];

  if (mounted) {
    out.push(open(mounted, "Open in File Manager", { icon: Icons.folder }));
    if (!system) {
      out.push(action("Unmount", async () => {
        await unmount(e);
        if (v.inner) await udisks("lock", "-b", v.path);
        await toast(`${title} unmounted`, { style: "success" });
        return refresh();
      }, { icon: Icons.upload, shortcut: "<Ctrl>u", section: "Drive" }));
    }
  } else if (isEncrypted(v) && !v.inner) {
    out.push(action("Unlock…", () => unlockForm(v, title), { icon: Icons.key }));
  } else if (!isSwap(e) && e.fstype && !isPlumbing(e)) {
    out.push(
      action("Mount and Open", async () => {
        const at = await mount(e);
        if (at) await openExternal(at);
        return close(at ? `${title} mounted at ${at}` : `${title} mounted`);
      }, { icon: Icons.folder }),
      action("Mount", async () => {
        const at = await mount(e);
        await toast(at ? `Mounted at ${at}` : `${title} mounted`, { style: "success" });
        return refresh();
      }, { icon: Icons.download, shortcut: "<Ctrl>m", section: "Drive" }),
    );
  }
  if (v.inner && !e.mountpoint) {
    out.push(action("Lock", async () => {
      await udisks("lock", "-b", v.path);
      await toast(`${title} locked`, { style: "success" });
      return refresh();
    }, { icon: Icons.lock, section: "Drive" }));
  }
  if (d.removable && !system) {
    out.push(
      action("Eject", async () => {
        await eject(d);
        return close(`${diskName(d)} can be removed safely`);
      }, {
        icon: Icons.power,
        shortcut: "<Ctrl>e",
        destructive: true,
        confirm: `Eject ${diskName(d)}? All its volumes are unmounted and the drive is powered off.`,
        section: "Drive",
      }),
    );
  }

  if (mounted) out.push(copy(mounted, "Copy Mount Point", { section: "Copy", shortcut: "<Ctrl><Shift>c" }));
  out.push(copy(e.path, "Copy Device Path", { section: "Copy" }));
  const uuid = e.uuid ?? v.uuid;
  if (uuid) out.push(copy(uuid, "Copy UUID", { section: "Copy" }));
  out.push(action("Refresh", () => refresh(), { icon: Icons.refresh, shortcut: "<Ctrl>r", section: "View" }));
  return out;
}

function volumeItem(v: Volume, d: Disk): Item {
  const e = effective(v);
  const title = volumeName(v, d);
  const mounted = e.mountpoint && !isSwap(e) ? e.mountpoint : undefined;
  const ratio = mounted && e.used !== undefined && e.size
    ? e.used / (e.used + (e.available ?? 0) || e.size)
    : undefined;
  const locked = isEncrypted(v) && !v.inner;
  const color: Color = ratio !== undefined ? usageColor(ratio) : locked ? "orange" : d.removable ? "blue" : "gray";
  const system = isSystemMount(e.mountpoint);
  const state = mounted
    ? system ? "System volume" : "Mounted"
    : locked
    ? "Locked"
    : isSwap(e)
    ? e.mountpoint ? "Swap in use" : "Swap"
    : isPlumbing(e)
    ? "Not browsable"
    : "Not mounted";
  const metadata: Metadata[] = [
    ...(ratio !== undefined
      ? [meta.progress("Usage", ratio, `${size(e.used ?? 0)} of ${size(e.size)} · ${Math.round(ratio * 100)} %`)]
      : []),
    meta.text("State", state, {
      icon: mounted ? Icons.check : locked ? Icons.lock : Icons.dottedCircle,
      color: mounted ? "green" : locked ? "orange" : "gray",
    }),
    ...(mounted ? [meta.text("Mount point", mounted, { icon: Icons.folder })] : []),
    meta.tags("File system", [
      { text: fsName(e), color: "blue" },
      ...(v.inner ? [{ text: `in ${fsName(v)}`, color: "orange" as const }] : []),
      ...(e.readonly ? [{ text: "Read-only", color: "gray" as const }] : []),
    ]),
    meta.separator(),
    meta.text("Device", e.path, { icon: Icons.drive }),
    ...(e.label ?? v.label ? [meta.text("Label", (e.label ?? v.label)!)] : []),
    ...(e.uuid ?? v.uuid ? [meta.text("UUID", (e.uuid ?? v.uuid)!, { icon: Icons.hash })] : []),
    meta.separator(),
    meta.text("Disk", `${diskName(d)} · ${size(d.size)}`, { icon: Icons.drive }),
    meta.text("Connection", transportName(d.transport), { icon: d.transport === "usb" ? Icons.plug : Icons.cpu }),
    meta.text("Removable", d.removable ? "Yes" : "No"),
  ];
  return {
    id: v.path,
    title,
    subtitle: `${diskName(d)} · ${e.path.replace("/dev/", "")}`,
    icon: { source: locked ? Icons.lock : Icons.drive, tint: color },
    section: d.removable ? "Removable" : "Internal",
    keywords: [
      "disk",
      "disque",
      "drive",
      "usb",
      "clé",
      e.path,
      fsName(e),
      e.uuid ?? "",
      mounted ?? "",
      d.model ?? "",
      transportName(d.transport),
    ],
    accessories: [
      ...(locked
        ? [{ icon: Icons.lock, tooltip: "Encrypted, locked" }]
        : v.inner
        ? [{ icon: Icons.key, tooltip: "Encrypted, unlocked" }]
        : []),
      { tag: fsName(e), color: "gray" },
      ratio !== undefined
        ? {
          text: `${size(e.available ?? 0)} free`,
          color: usageColor(ratio),
          tooltip: `${Math.round(ratio * 100)} % used`,
        }
        : { text: `${size(v.size)}`, tooltip: state },
    ],
    detail: {
      stats: ratio !== undefined
        ? [
          { label: "Used", value: size(e.used ?? 0), color: usageColor(ratio) },
          { label: "Free", value: size(e.available ?? 0) },
          { label: "Size", value: size(e.size) },
        ]
        : [{ label: "Size", value: size(v.size) }, {
          label: "State",
          value: state,
          color: locked ? "orange" : undefined,
        }],
      metadata,
    },
    actions: actionsFor(v, d, title),
  };
}

/** A disk without any volume (blank or unpartitioned): still worth ejecting. */
function emptyDiskItem(d: Disk): Item {
  return {
    id: d.path,
    title: diskName(d),
    subtitle: `${d.path.replace("/dev/", "")} · no volume`,
    icon: { source: Icons.drive, tint: "gray" },
    section: d.removable ? "Removable" : "Internal",
    keywords: ["disk", "disque", d.path, d.model ?? ""],
    accessories: [{ tag: "Empty", color: "gray" }, { text: size(d.size) }],
    detail: {
      markdown:
        "This drive has no partition or filesystem. Format it with GNOME Disks, KDE Partition Manager or GParted.",
      metadata: [
        meta.text("Device", d.path, { icon: Icons.drive }),
        meta.text("Size", size(d.size)),
        meta.text("Connection", transportName(d.transport)),
      ],
    },
    actions: [
      ...(d.removable
        ? [action("Power Off", async () => {
          await udisks("power-off", "-b", d.path);
          return close(`${diskName(d)} can be removed safely`);
        }, { icon: Icons.power, destructive: true, confirm: `Power off ${diskName(d)}?` })]
        : []),
      copy(d.path, "Copy Device Path", { section: "Copy" }),
    ],
  };
}

function items(disks: Disk[], filter: string): Item[] {
  const out: Item[] = [];
  for (const d of disks) {
    if (filter === "removable" && !d.removable) continue;
    const vols = d.volumes.filter((v) => d.removable || !isPlumbing(effective(v)));
    const shown = filter === "mounted" ? vols.filter((v) => effective(v).mountpoint) : vols;
    if (!d.volumes.length && filter !== "mounted") out.push(emptyDiskItem(d));
    out.push(...shown.map((v) => volumeItem(v, d)));
  }
  // Removable first, then by name.
  return out.sort((a, b) => (a.section === b.section ? 0 : a.section === "Removable" ? -1 : 1));
}

let summary = "";

export default list({
  placeholder: "Filter drives, volumes, mount points…",
  filter: {
    options: [
      { value: "all", title: "All" },
      { value: "removable", title: "Removable" },
      { value: "mounted", title: "Mounted" },
    ],
  },
  empty: {
    title: "No drives here",
    description: "Plug in a USB stick or an SD card: it shows up within a few seconds",
    icon: Icons.drive,
  },
  status: () => summary,
  async *items({ filter, signal }) {
    let last = "";
    let subtitle: string | null | undefined;
    while (!signal.aborted) {
      let disks: Disk[];
      try {
        disks = await lsblk();
      } catch (err) {
        if (err instanceof Deno.errors.NotFound) {
          throw new Error("lsblk was not found: install util-linux");
        }
        throw err;
      }
      const key = JSON.stringify(disks);
      if (key !== last) {
        last = key;
        const removable = disks.filter((d) => d.removable);
        const mounted = disks.flatMap((d) => d.volumes).filter((v) => effective(v).mountpoint).length;
        summary = `${disks.length} drive${
          disks.length === 1 ? "" : "s"
        } · ${removable.length} removable · ${mounted} mounted`;
        const next = removable.length
          ? `${removable.length} removable drive${removable.length === 1 ? "" : "s"}`
          : null;
        if (next !== subtitle) {
          subtitle = next;
          updateCommandMetadata({ subtitle }).catch(() => {});
        }
        yield items(disks, filter ?? "all");
      }
      // Drives come and go: check again every few seconds.
      await new Promise<void>((resolve) => {
        const t = setTimeout(resolve, 3000);
        signal.addEventListener("abort", () => {
          clearTimeout(t);
          resolve();
        }, { once: true });
      });
    }
  },
});
