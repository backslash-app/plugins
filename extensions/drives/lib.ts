// Parsing lsblk and udisksctl output. Pure, tested in lib_test.ts.

import type { Color } from "@backslash/api";

/** Columns asked of lsblk; older util-linux (< 2.33) lacks some, then the short list is used. */
export const COLUMNS =
  "NAME,PATH,LABEL,UUID,SIZE,FSTYPE,FSVER,MOUNTPOINT,RM,HOTPLUG,MODEL,VENDOR,TRAN,FSUSED,FSAVAIL,TYPE,RO";
export const COLUMNS_SHORT = "NAME,LABEL,SIZE,FSTYPE,MOUNTPOINT,RM,HOTPLUG,MODEL,TRAN,FSUSED,FSAVAIL,TYPE";

export interface Volume {
  name: string;
  path: string;
  label?: string;
  uuid?: string;
  size: number;
  fstype?: string;
  fsver?: string;
  mountpoint?: string;
  used?: number;
  available?: number;
  type: string;
  readonly: boolean;
  /** For an unlocked LUKS volume: the filesystem inside. */
  inner?: Volume;
}

export interface Disk {
  name: string;
  path: string;
  model?: string;
  vendor?: string;
  size: number;
  transport?: string;
  removable: boolean;
  type: string;
  volumes: Volume[];
}

// lsblk prints booleans and numbers as JSON values since 2.33, as strings before.
const bool = (v: unknown) => v === true || v === 1 || v === "1" || v === "true";
const num = (v: unknown) => (v === null || v === undefined || v === "" ? undefined : Number(v));
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);

interface Raw {
  [key: string]: unknown;
  children?: Raw[];
}

function volume(r: Raw): Volume {
  const name = String(r.name);
  const children = r.children ?? [];
  // An open LUKS container has a "crypt" child holding the real filesystem.
  const crypt = children.find((c) => c.type === "crypt" || c.type === "lvm");
  return {
    name,
    path: str(r.path) ?? `/dev/${name}`,
    label: str(r.label),
    uuid: str(r.uuid),
    size: num(r.size) ?? 0,
    fstype: str(r.fstype),
    fsver: str(r.fsver),
    mountpoint: str(r.mountpoint),
    used: num(r.fsused),
    available: num(r.fsavail),
    type: String(r.type ?? "part"),
    readonly: bool(r.ro),
    inner: crypt ? volume(crypt) : undefined,
  };
}

/** `lsblk -J -b -o …`: physical disks with their volumes; loop devices, zram and empty readers are left out. */
export function parseLsblk(json: string): Disk[] {
  const devices = (JSON.parse(json).blockdevices ?? []) as Raw[];
  return devices.flatMap((r) => {
    const name = String(r.name);
    const type = String(r.type ?? "disk");
    if (!["disk", "rom"].includes(type) || /^(zram|ram|loop)/.test(name)) return [];
    const size = num(r.size) ?? 0;
    if (size === 0) return [];
    const parts = (r.children ?? []).filter((c) => c.type === "part" || c.type === "crypt" || c.type === "lvm");
    // A stick formatted without a partition table carries its filesystem on the disk itself.
    const volumes = parts.length ? parts.map(volume) : str(r.fstype) || str(r.mountpoint) ? [volume(r)] : [];
    const transport = str(r.tran);
    return [{
      name,
      path: str(r.path) ?? `/dev/${name}`,
      model: str(r.model)?.replace(/_/g, " "),
      // Virtual disks report a PCI id ("0x1af4") as vendor.
      vendor: str(r.vendor)?.startsWith("0x") ? undefined : str(r.vendor),
      size,
      transport,
      removable: bool(r.rm) || bool(r.hotplug) || transport === "usb" || transport === "mmc",
      type,
      volumes,
    }];
  });
}

/** The volume that is mounted, or would be: the filesystem inside an unlocked LUKS container. */
export const effective = (v: Volume): Volume => v.inner ?? v;

export const isEncrypted = (v: Volume) => v.fstype === "crypto_LUKS" || v.fstype === "BitLocker";
export const isSwap = (v: Volume) => v.fstype === "swap" || v.mountpoint === "[SWAP]";

const SYSTEM_MOUNTS = /^\/(boot(\/efi)?|efi|home|usr|var|opt|srv|nix|gnu|recovery)?$/;

/** Mounted where the system needs it: don't offer to unmount it. */
export const isSystemMount = (mountpoint?: string) =>
  mountpoint !== undefined && (SYSTEM_MOUNTS.test(mountpoint) || mountpoint === "[SWAP]");

/** Partitions that hold nothing to browse: EFI-reserved, BIOS boot, LVM members… */
export const isPlumbing = (v: Volume) =>
  !v.mountpoint &&
  (!v.fstype ? v.size < 64 * 1024 * 1024 : ["LVM2_member", "linux_raid_member", "zfs_member"].includes(v.fstype));

const FS_NAMES: Record<string, string> = {
  vfat: "FAT",
  exfat: "exFAT",
  ntfs: "NTFS",
  ntfs3: "NTFS",
  ext2: "ext2",
  ext3: "ext3",
  ext4: "ext4",
  btrfs: "Btrfs",
  xfs: "XFS",
  f2fs: "F2FS",
  zfs_member: "ZFS",
  hfsplus: "HFS+",
  apfs: "APFS",
  iso9660: "ISO 9660",
  udf: "UDF",
  swap: "Swap",
  crypto_LUKS: "LUKS",
  BitLocker: "BitLocker",
  LVM2_member: "LVM",
  squashfs: "SquashFS",
};

/** "FAT32", "ext4", "LUKS 2"… */
export function fsName(v: Volume): string {
  if (!v.fstype) return v.mountpoint ? "Unknown" : "Unformatted";
  const base = FS_NAMES[v.fstype] ?? v.fstype;
  if (v.fstype === "vfat" && v.fsver) return v.fsver.replace(/^FAT/, "FAT");
  if (v.fstype === "crypto_LUKS" && v.fsver) return `LUKS ${v.fsver}`;
  return base;
}

const TRANSPORTS: Record<string, string> = {
  usb: "USB",
  sata: "SATA",
  ata: "ATA",
  nvme: "NVMe",
  mmc: "SD card",
  scsi: "SCSI",
  sas: "SAS",
  virtio: "Virtual",
  iscsi: "iSCSI",
  ieee1394: "FireWire",
};

export const transportName = (t?: string) => (t ? TRANSPORTS[t] ?? t.toUpperCase() : "Unknown");

/** The disk's commercial name: "SanDisk Ultra", "Samsung SSD 980 PRO 1TB". */
export function diskName(d: Disk): string {
  const model = d.model ?? "";
  const vendor = d.vendor && !model.toLowerCase().startsWith(d.vendor.toLowerCase()) ? d.vendor : "";
  return [vendor, model].filter(Boolean).join(" ") ||
    (d.type === "rom" ? "Optical drive" : d.transport ? `${transportName(d.transport)} drive` : "Drive");
}

/** What the user calls a volume: its label, else where it is mounted, else its size and kind. */
export function volumeName(v: Volume, d: Disk): string {
  const e = effective(v);
  if (e.label) return e.label;
  if (v.label) return v.label;
  if (e.mountpoint === "/") return "System";
  if (e.mountpoint && e.mountpoint !== "[SWAP]") return e.mountpoint.split("/").pop() || e.mountpoint;
  if (isSwap(e)) return "Swap";
  return `${size(v.size)} ${
    d.removable ? "Volume" : fsName(e) === "Unformatted" ? "Partition" : `${fsName(e)} Volume`
  }`;
}

/** 32 GB, 1 TB: decimal units, as printed on drives. */
export function size(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0 B";
  const units = ["B", "kB", "MB", "GB", "TB", "PB"];
  let i = 0;
  while (n >= 1000 && i < units.length - 1) {
    n /= 1000;
    i++;
  }
  return `${n >= 100 || i === 0 ? Math.round(n) : n.toFixed(1).replace(/\.0$/, "")} ${units[i]}`;
}

export const usageColor = (ratio: number): Color =>
  ratio >= 0.95 ? "red" : ratio >= 0.85 ? "orange" : ratio >= 0.7 ? "yellow" : "green";

/** `udisksctl mount`: "Mounted /dev/sdb1 at /run/media/ada/STICK" (older versions end with a dot). */
export function parseMounted(out: string): string | undefined {
  return out.match(/^Mounted \S+ at (.+?)\.?$/m)?.[1];
}

/** `udisksctl unlock`: "Unlocked /dev/sdb1 as /dev/dm-3." */
export function parseUnlocked(out: string): string | undefined {
  return out.match(/^Unlocked \S+ as (\S+?)\.?$/m)?.[1];
}

/** Turns udisks' D-Bus errors into a sentence. */
export function explainUdisksError(message: string): string {
  if (/target is busy|device is busy|DeviceBusy/i.test(message)) {
    return "The drive is in use: close the files and windows using it, then try again";
  }
  if (/NotAuthorized|not authorized|Authentication is required/i.test(message)) {
    return "Not allowed: your system's policy requires an administrator for this drive";
  }
  if (/not mounted/i.test(message)) return "Already unmounted";
  if (/already mounted/i.test(message)) return "Already mounted";
  if (/Error connecting to the udisks daemon|Could not connect|ServiceUnknown/i.test(message)) {
    return "The udisks service is not running (install and start udisks2)";
  }
  if (/wrong passphrase|Failed to activate device|incorrect passphrase/i.test(message)) return "Wrong passphrase";
  const m = message.match(/GDBus\.Error:[\w.]+:\s*(.*)$/m);
  return (m?.[1] ?? message).trim();
}
