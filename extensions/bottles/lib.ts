// Bottles' bottle.yml files, Wine prefixes and Wine's menu entries, and the command lines
// that run programs in them. Pure, tested in lib_test.ts.

// deno-lint-ignore no-import-prefix
import { parse } from "jsr:@std/yaml@^1";

export const FLATPAK_ID = "com.usebottles.bottles";

export type Source = "native" | "flatpak";

export interface Program {
  id: string;
  name: string;
  executable: string;
  /** Unix path of the .exe. */
  path: string;
  arguments?: string;
  folder?: string;
}

export interface Bottle {
  name: string;
  /** The bottle's folder (its Wine prefix). */
  dir: string;
  source: Source;
  runner?: string;
  arch?: string;
  environment?: string;
  dxvk?: string;
  vkd3d?: string;
  nvapi?: string;
  versioning: boolean;
  created?: string;
  updated?: string;
  programs: Program[];
  /** Variables set for every program of the bottle. */
  variables: Record<string, string>;
}

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);

/** A bottle.yml, written by Bottles 2022+ (keys in Title_Case). Undefined when it isn't one. */
export function parseBottle(yaml: string, dir: string, source: Source): Bottle | undefined {
  let doc: Record<string, unknown>;
  try {
    const parsed = parse(yaml);
    if (!parsed || typeof parsed !== "object") return undefined;
    doc = parsed as Record<string, unknown>;
  } catch {
    return undefined;
  }
  const name = str(doc.Name) ?? dir.split("/").pop();
  if (!name) return undefined;
  const params = (doc.Parameters ?? {}) as Record<string, unknown>;
  const programs = Object.entries((doc.External_Programs ?? {}) as Record<string, Record<string, unknown>>)
    .flatMap(([id, p]): Program[] => {
      if (!p || typeof p !== "object" || p.removed === true) return [];
      const path = str(p.path);
      const executable = str(p.executable) ?? path?.split("/").pop();
      const programName = str(p.name) ?? executable?.replace(/\.exe$/i, "");
      if (!programName || !executable) return [];
      return [{
        id: str(p.id) ?? id,
        name: programName,
        executable,
        path: path ?? "",
        arguments: str(p.arguments),
        folder: str(p.folder),
      }];
    })
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  const variables: Record<string, string> = {};
  for (const [k, v] of Object.entries((doc.Environment_Variables ?? {}) as Record<string, unknown>)) {
    if (typeof v === "string" || typeof v === "number") variables[k] = String(v);
  }
  const custom = doc.Custom_Path === true ? str(doc.Path) : undefined;
  return {
    name,
    dir: custom ?? dir,
    source,
    runner: str(doc.Runner),
    arch: str(doc.Arch),
    environment: str(doc.Environment),
    dxvk: params.dxvk === false ? undefined : str(doc.DXVK),
    vkd3d: params.vkd3d === false ? undefined : str(doc.VKD3D),
    nvapi: params.dxvk_nvapi === true ? str(doc.NVAPI) : undefined,
    versioning: doc.Versioning === true,
    created: str(doc.Creation_Date),
    updated: str(doc.Update_Date),
    programs,
    variables,
  };
}

/** bottles-cli, natively or inside the Flatpak. */
export function bottlesCli(source: Source, args: string[]): { program: string; args: string[] } {
  return source === "flatpak"
    ? { program: "flatpak", args: ["run", "--command=bottles-cli", FLATPAK_ID, ...args] }
    : { program: "bottles-cli", args };
}

export const runProgramArgs = (b: Bottle, p: Program) => ["run", "-b", b.name, "-p", p.name];
export const runExeArgs = (b: Bottle, path: string) => ["run", "-b", b.name, "-e", path];

/** Wine's own tools, as bottles-cli names them, and what to run with plain Wine. */
export const TOOLS = {
  winecfg: { title: "Wine Configuration", wine: ["winecfg"] },
  explorer: { title: "File Explorer", wine: ["explorer"] },
  uninstaller: { title: "Uninstaller", wine: ["uninstaller"] },
  regedit: { title: "Registry Editor", wine: ["regedit"] },
  taskmgr: { title: "Task Manager", wine: ["taskmgr"] },
  control: { title: "Control Panel", wine: ["control"] },
  cmd: { title: "Command Prompt", wine: ["wineconsole", "cmd"] },
} as const;

export type Tool = keyof typeof TOOLS;

export const toolArgs = (b: Bottle, tool: Tool) => ["tools", "-b", b.name, tool];

/** The Bottles app itself. */
export const bottlesApp = (source: Source) =>
  source === "flatpak" ? { program: "flatpak", args: ["run", FLATPAK_ID] } : { program: "bottles", args: [] };

/** "2026-03-14 18:22:51.123456" → "2026-03-14". */
export const day = (date?: string) => date?.match(/^\d{4}-\d{2}-\d{2}/)?.[0];

/** "soda-7.0-9" → "Soda 7.0-9", "caffe-9.7" → "Caffe 9.7", "sys-wine-9.0" → "System Wine 9.0". */
export function runnerName(runner?: string): string {
  if (!runner) return "Unknown";
  const m = runner.match(/^(sys-wine|[a-z]+(?:-[a-z]+)*)-(\d.*)$/i);
  if (!m) return runner;
  const name = m[1] === "sys-wine"
    ? "System Wine"
    : m[1].split("-").map((w) => w === "ge" ? "GE" : w[0].toUpperCase() + w.slice(1)).join("-");
  return `${name} ${m[2]}`;
}

// ---------------------------------------------------------------------------
// Plain Wine prefixes

export interface Prefix {
  path: string;
  name: string;
  arch?: "win64" | "win32";
  /** Last time Wine updated the prefix (system.reg's mtime). */
  modified?: number;
  programs: WineApp[];
}

/** "#arch=win64" near the top of system.reg. */
export function prefixArch(systemReg: string): Prefix["arch"] {
  const m = systemReg.match(/^#arch=(win64|win32)/m);
  return m ? m[1] as Prefix["arch"] : undefined;
}

/** ~/.wine is "Default"; winetricks' prefixes are named after their folder. */
export function prefixName(path: string, home: string): string {
  if (path === `${home}/.wine`) return "Default (~/.wine)";
  return path.split("/").filter(Boolean).pop() ?? path;
}

export interface WineApp {
  name: string;
  file: string;
  prefix: string;
  icon?: string;
  comment?: string;
}

/**
 * A menu entry Wine created when a Windows program was installed:
 * `Exec=env WINEPREFIX="/home/ada/.wine" wine C:\\\\ProgramData\\\\…\\\\App.lnk`.
 */
export function parseWineDesktop(file: string, text: string, home: string): WineApp | undefined {
  const field = (k: string) => text.match(new RegExp(`^${k}\\s*=\\s*(.*)$`, "m"))?.[1]?.trim();
  const exec = field("Exec");
  const name = field("Name");
  if (!exec || !name || !/\bwine(64)?\b/.test(exec) || field("NoDisplay") === "true") return undefined;
  const prefix = exec.match(/WINEPREFIX="([^"]+)"/)?.[1] ?? exec.match(/WINEPREFIX=(\S+)/)?.[1] ?? `${home}/.wine`;
  return { name, file, prefix: prefix.replace(/\/+$/, ""), icon: field("Icon"), comment: field("Comment") };
}

// ---------------------------------------------------------------------------
// Running a Windows program

/** A path from the clipboard: quotes, file:// URLs and ~ are handled. Undefined when it isn't one. */
export function pathFromClipboard(text: string, home: string): string | undefined {
  let t = text.trim().split("\n")[0].trim().replace(/^["']|["']$/g, "");
  if (t.startsWith("file://")) {
    try {
      t = decodeURIComponent(new URL(t).pathname);
    } catch {
      return undefined;
    }
  }
  if (t.startsWith("~/")) t = `${home}${t.slice(1)}`;
  return t.startsWith("/") ? t : undefined;
}

export const isWindowsProgram = (path: string) => /\.(exe|msi|bat|cmd|lnk|com)$/i.test(path);

/** `wine start /unix` runs .exe, .msi, .bat and .lnk alike, from a Unix path. */
export const wineStartArgs = (path: string) => ["start", "/unix", path];

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "app";

/**
 * systemd-run arguments: the program runs in its own scope and outlives the launcher.
 * `/usr/bin/env` finds the program on PATH, whatever systemd's version.
 */
export function scopeArgs(
  title: string,
  argv: string[],
  env: Record<string, string> = {},
  stamp = Date.now(),
  cwd?: string,
): string[] {
  return [
    "--user",
    "--collect",
    "--quiet",
    `--unit=app-backslash-wine-${slug(title)}-${stamp}`,
    `--description=${title}`,
    ...(cwd ? [`--working-directory=${cwd}`] : []),
    ...Object.entries(env).map(([k, v]) => `--setenv=${k}=${v}`),
    "--",
    "/usr/bin/env",
    ...argv,
  ];
}

const quote = (arg: string) => /^[\w@%+=:,./-]+$/.test(arg) ? arg : `'${arg.replace(/'/g, `'\\''`)}'`;
export const shellLine = (argv: string[]) => argv.map(quote).join(" ");

/** The command to type in a terminal for the same thing. */
export function commandText(program: string, args: string[], env: Record<string, string> = {}): string {
  const vars = Object.entries(env).map(([k, v]) => `${k}=${quote(v)}`);
  return [...vars, shellLine([program, ...args])].join(" ");
}

/** bottles-cli's errors, as a sentence. */
export function explainBottlesError(text: string): string {
  if (/Bottle .* not found|not found in bottles/i.test(text)) {
    return "Bottles doesn't know this bottle: open Bottles once";
  }
  if (/Program .* not found/i.test(text)) return "Bottles doesn't know this program any more";
  if (/error: app\/com\.usebottles\.bottles.*not installed/i.test(text)) return "The Bottles Flatpak is not installed";
  return text.split("\n").map((l) => l.trim()).filter(Boolean).pop() ?? "Bottles failed";
}

export const INSTALL_BOTTLES = "flatpak install flathub com.usebottles.bottles";
