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
  open,
  openExternal,
  refresh,
  toast,
  updateCommandMetadata,
} from "@backslash/api";
import {
  BACKEND_TITLES,
  branchSummary,
  changed,
  diffMarkdown,
  diffStat,
  type DotFile,
  editorScript,
  type FileState,
  packageState,
  parentDir,
  shellLine,
  sortFiles,
  STATE_LABELS,
  stowArgs,
  stowError,
  type StowPackage,
  terminalScript,
  tildify,
} from "../lib.ts";
import { chezmoiSource, git, gitArgv, HOME, load, Missing, type Prefs, sh, type Source } from "../dotfiles.ts";
import { runInTerminal } from "../terminal.ts";

const STATE_COLOR: Record<FileState, Color> = {
  modified: "yellow",
  added: "green",
  deleted: "red",
  renamed: "blue",
  untracked: "gray",
  conflict: "red",
  typechange: "orange",
  "apply-add": "blue",
  "apply-delete": "red",
  "apply-modify": "blue",
  script: "purple",
  clean: "gray",
};

const STATE_ICON: Partial<Record<FileState, string>> = {
  modified: Icons.inProgress,
  added: Icons.plus,
  deleted: Icons.minus,
  conflict: Icons.alert,
  "apply-add": Icons.download,
  "apply-modify": Icons.download,
  "apply-delete": Icons.trash,
  script: Icons.terminal,
};

const short = (p: string) => tildify(p, HOME);
const name = (p: string) => p.split("/").pop() ?? p;

function term(prefs: Prefs, argv: string[]) {
  runInTerminal(argv, prefs.terminal || undefined);
}

async function step(message: string, fn: () => Promise<unknown>) {
  try {
    await fn();
  } catch (e) {
    if (e instanceof Missing) throw new Error(`${e.message} is not installed`);
    throw e;
  }
  await toast(message, { style: "success" });
  return refresh();
}

// --- Source-wide actions -----------------------------------------------------------------

function commitAndPush(s: Source, prefs: Prefs): Action[] {
  if (!s.git) return [];
  const g = s.git;
  const addAll = s.backend === "chezmoi" || s.backend === "stow" ? ["add", "--all"] : ["add", "--update"];
  return [
    action("Commit & Push in Terminal", () => {
      term(
        prefs,
        terminalScript(`Committing ${BACKEND_TITLES[s.backend]} changes…`, [
          gitArgv(g, addAll),
          gitArgv(g, ["commit", "--verbose"]),
          gitArgv(g, ["push"]),
        ]),
      );
      return close();
    }, { icon: Icons.upload, shortcut: "<Ctrl>p", section: "Repository" }),
    action(s.backend === "chezmoi" ? "Pull & Apply in Terminal" : "Pull in Terminal", () => {
      term(
        prefs,
        terminalScript(
          "Pulling…",
          s.backend === "chezmoi" ? [["chezmoi", "update", "--verbose"]] : [gitArgv(g, ["pull", "--rebase"])],
        ),
      );
      return close();
    }, { icon: Icons.download, shortcut: "<Ctrl><Shift>p", section: "Repository" }),
  ];
}

function sourceActions(s: Source, prefs: Prefs): Action[] {
  return [
    ...(s.backend === "chezmoi"
      ? [action("Apply All in Terminal", () => {
        term(prefs, terminalScript("Applying your dotfiles…", [["chezmoi", "apply", "--verbose"]]));
        return close();
      }, { icon: Icons.download, shortcut: "<Ctrl><Shift>a", section: "Repository" })]
      : []),
    ...commitAndPush(s, prefs),
    open(s.root, s.backend === "chezmoi" ? "Open Source Folder" : "Open Repository Folder", {
      icon: Icons.folder,
      shortcut: "<Ctrl>o",
      section: "Open",
    }),
    ...(s.log.length
      ? [action("Show Recent Commits", () =>
        detail({
          title: `${BACKEND_TITLES[s.backend]} history`,
          markdown: s.log.map((c) => `- \`${c.hash}\` ${c.subject} · *${c.when}*`).join("\n"),
        }), { icon: Icons.history, section: "Repository" })]
      : []),
    copy(s.root, "Copy Folder Path", { section: "Copy" }),
    action("Reload", () => refresh(), { icon: Icons.refresh, shortcut: "<Ctrl>r" }),
  ];
}

// --- Files ---------------------------------------------------------------------------------

async function fileDiff(s: Source, f: DotFile): Promise<string> {
  if (s.backend === "chezmoi") return await sh("chezmoi", ["diff", "--no-pager", f.path]);
  if (!s.git) return "";
  if (f.state === "untracked") return "";
  const rel = f.path;
  return await git(s.git, ["diff", ...(s.status?.branch.empty ? ["--cached"] : ["HEAD"]), "--", rel]);
}

function editActions(s: Source, f: DotFile, prefs: Prefs): Action[] {
  const edit = s.backend === "chezmoi"
    ? action("Edit in Terminal", () => {
      term(prefs, ["chezmoi", "edit", "--apply", f.path]);
      return close();
    }, { icon: Icons.code, shortcut: "<Ctrl>e", section: "Edit" })
    : action("Edit in Terminal", () => {
      term(prefs, editorScript(f.path));
      return close();
    }, { icon: Icons.code, shortcut: "<Ctrl>e", section: "Edit" });
  return [
    edit,
    open(f.path, "Open File", { icon: Icons.file, section: "Edit" }),
    ...(s.backend === "chezmoi"
      ? [action("Open Source File", async () => {
        await openExternal(await chezmoiSource(f.path));
        return close();
      }, { icon: Icons.file, section: "Edit" })]
      : []),
    open(parentDir(f.path), "Open Containing Folder", { icon: Icons.folder, section: "Edit" }),
  ];
}

function changeActions(s: Source, f: DotFile): Action[] {
  if (s.backend === "chezmoi") {
    const out: Action[] = [];
    if (f.localEdit) {
      out.push(
        action(
          "Re-Add Local Changes",
          () => step(`${short(f.path)} saved to chezmoi`, () => sh("chezmoi", ["re-add", f.path])),
          {
            icon: Icons.upload,
            shortcut: "<Ctrl><Shift>a",
            section: "Change",
          },
        ),
      );
    }
    if (f.state !== "clean") {
      out.push(
        action("Apply", () => step(`${short(f.path)} applied`, () => sh("chezmoi", ["apply", "--force", f.path])), {
          icon: Icons.download,
          section: "Change",
          ...(f.localEdit
            ? { destructive: true, confirm: `Overwrite your edits to ${short(f.path)} with chezmoi's version?` }
            : {}),
        }),
      );
    }
    return out;
  }
  if (!s.git || f.state === "clean") return [];
  const g = s.git;
  const out: Action[] = [];
  if (f.staged) {
    out.push(
      action("Unstage", () => step(`${short(f.path)} unstaged`, () => git(g, ["restore", "--staged", "--", f.path])), {
        icon: Icons.minus,
        section: "Change",
      }),
    );
  } else {
    out.push(action("Stage", () => step(`${short(f.path)} staged`, () => git(g, ["add", "--", f.path])), {
      icon: Icons.plus,
      shortcut: "<Ctrl>s",
      section: "Change",
    }));
  }
  if (f.state === "modified" || f.state === "deleted") {
    out.push(
      action(
        "Discard Changes",
        () => step(`${short(f.path)} restored`, () => git(g, ["checkout", "HEAD", "--", f.path])),
        {
          icon: Icons.history,
          destructive: true,
          confirm: `Throw away your changes to ${short(f.path)}?`,
          section: "Danger",
        },
      ),
    );
  }
  return out;
}

function diffAction(s: Source, f: DotFile, prefs: Prefs): Action {
  return action("Show Diff", async () => {
    const diff = await fileDiff(s, f);
    const st = diffStat(diff);
    return detail({
      title: short(f.path),
      markdown: diffMarkdown(diff),
      stats: [
        { label: "Added", value: st.added, color: "green" },
        { label: "Removed", value: st.removed, color: "red" },
        { label: "State", value: STATE_LABELS[f.state], color: STATE_COLOR[f.state] },
      ],
      actions: [
        ...changeActions(s, f),
        ...editActions(s, f, prefs),
        action("Open Diff in Terminal", () => {
          const argv = s.backend === "chezmoi"
            ? ["chezmoi", "diff", f.path]
            : gitArgv(s.git!, ["diff", ...(s.status?.branch.empty ? ["--cached"] : ["HEAD"]), "--", f.path]);
          term(prefs, ["sh", "-c", `${shellLine(argv)} | less -R`]);
        }, { icon: Icons.terminal }),
        copy(diff, "Copy Diff", { section: "Copy" }),
      ],
    });
  }, { icon: Icons.eye, shortcut: "<Ctrl>d" });
}

function fileItem(s: Source, f: DotFile, prefs: Prefs): Item {
  const isChanged = changed(f);
  const color = STATE_COLOR[f.state];
  const hasDiff = isChanged && f.state !== "untracked" && f.state !== "script" &&
    !(s.backend !== "chezmoi" && !s.git);
  const edit = editActions(s, f, prefs);
  const primary = hasDiff ? [diffAction(s, f, prefs), ...edit] : [...edit];
  return {
    id: `${s.backend}:${f.path}`,
    title: name(f.path),
    subtitle: short(parentDir(f.path)),
    icon: { source: STATE_ICON[f.state] ?? Icons.file, tint: isChanged ? color : "gray" },
    section: `${BACKEND_TITLES[s.backend]}${isChanged ? " · Changed" : ""}`,
    keywords: [short(f.path), STATE_LABELS[f.state], ...(f.localEdit ? ["edited", "local"] : [])],
    accessories: [
      ...(f.staged ? [{ tag: "Staged", color: "green" as const }] : []),
      ...(f.localEdit ? [{ icon: Icons.code, tooltip: "Edited by hand since chezmoi last applied it" }] : []),
      ...(isChanged ? [{ tag: STATE_LABELS[f.state], color }] : []),
    ],
    detail: {
      metadata: [
        meta.text("Path", short(f.path), { icon: Icons.file }),
        meta.text("State", STATE_LABELS[f.state], { color: isChanged ? color : undefined }),
        ...(f.from ? [meta.text("Renamed from", short(f.from), { icon: Icons.arrowRight })] : []),
        ...(f.localEdit
          ? [meta.text("Edited", "By hand since chezmoi last wrote it: re-add or merge", { icon: Icons.code })]
          : []),
        ...(f.state.startsWith("apply-")
          ? [meta.text("Apply", "chezmoi apply would change this file", { icon: Icons.download })]
          : []),
        meta.text("Managed by", BACKEND_TITLES[s.backend], { icon: Icons.layers }),
      ],
    },
    actions: [
      ...primary,
      ...changeActions(s, f),
      ...sourceActions(s, prefs),
      copy(f.path, "Copy Path", { section: "Copy", shortcut: "<Ctrl><Shift>c" }),
    ],
  };
}

// --- Stow packages ----------------------------------------------------------------------

const PKG_LOOK = {
  linked: { tint: "green", label: "Linked" },
  partial: { tint: "yellow", label: "Partly linked" },
  unlinked: { tint: "gray", label: "Not linked" },
  conflict: { tint: "red", label: "Conflict" },
} as const;

function packageItem(s: Source, p: StowPackage, prefs: Prefs): Item {
  const st = s.stow!;
  const state = packageState(p);
  const look = PKG_LOOK[state];
  const linked = p.files.filter((f) => f.state === "linked").length;
  const run = (op: "stow" | "restow" | "delete", message: string) => () =>
    step(message, async () => {
      if (!st.installed) throw new Error("GNU Stow is not installed: install the stow package");
      try {
        await sh("stow", stowArgs(s.root, st.options, op, p.name));
      } catch (e) {
        throw new Error(stowError((e as Error).message));
      }
    });
  const stowIt = action(
    state === "unlinked" ? "Stow (Link)" : "Restow",
    run(
      state === "unlinked" ? "stow" : "restow",
      `${p.name} linked`,
    ),
    { icon: Icons.link },
  );
  const lines = p.files.slice(0, 200).map((f) => {
    const mark = f.state === "linked" ? "✓" : f.state === "missing" ? "·" : "✗";
    return `${mark} ${short(f.target)}${
      f.state === "conflict" ? "  (a real file is in the way)" : f.state === "foreign" ? "  (links elsewhere)" : ""
    }`;
  });
  return {
    id: `stow:${p.name}`,
    title: p.name,
    subtitle: `${linked} of ${p.files.length} files linked`,
    icon: { source: Icons.package, tint: look.tint },
    section: "Stow Packages",
    keywords: ["stow", "package", ...p.files.map((f) => short(f.target))],
    accessories: [{ text: `${p.files.length} files` }, { tag: look.label, color: look.tint }],
    detail: {
      markdown: lines.length ? "```\n" + lines.join("\n") + "\n```" : "Empty package.",
      metadata: [
        meta.text("Package", `${short(s.root)}/${p.name}`, { icon: Icons.folder }),
        meta.text("Target", short(st.options.target), { icon: Icons.home }),
        ...(st.options.dotfiles ? [meta.text("Dotfiles", "dot-x becomes .x", { icon: Icons.file })] : []),
      ],
    },
    actions: [
      stowIt,
      open(`${s.root}/${p.name}`, "Open Package Folder", { icon: Icons.folder, shortcut: "<Ctrl>o" }),
      ...(state !== "unlinked"
        ? [action("Unstow (Remove Links)", run("delete", `${p.name} unlinked`), {
          icon: Icons.trash,
          destructive: true,
          confirm: `Remove the links of ${p.name} from ${short(st.options.target)}?`,
          shortcut: "<Ctrl>Delete",
          section: "Danger",
        })]
        : []),
      ...commitAndPush(s, prefs),
      copy(shellLine(["stow", ...stowArgs(s.root, st.options, "restow", p.name)]), "Copy Stow Command", {
        section: "Copy",
      }),
      action("Reload", () => refresh(), { icon: Icons.refresh, shortcut: "<Ctrl>r" }),
    ],
  };
}

// --- Summary rows ----------------------------------------------------------------------------

function sourceItem(s: Source, prefs: Prefs): Item {
  const changes = s.files.filter(changed);
  const b = s.status?.branch;
  const tint: Color = s.error ? "red" : changes.length || b?.ahead || b?.behind ? "yellow" : "green";
  const managed = s.stow ? s.stow.packages.length : s.files.length;
  return {
    id: `source:${s.backend}`,
    title: BACKEND_TITLES[s.backend],
    subtitle: s.error ?? (b ? branchSummary(b) : short(s.root)),
    icon: { source: s.backend === "stow" ? Icons.layers : Icons.repository, tint },
    section: "Dotfiles",
    keywords: [s.backend, short(s.root)],
    accessories: [
      ...(changes.length ? [{ tag: `${changes.length} changed`, color: "yellow" as const }] : []),
      ...(b?.ahead ? [{ text: `↑${b.ahead}`, tooltip: "Commits to push" }] : []),
      ...(b?.behind ? [{ text: `↓${b.behind}`, tooltip: "Commits to pull" }] : []),
      { text: s.stow ? `${managed} packages` : `${managed} files` },
    ],
    detail: {
      stats: [
        { label: "Changed", value: changes.length, color: changes.length ? "yellow" : "green" },
        { label: s.stow ? "Packages" : "Managed", value: managed },
        ...(b ? [{ label: "To push", value: b.ahead, color: b.ahead ? "blue" as const : undefined }] : []),
      ],
      markdown: [
        s.error ? `**${s.error}**` : "",
        s.log.length ? `**Recent commits**\n\n${s.log.map((c) => `- ${c.subject} · *${c.when}*`).join("\n")}` : "",
      ].filter(Boolean).join("\n\n") || undefined,
      metadata: [
        meta.text("Folder", short(s.root), { icon: Icons.folder }),
        ...(b?.branch ? [meta.text("Branch", b.branch, { icon: Icons.branch })] : []),
        ...(b?.upstream ? [meta.text("Remote", b.upstream, { icon: Icons.cloud })] : []),
      ],
    },
    actions: sourceActions(s, prefs),
  };
}

function nothingFound(): Item {
  return {
    id: "none",
    title: "No dotfiles manager found",
    subtitle: "chezmoi, yadm, a bare repository in ~/.dotfiles or GNU Stow in ~/dotfiles",
    icon: { source: Icons.repository, tint: "orange" },
    detail: {
      markdown: [
        "## Dotfiles",
        "",
        "Backslash looks for:",
        "",
        "- **chezmoi** (`chezmoi init`)",
        "- **yadm** (`yadm init` or `yadm clone`)",
        "- a **bare git repository**, `~/.dotfiles` by default",
        "- **GNU Stow** packages, in `~/dotfiles` by default",
        "",
        "Change the folders in **Settings → Extensions → Dotfiles**.",
      ].join("\n"),
    },
    actions: [
      open("https://www.chezmoi.io/quick-start/", "chezmoi Quick Start", { icon: Icons.book }),
      open("https://yadm.io/docs/getting_started", "yadm Getting Started", { icon: Icons.book }),
    ],
  };
}

export default list({
  placeholder: "Filter dotfiles…",
  filter: { options: [{ value: "all", title: "All Files" }, { value: "changed", title: "Changed" }], default: "all" },
  empty: { title: "Nothing changed", description: "Every dotfile is committed and applied", icon: Icons.check },
  status: (items) => {
    const n = items.filter((i) => i.section?.endsWith("· Changed")).length;
    return n ? `${n} changed` : "";
  },
  async items({ preferences, signal, filter }) {
    const prefs = preferences as Prefs;
    const sources = await load(prefs, signal);
    if (!sources.length) return [nothingFound()];
    const items: Item[] = sources.map((s) => sourceItem(s, prefs));
    const onlyChanged = filter === "changed";
    for (const s of sources) {
      const files = sortFiles(s.files).filter((f) => !onlyChanged || changed(f));
      items.push(...files.map((f) => fileItem(s, f, prefs)));
      if (s.stow && !onlyChanged) items.push(...s.stow.packages.map((p) => packageItem(s, p, prefs)));
      if (s.stow && onlyChanged) {
        items.push(
          ...s.stow.packages.filter((p) => packageState(p) !== "linked").map((p) => packageItem(s, p, prefs)),
        );
      }
    }
    const count = sources.reduce((n, s) => n + s.files.filter(changed).length, 0);
    updateCommandMetadata({ subtitle: count ? `${count} changed` : null }).catch(() => {});
    return items;
  },
});
