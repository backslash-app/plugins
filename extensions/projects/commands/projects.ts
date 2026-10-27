import { action, close, copy, exec, type Item, list, open } from "@backslash/api";
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

function item(r: Recent, prefs: Prefs, g?: Git): Item {
  const name = r.path.split("/").pop()!.replace(/\.code-workspace$/, "");
  const accessories = [];
  if (g) {
    accessories.push({ text: g.branch });
    if (g.changes) accessories.push({ tag: `${g.changes} changed`, color: "orange" as const });
    if (g.ahead) accessories.push({ tag: `↑${g.ahead}`, color: "blue" as const });
  }
  accessories.push({ tag: r.editor });
  return {
    id: r.path,
    title: name,
    subtitle: tilde(r.path),
    icon: "folder",
    keywords: [r.path, r.editor, g?.branch ?? ""],
    accessories,
    actions: [
      action(`Open in ${r.editor}`, () => {
        launch(r.command, [r.path]);
        return close();
      }, { icon: "document-open" }),
      action("Open in Terminal", () => {
        openTerminal(r.path, prefs.terminal || undefined);
        return close();
      }, { icon: "utilities-terminal", shortcut: "<Ctrl>t" }),
      open(r.path, "Open Folder", { icon: "folder-open" }),
      ...(g?.page ? [open(g.page, "Open Repository Page", { shortcut: "<Ctrl>o" })] : []),
      ...(r.command !== prefs.editor
        ? [action(`Open in ${editorName(prefs.editor)}`, () => {
          launch(prefs.editor, [r.path]);
          return close();
        })]
        : []),
      copy(r.path, "Copy Path"),
    ],
  };
}

export default list({
  placeholder: "Search projects…",
  empty: {
    title: "No projects found",
    description:
      "Open folders in VS Code, Cursor, Zed or a JetBrains IDE, or keep git repositories in ~/Projects or ~/code",
  },
  async *items({ preferences }) {
    const prefs = preferences as unknown as Prefs;
    const found = projects(prefs.editor || "code");
    yield found.map((r) => item(r, prefs));
    // Then branch and pending changes, which take a git call each.
    const info = await Promise.all(found.slice(0, 80).map((r) => git(r.path)));
    yield found.map((r, i) => item(r, prefs, info[i]));
  },
});
