import {
  type Action,
  action,
  close,
  type Context,
  copy,
  Icons,
  type Item,
  list,
  meta,
  type Metadata,
  open,
  refresh,
  submenu,
  updateCommandMetadata,
} from "@backslash/api";
import { command, isNewer, MANAGERS, type Op, type Runtime, sortRuntimes, terminalScript, toolInfo } from "../lib.ts";
import { available, detect, type Found, HOME, latest } from "../managers.ts";
import { runInTerminal } from "../terminal.ts";

interface Prefs {
  terminal?: string;
}

/** Runs a command in the terminal and closes the launcher. */
function inTerminal(title: string, line: string, prefs: Prefs): Action {
  return action(title, () => {
    runInTerminal(["bash", "-c", terminalScript(title, line)], prefs.terminal || undefined);
    return close(title);
  }, { icon: Icons.terminal });
}

const OPS: Record<Op, string> = {
  install: "Install",
  use: "Use Globally",
  uninstall: "Uninstall",
  update: "Update",
};

function runtimeActions(r: Runtime, f: Found, prefs: Prefs): Action[] {
  const info = toolInfo(r);
  const cmd = (op: Op, version = r.manager === "rustup" ? r.tool : r.version) =>
    command(r.manager, op, r.tool, version, { asdfGo: f.asdfGo });
  const run = (op: Op, label: string, options: { icon?: string; shortcut?: string } = {}, version?: string) => {
    const line = cmd(op, version);
    return line ? [{ ...inTerminal(label, line, prefs), ...options }] : [];
  };
  const out: Action[] = [];
  if (!r.installed) out.push(...run("install", `Install ${info.name} ${r.version}`, { icon: Icons.download }));
  if (!r.current) {
    out.push(...run("use", `Use ${info.name} ${r.version} Globally`, { icon: Icons.check, shortcut: "<Ctrl>g" }));
  }
  if (r.manager === "rustup" && !isNewer(r.latest, r.version)) {
    out.push(...run("update", `Update Rust ${r.tool.split("-")[0]}`, { icon: Icons.refresh, shortcut: "<Ctrl>u" }));
  }
  if (r.latest && isNewer(r.latest, r.version)) {
    if (r.manager === "rustup") {
      out.push(...run("update", `Update Rust ${r.tool.split("-")[0]} to ${r.latest}`, {
        icon: Icons.download,
        shortcut: "<Ctrl>u",
      }));
    } else if (r.current) {
      // Install the newer one and switch to it (mise use does both).
      const install = cmd("install", r.latest), use = cmd("use", r.latest);
      const line = r.manager === "mise" ? use : install && use ? `${install} && ${use}` : install;
      if (line) {
        out.push({
          ...inTerminal(`Update ${toolInfo(r).name} to ${r.latest}`, line, prefs),
          icon: Icons.download,
          shortcut: "<Ctrl>u",
        });
      }
    } else out.push(...run("install", `Install ${r.latest}`, { icon: Icons.download, shortcut: "<Ctrl>u" }, r.latest));
  }
  if (["mise", "asdf", "fnm", "pyenv"].includes(r.manager)) {
    out.push(submenu("Install Version", async () => {
      const versions = (await available(r.manager, r.manager === "fnm" ? "node" : r.tool)).slice(0, 25);
      if (!versions.length) return [action("No version found", () => {}, { icon: Icons.info })];
      return versions.flatMap((v, i) => {
        const line = cmd("install", v);
        return line
          ? [{ ...inTerminal(`${OPS.install} ${info.name} ${v}`, line, prefs), title: i === 0 ? `${v} (latest)` : v }]
          : [];
      });
    }, { icon: Icons.download, section: "Versions" }));
  }
  if (r.manager === "rustup") {
    out.push(submenu(
      "Install Toolchain",
      ["stable", "beta", "nightly"].map((c) => ({
        ...inTerminal(`Install Rust ${c}`, command("rustup", "install", c, c)!, prefs),
        title: c,
      })),
      { icon: Icons.download, section: "Versions" },
    ));
  }
  const copyLine = cmd("use");
  if (copyLine) out.push(copy(copyLine, "Copy Use Command", { icon: Icons.terminal, section: "Copy" }));
  out.push(copy(r.version, "Copy Version", { shortcut: "<Ctrl><Shift>c", section: "Copy" }));
  if (r.path) {
    out.push(open(r.path.replace(/^~/, HOME), "Open Install Folder", { icon: Icons.folder, section: "Copy" }));
  }
  out.push(
    open(MANAGERS[r.manager].site, `${MANAGERS[r.manager].title} Website`, { icon: Icons.globe, section: "Copy" }),
  );
  if (r.installed) {
    const line = cmd("uninstall");
    if (line) {
      out.push({
        ...inTerminal(`Uninstall ${info.name} ${r.version}`, line, prefs),
        destructive: true,
        confirm: `Uninstall ${info.name} ${r.version}${r.current ? ", the version in use" : ""}?`,
        shortcut: "<Ctrl><Shift>x",
        section: "Danger",
        icon: Icons.trash,
      });
    }
  }
  return out;
}

function runtimeItem(r: Runtime, f: Found, prefs: Prefs): Item {
  const info = toolInfo(r);
  const update = isNewer(r.latest, r.version);
  const inUse = ["mise", "asdf", "pyenv"].includes(r.manager) ? "Global" : "Default";
  const status = !r.installed
    ? (r.current ? `${inUse}, not installed` : "Not installed")
    : r.current
    ? inUse
    : "Installed";
  const lines: Metadata[] = [
    meta.text("Tool", info.name, { icon: Icons.box, color: info.color }),
    meta.text("Version", r.version, { icon: Icons.tag }),
    meta.text("Status", status, {
      icon: !r.installed ? Icons.alert : r.current ? Icons.check : Icons.dot,
      color: !r.installed ? "red" : r.current ? "green" : "gray",
    }),
    ...(r.latest
      ? [meta.text("Latest", update ? `${r.latest} available` : `${r.latest} (up to date)`, {
        icon: update ? Icons.arrowUp : Icons.check,
        color: update ? "blue" : "green",
      })]
      : []),
    ...(r.requested && r.requested !== r.version ? [meta.text("Requested", r.requested)] : []),
    ...(r.source ? [meta.text("Set by", r.source, { icon: Icons.file })] : []),
    ...(r.detail && r.detail !== r.tool ? [meta.text("Toolchain", r.detail)] : []),
    ...(r.manager === "rustup" ? [meta.text("Toolchain", r.tool, { icon: Icons.layers })] : []),
    meta.separator(),
    meta.text("Manager", `${MANAGERS[r.manager].title}${f.version ? ` ${f.version}` : ""}`, { icon: Icons.settings }),
    ...(r.path ? [meta.text("Path", r.path, { icon: Icons.folder })] : []),
  ];
  const use = command(r.manager, "use", r.tool, r.manager === "rustup" ? r.tool : r.version, { asdfGo: f.asdfGo });
  return {
    id: `${r.manager}:${r.tool}:${r.version}`,
    title: `${info.name} ${r.version}`,
    subtitle: r.manager === "rustup"
      ? r.tool
      : r.requested && r.requested !== r.version
      ? `requested ${r.requested}`
      : undefined,
    icon: {
      source: !r.installed ? Icons.alert : r.current ? Icons.done : Icons.todo,
      tint: r.installed ? info.color : "red",
    },
    section: MANAGERS[r.manager].title,
    keywords: [r.tool, r.manager, status, r.source ?? ""],
    accessories: [
      ...(r.current && r.installed ? [{ tag: status, color: "green" as const }] : []),
      ...(!r.installed ? [{ tag: "Not installed", color: "red" as const }] : []),
      ...(update && r.current
        ? [{ icon: { source: Icons.arrowUp, tint: "blue" as const }, text: r.latest, tooltip: "Newer version" }]
        : []),
      ...(r.source && !r.current ? [{ text: r.source }] : []),
    ],
    detail: {
      markdown: use ? `Use it everywhere:\n\n\`\`\`sh\n${use}\n\`\`\`` : undefined,
      metadata: lines,
    },
    actions: runtimeActions(r, f, prefs),
  };
}

function errorItem(f: Found): Item {
  return {
    id: `error:${f.manager}`,
    title: `${MANAGERS[f.manager].title} couldn't list its versions`,
    subtitle: f.error,
    icon: { source: Icons.alert, tint: "orange" },
    section: MANAGERS[f.manager].title,
    detail: { markdown: `\`\`\`text\n${f.error}\n\`\`\`` },
    actions: [open(MANAGERS[f.manager].site, "Open Website"), copy(f.error ?? "", "Copy Error")],
  };
}

async function installHint(prefs: Prefs): Promise<Item[]> {
  const os = await Deno.readTextFile("/etc/os-release").catch(() => "");
  const ids = (os.match(/^ID(?:_LIKE)?="?([^"\n]*)"?/gm) ?? []).join(" ").toLowerCase();
  const [distro, line] = /arch|manjaro|endeavouros|cachyos/.test(ids)
    ? ["Arch", "sudo pacman -S mise"]
    : /fedora|rhel|centos/.test(ids)
    ? ["Fedora", "sudo dnf copr enable jdxcode/mise && sudo dnf install mise"]
    : /opensuse|suse/.test(ids)
    ? ["openSUSE", "sudo zypper install mise"]
    : [/^NAME="?([^"\n]*)"?/m.exec(os)?.[1] || "any distribution", "curl https://mise.run | sh"];
  return [{
    id: "install",
    title: "No version manager found",
    subtitle: "Install mise to manage Node, Python, Go, Java and more",
    icon: { source: Icons.download, tint: "blue" },
    detail: {
      markdown: [
        "## Install a version manager",
        "",
        `**mise** handles most languages with one tool. On ${distro}:`,
        "",
        "```sh",
        line,
        "```",
        "",
        'Then add `eval "$(mise activate bash)"` (or zsh, fish) to your shell\'s startup file.',
        "",
        "Also detected when installed: **asdf**, **rustup**, **fnm**, **nvm**, **pyenv** and **SDKMAN!**.",
      ].join("\n"),
    },
    actions: [
      inTerminal("Install mise", line, prefs),
      copy(line, "Copy Install Command"),
      open("https://mise.jdx.dev/getting-started.html", "Open mise Docs"),
      open("https://rustup.rs", "Install Rust with rustup", { section: "Others" }),
    ],
  }];
}

let counts = { runtimes: 0, managers: 0, updates: 0 };

export default (_ctx: Context) =>
  list({
    placeholder: "Filter runtimes by language, version or manager…",
    filter: {
      options: [{ value: "all", title: "All" }, { value: "current", title: "In use" }, {
        value: "updates",
        title: "Updates",
      }],
    },
    empty: { title: "Nothing here", description: "No runtime matches this view.", icon: Icons.box },
    status: (items) =>
      items[0]?.id === "install"
        ? "No version manager"
        : `${counts.runtimes} runtime${counts.runtimes === 1 ? "" : "s"} · ${counts.managers} manager${
          counts.managers === 1 ? "" : "s"
        }${counts.updates ? ` · ${counts.updates} update${counts.updates === 1 ? "" : "s"}` : ""}`,
    actions: [action("Reload", () => refresh(), { icon: Icons.refresh, shortcut: "<Ctrl>r" })],
    async *items({ preferences, filter }) {
      const prefs = preferences as Prefs;
      const found = await detect();
      if (!found.length) return yield await installHint(prefs);
      const show = (latestOf?: Map<string, string>) => {
        const items: Item[] = [];
        let total = 0, updates = 0;
        for (const f of found) {
          if (f.error) items.push(errorItem(f));
          for (const r of sortRuntimes(f.runtimes)) {
            const known = latestOf?.get(`${f.manager}:${r.tool}`);
            const rt = { ...r, latest: known ?? r.latest };
            total++;
            const newer = isNewer(rt.latest, rt.version) && rt.current;
            if (newer) updates++;
            if (filter === "current" && !rt.current) continue;
            if (filter === "updates" && !newer) continue;
            items.push(runtimeItem(rt, f, prefs));
          }
        }
        counts = { runtimes: total, managers: found.length, updates };
        return items;
      };
      yield show();
      // Newest versions take a network call per manager: shown as each one answers.
      const newest = new Map<string, string>();
      const pending = new Map(found.map((f) => [f.manager, latest(f).then((m) => [f.manager, m] as const)]));
      while (pending.size) {
        const [manager, versions] = await Promise.race(pending.values());
        pending.delete(manager);
        if (!versions.size) continue;
        for (const [k, v] of versions) newest.set(k, v);
        yield show(newest);
      }
      updateCommandMetadata({
        subtitle: counts.updates ? `${counts.updates} update${counts.updates === 1 ? "" : "s"}` : null,
      })
        .catch(() => {});
    },
  });
