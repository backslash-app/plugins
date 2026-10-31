// What a package looks like in both commands, and its PKGBUILD.

import {
  type Accessory,
  type Action,
  action,
  close,
  type Color,
  copy,
  detail,
  Icons,
  type Item,
  meta,
  type Metadata,
  open,
} from "@backslash/api";
import { pkgbuild } from "./api.ts";
import {
  age,
  type AurPackage,
  cloneUrl,
  date,
  depName,
  type Helper,
  installCommand,
  type Installed,
  isVcs,
  packageUrl,
  pkgbuildMarkdown,
  pkgbuildPageUrl,
  popularity,
  removeCommand,
  type State,
  votes,
} from "./lib.ts";
import { inTerminal } from "./system.ts";

export interface Setup {
  helper?: Helper;
  terminal?: unknown;
}

export const helperName = (s: Setup) => s.helper ?? "makepkg";

function terminalAction(title: string, command: string, setup: Setup, options: Parameters<typeof action>[2] = {}) {
  return action(title, () => {
    const term = inTerminal(command, setup.terminal);
    return close(`Running in ${term}…`);
  }, { icon: Icons.terminal, ...options });
}

export function installAction(
  p: AurPackage,
  setup: Setup,
  verb: "Install" | "Update" | "Reinstall" = "Install",
): Action {
  const how = setup.helper ? ` with ${setup.helper}` : "";
  return terminalAction(
    `${verb} ${p.Name}${how}`,
    installCommand([p.Name], setup.helper, p.PackageBase),
    setup,
    { icon: Icons.download },
  );
}

export function removeAction(name: string, setup: Setup): Action {
  return terminalAction(`Remove ${name}`, removeCommand([name]), setup, {
    icon: Icons.trash,
    destructive: true,
    section: "Danger",
    shortcut: "<Ctrl>Delete",
    confirm: `Remove ${name} and the dependencies nothing else needs? It runs in a terminal, with sudo.`,
  });
}

export function pkgbuildAction(p: AurPackage, setup: Setup, installed?: Installed): Action {
  return action("View PKGBUILD", async ({ signal }) => {
    const text = await pkgbuild(p.PackageBase, signal);
    return detail({
      title: `PKGBUILD · ${p.PackageBase}`,
      markdown: pkgbuildMarkdown(p.PackageBase, text),
      metadata: [
        meta.text("Package base", p.PackageBase, { icon: Icons.package }),
        meta.text("Version", p.Version, { icon: Icons.tag }),
        meta.text("Maintainer", p.Maintainer ?? "Orphaned", { icon: Icons.person }),
        meta.text("Updated", date(p.LastModified), { icon: Icons.clock }),
        meta.link("Browse", "cgit", pkgbuildPageUrl(p.PackageBase)),
      ],
      actions: [
        installAction(p, setup, installed ? "Update" : "Install"),
        open(pkgbuildPageUrl(p.PackageBase), "Open in cgit", { icon: Icons.globe, shortcut: "<Ctrl>o" }),
        copy(text, "Copy PKGBUILD", { section: "Copy" }),
      ],
    });
  }, { icon: Icons.code, shortcut: "<Ctrl>p" });
}

function depTags(label: string, deps: string[] | undefined, color?: Color): Metadata[] {
  if (!deps?.length) return [];
  const names = [...new Set(deps.map(depName))];
  return [
    meta.tags(
      label,
      [...names.slice(0, 10), ...(names.length > 10 ? [`+${names.length - 10}`] : [])].map((t) => ({
        text: t,
        ...(color ? { color } : {}),
      })),
    ),
  ];
}

export const STATE_LOOK: Record<State, { text: string; color: Color }> = {
  update: { text: "Update available", color: "orange" },
  current: { text: "Up to date", color: "green" },
  newer: { text: "Newer than the AUR", color: "blue" },
  missing: { text: "Not in the AUR", color: "gray" },
};

export function packageItem(
  p: AurPackage,
  setup: Setup,
  opts: { installed?: Installed; state?: State; section?: string; now?: number } = {},
): Item {
  const now = opts.now ?? Date.now();
  const { installed, state } = opts;
  const orphan = !p.Maintainer;
  const flagged = p.OutOfDate !== null && p.OutOfDate !== undefined;
  const tint: Color = flagged ? "orange" : state === "update" ? "orange" : installed ? "green" : "blue";
  const accessories: Accessory[] = [
    ...(state === "update"
      ? [{ tag: `→ ${p.Version}`, color: "orange" as const, tooltip: `Installed: ${installed?.version}` }]
      : []),
    ...(installed && state !== "update"
      ? [{ tag: "Installed", color: "green" as const, tooltip: installed.version }]
      : []),
    ...(flagged ? [{ tag: "Out of date", color: "orange" as const, tooltip: `Flagged on ${date(p.OutOfDate!)}` }] : []),
    ...(orphan ? [{ tag: "Orphan", color: "gray" as const, tooltip: "No maintainer" }] : []),
    { icon: { source: Icons.arrowUp, tint: "gray" as const }, text: votes(p.NumVotes), tooltip: `${p.NumVotes} votes` },
    { text: age(p.LastModified, now), tooltip: `Updated ${date(p.LastModified)}` },
  ];
  const command = installCommand([p.Name], setup.helper, p.PackageBase);
  const metadata: Metadata[] = [
    meta.text("Version", p.Version, { icon: Icons.tag }),
    ...(installed
      ? [
        meta.text("Installed", installed.version, {
          icon: Icons.check,
          color: state === "update" ? "orange" : "green",
        }),
      ]
      : []),
    ...(state ? [meta.text("State", STATE_LOOK[state].text, { color: STATE_LOOK[state].color })] : []),
    p.Maintainer
      ? meta.person("Maintainer", p.Maintainer)
      : meta.text("Maintainer", "None (orphaned)", { color: "orange" }),
    ...(p.CoMaintainers?.length
      ? [meta.text("Co-maintainers", p.CoMaintainers.join(", "), { icon: Icons.person })]
      : []),
    ...(flagged ? [meta.text("Flagged out of date", date(p.OutOfDate!), { icon: Icons.flag, color: "orange" })] : []),
    meta.text("Last updated", `${date(p.LastModified)} (${age(p.LastModified, now)})`, { icon: Icons.clock }),
    meta.text("First submitted", date(p.FirstSubmitted), { icon: Icons.calendar }),
    ...(p.License?.length ? [meta.tags("License", p.License)] : []),
    ...depTags("Depends", p.Depends),
    ...depTags("Build deps", p.MakeDepends, "gray"),
    ...depTags("Optional", p.OptDepends, "gray"),
    ...depTags("Provides", p.Provides, "blue"),
    ...depTags("Conflicts", p.Conflicts, "red"),
    ...(p.Keywords?.length ? [meta.tags("Keywords", p.Keywords.slice(0, 10))] : []),
    meta.separator(),
    meta.link("AUR", `aur.archlinux.org/packages/${p.Name}`, packageUrl(p.Name)),
    ...(p.URL ? [meta.link("Upstream", p.URL.replace(/^https?:\/\/(www\.)?/, ""), p.URL)] : []),
    ...(p.PackageBase !== p.Name ? [meta.text("Package base", p.PackageBase, { icon: Icons.layers })] : []),
  ];
  const markdown = [
    p.Description ?? "_No description._",
    ...(isVcs(p.Name)
      ? ["", "Built from the latest commit upstream: its version here only changes when the PKGBUILD does."]
      : []),
    "",
    "```sh",
    command.replaceAll(" && ", " &&\n  "),
    "```",
  ].join("\n");
  // Installed and current: reading comes first, reinstalling is further down.
  const current = !!installed && state !== "update";
  const install = current
    ? installAction(p, setup, "Reinstall")
    : installAction(p, setup, installed ? "Update" : "Install");
  const actions: Action[] = [
    ...(current ? [] : [install]),
    pkgbuildAction(p, setup, installed),
    open(packageUrl(p.Name), "Open in the AUR", { icon: Icons.globe, shortcut: "<Ctrl>o" }),
    ...(p.URL ? [open(p.URL, "Open Upstream Website", { icon: Icons.home, shortcut: "<Ctrl>h" })] : []),
    open(`${packageUrl(p.Name)}#comments`, "Read Comments", { icon: Icons.comment, section: "Links" }),
    copy(p.Name, "Copy Name", { section: "Copy", shortcut: "<Ctrl><Shift>c" }),
    ...(current ? [{ ...install, section: "Package" }] : []),
    copy(command, "Copy Install Command", { section: "Copy" }),
    copy(`git clone ${cloneUrl(p.PackageBase)}`, "Copy git clone Command", { section: "Copy" }),
    ...(installed ? [removeAction(p.Name, setup)] : []),
  ];
  return {
    id: p.Name,
    title: p.Name,
    subtitle: p.Description ?? undefined,
    icon: { source: Icons.package, tint },
    section: opts.section,
    keywords: [...(p.Keywords ?? []), p.PackageBase, ...(p.Maintainer ? [p.Maintainer] : [])],
    accessories,
    detail: {
      stats: [
        { label: "Votes", value: p.NumVotes },
        { label: "Popularity", value: popularity(p.Popularity) },
        { label: "Updated", value: age(p.LastModified, now), ...(flagged ? { color: "orange" as const } : {}) },
      ],
      markdown,
      metadata,
    },
    actions,
  };
}
