// The list's rows: one per drive, Btrfs filesystem and ZFS pool.

import {
  type Action,
  action,
  type Color,
  copy,
  Icons,
  type Item,
  meta,
  type Metadata,
  open,
  type Outcome,
  type Stat,
  toast,
} from "@backslash/api";
import {
  ago,
  counterName,
  criticalWarnings,
  type DeviceStats,
  type Disk,
  diskName,
  health,
  hours,
  kind,
  LEVEL_COLOR,
  type Pool,
  poolColor,
  type Scrub,
  size,
  type Smart,
  temperatureColor,
  wearColor,
} from "./lib.ts";
import { type Saved, startBtrfsScrub, startSelfTest, startZfsScrub } from "./system.ts";

export interface Handlers {
  /** Reads SMART and Btrfs as root, then reloads the list. */
  read: () => Promise<Outcome>;
  changed: () => void;
}

const LEVEL_ICON = { good: Icons.done, warning: Icons.alert, failing: Icons.alert, unknown: Icons.question };

function readAction(h: Handlers, saved?: Saved): Action {
  return action(saved ? "Read SMART Data Again" : "Read SMART Data", h.read, {
    icon: Icons.refresh,
    shortcut: "<Ctrl>r",
    section: "SMART",
  });
}

function smartMarkdown(s: Smart | undefined, reasons: string[], saved?: Saved): string | undefined {
  if (!saved) {
    return "SMART data is readable by root only: **Enter** reads every drive after asking for your password once.";
  }
  if (!s) return "This drive wasn't connected when the SMART data was read: **Ctrl+R** reads it again.";
  if (!s.available) {
    return `No SMART data: ${s.error ?? "the drive or its enclosure doesn't report any"}.\n\n` +
      "SD cards, most USB sticks and some USB enclosures don't support SMART.";
  }
  const lines = reasons.map((r) => `- ${r}`);
  if (s.testRemaining !== undefined) lines.push(`- A self-test is running: ${s.testRemaining}% left`);
  return lines.length ? lines.join("\n") : undefined;
}

function attributeTable(s: Smart): string {
  if (!s.attributes.length) return "";
  const rows = s.attributes.map((a) =>
    `| ${a.id} | ${a.name}${a.failed ? " ⚠" : ""} | ${a.value} | ${a.worst} | ${a.thresh} | ${a.rawText} |`
  );
  return ["", "| ID | Attribute | Value | Worst | Threshold | Raw |", "|---|---|---|---|---|---|", ...rows].join("\n");
}

export function diskItem(d: Disk, h: Handlers, saved?: Saved): Item {
  const s = saved?.report.smart[d.path];
  const verdict = health(s);
  const tint = LEVEL_COLOR[verdict.level];
  const name = diskName(d, s);
  const type = kind(d, s);
  const stats: Stat[] = [{ label: "Health", value: verdict.label, color: tint }];
  if (s?.temperature !== undefined) {
    stats.push({ label: "Temperature", value: `${s.temperature} °C`, color: temperatureColor(s) });
  }
  if (s?.powerOnHours !== undefined) stats.push({ label: "Powered on", value: hours(s.powerOnHours) });
  if (s?.lifeUsed !== undefined) stats.push({ label: "Wear", value: `${s.lifeUsed}%`, color: wearColor(s.lifeUsed) });

  const metadata: Metadata[] = [
    meta.text("Device", d.path, { icon: Icons.drive }),
    meta.text("Type", type, { icon: Icons.box }),
    meta.text("Capacity", size(s?.capacity ?? d.size), { icon: Icons.database }),
  ];
  const serial = s?.serial ?? d.serial;
  if (serial) metadata.push(meta.text("Serial", serial, { icon: Icons.hash }));
  const firmware = s?.firmware ?? d.firmware;
  if (firmware) metadata.push(meta.text("Firmware", firmware, { icon: Icons.code }));
  if (s?.available) {
    metadata.push(meta.separator());
    if (s.passed !== undefined) {
      metadata.push(meta.text("Self-assessment", s.passed ? "Passed" : "FAILED", {
        icon: { source: s.passed ? Icons.check : Icons.cross, tint: s.passed ? "green" : "red" },
        color: s.passed ? "green" : "red",
      }));
    }
    if (s.lifeUsed !== undefined) {
      metadata.push(meta.progress("Endurance used", s.lifeUsed / 100, `${s.lifeUsed}%`));
    }
    if (s.availableSpare !== undefined) {
      metadata.push(meta.text("Spare blocks", `${s.availableSpare}% (threshold ${s.spareThreshold ?? "?"}%)`, {
        icon: Icons.layers,
      }));
    }
    if (s.criticalWarning) {
      metadata.push(meta.text("Critical warning", criticalWarnings(s.criticalWarning).join(", "), {
        icon: Icons.alert,
        color: "red",
      }));
    }
    const count = (label: string, value: number | undefined, icon: string) => {
      if (value !== undefined) {
        metadata.push(meta.text(label, value.toLocaleString("en-US"), { icon, color: value ? "orange" : undefined }));
      }
    };
    count("Reallocated sectors", s.reallocated, Icons.alert);
    count("Pending sectors", s.pending, Icons.hourglass);
    count("Uncorrectable sectors", s.uncorrectable, Icons.cross);
    count("Media errors", s.mediaErrors, Icons.alert);
    if (s.crcErrors) {
      metadata.push(meta.text("Cable (CRC) errors", s.crcErrors.toLocaleString("en-US"), { icon: Icons.plug }));
    }
    if (s.bytesWritten !== undefined) {
      metadata.push(meta.text("Data written", size(s.bytesWritten), { icon: Icons.upload }));
    }
    if (s.bytesRead !== undefined) metadata.push(meta.text("Data read", size(s.bytesRead), { icon: Icons.download }));
    if (s.powerOnHours !== undefined) {
      metadata.push(meta.text("Power-on hours", s.powerOnHours.toLocaleString("en-US"), { icon: Icons.clock }));
    }
    if (s.powerCycles !== undefined) {
      metadata.push(meta.text("Power cycles", s.powerCycles.toLocaleString("en-US"), { icon: Icons.power }));
    }
    if (s.unsafeShutdowns !== undefined) {
      metadata.push(meta.text("Unsafe shutdowns", s.unsafeShutdowns.toLocaleString("en-US"), { icon: Icons.bolt }));
    }
    if (s.lastTest) {
      metadata.push(meta.text(
        "Last self-test",
        `${s.lastTest.type}: ${s.lastTest.result}${
          s.lastTest.hours !== undefined ? ` (at ${s.lastTest.hours} h)` : ""
        }`,
        { icon: { source: s.lastTest.passed ? Icons.check : Icons.cross, tint: s.lastTest.passed ? "green" : "red" } },
      ));
    }
  }
  if (saved) metadata.push(meta.separator(), meta.text("Read", ago(saved.at), { icon: Icons.history }));

  const actions: Action[] = [];
  if (!saved || !s) actions.push(readAction(h, saved));
  if (s?.available) {
    actions.push(
      action("Start Short Self-Test", async () => {
        const minutes = await startSelfTest(d.path);
        await toast(`Self-test started on ${name}`, {
          style: "success",
          message: `Results in about ${minutes || s.shortTestMinutes || 2} minutes: read the SMART data again then`,
        });
      }, {
        icon: Icons.play,
        shortcut: "<Ctrl>t",
        section: "SMART",
        confirm: `Start a short self-test of ${name}? It takes a few minutes; the drive stays usable`,
      }),
    );
  }
  if (saved && s) actions.push(readAction(h, saved));
  actions.push(
    copy(`sudo smartctl -a ${d.path}`, "Copy smartctl Command", { section: "Copy", icon: Icons.terminal }),
    ...(serial ? [copy(serial, "Copy Serial Number", { section: "Copy" })] : []),
  );

  const accessories = [];
  if (s?.testRemaining !== undefined) {
    accessories.push({ text: `Testing ${100 - s.testRemaining}%`, icon: Icons.inProgress });
  }
  if (s?.temperature !== undefined) {
    accessories.push({ text: `${s.temperature} °C`, icon: Icons.thermometer, color: temperatureColor(s) });
  }
  if (!saved) accessories.push({ text: "Needs your password", icon: Icons.lock });
  accessories.push({ tag: verdict.label, color: tint });

  return {
    id: `disk:${d.path}`,
    title: name,
    subtitle: `${d.name} · ${size(d.size)} ${type}`,
    icon: { source: LEVEL_ICON[verdict.level], tint },
    section: "Drives",
    keywords: [d.name, d.path, type, serial ?? "", verdict.label],
    accessories,
    detail: {
      stats,
      markdown: [smartMarkdown(s, verdict.reasons, saved), s ? attributeTable(s) : ""].filter(Boolean).join("\n"),
      metadata,
    },
    actions,
  };
}

const SCRUB_LOOK: Record<Scrub["status"], { label: string; color: Color }> = {
  finished: { label: "Scrubbed", color: "green" },
  running: { label: "Scrubbing", color: "blue" },
  aborted: { label: "Scrub aborted", color: "orange" },
  interrupted: { label: "Scrub interrupted", color: "orange" },
  never: { label: "Never scrubbed", color: "gray" },
  unknown: { label: "Scrub unknown", color: "gray" },
};

export function btrfsItem(
  fs: { uuid: string; label?: string; mountpoint?: string; devices: string[] },
  h: Handlers,
  saved?: Saved,
): Item {
  const mount = fs.mountpoint;
  const scrub = mount ? saved?.report.scrub[mount] : undefined;
  const stats: DeviceStats[] = mount ? saved?.report.stats[mount] ?? [] : [];
  const errors = stats.reduce((sum, d) => sum + d.total, 0) + (scrub?.errors ?? 0);
  const look = scrub ? SCRUB_LOOK[scrub.status] : undefined;
  const color: Color = !saved || !scrub ? "gray" : errors ? "red" : look!.color === "gray" ? "orange" : "green";
  const title = fs.label ? `${fs.label} (Btrfs)` : mount ? `Btrfs on ${mount}` : "Btrfs (not mounted)";

  const metadata: Metadata[] = [
    meta.text("Mounted at", mount ?? "Not mounted", { icon: Icons.folder }),
    meta.tags("Devices", fs.devices),
    meta.text("UUID", fs.uuid, { icon: Icons.hash }),
  ];
  if (scrub) {
    metadata.push(meta.separator(), meta.text("Last scrub", scrub.started ?? "Never", { icon: Icons.calendar }));
    if (scrub.duration) metadata.push(meta.text("Duration", scrub.duration, { icon: Icons.timer }));
    if (scrub.total) metadata.push(meta.text("Scrubbed", scrub.total, { icon: Icons.database }));
    if (scrub.progress !== undefined) metadata.push(meta.progress("Progress", scrub.progress / 100));
    if (scrub.summary) {
      metadata.push(meta.text("Result", scrub.summary, { icon: Icons.shield, color: scrub.errors ? "red" : "green" }));
    }
  }
  for (const d of stats) {
    metadata.push(meta.separator());
    for (const [key, value] of Object.entries(d.counters)) {
      metadata.push(meta.text(`${d.device.split("/").pop()} · ${counterName(key)}`, value, {
        color: value ? "red" : undefined,
      }));
    }
  }
  const actions: Action[] = [];
  if (!saved) actions.push(readAction(h, saved));
  if (mount) {
    actions.push(
      action("Start Scrub", async () => {
        await startBtrfsScrub(mount);
        await toast(`Scrub of ${mount} started`, { style: "success", message: "It runs in the background" });
        h.changed();
      }, {
        icon: Icons.play,
        shortcut: "<Ctrl>t",
        section: "Btrfs",
        confirm: `Scrub ${mount}? Every block is read and checked; the disk is busy for a while`,
      }),
      open(mount, "Open in File Manager", { icon: Icons.folder, section: "Btrfs" }),
    );
  }
  if (saved) actions.push(readAction(h, saved));
  if (mount) actions.push(copy(`sudo btrfs scrub status ${mount}`, "Copy Status Command", { section: "Copy" }));

  return {
    id: `btrfs:${fs.uuid}`,
    title,
    subtitle: fs.devices.join(", "),
    icon: { source: Icons.layers, tint: color },
    section: "Btrfs",
    keywords: ["btrfs", "scrub", mount ?? "", ...fs.devices],
    accessories: [
      ...(!saved ? [{ text: "Needs your password", icon: Icons.lock }] : []),
      ...(errors ? [{ text: `${errors} error${errors === 1 ? "" : "s"}`, color: "red" as const }] : []),
      ...(look ? [{ tag: look.label, color: look.color }] : []),
    ],
    detail: {
      stats: scrub
        ? [
          { label: "Errors", value: errors, color: errors ? "red" : "green" },
          { label: "Scrub", value: look!.label, color: look!.color },
        ]
        : undefined,
      markdown: !saved
        ? "Error counters and the scrub status are readable by root only: **Enter** reads them."
        : !mount
        ? "Mount the filesystem to see its error counters and scrub it."
        : errors
        ? "**Errors were found.** Checksum errors mean data was corrupted on the disk; restore the affected files " +
          "from a backup. Reset the counters with `sudo btrfs device stats -z` once fixed."
        : undefined,
      metadata,
    },
    actions,
  };
}

export function poolItem(p: Pool, h: Handlers): Item {
  const color = poolColor(p.health);
  const scrubbing = /in progress/i.test(p.scan ?? "");
  const metadata: Metadata[] = [
    meta.text("Health", p.health, { icon: Icons.shield, color }),
    meta.progress("Capacity", p.capacity / 100, `${p.allocated} of ${p.size} (${p.capacity}%)`),
    meta.text("Free", p.free, { icon: Icons.database }),
    meta.text("Fragmentation", p.fragmentation, { icon: Icons.layers }),
  ];
  if (p.scan) metadata.push(meta.text("Last scan", p.scan, { icon: Icons.calendar }));
  if (p.errors) {
    metadata.push(meta.text("Errors", p.errors, {
      icon: Icons.alert,
      color: /No known data errors/i.test(p.errors) ? "green" : "red",
    }));
  }
  if (p.devices.length) {
    metadata.push(meta.separator());
    for (const d of p.devices) {
      metadata.push(meta.text(d.name, `${d.state} · errors ${d.errors} (read/write/checksum)`, {
        color: d.state === "ONLINE" && d.errors === "0/0/0" ? undefined : "red",
      }));
    }
  }
  return {
    id: `zfs:${p.name}`,
    title: p.name,
    subtitle: `ZFS pool · ${p.allocated} of ${p.size}`,
    icon: { source: Icons.database, tint: color },
    section: "ZFS Pools",
    keywords: ["zfs", "zpool", "pool", p.health],
    accessories: [
      { text: `${p.capacity}%`, color: p.capacity >= 90 ? "red" : p.capacity >= 80 ? "orange" : undefined },
      ...(scrubbing ? [{ tag: "Scrubbing", color: "blue" as const }] : []),
      { tag: p.health, color },
    ],
    detail: {
      stats: [
        { label: "Health", value: p.health, color },
        { label: "Used", value: `${p.capacity}%` },
        { label: "Free", value: p.free },
      ],
      markdown: [p.status, p.action].filter(Boolean).join("\n\n") || undefined,
      metadata,
    },
    actions: [
      action("Start Scrub", async () => {
        await startZfsScrub(p.name);
        await toast(`Scrub of ${p.name} started`, { style: "success", message: "It runs in the background" });
        h.changed();
      }, {
        icon: Icons.play,
        shortcut: "<Ctrl>t",
        confirm: `Scrub ${p.name}? Every block is read and checked; the pool is busy for a while`,
      }),
      copy(`zpool status -v ${p.name}`, "Copy Status Command", { section: "Copy" }),
    ],
  };
}
