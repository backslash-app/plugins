// Asking each version manager what it has. A manager that isn't installed is skipped.

import {
  asdfIsGo,
  asdfRuntimes,
  type Manager,
  nvmRuntimes,
  parseAsdfLatestAll,
  parseFnmList,
  parseMiseLs,
  parseMiseOutdated,
  parseRustupCheck,
  parseRustupList,
  pyenvRuntimes,
  type Runtime,
  rustcVersion,
  sdkmanRuntimes,
  stableVersions,
} from "./lib.ts";

export const HOME = Deno.env.get("HOME") ?? "";
const NVM_DIR = Deno.env.get("NVM_DIR") || `${HOME}/.nvm`;
const SDKMAN_DIR = Deno.env.get("SDKMAN_DIR") || `${HOME}/.sdkman`;

export class Missing extends Error {}

/** stdout of a program run from the home folder (where global versions apply). */
export async function run(program: string, args: string[], timeout = 15_000): Promise<string> {
  let out: Deno.CommandOutput;
  try {
    out = await new Deno.Command(program, {
      args,
      cwd: HOME || undefined,
      stdin: "null",
      stdout: "piped",
      stderr: "piped",
      env: { NO_COLOR: "1", MISE_YES: "0" },
      signal: AbortSignal.timeout(timeout),
    }).output();
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) throw new Missing(program);
    throw err;
  }
  const text = (b: Uint8Array) => new TextDecoder().decode(b).trim();
  if (out.code !== 0) throw new Error(`${program} ${args[0]}: ${text(out.stderr) || `exit ${out.code}`}`);
  return text(out.stdout);
}

function dirs(path: string): string[] {
  try {
    return [...Deno.readDirSync(path)].filter((e) => e.isDirectory || e.isSymlink).map((e) => e.name);
  } catch {
    return [];
  }
}

export interface Found {
  manager: Manager;
  runtimes: Runtime[];
  /** The manager's own version line. */
  version?: string;
  error?: string;
  asdfGo?: boolean;
}

const LIST: Record<Manager, () => Promise<Omit<Found, "manager">>> = {
  async mise() {
    const [json, version] = await Promise.all([run("mise", ["ls", "--json"]), run("mise", ["--version"])]);
    return { runtimes: parseMiseLs(json, HOME), version: version.split(" ")[0] };
  },
  async asdf() {
    const version = await run("asdf", ["version"]).catch(() => run("asdf", ["--version"]));
    const [list, current] = await Promise.all([run("asdf", ["list"]), run("asdf", ["current"]).catch(() => "")]);
    return {
      runtimes: asdfRuntimes(list, current, HOME),
      version: version.replace(/^asdf version /, ""),
      asdfGo: asdfIsGo(version),
    };
  },
  async rustup() {
    const [list, version] = await Promise.all([
      run("rustup", ["toolchain", "list"]),
      run("rustup", ["--version"]).catch(() => ""),
    ]);
    const toolchains = parseRustupList(list);
    const versions = await Promise.all(
      toolchains.map((t) =>
        run("rustup", ["run", t.name, "rustc", "--version"]).then(rustcVersion).catch(() => undefined)
      ),
    );
    return {
      version: /rustup (\S+)/.exec(version)?.[1],
      runtimes: toolchains.map((t, i) => ({
        manager: "rustup" as const,
        tool: t.name,
        version: versions[i] ?? t.name.split("-")[0],
        current: t.isDefault,
        installed: true,
        source: t.isDefault ? "default" : t.active ? "active here" : undefined,
        detail: t.name,
      })),
    };
  },
  async fnm() {
    const [list, version] = await Promise.all([run("fnm", ["list"]), run("fnm", ["--version"]).catch(() => "")]);
    return { runtimes: parseFnmList(list), version: version.replace(/^fnm /, "") };
  },
  // nvm is a shell function: its folder says what's installed.
  nvm() {
    const installed = dirs(`${NVM_DIR}/versions/node`).filter((v) => /^v\d/.test(v));
    if (!installed.length && !dirs(NVM_DIR).length) return Promise.reject(new Missing("nvm"));
    let alias = "";
    try {
      alias = Deno.readTextFileSync(`${NVM_DIR}/alias/default`);
    } catch { /* no default */ }
    return Promise.resolve({ runtimes: nvmRuntimes(installed, alias) });
  },
  async pyenv() {
    const [bare, global, version] = await Promise.all([
      run("pyenv", ["versions", "--bare", "--skip-aliases"]).catch(() => run("pyenv", ["versions", "--bare"])),
      run("pyenv", ["global"]).catch(() => ""),
      run("pyenv", ["--version"]).catch(() => ""),
    ]);
    return { runtimes: pyenvRuntimes(bare, global), version: version.replace(/^pyenv /, "") };
  },
  // sdk is a shell function too: candidates are folders, `current` a link.
  sdkman() {
    const root = `${SDKMAN_DIR}/candidates`;
    const names = dirs(root);
    if (!names.length) return Promise.reject(new Missing("sdkman"));
    const candidates: Record<string, { versions: string[]; current?: string }> = {};
    for (const name of names) {
      let current: string | undefined;
      try {
        current = Deno.readLinkSync(`${root}/${name}/current`).split("/").filter(Boolean).pop();
      } catch { /* no default */ }
      const versions = dirs(`${root}/${name}`).filter((v) => v !== "current");
      if (versions.length) candidates[name] = { versions, current };
    }
    return Promise.resolve({ runtimes: sdkmanRuntimes(candidates) });
  },
};

export const ORDER: Manager[] = ["mise", "asdf", "rustup", "fnm", "nvm", "pyenv", "sdkman"];

/** Every installed manager with its runtimes; failures are reported, not thrown. */
export async function detect(): Promise<Found[]> {
  const results = await Promise.all(ORDER.map(async (manager): Promise<Found | undefined> => {
    try {
      return { manager, ...await LIST[manager]() };
    } catch (e) {
      if (e instanceof Missing) return undefined;
      return { manager, runtimes: [], error: e instanceof Error ? e.message : String(e) };
    }
  }));
  return results.filter((r): r is Found => !!r);
}

/** Newest versions of one manager's tools, from the network (`manager:tool` → version). */
export async function latest(f: Found): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const set = (entries: Record<string, string>) => {
    for (const [tool, v] of Object.entries(entries)) out.set(`${f.manager}:${tool}`, v);
  };
  try {
    if (f.manager === "mise") set(parseMiseOutdated(await run("mise", ["outdated", "--json"], 12_000)));
    else if (f.manager === "asdf") set(parseAsdfLatestAll(await run("asdf", ["latest", "--all"], 12_000)));
    else if (f.manager === "rustup") set(parseRustupCheck(await run("rustup", ["check"], 12_000)));
    else if (f.manager === "pyenv") {
      // The list of known versions is local: no network.
      const known = stableVersions((await run("pyenv", ["install", "--list"])).split("\n"));
      const v = known.find((x) => /^3\.\d+\.\d+$/.test(x));
      if (v) set({ python: v });
    }
  } catch { /* offline, or a plugin failing: no "latest" */ }
  return out;
}

/** Versions a manager can install, newest first (for the Install submenu). */
export async function available(manager: Manager, tool: string): Promise<string[]> {
  switch (manager) {
    case "mise":
      return stableVersions((await run("mise", ["ls-remote", tool], 30_000)).split("\n"));
    case "asdf":
      return stableVersions((await run("asdf", ["list", "all", tool], 30_000)).split("\n"));
    case "fnm":
      return stableVersions((await run("fnm", ["ls-remote"], 30_000)).split("\n"));
    case "pyenv":
      return stableVersions((await run("pyenv", ["install", "--list"])).split("\n"));
    default:
      return [];
  }
}
