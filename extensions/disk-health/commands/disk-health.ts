import { copy, Icons, type Item, list, open, toast, updateCommandMetadata } from "@backslash/api";
import { btrfsFilesystems, type Disk, health, installSmartctl, osFamily } from "../lib.ts";
import { disks, pools, readAsRoot, type Saved, saved } from "../system.ts";
import { btrfsItem, diskItem, type Handlers, poolItem } from "../ui.ts";

const changes = new EventTarget();
const changed = () => changes.dispatchEvent(new Event("change"));

/** Yields once, then again after each change, until the user leaves. */
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

let current: Disk[] = [];

const handlers: Handlers = {
  async read() {
    await toast("Reading SMART data…");
    const result = await readAsRoot(current);
    const failing = current.filter((d) => health(result.report.smart[d.path]).level === "failing").length;
    await toast(failing ? `${failing} drive${failing > 1 ? "s" : ""} failing` : "SMART data read", {
      style: failing ? "failure" : "success",
    });
    changed();
  },
  changed,
};

async function installItem(): Promise<Item> {
  const command = installSmartctl(osFamily(await Deno.readTextFile("/etc/os-release").catch(() => "")));
  return {
    id: "install",
    title: "smartctl is not installed",
    subtitle: "Install smartmontools to read SMART data",
    icon: { source: Icons.alert, tint: "orange" },
    section: "Drives",
    detail: {
      markdown: `SMART data comes from **smartctl**, in the smartmontools package:\n\n\`\`\`\n${command}\n\`\`\``,
    },
    actions: [
      copy(command, "Copy Install Command"),
      open("https://www.smartmontools.org/", "smartmontools Website", { icon: Icons.globe }),
    ],
  };
}

export default list({
  placeholder: "Filter drives, filesystems and pools…",
  empty: { title: "No drive found", description: "lsblk lists no physical drive", icon: Icons.drive },
  status: (items) => {
    const drives = items.filter((i) => i.section === "Drives" && i.id !== "install").length;
    return `${drives} drive${drives === 1 ? "" : "s"}`;
  },
  items: ({ signal }) =>
    live(async () => {
      const [found, zfs, last] = await Promise.all([disks(), pools(), saved()]);
      current = found;
      // SMART data read earlier is kept only for drives that are still there.
      const known: Saved | undefined = last;
      const items: Item[] = [];
      if (known?.report.missing.includes("smartctl")) items.push(await installItem());
      items.push(...found.map((d) => diskItem(d, handlers, known)));
      items.push(...btrfsFilesystems(found).map((fs) => btrfsItem(fs, handlers, known)));
      items.push(...zfs.map((p) => poolItem(p, handlers)));

      const levels = found.map((d) => health(known?.report.smart[d.path]).level);
      const bad = levels.filter((l) => l === "failing" || l === "warning").length;
      updateCommandMetadata({
        subtitle: known ? (bad ? `${bad} drive${bad > 1 ? "s" : ""} need attention` : "All drives healthy") : null,
      }).catch(() => {});
      return items;
    }, signal),
});
