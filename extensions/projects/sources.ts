// Where editors keep their recent projects.

import { DatabaseSync } from "node:sqlite";
import { jetbrainsProduct, jetbrainsRecents, merge, type Recent, vscodeRecents, zedPaths } from "./lib.ts";

export const HOME = Deno.env.get("HOME") ?? "";
const TMP = "/tmp/backslash-projects";

const VSCODES: [string, string, string][] = [
  [".config/Code", "VS Code", "code"],
  [".var/app/com.visualstudio.code/config/Code", "VS Code", "code"],
  [".config/Code - OSS", "Code - OSS", "code-oss"],
  [".config/VSCodium", "VSCodium", "codium"],
  [".var/app/com.vscodium.codium/config/VSCodium", "VSCodium", "codium"],
  [".config/Cursor", "Cursor", "cursor"],
  [".config/Windsurf", "Windsurf", "windsurf"],
];

const FOLDERS = ["Projects", "projects", "Code", "code", "dev", "Developer", "src", "git", "repos", "workspace"];

const isDir = (path: string) => {
  try {
    return Deno.statSync(path).isDirectory;
  } catch {
    return false;
  }
};

function dirs(path: string): string[] {
  try {
    return [...Deno.readDirSync(path)].filter((e) => e.isDirectory && !e.name.startsWith(".")).map((e) =>
      `${path}/${e.name}`
    );
  } catch {
    return [];
  }
}

/** A readable copy of a database the editor may hold open. */
function open(path: string): DatabaseSync | undefined {
  try {
    Deno.statSync(path);
    Deno.mkdirSync(TMP, { recursive: true });
    const copy = `${TMP}/${path.replace(/[^a-zA-Z0-9]/g, "_").slice(-100)}`;
    Deno.copyFileSync(path, copy);
    try {
      Deno.copyFileSync(`${path}-wal`, `${copy}-wal`);
    } catch { /* no write-ahead log */ }
    return new DatabaseSync(copy);
  } catch {
    return undefined;
  }
}

function vscode(): Recent[] {
  return VSCODES.flatMap(([dir, editor, command]) => {
    const db = open(`${HOME}/${dir}/User/globalStorage/state.vscdb`);
    if (!db) return [];
    try {
      const row = db.prepare("SELECT value FROM ItemTable WHERE key = 'history.recentlyOpenedPathsList'").get() as
        | { value: string }
        | undefined;
      return row ? vscodeRecents(String(row.value), editor, command) : [];
    } catch {
      return [];
    } finally {
      db.close();
    }
  });
}

function jetbrains(): Recent[] {
  return dirs(`${HOME}/.config/JetBrains`).flatMap((dir) => {
    const product = jetbrainsProduct(dir.split("/").pop()!);
    if (!product) return [];
    try {
      const xml = Deno.readTextFileSync(`${dir}/options/recentProjects.xml`);
      return jetbrainsRecents(xml, HOME, ...product);
    } catch {
      return [];
    }
  });
}

function zed(): Recent[] {
  return dirs(`${HOME}/.local/share/zed/db`).flatMap((dir) => {
    const db = open(`${dir}/db.sqlite`);
    if (!db) return [];
    try {
      const rows = db.prepare("SELECT * FROM workspaces").all() as Record<string, unknown>[];
      return rows.flatMap((row) => {
        const opened = Date.parse(String(row.timestamp ?? "")) || 0;
        const columns = Object.keys(row).filter((k) => /paths/.test(k));
        return columns.flatMap((k) => zedPaths(row[k])).map((path) => ({
          path,
          opened,
          editor: "Zed",
          command: "zed",
        }));
      });
    } catch {
      return [];
    } finally {
      db.close();
    }
  });
}

/** Git repositories one or two levels below the usual folders. */
function gitFolders(editor: string): Recent[] {
  const found: string[] = [];
  for (const root of FOLDERS.map((f) => `${HOME}/${f}`)) {
    for (const dir of dirs(root)) {
      if (isDir(`${dir}/.git`)) found.push(dir);
      else found.push(...dirs(dir).filter((d) => isDir(`${d}/.git`)));
    }
  }
  const names: Record<string, string> = { code: "VS Code", codium: "VSCodium", cursor: "Cursor", zed: "Zed" };
  return found.map((path) => ({ path, opened: 0, editor: names[editor] ?? editor, command: editor }));
}

/** Every project, most recently opened first; folders that no longer exist are dropped. */
export function projects(editor: string): Recent[] {
  // Editors first, so a project keeps the editor it was opened with.
  const fromEditors = merge([...vscode(), ...jetbrains(), ...zed()]);
  const known = new Set(fromEditors.map((r) => r.path));
  const all = [...fromEditors, ...gitFolders(editor).filter((r) => !known.has(r.path))];
  return all.filter((r) => isDir(r.path) || r.path.endsWith(".code-workspace"))
    .sort((a, b) => b.opened - a.opened);
}
