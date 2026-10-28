import { assertEquals } from "@std/assert";
import {
  diskName,
  effective,
  explainUdisksError,
  fsName,
  isPlumbing,
  isSystemMount,
  parseLsblk,
  parseMounted,
  parseUnlocked,
  size,
  volumeName,
} from "./lib.ts";

// util-linux 2.39 on a laptop: NVMe with EFI and an unlocked LUKS root, a USB stick, an empty SD reader.
const LAPTOP = JSON.stringify({
  blockdevices: [
    {
      name: "zram0",
      path: "/dev/zram0",
      size: 8589934592,
      type: "disk",
      mountpoint: "[SWAP]",
      fstype: "swap",
      rm: false,
      hotplug: false,
    },
    {
      name: "mmcblk0",
      path: "/dev/mmcblk0",
      size: 0,
      type: "disk",
      rm: true,
      hotplug: true,
      tran: "mmc",
    },
    {
      name: "nvme0n1",
      path: "/dev/nvme0n1",
      label: null,
      size: 1000204886016,
      fstype: null,
      mountpoint: null,
      rm: false,
      hotplug: false,
      model: "Samsung SSD 980 PRO 1TB",
      vendor: null,
      tran: "nvme",
      type: "disk",
      ro: false,
      children: [
        {
          name: "nvme0n1p1",
          path: "/dev/nvme0n1p1",
          label: "EFI",
          uuid: "B2A1-1C3D",
          size: 629145600,
          fstype: "vfat",
          fsver: "FAT32",
          mountpoint: "/boot/efi",
          fsused: 78643200,
          fsavail: 550502400,
          type: "part",
          rm: false,
          hotplug: false,
        },
        {
          name: "nvme0n1p2",
          path: "/dev/nvme0n1p2",
          uuid: "6c1b6e0e-luks",
          size: 999574142976,
          fstype: "crypto_LUKS",
          fsver: "2",
          mountpoint: null,
          type: "part",
          children: [
            {
              name: "luks-6c1b",
              path: "/dev/mapper/luks-6c1b",
              label: "fedora",
              uuid: "f00d-btrfs",
              size: 999557365760,
              fstype: "btrfs",
              mountpoint: "/",
              fsused: 400000000000,
              fsavail: 590000000000,
              type: "crypt",
            },
          ],
        },
      ],
    },
    {
      name: "sda",
      path: "/dev/sda",
      size: 61530439680,
      rm: true,
      hotplug: true,
      model: "Ultra_Fit",
      vendor: "SanDisk ",
      tran: "usb",
      type: "disk",
      children: [
        {
          name: "sda1",
          path: "/dev/sda1",
          label: null,
          uuid: "1234-ABCD",
          size: 61529391104,
          fstype: "exfat",
          fsver: "1.0",
          mountpoint: null,
          type: "part",
        },
      ],
    },
  ],
});

Deno.test("lsblk: disks, partitions and unlocked LUKS", () => {
  const disks = parseLsblk(LAPTOP);
  assertEquals(disks.map((d) => d.name), ["nvme0n1", "sda"]);
  const [nvme, usb] = disks;
  assertEquals(nvme.removable, false);
  assertEquals(usb.removable, true);
  assertEquals(diskName(nvme), "Samsung SSD 980 PRO 1TB");
  assertEquals(diskName(usb), "SanDisk Ultra Fit");
  assertEquals(nvme.volumes.length, 2);
  const root = nvme.volumes[1];
  assertEquals(effective(root).mountpoint, "/");
  assertEquals(effective(root).path, "/dev/mapper/luks-6c1b");
  assertEquals(fsName(root), "LUKS 2");
  assertEquals(fsName(nvme.volumes[0]), "FAT32");
  assertEquals(volumeName(root, nvme), "fedora");
  assertEquals(volumeName(nvme.volumes[0], nvme), "EFI");
  assertEquals(volumeName(usb.volumes[0], usb), "61.5 GB Volume");
});

Deno.test("lsblk before 2.33: strings for numbers and booleans, no path", () => {
  const old = JSON.stringify({
    blockdevices: [{
      name: "sdb",
      label: "KEY",
      size: "15728640000",
      fstype: "vfat",
      mountpoint: "/run/media/ada/KEY",
      rm: "1",
      hotplug: "1",
      model: "DataTraveler 3.0",
      tran: "usb",
      fsused: "1048576000",
      fsavail: "14680064000",
      type: "disk",
    }],
  });
  const [d] = parseLsblk(old);
  assertEquals(d.path, "/dev/sdb");
  assertEquals(d.removable, true);
  // Formatted without a partition table: the disk is its own volume.
  assertEquals(d.volumes.length, 1);
  assertEquals(d.volumes[0].used, 1048576000);
  assertEquals(volumeName(d.volumes[0], d), "KEY");
});

Deno.test("system mounts and plumbing partitions", () => {
  assertEquals(["/", "/boot/efi", "/home", "[SWAP]", "/run/media/ada/KEY", "/mnt/data"].map(isSystemMount), [
    true,
    true,
    true,
    true,
    false,
    false,
  ]);
  const base = { name: "x", path: "/dev/x", type: "part", readonly: false };
  assertEquals(isPlumbing({ ...base, size: 16 * 1024 * 1024 }), true); // Microsoft reserved
  assertEquals(isPlumbing({ ...base, size: 16e9, fstype: "LVM2_member" }), true);
  assertEquals(isPlumbing({ ...base, size: 16e9, fstype: "ext4" }), false);
});

Deno.test("udisksctl output and errors", () => {
  assertEquals(parseMounted("Mounted /dev/sda1 at /run/media/ada/USB STICK"), "/run/media/ada/USB STICK");
  assertEquals(parseMounted("Mounted /dev/sdb1 at /media/ada/KEY."), "/media/ada/KEY");
  assertEquals(parseUnlocked("Unlocked /dev/sdb1 as /dev/dm-3."), "/dev/dm-3");
  assertEquals(
    explainUdisksError(
      "udisksctl exited with 1: Error unmounting /dev/sda1: GDBus.Error:org.freedesktop.UDisks2.Error.DeviceBusy: Error unmounting /dev/sda1: target is busy",
    ),
    "The drive is in use: close the files and windows using it, then try again",
  );
  assertEquals(
    explainUdisksError("Error connecting to the udisks daemon: Could not connect: No such file or directory"),
    "The udisks service is not running (install and start udisks2)",
  );
  assertEquals(
    explainUdisksError("Error mounting: GDBus.Error:org.freedesktop.UDisks2.Error.Failed: Unknown filesystem type"),
    "Unknown filesystem type",
  );
});

Deno.test("sizes in decimal units, as printed on drives", () => {
  assertEquals([size(0), size(999), size(61529391104), size(1000204886016), size(629145600)], [
    "0 B",
    "999 B",
    "61.5 GB",
    "1 TB",
    "629 MB",
  ]);
});
