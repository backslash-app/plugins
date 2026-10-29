// Bottles and Wine prefixes on disk, and starting their programs so they outlive the launcher.

import {
  type Bottle,
  bottlesApp,
  bottlesCli,
  explainBottlesError,
  parseBottle,
  parseWineDesktop,
  type Prefix,
  prefixArch,
  prefixName,
  scopeArgs,
  type Source,
  type Tool,
  TOOLS,
  type WineApp,
  wineStartArgs,
} from "./lib.ts";

function env(name: string): string | undefined {
  try {
    return Deno.env.get(name) || undefined;
  } catch {
    return undefined;
  }
}

export const HOME = env("HOME") ?? "";

export const BOTTLE_DIRS: { dir: string; source: Source }[] = [
  { dir: `${HOME}/.local/share/bottles/bottles`, source: "native" },
  { dir: `${HOME}/.var/app/com.usebottles.bottles/data/bottles/bottles`, source: "flatpak" },
];
export const PREFIX_DIR = `${HOME}/.local/share/wineprefixes`;
export const WINE_MENU = `${HOME}/.local/share/applications/wine`;

export const tilde = (p: string) => (HOME && p.startsWith(HOME) ? `~${p.slice(HOME.length)}` : p);

// ---------------------------------------------------------------------------
// Reading

export async function bottles(): Promise<{ bottles: Bottle[]; installs: Source[] }> {
  const installs: Source[] = [];
  const found = await Promise.all(BOTTLE_DIRS.map(async ({ dir, source }) => {
    let entries: Deno.DirEntry[];
    try {
      entries = await Array.fromAsync(Deno.readDir(dir));
    } catch {
      return [];
    }
    installs.push(source);
    const list = await Promise.all(
      entries.filter((e) => e.isDirectory).map(async (e) => {
        const yml = await Deno.readTextFile(`${dir}/${e.name}/bottle.yml`).catch(() => "");
        return yml ? parseBottle(yml, `${dir}/${e.name}`, source) : undefined;
      }),
    );
    return list.filter((b): b is Bottle => !!b);
  }));
  const all = found.flat().sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  return { bottles: all, installs };
}

/** Programs Wine put in the menu, recursively (Wine nests them like the Start menu). */
async function wineApps(dir = WINE_MENU, out: WineApp[] = []): Promise<WineApp[]> {
  let entries: Deno.DirEntry[];
  try {
    entries = await Array.fromAsync(Deno.readDir(dir));
  } catch {
    return out;
  }
  await Promise.all(entries.map(async (e) => {
    const path = `${dir}/${e.name}`;
    if (e.isDirectory) await wineApps(path, out);
    else if (e.name.endsWith(".desktop") && !/uninstall/i.test(e.name)) {
      const app = parseWineDesktop(path, await Deno.readTextFile(path).catch(() => ""), HOME);
      if (app) out.push(app);
    }
  }));
  return out;
}

async function prefix(path: string, programs: WineApp[]): Promise<Prefix | undefined> {
  const reg = await Deno.readTextFile(`${path}/system.reg`).catch(() => undefined);
  const known = programs.filter((p) => p.prefix === path);
  if (reg === undefined && !known.length) return undefined;
  const info = await Deno.stat(`${path}/system.reg`).catch(() => undefined);
  return {
    path,
    name: prefixName(path, HOME),
    arch: reg ? prefixArch(reg.slice(0, 4096)) : undefined,
    modified: info?.mtime?.getTime(),
    programs: known.sort((a, b) => a.name.localeCompare(b.name)),
  };
}

/** ~/.wine, winetricks' prefixes, and those Wine's menu entries point to (except Bottles'). */
export async function prefixes(): Promise<Prefix[]> {
  const programs = await wineApps();
  const paths = new Set([`${HOME}/.wine`]);
  try {
    for await (const e of Deno.readDir(PREFIX_DIR)) if (e.isDirectory) paths.add(`${PREFIX_DIR}/${e.name}`);
  } catch {
    // No winetricks prefixes.
  }
  for (const p of programs) {
    if (!BOTTLE_DIRS.some((b) => p.prefix.startsWith(b.dir))) paths.add(p.prefix);
  }
  const found = await Promise.all([...paths].map((p) => prefix(p, programs)));
  return found.filter((p): p is Prefix => !!p);
}

// ---------------------------------------------------------------------------
// Running

async function output(program: string, args: string[], timeout = 15_000): Promise<{ code: number; text: string }> {
  try {
    const o = await new Deno.Command(program, {
      args,
      stdin: "null",
      stdout: "piped",
      stderr: "piped",
      signal: AbortSignal.timeout(timeout),
    }).output();
    const d = (b: Uint8Array) => new TextDecoder().decode(b);
    return { code: o.code, text: `${d(o.stdout)}\n${d(o.stderr)}`.trim() };
  } catch (e) {
    if (e instanceof Deno.errors.NotFound || e instanceof Deno.errors.NotCapable) return { code: -1, text: "" };
    throw e;
  }
}

/** Starts a program in its own systemd scope; errors from systemd-run itself are reported. */
async function start(title: string, argv: string[], vars: Record<string, string> = {}, cwd?: string) {
  const o = await output("systemd-run", scopeArgs(title, argv, vars, Date.now(), cwd));
  if (o.code === 0) return;
  if (o.code !== -1) throw new Error(o.text.split("\n").pop() || "systemd-run failed");
  // No systemd user session: start it directly.
  try {
    new Deno.Command(argv[0], {
      args: argv.slice(1),
      env: vars,
      cwd,
      stdin: "null",
      stdout: "null",
      stderr: "null",
    }).spawn().unref();
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) throw new Error(`${argv[0]} is not installed`);
    throw e;
  }
}

/** Checks that bottles-cli (or the Flatpak) is there before starting anything in the background. */
async function checkBottles(source: Source) {
  const probe = source === "flatpak"
    ? await output("flatpak", ["info", "com.usebottles.bottles"])
    : await output("bottles-cli", ["--help"]);
  if (probe.code === -1) {
    throw new Error(
      source === "flatpak" ? "flatpak is not installed" : "bottles-cli was not found: is Bottles installed?",
    );
  }
  if (probe.code !== 0) throw new Error(explainBottlesError(probe.text));
}

export async function runInBottle(b: Bottle, args: string[], title: string) {
  await checkBottles(b.source);
  const cli = bottlesCli(b.source, args);
  await start(title, [cli.program, ...cli.args]);
}

export const bottleTool = (b: Bottle, tool: Tool) =>
  runInBottle(b, ["tools", "-b", b.name, tool], `${TOOLS[tool].title} (${b.name})`);

export async function openBottles(source: Source) {
  const app = bottlesApp(source);
  await start("Bottles", [app.program, ...app.args]);
}

const wineEnv = (p: Prefix | string) => ({ WINEPREFIX: typeof p === "string" ? p : p.path });

export const runInPrefix = (p: Prefix, path: string) =>
  start(
    path.split("/").pop() ?? "Wine",
    ["wine", ...wineStartArgs(path)],
    wineEnv(p),
    path.split("/").slice(0, -1).join("/"),
  );

export const prefixTool = (p: Prefix, tool: Tool) =>
  start(`${TOOLS[tool].title} (${p.name})`, ["wine", ...TOOLS[tool].wine], wineEnv(p));

export const winetricks = (p: Prefix) => start(`Winetricks (${p.name})`, ["winetricks"], wineEnv(p));

/** A Wine menu entry, as the desktop would start it. */
export const runWineApp = (a: WineApp) => start(a.name, ["gio", "launch", a.file]);

/** Stops every program of the prefix (wineserver -k). */
export async function killPrefix(p: Prefix) {
  const o = await new Deno.Command("wineserver", { args: ["-k"], env: wineEnv(p), stdout: "null", stderr: "piped" })
    .output()
    .catch((e) => {
      if (e instanceof Deno.errors.NotFound) throw new Error("wineserver was not found: is Wine installed?");
      throw e;
    });
  if (o.code !== 0 && o.code !== 1) throw new Error(new TextDecoder().decode(o.stderr).trim() || "wineserver failed");
}

export async function hasWine(): Promise<boolean> {
  return (await output("wine", ["--version"], 5000)).code === 0;
}
