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
  ago,
  coderWebUrl,
  codespaceVscodeUrl,
  gitSummary,
  isTransitional,
  PROVIDERS,
  sortWorkspaces,
  stateLook,
  terminalScript,
  until,
  type Workspace,
} from "../lib.ts";
import { background, coderOpenVscode, github, githubToken, load, type Loaded } from "../providers.ts";
import { runInTerminal } from "../terminal.ts";

interface Prefs {
  githubToken?: string;
  terminal?: string;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

function inTerminal(title: string, argv: string[], prefs: Prefs, options: { wait?: boolean; icon?: string } = {}) {
  return action(title, () => {
    runInTerminal(["bash", "-c", terminalScript(argv, options.wait)], prefs.terminal || undefined);
    return close();
  }, { icon: options.icon ?? Icons.terminal });
}

/** Runs a CLI in the background, then reloads: the list keeps checking while the state changes. */
function inBackground(title: string, program: string, args: string[], done: string, options = {}): Action {
  return action(title, async () => {
    background(program, args);
    await toast(done);
    return refresh();
  }, options);
}

function codespaceActions(w: Workspace, prefs: Prefs): Action[] {
  const call = (method: string, path: string, done: string) => async () => {
    const token = await githubToken(prefs as Record<string, unknown>);
    if (!token) throw new Error("Add a GitHub token in the extension's preferences");
    await github(token, path, { method });
    await toast(done, { style: "success" });
    return refresh();
  };
  const start = action("Start Codespace", call("POST", `/user/codespaces/${w.id}/start`, `Starting ${w.title}…`), {
    icon: Icons.play,
    shortcut: "<Ctrl>s",
  });
  const vscode = open(codespaceVscodeUrl(w.id), "Open in VS Code", { icon: Icons.code });
  const out: Action[] = w.state === "stopped" || w.state === "failed" ? [start, vscode] : [vscode];
  if (w.webUrl) out.push(open(w.webUrl, "Open in Browser", { icon: Icons.globe, shortcut: "<Ctrl>b" }));
  out.push(inTerminal("Connect over SSH", ["gh", "codespace", "ssh", "-c", w.id], prefs));
  if (w.state === "running" || w.state === "starting") {
    out.push(
      action("Stop Codespace", call("POST", `/user/codespaces/${w.id}/stop`, `Stopping ${w.title}…`), {
        icon: Icons.stop,
        shortcut: "<Ctrl><Shift>s",
      }),
    );
  }
  out.push(copy(w.id, "Copy Codespace Name", { shortcut: "<Ctrl><Shift>c", section: "Copy" }));
  if (w.repoUrl) out.push(open(w.repoUrl, "Open Repository", { icon: Icons.repository, section: "Copy" }));
  out.push(action("Delete Codespace", call("DELETE", `/user/codespaces/${w.id}`, `Deleting ${w.title}…`), {
    icon: Icons.trash,
    destructive: true,
    shortcut: "<Ctrl><Shift>x",
    section: "Danger",
    confirm: `Delete ${w.title}?${w.uncommitted || w.unpushed ? " It has changes that aren't pushed." : ""}`,
  }));
  return out;
}

function coderActions(w: Workspace, base: string | undefined, prefs: Prefs): Action[] {
  const vscode = action("Open in VS Code", async () => {
    await coderOpenVscode(w.id);
    return close();
  }, { icon: Icons.code });
  const start = inBackground("Start Workspace", "coder", ["start", w.id, "--yes"], `Starting ${w.title}…`, {
    icon: Icons.play,
    shortcut: "<Ctrl>s",
  });
  const out: Action[] = w.state === "running" ? [vscode] : [start, vscode];
  out.push(inTerminal("Connect over SSH", ["coder", "ssh", w.id], prefs));
  if (base) out.push(open(coderWebUrl(base, w), "Open in Browser", { icon: Icons.globe, shortcut: "<Ctrl>b" }));
  if (w.state === "running" || w.state === "starting") {
    out.push(inBackground("Stop Workspace", "coder", ["stop", w.id, "--yes"], `Stopping ${w.title}…`, {
      icon: Icons.stop,
      shortcut: "<Ctrl><Shift>s",
    }));
  }
  if (w.outdated) {
    out.push(inTerminal("Update to the Latest Template", ["coder", "update", w.id], prefs, {
      wait: true,
      icon: Icons.download,
    }));
  }
  out.push(copy(w.id, "Copy Workspace Name", { shortcut: "<Ctrl><Shift>c", section: "Copy" }));
  out.push(copy(`coder ssh ${w.id}`, "Copy SSH Command", { icon: Icons.terminal, section: "Copy" }));
  out.push(inBackground("Delete Workspace", "coder", ["delete", w.id, "--yes"], `Deleting ${w.title}…`, {
    icon: Icons.trash,
    destructive: true,
    shortcut: "<Ctrl><Shift>x",
    section: "Danger",
    confirm: `Delete ${w.id} and its home folder?`,
  }));
  return out;
}

function devpodActions(w: Workspace, prefs: Prefs): Action[] {
  const vscode = w.state === "running"
    ? inBackground("Open in VS Code", "devpod", ["up", w.id, "--ide", "vscode"], `Opening ${w.title}…`, {
      icon: Icons.code,
    })
    : inTerminal("Start and Open in VS Code", ["devpod", "up", w.id, "--ide", "vscode"], prefs, { icon: Icons.code });
  const start = inBackground("Start Workspace", "devpod", ["up", w.id, "--ide", "none"], `Starting ${w.title}…`, {
    icon: Icons.play,
    shortcut: "<Ctrl>s",
  });
  const out: Action[] = w.state === "stopped" ? [start, vscode] : [vscode];
  out.push(inTerminal("Connect over SSH", ["devpod", "ssh", w.id], prefs));
  if (w.state === "running" || w.state === "starting") {
    out.push(inBackground("Stop Workspace", "devpod", ["stop", w.id], `Stopping ${w.title}…`, {
      icon: Icons.stop,
      shortcut: "<Ctrl><Shift>s",
    }));
  }
  if (w.state === "unknown") out.push({ ...start, shortcut: undefined });
  out.push(copy(w.id, "Copy Workspace ID", { shortcut: "<Ctrl><Shift>c", section: "Copy" }));
  out.push(copy(`ssh ${w.id}.devpod`, "Copy SSH Command", { icon: Icons.terminal, section: "Copy" }));
  if (w.repoUrl) out.push(open(w.repoUrl, "Open Repository", { icon: Icons.repository, section: "Copy" }));
  out.push(inBackground("Delete Workspace", "devpod", ["delete", w.id], `Deleting ${w.title}…`, {
    icon: Icons.trash,
    destructive: true,
    shortcut: "<Ctrl><Shift>x",
    section: "Danger",
    confirm: `Delete ${w.id} and its container or machine?`,
  }));
  return out;
}

function workspaceItem(w: Workspace, loaded: Loaded, prefs: Prefs): Item {
  const look = stateLook(w.state);
  const git = gitSummary(w);
  const stops = until(w.deadline);
  const lines: Metadata[] = [
    meta.text(
      "State",
      w.rawState && w.rawState.toLowerCase() !== look.text.toLowerCase() ? `${look.text} (${w.rawState})` : look.text,
      {
        icon: look.icon,
        color: look.tint,
      },
    ),
    meta.text("Provider", PROVIDERS[w.provider].title, { icon: Icons.cloud }),
    ...(w.repo ? [w.repoUrl ? meta.link("Repository", w.repo, w.repoUrl) : meta.text("Source", w.repo)] : []),
    ...(w.branch ? [meta.text("Branch", w.branch, { icon: Icons.branch })] : []),
    ...(git ? [meta.text("Changes", git, { icon: Icons.commit, color: "orange" })] : []),
    ...(w.machine ? [meta.text("Machine", w.machine, { icon: Icons.cpu })] : []),
    ...(w.template ? [meta.text(w.provider === "codespaces" ? "Dev container" : "Template", w.template)] : []),
    ...(w.outdated
      ? [meta.text("Template", "A newer version is available", { icon: Icons.arrowUp, color: "blue" })]
      : []),
    ...(w.backend ? [meta.text("Runs on", w.backend, { icon: Icons.server })] : []),
    ...(w.ide ? [meta.text("IDE", w.ide)] : []),
    ...(w.healthy === false ? [meta.text("Health", "Agent not connected", { icon: Icons.alert, color: "red" })] : []),
    ...(stops ? [meta.text("Stops", stops, { icon: Icons.timer })] : []),
    ...(w.idleTimeoutMinutes ? [meta.text("Idle timeout", `${w.idleTimeoutMinutes} min`, { icon: Icons.timer })] : []),
    meta.separator(),
    ...(w.lastUsed ? [meta.text("Last used", ago(w.lastUsed), { icon: Icons.clock })] : []),
    ...(w.created ? [meta.text("Created", ago(w.created))] : []),
    ...(w.location ? [meta.text("Region", w.location, { icon: Icons.globe })] : []),
    ...(w.owner ? [meta.text("Owner", w.owner, { icon: Icons.person })] : []),
    meta.text(w.provider === "codespaces" ? "Name" : "ID", w.id),
  ];
  const accessories: Accessory[] = [
    { tag: look.text, color: look.tint },
    ...(w.outdated ? [{ icon: { source: Icons.arrowUp, tint: "blue" as const }, tooltip: "Template update" }] : []),
    ...(git ? [{ text: git.split(",")[0], icon: Icons.commit, tooltip: git }] : []),
    ...(stops && w.state === "running" ? [{ text: `stops ${stops}`, icon: Icons.timer }] : []),
    ...(w.lastUsed && w.state !== "running" ? [{ text: ago(w.lastUsed), tooltip: "Last used" }] : []),
  ];
  const actions = w.provider === "codespaces"
    ? codespaceActions(w, prefs)
    : w.provider === "coder"
    ? coderActions(w, loaded.base, prefs)
    : devpodActions(w, prefs);
  return {
    id: `${w.provider}:${w.id}`,
    title: w.title,
    subtitle: [w.repo, w.branch && w.repo ? w.branch : "", w.provider === "coder" ? w.template : w.machine ?? w.backend]
      .filter(Boolean).join(" · ") || undefined,
    icon: { source: look.icon, tint: look.tint },
    section: PROVIDERS[w.provider].title,
    keywords: [w.id, w.provider, look.text, w.repo ?? "", w.branch ?? "", w.template ?? "", w.backend ?? ""],
    accessories,
    detail: { metadata: lines },
    actions,
  };
}

const SETUP: Record<string, { line: string; link: string }> = {
  codespaces: {
    line: "gh auth refresh -h github.com -s codespace",
    link: "https://github.com/settings/tokens/new?scopes=codespace&description=Backslash",
  },
  coder: { line: "coder login https://coder.example.com", link: "https://coder.com/docs/install/cli" },
  devpod: { line: "devpod provider add docker", link: "https://devpod.sh/docs/getting-started/install" },
};

function problemItem(l: Loaded): Item {
  const text = l.error ?? l.setup ?? "";
  const title = PROVIDERS[l.provider].title;
  return {
    id: `problem:${l.provider}`,
    title: l.error ? `${title} couldn't list its workspaces` : `Connect ${title}`,
    subtitle: text,
    icon: { source: l.error ? Icons.alert : Icons.key, tint: "orange" },
    section: title,
    detail: { markdown: [`## ${title}`, "", text, "", "```sh", SETUP[l.provider].line, "```"].join("\n") },
    actions: [
      ...(l.provider === "codespaces" ? [open(SETUP.codespaces.link, "Create a Token", { icon: Icons.key })] : []),
      copy(SETUP[l.provider].line, "Copy Command", { icon: Icons.terminal }),
      open(PROVIDERS[l.provider].site, "Open Documentation"),
    ],
  };
}

function welcomeItem(): Item {
  return {
    id: "welcome",
    title: "No dev environment found",
    subtitle: "Connect GitHub Codespaces, or install the Coder or DevPod CLI",
    icon: { source: Icons.cloud, tint: "gray" },
    detail: {
      markdown: [
        "## Connect a provider",
        "",
        "- **GitHub Codespaces**: add a token with the `codespace` scope in the extension's preferences, or let",
        "  the GitHub CLI's sign-in be used: `gh auth refresh -h github.com -s codespace`",
        "- **Coder**: install the CLI and run `coder login <your deployment URL>`",
        "- **DevPod**: install the CLI; its workspaces appear here with their state",
      ].join("\n"),
    },
    actions: [
      open(SETUP.codespaces.link, "Create a GitHub Token", { icon: Icons.key }),
      copy(SETUP.codespaces.line, "Copy gh Command", { icon: Icons.terminal }),
      open(SETUP.devpod.link, "Open DevPod Install Guide", { icon: Icons.download }),
      open(SETUP.coder.link, "Open Coder Install Guide", { icon: Icons.download }),
    ],
  };
}

/** Shown as a row: errors, and sign-ins that failed (a CLI that isn't installed is just left out). */
function isProblem(l: Loaded): boolean {
  if (l.error) return true;
  if (!l.setup || l.setup === "not installed") return false;
  return !(l.provider === "codespaces" && l.setup.startsWith("Add"));
}

function render(loaded: Loaded[], prefs: Prefs, filter?: string): Item[] {
  const items = loaded.filter(isProblem).map(problemItem);
  const owner = new Map(loaded.flatMap((l) => l.workspaces.map((w) => [w, l] as const)));
  for (const w of sortWorkspaces([...owner.keys()])) {
    if (filter === "running" && w.state !== "running" && !isTransitional(w.state)) continue;
    if (filter === "stopped" && w.state !== "stopped") continue;
    items.push(workspaceItem(w, owner.get(w)!, prefs));
  }
  return items;
}

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => (clearTimeout(t), resolve()), { once: true });
  });

let summary = "";

export default list({
  placeholder: "Filter workspaces by name, repository, branch or state…",
  filter: {
    options: [{ value: "all", title: "All" }, { value: "running", title: "Running" }, {
      value: "stopped",
      title: "Stopped",
    }],
  },
  empty: { title: "Nothing here", description: "No workspace matches this view.", icon: Icons.cloud },
  status: () => summary,
  actions: [action("Reload", () => refresh(), { icon: Icons.refresh, shortcut: "<Ctrl>r" })],
  async *items({ preferences, signal, filter }) {
    const prefs = preferences as Prefs;
    let latest: Loaded[] = [];
    const show = () => {
      const all = latest.flatMap((l) => l.workspaces);
      const running = all.filter((w) => w.state === "running").length;
      summary = all.length ? `${plural(all.length, "workspace")} · ${running} running` : "";
      const nothing = latest.length === 3 && !all.length && !latest.some(isProblem);
      return nothing ? [welcomeItem()] : render(latest, prefs, filter);
    };
    for await (const loaded of load(preferences, signal)) {
      latest = loaded;
      yield show();
    }
    const running = latest.flatMap((l) => l.workspaces).filter((w) => w.state === "running").length;
    updateCommandMetadata({ subtitle: running ? `${running} running` : null }).catch(() => {});
    // While something starts or stops, check again every few seconds (for up to 5 minutes).
    for (let round = 0; round < 60 && !signal.aborted; round++) {
      if (!latest.some((l) => l.workspaces.some((w) => isTransitional(w.state)))) break;
      await sleep(5000, signal);
      if (signal.aborted) break;
      for await (const loaded of load(preferences, signal)) latest = loaded;
      yield show();
    }
  },
});
