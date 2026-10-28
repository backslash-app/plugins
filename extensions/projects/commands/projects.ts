import { action, close, type Color, copy, exec, Icons, type Item, list, meta, open, submenu } from "@backslash/api";
import { gitStatus, type Recent, remotePage } from "../lib.ts";
import { HOME, projects } from "../sources.ts";

interface Prefs {
  editor: string;
  terminal?: string;
}

const TERMINALS = [
  "kitty",
  "alacritty",
  "wezterm",
  "foot",
  "ghostty",
  "ptyxis",
  "kgx",
  "gnome-terminal",
  "konsole",
  "xfce4-terminal",
  "tilix",
  "xterm",
];

/** Starts a program that outlives the command. */
function launch(program: string, args: string[], cwd?: string) {
  const child = new Deno.Command(program, { args, cwd, stdin: "null", stdout: "null", stderr: "null" }).spawn();
  child.unref();
}

function openTerminal(dir: string, preferred?: string) {
  for (const term of preferred ? [preferred] : TERMINALS) {
    try {
      // Terminals start in the directory they are launched from.
      launch(term, term === "wezterm" ? ["start", "--cwd", dir] : [], dir);
      return;
    } catch (err) {
      if (!(err instanceof Deno.errors.NotFound)) throw err;
    }
  }
  throw new Error("No terminal found: set one in the extension's preferences");
}

const EDITORS: Record<string, string> = {
  code: "VS Code",
  "code-oss": "Code - OSS",
  codium: "VSCodium",
  cursor: "Cursor",
  windsurf: "Windsurf",
  zed: "Zed",
  zeditor: "Zed",
  idea: "IntelliJ IDEA",
};
const editorName = (command: string) => EDITORS[command] ?? command;

const tilde = (path: string) => (path.startsWith(HOME) ? `~${path.slice(HOME.length)}` : path);

interface Git {
  branch: string;
  changes: number;
  ahead: number;
  page?: string;
}

async function git(dir: string): Promise<Git | undefined> {
  try {
    const status = gitStatus(await exec("git", ["-C", dir, "status", "--porcelain=v1", "--branch"]));
    const remote = await exec("git", ["-C", dir, "remote", "get-url", "origin"]).catch(() => "");
    return { ...status, page: remotePage(remote) };
  } catch {
    return undefined;
  }
}

/** What a project is written in, from the files at its root. */
const MARKERS: [string, string, Color][] = [
  ["Cargo.toml", "Rust", "orange"],
  ["go.mod", "Go", "teal"],
  ["deno.json", "Deno", "gray"],
  ["tsconfig.json", "TypeScript", "blue"],
  ["package.json", "JavaScript", "yellow"],
  ["pyproject.toml", "Python", "blue"],
  ["requirements.txt", "Python", "blue"],
  ["pom.xml", "Java", "orange"],
  ["build.gradle", "Java", "orange"],
  ["build.gradle.kts", "Kotlin", "purple"],
  ["Gemfile", "Ruby", "red"],
  ["composer.json", "PHP", "purple"],
  ["mix.exs", "Elixir", "purple"],
  ["pubspec.yaml", "Dart", "teal"],
  ["CMakeLists.txt", "C++", "pink"],
  ["meson.build", "C", "gray"],
  ["flake.nix", "Nix", "blue"],
];

function language(dir: string): [string, Color] | undefined {
  for (const [file, name, color] of MARKERS) {
    try {
      Deno.statSync(`${dir}/${file}`);
      return [name, color];
    } catch { /* next */ }
  }
  return undefined;
}

const date = (ms: number) => new Date(ms).toLocaleDateString("en", { day: "numeric", month: "short", year: "numeric" });

function item(r: Recent, prefs: Prefs, g?: Git): Item {
  const name = r.path.split("/").pop()!.replace(/\.code-workspace$/, "");
  const lang = language(r.path);
  const accessories = [];
  if (g) {
    accessories.push({ icon: Icons.branch, text: g.branch });
    if (g.changes) accessories.push({ tag: `${g.changes} changed`, color: "orange" as const });
    if (g.ahead) accessories.push({ tag: `↑${g.ahead}`, color: "blue" as const, tooltip: "Commits not pushed" });
  }
  accessories.push({ text: r.editor });
  const openIn = (title: string, command: string) =>
    action(title, () => {
      launch(command, [r.path]);
      return close();
    }, { icon: Icons.code });
  const others = Object.entries(EDITORS).filter(([cmd]) =>
    cmd !== r.command && cmd !== "zeditor" && cmd !== "code-oss"
  );
  return {
    id: r.path,
    title: name,
    subtitle: tilde(r.path),
    icon: { source: Icons.folder, tint: lang?.[1] ?? "gray" },
    keywords: [r.path, r.editor, g?.branch ?? "", lang?.[0] ?? ""],
    accessories,
    detail: {
      metadata: [
        meta.text("Folder", tilde(r.path), { icon: Icons.folder }),
        ...(lang ? [meta.text("Language", lang[0], { icon: Icons.dot, color: lang[1] })] : []),
        meta.text("Editor", r.editor, { icon: Icons.code }),
        ...(r.opened ? [meta.text("Opened", date(r.opened), { icon: Icons.clock })] : []),
        ...(g
          ? [
            meta.separator(),
            meta.text("Branch", g.branch, { icon: Icons.branch }),
            meta.text("Changes", g.changes ? `${g.changes} file${g.changes > 1 ? "s" : ""} changed` : "Clean", {
              icon: g.changes ? Icons.dot : Icons.check,
              color: g.changes ? "orange" : "green",
            }),
            ...(g.ahead
              ? [meta.text("Not pushed", `${g.ahead} commit${g.ahead > 1 ? "s" : ""}`, { color: "blue" })]
              : []),
            ...(g.page ? [meta.link("Remote", g.page.replace(/^https:\/\//, ""), g.page)] : []),
          ]
          : []),
      ],
    },
    actions: [
      openIn(`Open in ${r.editor}`, r.command),
      action("Open in Terminal", () => {
        openTerminal(r.path, prefs.terminal || undefined);
        return close();
      }, { icon: Icons.terminal, shortcut: "<Ctrl>t" }),
      open(r.path, "Open Folder", { icon: Icons.folder }),
      ...(g?.page ? [open(g.page, "Open Repository Page", { shortcut: "<Ctrl>o" })] : []),
      submenu("Open With", [
        ...(r.command !== prefs.editor ? [openIn(editorName(prefs.editor), prefs.editor)] : []),
        ...others.map(([cmd, title]) => openIn(title, cmd)),
      ], { icon: Icons.apps, section: "Open" }),
      copy(r.path, "Copy Path", { shortcut: "<Ctrl><Shift>c", section: "Copy" }),
      ...(g?.branch ? [copy(g.branch, "Copy Branch Name", { icon: Icons.branch, section: "Copy" })] : []),
    ],
  };
}

export default list({
  placeholder: "Search projects by name, path, branch, language…",
  empty: {
    title: "No projects found",
    description:
      "Open folders in VS Code, Cursor, Zed or a JetBrains IDE, or keep git repositories in ~/Projects or ~/code",
    icon: "bs-folder",
  },
  status: (items) => `${items.length} project${items.length === 1 ? "" : "s"}`,
  async *items({ preferences }) {
    const prefs = preferences as unknown as Prefs;
    const found = projects(prefs.editor || "code");
    yield found.map((r) => item(r, prefs));
    // Then branch and pending changes, which take a git call each.
    const info = await Promise.all(found.slice(0, 80).map((r) => git(r.path)));
    yield found.map((r, i) => item(r, prefs, info[i]));
  },
});
