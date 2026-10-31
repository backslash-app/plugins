import {
  type Action,
  action,
  close,
  type Color,
  copy,
  type Icon,
  Icons,
  type Item,
  list,
  meta,
  type Metadata,
  refresh,
  toast,
} from "@backslash/api";
import { type BootEntry, efiFile, hidden, type Os, OS_TITLES, SOURCE_TITLES, windowsFirst } from "../lib.ts";
import {
  cancelNext,
  efi,
  firmwareSetup,
  type Grub,
  grub,
  reboot,
  rebootInto,
  rebootToFirmware,
  setDefault,
  setNext,
  systemdBoot,
  type Tools,
  unlockGrub,
} from "../system.ts";

const OS_ICONS: Record<Os, { source: string; tint: Color }> = {
  windows: { source: Icons.window, tint: "blue" },
  linux: { source: Icons.terminal, tint: "green" },
  macos: { source: Icons.apps, tint: "gray" },
  firmware: { source: Icons.settings, tint: "orange" },
  network: { source: Icons.globe, tint: "teal" },
  removable: { source: Icons.drive, tint: "purple" },
  tool: { source: Icons.code, tint: "gray" },
  other: { source: Icons.power, tint: "gray" },
};

const SAVE = "Open apps are closed: save your work first.";

let summary = "";

function entryItem(e: BootEntry, tools: Tools, canCancel: boolean): Item {
  const where = SOURCE_TITLES[e.source];
  const file = e.source === "efi" ? efiFile(e.path) : e.path;
  const metadata: Metadata[] = [
    meta.text("Boot loader", where, { icon: Icons.layers }),
    meta.text("System", OS_TITLES[e.os], { icon: OS_ICONS[e.os].source }),
    meta.text(e.source === "efi" ? "Boot number" : "Entry", e.source === "efi" ? `Boot${e.target}` : e.target, {
      icon: Icons.hash,
    }),
    ...(e.submenu ? [meta.text("Submenu", e.submenu, { icon: Icons.folder })] : []),
    ...(e.version ? [meta.text("Version", e.version, { icon: Icons.tag })] : []),
    ...(file ? [meta.text(e.source === "efi" ? "Loader" : "Kernel", file, { icon: Icons.file })] : []),
    meta.separator(),
    meta.tags("State", [
      ...(e.isCurrent ? [{ text: "Running now", color: "green" as const }] : []),
      ...(e.isDefault
        ? [{ text: e.source === "efi" ? "First in boot order" : "Default", color: "blue" as const }]
        : []),
      ...(e.isNext ? [{ text: "Next boot", color: "orange" as const }] : []),
      ...(e.active === false ? [{ text: "Inactive", color: "gray" as const }] : []),
      ...(!e.isCurrent && !e.isDefault && !e.isNext && e.active !== false ? [{ text: "Available" }] : []),
    ]),
  ];
  const markdown = [
    e.options ? `**Kernel options**\n\n\`\`\`\n${e.options}\n\`\`\`` : "",
    e.source === "efi" && e.path ? `**Device path**\n\n\`\`\`\n${e.path}\n\`\`\`` : "",
  ].filter(Boolean).join("\n\n");

  const actions: Action[] = [
    action(`Reboot into ${e.title}`, async () => {
      await rebootInto(e, tools);
      return close("Rebooting…");
    }, { icon: Icons.power, confirm: `Reboot now into “${e.title}”, this time only? ${SAVE}` }),
    action("Pick for Next Boot Only", async () => {
      await setNext(e, tools);
      await toast(`${e.title} starts at the next reboot`, { style: "success" });
      return refresh();
    }, { icon: Icons.arrowRight }),
    ...(e.source === "systemd-boot" && !e.isDefault
      ? [action("Make Default", async () => {
        await setDefault(e);
        await toast(`${e.title} is now the default entry`, { style: "success" });
        return refresh();
      }, { icon: Icons.starFilled, shortcut: "<Ctrl>d", confirm: `Start “${e.title}” by default from now on?` })]
      : []),
    ...(canCancel ? [cancelAction(e.source, tools)] : []),
    copy(e.target, e.source === "efi" ? "Copy Boot Number" : "Copy Entry ID", {
      section: "Copy",
      shortcut: "<Ctrl><Shift>c",
    }),
    copy(e.title, "Copy Title", { section: "Copy" }),
    ...common(),
  ];

  return {
    id: `${e.source}:${e.target}`,
    title: e.title,
    subtitle: e.submenu ?? e.version,
    icon: e.active === false ? { source: OS_ICONS[e.os].source, tint: "gray" } : OS_ICONS[e.os],
    section: SOURCE_TITLES[e.source],
    keywords: [OS_TITLES[e.os], e.target, e.source, e.os === "windows" ? "windows win dual boot" : ""],
    accessories: [
      ...(e.isNext ? [{ tag: "Next boot", color: "orange" as const }] : []),
      ...(e.isCurrent ? [{ tag: "Running", color: "green" as const }] : []),
      ...(e.isDefault ? [{ tag: e.source === "efi" ? "First" : "Default", color: "blue" as const }] : []),
      ...(e.active === false ? [{ tag: "Inactive", color: "gray" as const }] : []),
    ],
    detail: { markdown: markdown || undefined, metadata },
    actions,
  };
}

function cancelAction(source: BootEntry["source"], tools: Tools): Action {
  return action("Cancel Next Boot Choice", async () => {
    await cancelNext(source, tools);
    await toast("The usual entry starts at the next reboot", { style: "success" });
    return refresh();
  }, { icon: Icons.cross, section: "Next Boot", shortcut: "<Ctrl><Shift>x" });
}

function common(): Action[] {
  return [
    action("Reboot Normally", async () => {
      await reboot();
      return close("Rebooting…");
    }, { icon: Icons.refresh, section: "Power", confirm: `Reboot now? ${SAVE}` }),
    action("Reboot into Firmware Setup", async () => {
      await rebootToFirmware();
      return close("Rebooting into the firmware setup…");
    }, { icon: Icons.settings, section: "Power", confirm: `Reboot now into the UEFI/BIOS setup? ${SAVE}` }),
    action("Refresh", () => refresh(), { icon: Icons.refresh, shortcut: "<Ctrl>r", section: "View" }),
  ];
}

function firmwareItem(support: string | undefined): Item {
  const challenge = support === "challenge";
  return {
    id: "firmware-setup",
    title: "Firmware Setup (UEFI/BIOS)",
    subtitle: "Boot order, Secure Boot, virtualization…",
    icon: { source: Icons.settings, tint: "orange" },
    section: "Firmware",
    keywords: ["bios", "uefi", "firmware", "setup", "secure boot", "virtualization", "virtualisation", "paramètres"],
    detail: {
      markdown: "Reboots straight into the firmware's settings, without pressing a key at the right moment." +
        (challenge ? "\n\nYour system asks for a password first." : ""),
      metadata: [meta.text("Supported", support === "yes" || challenge ? "Yes" : "Unknown", { icon: Icons.check })],
    },
    actions: [
      action("Reboot into Firmware Setup", async () => {
        await rebootToFirmware();
        return close("Rebooting into the firmware setup…");
      }, { icon: Icons.settings, confirm: `Reboot now into the UEFI/BIOS setup? ${SAVE}` }),
      action("Refresh", () => refresh(), { icon: Icons.refresh, shortcut: "<Ctrl>r", section: "View" }),
    ],
  };
}

function lockedGrubItem(g: Grub): Item {
  return {
    id: "grub-locked",
    title: "Read the GRUB Menu",
    subtitle: `${g.dir}/grub.cfg is readable by root only`,
    icon: { source: Icons.lock, tint: "orange" },
    section: SOURCE_TITLES.grub,
    detail: { markdown: "Backslash asks for your password once to read the menu, then keeps it until it quits." },
    actions: [
      action("Read with Password", async () => {
        await unlockGrub(g.dir);
        return refresh();
      }, { icon: Icons.key }),
    ],
  };
}

function noticeItem(id: string, title: string, subtitle: string, icon: Icon, markdown: string): Item {
  return { id, title, subtitle, icon, section: "Notes", detail: { markdown }, actions: common() };
}

export default list({
  placeholder: "Reboot into…",
  empty: {
    title: "No boot entry found",
    description: "Install efibootmgr, or use systemd-boot or GRUB",
    icon: Icons.power,
  },
  status: () => summary,
  actions: common(),
  async items() {
    const [sd, g, firmware, support] = await Promise.all([
      systemdBoot().catch(() => undefined),
      grub().catch(() => undefined),
      efi().catch(() => undefined),
      firmwareSetup(),
    ]);
    const tools: Tools = { grubReboot: g?.rebootTool ?? "grub-reboot", grubEditenv: g?.editenvTool ?? "grub-editenv" };
    const items: Item[] = [];

    const sdEntries = windowsFirst((sd?.entries ?? []).filter((e) => !hidden(e)));
    const sdNext = sdEntries.some((e) => e.isNext);
    items.push(...sdEntries.map((e) => entryItem(e, tools, sdNext)));
    if (sd?.partial) {
      items.push(noticeItem(
        "sd-partial",
        "Entry details need root",
        "bootctl can't read the EFI system partition as you",
        { source: Icons.info, tint: "gray" },
        "The entries come from what systemd-boot reported at boot; their titles and kernels are on a partition only root can read.",
      ));
    }

    // GRUB, unless systemd-boot runs the show (a leftover grub.cfg would only mislead).
    if (g && !sdEntries.length) {
      if (g.locked) items.push(lockedGrubItem(g));
      const grubEntries = windowsFirst(g.entries.filter((e) => e.os !== "firmware"));
      const next = grubEntries.some((e) => e.isNext);
      items.push(...grubEntries.map((e) => entryItem(e, tools, next)));
      if (grubEntries.length && !g.supportsNextEntry) {
        items.push(noticeItem(
          "grub-no-next",
          "GRUB ignores next-boot choices",
          "Regenerate grub.cfg with grub-mkconfig",
          { source: Icons.alert, tint: "orange" },
          "This grub.cfg doesn't read `next_entry`, so rebooting into an entry once may start the default one.",
        ));
      }
    }

    const efiEntries = firmware?.entries ?? [];
    const efiNext = !!firmware?.next;
    items.push(...efiEntries.map((e) => entryItem(e, tools, efiNext)));

    if (support !== "na" && support !== "no") items.push(firmwareItem(support));

    const next = [...sdEntries, ...(g?.entries ?? []), ...efiEntries].find((e) => e.isNext);
    const count = sdEntries.length + (sdEntries.length ? 0 : g?.entries.length ?? 0) + efiEntries.length;
    summary = [
      `${count} boot entr${count === 1 ? "y" : "ies"}`,
      ...(next ? [`next boot: ${next.title}`] : []),
      ...(firmware?.timeout !== undefined ? [`firmware timeout ${firmware.timeout}s`] : []),
    ].join(" · ");
    return items;
  },
});
