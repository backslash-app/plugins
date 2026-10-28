import {
  type Action,
  action,
  close,
  copy,
  Icons,
  type Item,
  list,
  meta,
  open,
  refresh,
  toast,
  updateCommandMetadata,
} from "@backslash/api";
import { ago, type AppImage, formatBytes, INTEGRATOR_LABELS, tildify } from "../lib.ts";
import {
  APPLICATIONS,
  findAppImages,
  HOME,
  integrate,
  makeExecutable,
  moveToApplications,
  removeIntegration,
  runAppImage,
  trash,
} from "../appimages.ts";
import { runInTerminal } from "../terminal.ts";

interface Prefs {
  folders?: string;
  terminal?: string;
}

const short = (p: string) => tildify(p, HOME);
const dir = (p: string) => p.slice(0, p.lastIndexOf("/")) || "/";

async function step(message: string, fn: () => Promise<unknown>) {
  await fn();
  await toast(message, { style: "success" });
  return refresh();
}

/** The integration's icon when it is a file or a theme name, our glyph otherwise. */
function iconOf(a: AppImage) {
  const icon = a.entry?.icon;
  if (icon && icon !== "application-x-executable") return icon;
  return { source: Icons.apps, tint: a.executable ? "blue" as const : "gray" as const };
}

function appItem(a: AppImage, prefs: Prefs): Item {
  const integrated = !!a.entry;
  const inApplications = dir(a.path) === APPLICATIONS;
  const by = a.entry ? INTEGRATOR_LABELS[a.entry.by] : undefined;
  const runIt = action(a.executable ? "Run" : "Make Executable & Run", async () => {
    await runAppImage(a);
    return close(`${a.name} is starting`);
  }, { icon: Icons.play });
  const actions: Action[] = [
    runIt,
    integrated
      ? action("Remove from App Menu", () => step(`${a.name} removed from the menu`, () => removeIntegration(a)), {
        icon: Icons.minus,
        shortcut: "<Ctrl>i",
        ...(a.entry?.by !== "backslash"
          ? { confirm: `Delete the menu entry ${by} made for ${a.name}?`, destructive: true }
          : {}),
        section: "Menu",
      })
      : action("Add to App Menu", () => step(`${a.name} added to the menu`, () => integrate(a)), {
        icon: Icons.plus,
        shortcut: "<Ctrl>i",
        section: "Menu",
      }),
    ...(!a.executable
      ? [action("Make Executable", () => step(`${a.name} is now executable`, () => makeExecutable(a)), {
        icon: Icons.check,
        shortcut: "<Ctrl>x",
        section: "File",
      })]
      : []),
    ...(!inApplications
      ? [action("Move to ~/Applications", async () => {
        const target = await moveToApplications(a);
        await toast(`Moved to ${short(target)}`, { style: "success" });
        return refresh();
      }, { icon: Icons.arrowRight, shortcut: "<Ctrl>m", section: "File" })]
      : []),
    action("Run in Terminal", () => {
      runInTerminal(
        [
          "sh",
          "-c",
          `"$1"; status=$?; echo; printf 'Exited with %s. Press Enter to close this window.' "$status"; read -r _`,
          "sh",
          a.path,
        ],
        prefs.terminal || undefined,
      );
      return close();
    }, { icon: Icons.terminal, section: "File" }),
    open(dir(a.path), "Open Containing Folder", { icon: Icons.folder, shortcut: "<Ctrl>o", section: "File" }),
    ...(a.entry ? [open(a.entry.file, "Open Menu Entry", { icon: Icons.file, section: "Menu" })] : []),
    copy(a.path, "Copy Path", { section: "Copy", shortcut: "<Ctrl><Shift>c" }),
    action("Move to Trash", () => step(`${a.name} moved to the trash`, () => trash(a)), {
      icon: Icons.trash,
      destructive: true,
      confirm: `Move ${a.file} (${formatBytes(a.size)}) to the trash?`,
      shortcut: "<Ctrl>Delete",
      section: "Danger",
    }),
    action("Reload", () => refresh(), { icon: Icons.refresh, shortcut: "<Ctrl>r" }),
  ];
  return {
    id: a.path,
    title: a.name,
    subtitle: a.version ? `${a.version} · ${short(dir(a.path))}` : short(dir(a.path)),
    icon: iconOf(a),
    section: integrated ? "In the App Menu" : "Not in the Menu",
    keywords: [a.file, short(a.path), a.version ?? "", ...(by ? [by] : [])],
    accessories: [
      ...(!a.executable ? [{ tag: "Not executable", color: "orange" as const }] : []),
      ...(a.type === undefined
        ? [{ tag: "Unverified", color: "gray" as const, tooltip: "No AppImage signature" }]
        : []),
      ...(integrated
        ? [{ icon: { source: Icons.check, tint: "green" as const }, tooltip: `In the app menu (${by})` }]
        : []),
      { text: formatBytes(a.size) },
      ...(a.modified ? [{ text: ago(a.modified), tooltip: `Modified ${new Date(a.modified).toLocaleString()}` }] : []),
    ],
    detail: {
      stats: [
        { label: "Size", value: formatBytes(a.size) },
        { label: "Version", value: a.version ?? "?" },
        { label: "Menu", value: integrated ? "Yes" : "No", color: integrated ? "green" : "gray" },
      ],
      metadata: [
        meta.text("File", a.file, { icon: Icons.file }),
        meta.text("Folder", short(dir(a.path)), { icon: Icons.folder }),
        ...(a.modified
          ? [
            meta.text("Modified", `${new Date(a.modified).toLocaleString()} (${ago(a.modified)})`, {
              icon: Icons.calendar,
            }),
          ]
          : []),
        meta.text("Executable", a.executable ? "Yes" : "No", {
          icon: Icons.terminal,
          color: a.executable ? "green" : "orange",
        }),
        meta.text("Format", a.type ? `AppImage type ${a.type}` : "Named .AppImage, no signature found", {
          icon: Icons.package,
        }),
        ...(a.arch ? [meta.text("Architecture", a.arch, { icon: Icons.cpu })] : []),
        ...(a.entry
          ? [
            meta.text("Menu entry", short(a.entry.file), { icon: Icons.apps }),
            meta.text("Added by", by!, { icon: Icons.person }),
            ...(a.entry.comment ? [meta.text("Comment", a.entry.comment, { icon: Icons.comment })] : []),
          ]
          : []),
      ],
    },
    actions,
  };
}

export default list({
  placeholder: "Filter AppImages…",
  empty: {
    title: "No AppImage found",
    description: "Put them in ~/Applications, or add their folder in Settings",
    icon: Icons.apps,
  },
  status: (items) => `${items.length} AppImage${items.length === 1 ? "" : "s"}`,
  async items({ preferences }) {
    const prefs = preferences as Prefs;
    const { apps } = await findAppImages(prefs.folders ?? "");
    const total = apps.reduce((n, a) => n + a.size, 0);
    updateCommandMetadata({ subtitle: apps.length ? `${apps.length} · ${formatBytes(total)}` : null }).catch(() => {});
    // Integrated first, then the others, each by name.
    return [
      ...apps.filter((a) => a.entry).map((a) => appItem(a, prefs)),
      ...apps.filter((a) => !a.entry).map((a) => appItem(a, prefs)),
    ];
  },
});
