import { action, close, type Color, type Context, copy, Icons, type Item, list, meta, open } from "@backslash/api";
import { type Runner, shellArgv, type Task, terminalScript, tilde } from "../lib.ts";
import { FOLDERS, HOME, projects, tasksOf } from "../sources.ts";
import { runInTerminal, shellLine } from "../terminal.ts";

interface Prefs {
  terminal?: string;
  max?: number;
}

const RUNNERS: Record<Runner, { icon: string; tint: Color; title: string }> = {
  npm: { icon: Icons.package, tint: "red", title: "npm" },
  pnpm: { icon: Icons.package, tint: "orange", title: "pnpm" },
  yarn: { icon: Icons.package, tint: "blue", title: "Yarn" },
  bun: { icon: Icons.package, tint: "pink", title: "Bun" },
  deno: { icon: Icons.braces, tint: "teal", title: "Deno" },
  make: { icon: Icons.settings, tint: "gray", title: "Make" },
  just: { icon: Icons.bolt, tint: "yellow", title: "just" },
  task: { icon: Icons.layers, tint: "teal", title: "Task" },
  cargo: { icon: Icons.box, tint: "orange", title: "Cargo" },
  composer: { icon: Icons.package, tint: "purple", title: "Composer" },
  python: { icon: Icons.code, tint: "blue", title: "Python" },
};

const INSTALL: Record<string, Record<string, string>> = {
  just: {
    arch: "sudo pacman -S just",
    fedora: "sudo dnf install just",
    debian: "sudo apt install just",
    suse: "sudo zypper install just",
    other: "cargo install just",
  },
  task: {
    arch: "sudo pacman -S go-task",
    fedora: "sudo dnf install go-task",
    debian: "sudo snap install task --classic",
    suse: "sudo zypper install go-task",
    other: "go install github.com/go-task/task/v3/cmd/task@latest",
  },
};

let family: Promise<string> | undefined;
function osFamily(): Promise<string> {
  family ??= Deno.readTextFile("/etc/os-release").catch(() => "").then((text) => {
    const field = (k: string) => text.match(new RegExp(`^${k}="?([^"\\n]*)"?`, "m"))?.[1]?.toLowerCase() ?? "";
    const ids = `${field("ID")} ${field("ID_LIKE")}`.split(/\s+/);
    if (ids.some((i) => ["arch", "manjaro", "endeavouros", "cachyos"].includes(i))) return "arch";
    if (ids.some((i) => ["debian", "ubuntu", "linuxmint", "pop"].includes(i))) return "debian";
    if (ids.some((i) => ["fedora", "rhel", "centos"].includes(i))) return "fedora";
    if (ids.some((i) => i.startsWith("opensuse") || i === "suse")) return "suse";
    return "other";
  });
  return family;
}

let shown = { tasks: 0, projects: 0 };

/** The folder's name, with its parent when another project has the same name. */
function sectionName(dir: string, all: string[]): string {
  const name = dir.split("/").pop()!;
  const twins = all.filter((d) => d !== dir && d.split("/").pop() === name);
  return twins.length ? dir.split("/").slice(-2).join("/") : name;
}

function taskItem(t: Task, dir: string, project: string, prefs: Prefs, hint?: string): Item {
  const r = RUNNERS[t.runner];
  const runnerName = t.tool && t.runner === "python" ? `Python · ${t.tool}` : r.title;
  const cd = `cd ${shellLine([tilde(dir, HOME)]).replace(/^'~/, "~'")} && ${t.command}`;
  const needsArgs = /<\w[\w-]*>/.test(t.command);
  return {
    id: `${dir}\u0000${t.runner}\u0000${t.name}`,
    title: t.name,
    subtitle: t.description ?? t.script,
    icon: { source: r.icon, tint: r.tint },
    section: project,
    keywords: [project, r.title, t.tool ?? "", t.script ?? "", t.file],
    accessories: [{ tag: runnerName, color: r.tint }],
    detail: {
      markdown: [
        "```sh",
        t.command,
        "```",
        ...(t.script && t.script !== t.command ? ["", "Runs:", "", "```sh", t.script, "```"] : []),
        ...(t.description && t.script ? ["", t.description] : []),
        ...(needsArgs ? ["", "_The terminal asks for the `<arguments>` before running._"] : []),
        ...(hint ? ["", hint] : []),
      ].join("\n"),
      metadata: [
        meta.text("Project", project, { icon: Icons.folder }),
        meta.text("Folder", tilde(dir, HOME), { icon: Icons.folder }),
        meta.text("Runner", runnerName, { icon: r.icon, color: r.tint }),
        meta.text("Defined in", t.file, { icon: Icons.file }),
      ],
    },
    actions: [
      action("Run in Terminal", () => {
        const argv = shellArgv(Deno.env.get("SHELL"), terminalScript(dir, t.command));
        runInTerminal(argv, prefs.terminal || undefined);
        return close(`Running ${t.name}`);
      }, { icon: Icons.play, shortcut: "<Ctrl>t" }),
      copy(t.command, "Copy Command", { icon: Icons.terminal }),
      copy(cd, "Copy Command with cd", { shortcut: "<Ctrl><Shift>c", section: "Copy" }),
      copy(dir, "Copy Folder Path", { icon: Icons.folder, section: "Copy" }),
      open(`${dir}/${t.file}`, `Open ${t.file}`, { icon: Icons.file, shortcut: "<Ctrl>o", section: "Project" }),
      open(dir, "Open Folder", { icon: Icons.folder, section: "Project" }),
    ],
  };
}

export default (_ctx: Context) =>
  list({
    placeholder: "Search scripts, Make targets, recipes and tasks by name or project…",
    empty: {
      title: "No project scripts found",
      description: `Projects opened in VS Code, Cursor, Zed or a JetBrains IDE, and folders in ~/${
        FOLDERS.slice(0, 4).join(", ~/")
      }… with a package.json, Makefile, justfile, Taskfile, Cargo.toml, deno.json, composer.json or pyproject.toml.`,
      icon: Icons.terminal,
    },
    status: () => `${shown.tasks} task${shown.tasks === 1 ? "" : "s"} in ${shown.projects} projects`,
    async *items({ preferences }) {
      const prefs = preferences as Prefs;
      const max = Math.max(1, Math.min(200, Number(prefs.max) || 40));
      const found = projects().slice(0, max);
      const fam = await osFamily();
      const items: Item[] = [];
      let count = 0;
      // Project by project, most recent first, so the first ones show at once.
      for (let i = 0; i < found.length; i += 8) {
        const batch = found.slice(i, i + 8);
        const results = await Promise.all(batch.map((p) => tasksOf(p.path)));
        results.forEach((res, j) => {
          const dir = batch[j].path;
          if (!res.tasks.length) return;
          count++;
          const name = sectionName(dir, found.map((p) => p.path));
          const hint = res.missing.length
            ? res.missing.map((m) =>
              `Install \`${m}\` for descriptions and parameters: \`${INSTALL[m]?.[fam] ?? INSTALL[m]?.other}\``
            ).join("\n\n")
            : undefined;
          items.push(...res.tasks.map((t) =>
            taskItem(t, dir, name, prefs, t.runner === "just" || t.runner === "task" ? hint : undefined)
          ));
        });
        shown = { tasks: items.length, projects: count };
        yield [...items];
      }
      if (!found.length) {
        yield [];
      }
    },
  });
