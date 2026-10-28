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
  type ListSpec,
  meta,
  type Metadata,
  open,
  refresh,
  submenu,
  toast,
  updateCommandMetadata,
} from "@backslash/api";
import { git, GitMissing, HOME, inspect, pool, recentCommits, type Repo, run } from "../git.ts";
import {
  branchUrl,
  changeSummary,
  type Commit,
  commitUrl,
  findArgs,
  installCommand,
  parseBranches,
  parseFolders,
  relativeTime,
  reposFromFind,
  rootOf,
  tilde,
} from "../lib.ts";
import { launch, openTerminalAt, runInTerminal } from "../terminal.ts";

interface Prefs {
  folders?: string;
  depth?: number;
  editor?: string;
  terminal?: string;
}

/** Editors that live in a terminal. */
const TERMINAL_EDITORS = new Set(["nvim", "vim", "vi", "hx", "helix", "nano", "micro", "kak", "emacs"]);

const EDITOR_NAMES: Record<string, string> = {
  code: "VS Code",
  codium: "VSCodium",
  cursor: "Cursor",
  zed: "Zed",
  zeditor: "Zed",
  subl: "Sublime Text",
  idea: "IntelliJ IDEA",
  "gnome-text-editor": "Text Editor",
  kate: "Kate",
  nvim: "Neovim",
  hx: "Helix",
};

const name = (path: string) => path.split("/").pop() || path;

function openInEditor(path: string, prefs: Prefs) {
  const editor = prefs.editor?.trim() || "code";
  if (TERMINAL_EDITORS.has(editor)) {
    runInTerminal([editor, "."], prefs.terminal || undefined, path);
    return;
  }
  if (!launch(editor, [path])) throw new Error(`${editor} is not installed: set your editor in the preferences`);
}

/** Runs a git command from an action: a toast with its outcome, then the list reloads. */
function gitAction(
  title: string,
  repo: Repo,
  args: string[],
  done: string,
  options: { icon?: string; shortcut?: string; section?: string; confirm?: string; destructive?: boolean } = {},
): Action {
  return action(title, async () => {
    await toast(`${title}…`);
    try {
      const out = await git(repo.path, args);
      const summary = out.split("\n").filter(Boolean).pop();
      await toast(done, { style: "success", message: summary && summary.length < 120 ? summary : undefined });
    } catch (e) {
      await toast(`${title} failed`, { style: "failure", message: (e as Error).message });
    }
    return refresh();
  }, options);
}

function commitItem(c: Commit, repo: Repo, now: number): Item {
  const refs = c.refs.map((r) => r.replace(/^HEAD -> /, "")).filter((r) => r !== "HEAD");
  const page = repo.remote?.page;
  return {
    id: c.hash,
    title: c.subject,
    subtitle: c.short,
    icon: { source: Icons.commit, tint: refs.length ? "blue" : "gray" },
    keywords: [c.author, c.hash, ...refs],
    accessories: [
      ...refs.slice(0, 2).map((r) => ({
        tag: r.replace(/^tag: /, ""),
        color: (r.startsWith("tag: ") ? "yellow" : "blue") as Color,
      })),
      { avatar: c.author, tooltip: c.author },
      { text: relativeTime(c.time, now) },
    ],
    detail: {
      markdown: `## ${c.subject}${c.body ? `\n\n${c.body}` : ""}`,
      metadata: [
        meta.text("Commit", c.short, { icon: Icons.commit }),
        meta.person("Author", c.author),
        meta.text("Email", c.email, { icon: Icons.mail }),
        meta.text("Date", new Date(c.time * 1000).toLocaleString("en", { dateStyle: "medium", timeStyle: "short" }), {
          icon: Icons.clock,
        }),
        ...(refs.length ? [meta.tags("Refs", refs)] : []),
      ],
    },
    actions: [
      copy(c.hash, "Copy Commit Hash"),
      ...(page ? [open(commitUrl(page, c.hash), "Open Commit in Browser", { shortcut: "<Ctrl>o" })] : []),
      action("Show Changed Files", async () => {
        const stat = await git(repo.path, ["show", "--stat", "--format=", c.hash]);
        return detail({
          title: c.short,
          markdown: `## ${c.subject}\n\n\`\`\`\n${stat || "No file changes."}\n\`\`\``,
          metadata: [meta.text("Commit", c.short), meta.person("Author", c.author)],
          actions: [copy(c.hash, "Copy Commit Hash")],
        });
      }, { icon: Icons.file, shortcut: "<Ctrl>d" }),
      copy(c.short, "Copy Short Hash", { section: "Copy" }),
      copy(c.subject, "Copy Message", { icon: Icons.text, section: "Copy" }),
    ],
  };
}

function commitsList(repo: Repo): ListSpec {
  return list({
    title: `${name(repo.path)} · Recent Commits`,
    placeholder: "Filter commits by message, author, hash…",
    status: (items) => `${items.length} recent commits on ${repo.status?.branch ?? "HEAD"}`,
    empty: { title: "No commits yet", icon: Icons.commit },
    async items({ signal }) {
      const now = Date.now();
      return (await recentCommits(repo.path, signal)).map((c) => commitItem(c, repo, now));
    },
  });
}

function repoActions(repo: Repo, prefs: Prefs): Action[] {
  const s = repo.status;
  const page = repo.remote?.page;
  const editor = prefs.editor?.trim() || "code";
  return [
    action(`Open in ${EDITOR_NAMES[editor] ?? editor}`, () => {
      openInEditor(repo.path, prefs);
      return close();
    }, { icon: Icons.code }),
    action("Open in Terminal", () => {
      openTerminalAt(repo.path, prefs.terminal || undefined);
      return close();
    }, { icon: Icons.terminal, shortcut: "<Ctrl>t" }),
    action("Recent Commits", () => commitsList(repo), { icon: Icons.history, shortcut: "<Ctrl>l" }),
    ...(page ? [open(page, "Open Remote in Browser", { shortcut: "<Ctrl>o" })] : []),
    submenu("Switch Branch", async () => {
      const branches = parseBranches(
        await git(repo.path, ["branch", "--sort=-committerdate", "--format=%(refname:short)"]),
      );
      return branches.filter((b) => b !== s?.branch).slice(0, 40).map((b) =>
        gitAction(b, repo, ["switch", b], `Switched to ${b}`, { icon: Icons.branch })
      );
    }, { icon: Icons.branch, shortcut: "<Ctrl>b", section: "Git" }),
    gitAction("Fetch", repo, ["fetch", "--all", "--prune"], "Fetched", {
      icon: Icons.download,
      shortcut: "<Ctrl>f",
      section: "Git",
    }),
    ...(s?.upstream
      ? [
        gitAction("Pull (Fast-Forward Only)", repo, ["pull", "--ff-only"], "Pulled", {
          icon: Icons.arrowDown,
          shortcut: "<Ctrl>p",
          section: "Git",
        }),
      ]
      : []),
    ...(repo.changes
      ? [
        gitAction(
          "Stash Changes",
          repo,
          [
            "stash",
            "push",
            "--include-untracked",
            "-m",
            `Backslash ${new Date().toISOString().slice(0, 16).replace("T", " ")}`,
          ],
          "Changes stashed",
          { icon: Icons.archive, section: "Git" },
        ),
      ]
      : []),
    ...(s?.stashes
      ? [
        gitAction("Pop Latest Stash", repo, ["stash", "pop"], "Stash applied", {
          icon: Icons.upload,
          section: "Git",
          confirm: "Apply and drop the latest stash?",
        }),
      ]
      : []),
    ...(page && s?.branch
      ? [open(branchUrl(page, s.branch), "Open Branch in Browser", { icon: Icons.branch, section: "Open" })]
      : []),
    open(repo.path, "Open Folder", { icon: Icons.folder, section: "Open" }),
    ...(repo.remote
      ? [copy(repo.remote.url, "Copy Remote URL", { icon: Icons.link, shortcut: "<Ctrl><Shift>c", section: "Copy" })]
      : []),
    copy(repo.path, "Copy Path", { section: "Copy" }),
    ...(s?.branch ? [copy(s.branch, "Copy Branch Name", { icon: Icons.branch, section: "Copy" })] : []),
    ...(repo.last ? [copy(repo.last.hash, "Copy Last Commit Hash", { icon: Icons.commit, section: "Copy" })] : []),
  ];
}

function repoItem(repo: Repo, roots: string[], prefs: Prefs, now: number, loading: boolean): Item {
  const s = repo.status;
  const root = rootOf(repo.path, roots);
  const parent = repo.path.slice(0, repo.path.length - name(repo.path).length - 1);
  const accessories: Item["accessories"] = [];
  if (s) {
    accessories.push({ icon: Icons.branch, text: s.branch ?? `detached ${s.oid?.slice(0, 7) ?? ""}`.trim() });
    if (s.conflicts) accessories.push({ tag: `${s.conflicts} conflicts`, color: "red" });
    else if (repo.changes) {
      accessories.push({ tag: `${repo.changes} changed`, color: "orange", tooltip: changeSummary(s) });
    }
    if (s.ahead || s.behind) {
      accessories.push({
        tag: [s.ahead && `↑${s.ahead}`, s.behind && `↓${s.behind}`].filter(Boolean).join(" "),
        color: s.behind ? "purple" : "blue",
        tooltip: `${s.ahead} to push, ${s.behind} to pull`,
      });
    }
    if (repo.last) accessories.push({ text: relativeTime(repo.last.time, now), tooltip: "Last commit" });
  } else if (repo.error) accessories.push({ tag: "Error", color: "red", tooltip: repo.error });
  const tint: Color = !s
    ? "gray"
    : s.conflicts
    ? "red"
    : repo.changes
    ? "orange"
    : s.ahead || s.behind
    ? "blue"
    : "green";
  const metadata: Metadata[] = [meta.text("Folder", tilde(repo.path, HOME), { icon: Icons.folder })];
  if (s) {
    metadata.push(
      meta.text("Branch", s.branch ?? "Detached HEAD", { icon: Icons.branch }),
      ...(s.upstream
        ? [meta.text("Upstream", s.upstream, { icon: Icons.cloud })]
        : [meta.text("Upstream", "None", { color: "gray" })]),
      meta.text("Changes", changeSummary(s), {
        icon: repo.changes ? Icons.dot : Icons.check,
        color: s.conflicts ? "red" : repo.changes ? "orange" : "green",
      }),
      ...(s.stashes ? [meta.text("Stashes", String(s.stashes), { icon: Icons.archive })] : []),
    );
  }
  if (repo.last) {
    metadata.push(
      meta.separator(),
      meta.text("Last commit", repo.last.short, { icon: Icons.commit }),
      meta.person("Author", repo.last.author),
      meta.text("Date", relativeTime(repo.last.time, now), { icon: Icons.clock }),
    );
  }
  if (repo.remote) {
    metadata.push(meta.separator());
    metadata.push(
      repo.remote.page
        ? meta.link(`Remote (${repo.remote.name})`, repo.remote.page.replace(/^https?:\/\//, ""), repo.remote.page)
        : meta.text(`Remote (${repo.remote.name})`, repo.remote.url),
    );
  }
  return {
    id: repo.path,
    title: name(repo.path),
    subtitle: tilde(parent, HOME),
    icon: { source: Icons.repository, tint },
    section: root ? tilde(root, HOME) : undefined,
    keywords: [repo.path, s?.branch ?? "", repo.remote?.url ?? ""],
    accessories,
    detail: {
      stats: s
        ? [
          { label: "changed", value: repo.changes, color: repo.changes ? "orange" : "green" },
          { label: "to push", value: s.ahead, color: s.ahead ? "blue" : undefined },
          { label: "to pull", value: s.behind, color: s.behind ? "purple" : undefined },
        ]
        : [],
      markdown: repo.error
        ? `**git failed:** ${repo.error}`
        : repo.last
        ? `**${repo.last.subject}**\n\n${repo.last.author} · ${relativeTime(repo.last.time, now)}`
        : loading
        ? "_Reading git status…_"
        : "_No commits yet._",
      metadata,
    },
    actions: repoActions(repo, prefs),
  };
}

async function setupItems(error: GitMissing): Promise<Item[]> {
  const os = await Deno.readTextFile("/etc/os-release").catch(() => "");
  const cmd = installCommand(os);
  return [{
    id: "setup",
    title: error.message,
    subtitle: cmd,
    icon: { source: Icons.alert, tint: "orange" },
    detail: { markdown: `## Install git\n\n\`\`\`\n${cmd}\n\`\`\`` },
    actions: [copy(cmd, "Copy Install Command"), open("https://git-scm.com/downloads/linux", "Open git Downloads")],
  }];
}

let total = 0;

export default list({
  placeholder: "Filter repositories by name, folder, branch, remote…",
  filter: {
    options: [
      { value: "all", title: "All" },
      { value: "changes", title: "Changes" },
      { value: "sync", title: "Ahead / Behind" },
    ],
  },
  empty: {
    title: "No repository here",
    description:
      "Set the folders to scan in Settings → Extensions → Git Repos (default: ~/Projects, ~/code, ~/src, ~/dev…)",
    icon: Icons.repository,
  },
  status: (items) => {
    if (items[0]?.id === "setup") return "git is missing";
    if (items[0]?.id === "none") return "No repository found";
    return `${items.length === total ? total : `${items.length} of ${total}`} repositor${total === 1 ? "y" : "ies"}`;
  },
  async *items({ preferences, signal, filter }) {
    const prefs = preferences as Prefs;
    const roots = parseFolders(prefs.folders, HOME);
    const depth = Number(prefs.depth) || 3;
    let paths: string[];
    try {
      await run("git", ["--version"], { signal });
      // find exits with 1 when a folder doesn't exist; what it found is still good.
      paths = reposFromFind(await run("find", findArgs(roots, depth), { signal, allowFailure: true }));
    } catch (e) {
      if (e instanceof GitMissing) {
        yield await setupItems(e);
        return;
      }
      throw e;
    }
    total = paths.length;
    if (!paths.length) {
      yield [{
        id: "none",
        title: "No git repository found",
        subtitle: `Looked ${depth} levels deep in ${roots.map((r) => tilde(r, HOME)).join(", ")}`,
        icon: { source: Icons.folder, tint: "gray" },
        detail: {
          markdown:
            "Set **Folders** in Settings → Extensions → Git Repos → Configure: a list separated by commas, like `~/Projects, ~/work`.",
        },
        actions: [open(roots[0] ?? HOME, "Open Folder")],
      }];
      return;
    }
    const now = Date.now();
    const view = filter ?? "all";
    if (view === "all") yield paths.map((p) => repoItem({ path: p, changes: 0 }, roots, prefs, now, true));
    const repos = await pool(paths, 8, (p) => inspect(p, signal));
    const dirty = repos.filter((r) => r.changes > 0).length;
    const unsynced = repos.filter((r) => r.status && (r.status.ahead || r.status.behind)).length;
    updateCommandMetadata({
      subtitle: [dirty && `${dirty} with changes`, unsynced && `${unsynced} to sync`].filter(Boolean).join(" · ") ||
        null,
    }).catch(() => {});
    const shown = repos.filter((r) =>
      view === "changes"
        ? r.changes > 0
        : view === "sync"
        ? !!r.status && (r.status.ahead > 0 || r.status.behind > 0)
        : true
    );
    total = repos.length;
    yield shown.map((r) => repoItem(r, roots, prefs, now, false));
  },
});
