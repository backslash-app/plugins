import {
  type Accessory,
  type Action,
  action,
  close,
  copy,
  Icons,
  type Item,
  list,
  meta,
  type Metadata,
  open,
  refresh,
  toast,
  updateCommandMetadata,
} from "@backslash/api";
import {
  activateLine,
  checkDeletable,
  type Env,
  envTitle,
  formatSize,
  KINDS,
  sortEnvs,
  terminalScript,
  tilde,
} from "../lib.ts";
import { findEnvs, HOME, remove, sizes } from "../envs.ts";
import { runInTerminal } from "../terminal.ts";

interface Prefs {
  terminal?: string;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

function inTerminal(title: string, e: Env, prefs: Prefs, then?: string): Action {
  return action(title, () => {
    runInTerminal(["bash", "-c", terminalScript(e, then)], prefs.terminal || undefined);
    return close(`${envTitle(e)} activated`);
  }, { icon: Icons.terminal });
}

function packagesMarkdown(e: Env): string {
  const pkgs = e.packages ?? [];
  if (!pkgs.length) return "_No package installed._";
  const shown = pkgs.slice(0, 40).map((p) => `- ${p.name} \`${p.version}\``);
  return [`### ${plural(pkgs.length, "package")}`, "", ...shown, ...(pkgs.length > 40 ? [`- …`] : [])].join("\n");
}

function envItem(e: Env, prefs: Prefs, size?: number): Item {
  const kind = KINDS[e.kind];
  const title = envTitle(e);
  const problem = e.broken
    ? "Its base Python is gone: recreate it"
    : e.orphan
    ? "Its project folder no longer exists"
    : undefined;
  const lines: Metadata[] = [
    meta.text("Python", e.python || "Unknown", { icon: Icons.code }),
    meta.text("Kind", kind.title, { icon: Icons.layers, color: kind.color }),
    ...(problem ? [meta.text("Problem", problem, { icon: Icons.alert, color: "red" })] : []),
    ...(size !== undefined ? [meta.text("Size", formatSize(size), { icon: Icons.drive })] : []),
    meta.text("Packages", e.packages?.length ?? 0, { icon: Icons.package }),
    meta.separator(),
    meta.text("Folder", tilde(e.path, HOME), { icon: Icons.folder }),
    ...(e.project
      ? [meta.text("Project", tilde(e.project, HOME), { icon: Icons.project })]
      : e.kind === "poetry"
      ? [meta.text("Project", "Not found in your code folders", { icon: Icons.question })]
      : []),
    ...(e.base ? [meta.text("Base Python", tilde(e.base, HOME))] : []),
    ...(e.creator ? [meta.text("Made with", e.creator)] : []),
    ...(e.systemSitePackages ? [meta.text("System packages", "Visible")] : []),
    ...(e.created ? [meta.text("Created", new Date(e.created).toLocaleDateString("en", { dateStyle: "medium" }))] : []),
  ];
  const accessories: Accessory[] = [
    ...(e.broken ? [{ tag: "Broken", color: "red" as const, tooltip: problem }] : []),
    ...(e.orphan ? [{ tag: "Orphaned", color: "orange" as const, tooltip: problem }] : []),
    ...(e.python ? [{ tag: `Python ${e.python.split(".").slice(0, 2).join(".")}`, color: kind.color }] : []),
    ...(size !== undefined ? [{ text: formatSize(size), icon: Icons.drive, tooltip: "Size on disk" }] : []),
  ];
  const sub = e.kind === "conda"
    ? tilde(e.path, HOME)
    : e.project
    ? `${e.path.slice(e.project.length + 1) || tilde(e.path, HOME)} · ${kind.title}`
    : `${tilde(e.path, HOME)} · ${kind.title}`;
  const deletable = (() => {
    try {
      checkDeletable(e, HOME);
      return true;
    } catch {
      return false;
    }
  })();
  return {
    id: e.path,
    title,
    subtitle: sub,
    icon: {
      source: e.broken ? Icons.alert : e.kind === "conda" ? Icons.box : Icons.layers,
      tint: e.broken ? "red" : e.orphan ? "orange" : kind.color,
    },
    section: e.kind === "conda"
      ? "conda"
      : e.kind === "poetry"
      ? "Poetry"
      : e.kind === "pipenv"
      ? "Pipenv"
      : "Projects",
    keywords: [e.path, e.kind, e.python, e.name ?? "", e.project ?? ""],
    accessories,
    detail: {
      markdown: [
        problem ? `**${problem}.**\n` : "",
        "```sh",
        activateLine(e),
        "```",
        "",
        packagesMarkdown(e),
      ].join("\n"),
      metadata: lines,
    },
    actions: [
      inTerminal("Open Terminal with It Activated", e, prefs),
      ...(e.project ? [open(e.project, "Open Project Folder", { icon: Icons.folder })] : []),
      { ...inTerminal("Start Python", e, prefs, "exec python"), icon: Icons.code, shortcut: "<Ctrl>p" },
      copy(activateLine(e), "Copy Activate Command", {
        icon: Icons.terminal,
        shortcut: "<Ctrl><Shift>c",
        section: "Copy",
      }),
      copy(`${e.path}/bin/python`, "Copy Python Path", { section: "Copy" }),
      copy(e.path, "Copy Folder Path", { section: "Copy" }),
      open(e.path, "Open Environment Folder", { icon: Icons.folder, section: "Copy" }),
      ...(deletable
        ? [action("Delete Environment", async () => {
          checkDeletable(e, HOME);
          await remove(e);
          await toast(`Deleted ${title}${size ? `, ${formatSize(size)} freed` : ""}`, { style: "success" });
          return refresh();
        }, {
          icon: Icons.trash,
          destructive: true,
          shortcut: "<Ctrl><Shift>x",
          section: "Danger",
          confirm: `Delete ${tilde(e.path, HOME)}${size ? ` (${formatSize(size)})` : ""}? Recreate it with ${
            e.kind === "uv"
              ? "uv sync"
              : e.kind === "poetry"
              ? "poetry install"
              : e.kind === "conda"
              ? "conda create"
              : "your tool"
          }.`,
        })]
        : []),
    ],
  };
}

function noneItem(): Item {
  return {
    id: "none",
    title: "No Python environment found",
    subtitle: "Looked in ~/Projects, ~/code, ~/src… and Poetry, Pipenv and conda folders",
    icon: { source: Icons.layers, tint: "gray" },
    detail: {
      markdown: [
        "## No environment yet",
        "",
        "Create one in a project:",
        "",
        "```sh",
        "python3 -m venv .venv   # or: uv venv",
        "```",
        "",
        "Projects are looked for one or two levels below `~/Projects`, `~/projects`, `~/Code`, `~/code`, `~/dev`,",
        "`~/Developer`, `~/src`, `~/git`, `~/repos`, `~/workspace` and `~/work`. Poetry, Pipenv and conda",
        "environments are found in their own folders.",
      ].join("\n"),
    },
    actions: [copy("python3 -m venv .venv", "Copy Command"), open(KINDS.venv.site, "venv Documentation")],
  };
}

let summary = "";

export default list({
  placeholder: "Filter environments by project, Python version or kind…",
  filter: {
    options: [
      { value: "all", title: "All" },
      { value: "projects", title: "Projects" },
      { value: "managed", title: "Poetry, Pipenv, conda" },
      { value: "problems", title: "Broken or orphaned" },
    ],
  },
  empty: { title: "Nothing here", description: "No environment matches this view.", icon: Icons.layers },
  status: () => summary,
  actions: [action("Reload", () => refresh(), { icon: Icons.refresh, shortcut: "<Ctrl>r" })],
  async *items({ preferences, filter }) {
    const prefs = preferences as Prefs;
    const all = sortEnvs(await findEnvs());
    if (!all.length) {
      summary = "";
      return yield [noneItem()];
    }
    const shown = all.filter((e) =>
      filter === "projects"
        ? ["venv", "uv", "virtualenv"].includes(e.kind)
        : filter === "managed"
        ? ["poetry", "pipenv", "conda"].includes(e.kind)
        : filter === "problems"
        ? e.broken || e.orphan
        : true
    );
    summary = `${plural(all.length, "environment")} · measuring…`;
    yield shown.map((e) => envItem(e, prefs));
    // du takes a while on big environments: sizes come second.
    const measured = await sizes(all.map((e) => e.path));
    const total = [...measured.values()].reduce((a, b) => a + b, 0);
    summary = `${plural(all.length, "environment")}${total ? ` · ${formatSize(total)}` : ""}`;
    yield shown.map((e) => envItem(e, prefs, measured.get(e.path)));
    updateCommandMetadata({ subtitle: total ? `${plural(all.length, "environment")}, ${formatSize(total)}` : null })
      .catch(() => {});
  },
});
