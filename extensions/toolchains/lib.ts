// Version managers' outputs, parsed into one shape, and the commands that change them. Tested in lib_test.ts.

import type { Color } from "@backslash/api";

export type Manager = "mise" | "asdf" | "rustup" | "fnm" | "nvm" | "pyenv" | "sdkman";

export const MANAGERS: Record<Manager, { title: string; site: string }> = {
  mise: { title: "mise", site: "https://mise.jdx.dev" },
  asdf: { title: "asdf", site: "https://asdf-vm.com" },
  rustup: { title: "rustup", site: "https://rustup.rs" },
  fnm: { title: "fnm", site: "https://github.com/Schniz/fnm" },
  nvm: { title: "nvm", site: "https://github.com/nvm-sh/nvm" },
  pyenv: { title: "pyenv", site: "https://github.com/pyenv/pyenv" },
  sdkman: { title: "SDKMAN!", site: "https://sdkman.io" },
};

export interface Runtime {
  manager: Manager;
  /** As the manager names it: `node`, `nodejs`, `python`, `stable-x86_64-unknown-linux-gnu`. */
  tool: string;
  version: string;
  /** Used where nothing else says otherwise (global / default). */
  current: boolean;
  installed: boolean;
  /** What asked for it: `~/.config/mise/config.toml`, `~/.tool-versions`, "default"… */
  source?: string;
  requested?: string;
  path?: string;
  /** The newest version, once looked up. */
  latest?: string;
  /** rustup: the toolchain's rustc version. */
  detail?: string;
}

// --- Versions -------------------------------------------------------------------------

const parts = (v: string) => v.replace(/^v/, "").split(/[.+-]/).map((p) => (/^\d+$/.test(p) ? Number(p) : p));

/** Numeric-aware: 3.10.1 > 3.9.12, 22.11.0 > 22.2.0. */
export function compareVersions(a: string, b: string): number {
  const x = parts(a), y = parts(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const p = x[i], q = y[i];
    if (p === undefined) return typeof q === "number" ? -1 : 1;
    if (q === undefined) return typeof p === "number" ? 1 : -1;
    if (p === q) continue;
    if (typeof p === "number" && typeof q === "number") return p - q;
    if (typeof p === "number") return 1;
    if (typeof q === "number") return -1;
    return String(p).localeCompare(String(q));
  }
  return 0;
}

/** Final releases only (no -rc, -beta, dev), newest first. */
export function stableVersions(lines: string[]): string[] {
  return [...new Set(lines.map((l) => l.trim().split(/\s+/)[0]).filter((v) => /^v?\d+(\.\d+)*$/.test(v ?? "")))]
    .sort((a, b) => compareVersions(b, a));
}

export const isNewer = (latest: string | undefined, version: string) =>
  !!latest && /^v?\d/.test(version) && compareVersions(latest, version) > 0;

// --- mise -----------------------------------------------------------------------------

interface MiseEntry {
  version: string;
  requested_version?: string;
  install_path?: string;
  source?: { type?: string; path?: string };
  installed?: boolean;
  active?: boolean;
}

/** `mise ls --json`. */
export function parseMiseLs(json: string, home = ""): Runtime[] {
  const data = JSON.parse(json || "{}") as Record<string, MiseEntry[]>;
  return Object.entries(data).flatMap(([tool, entries]) =>
    entries.map((e) => ({
      manager: "mise" as const,
      tool,
      version: e.version,
      current: !!e.active,
      installed: e.installed !== false,
      source: e.source?.path ? tildify(e.source.path, home) : undefined,
      requested: e.requested_version,
      path: e.install_path ? tildify(e.install_path, home) : undefined,
    }))
  );
}

/** `mise outdated --json`: tool → newest version. */
export function parseMiseOutdated(json: string): Record<string, string> {
  const data = JSON.parse(json || "{}") as Record<string, { latest?: string }>;
  return Object.fromEntries(Object.entries(data).flatMap(([t, o]) => (o.latest ? [[t, o.latest]] : [])));
}

// --- asdf -----------------------------------------------------------------------------

/** `asdf current`: both the 0.16+ table (with a header) and the older columns. */
export function parseAsdfCurrent(text: string): Record<string, { version: string; source?: string }> {
  const out: Record<string, { version: string; source?: string }> = {};
  for (const line of text.split("\n")) {
    if (/^Name\s+Version/.test(line) || !line.trim()) continue;
    const [tool, version, ...rest] = line.trim().split(/\s+/);
    if (!tool || !version || /^(______|No|Not)/.test(version)) continue;
    const source = rest.join(" ").replace(/\s+(true|false)$/, "").trim();
    out[tool] = { version, source: source && !/^No version/.test(source) ? source : undefined };
  }
  return out;
}

/** `asdf list`: tools at the margin, their versions indented (`*` marks the current one). */
export function parseAsdfList(text: string): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  let tool = "";
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    if (/^\S/.test(line)) {
      tool = line.trim();
      out[tool] = [];
    } else if (tool && !/No versions installed/i.test(line)) {
      out[tool].push(line.trim().replace(/^\*/, ""));
    }
  }
  return out;
}

export function asdfRuntimes(list: string, current: string, home = ""): Runtime[] {
  const cur = parseAsdfCurrent(current);
  return Object.entries(parseAsdfList(list)).flatMap(([tool, versions]) =>
    versions.map((version) => ({
      manager: "asdf" as const,
      tool,
      version,
      current: cur[tool]?.version === version,
      installed: true,
      source: cur[tool]?.version === version && cur[tool].source ? tildify(cur[tool].source!, home) : undefined,
    }))
  );
}

/** `asdf latest --all`: `nodejs  22.11.0  installed`. */
export function parseAsdfLatestAll(text: string): Record<string, string> {
  return Object.fromEntries(
    text.split("\n").map((l) => l.trim().split(/\s+/)).filter((p) => p.length >= 2 && /^\d/.test(p[1]))
      .map((p) => [p[0], p[1]]),
  );
}

/** 0.16 rewrote asdf in Go: `asdf set -u` replaced `asdf global`. */
export function asdfIsGo(versionOutput: string): boolean {
  const m = /(\d+)\.(\d+)/.exec(versionOutput);
  return !!m && (Number(m[1]) > 0 || Number(m[2]) >= 16);
}

// --- rustup ---------------------------------------------------------------------------

/** `rustup toolchain list`: `stable-x86_64-unknown-linux-gnu (active, default)`. */
export function parseRustupList(text: string): { name: string; isDefault: boolean; active: boolean }[] {
  return text.split("\n").map((l) => l.trim()).filter((l) => l && !/^no installed toolchains/i.test(l)).map((l) => {
    const name = l.split(/\s+/)[0];
    const flags = /\(([^)]*)\)/.exec(l)?.[1] ?? "";
    return { name, isDefault: /default/.test(flags), active: /active/.test(flags) };
  });
}

/** `rustc 1.82.0 (f6e511eec 2024-10-15)` → `1.82.0`. */
export const rustcVersion = (out: string) => /rustc (\S+)/.exec(out)?.[1];

/** `stable-x86_64-unknown-linux-gnu` → `stable`. */
export const channel = (toolchain: string) =>
  toolchain.replace(/-(x86_64|aarch64|i686|armv7|riscv64gc|powerpc64le|s390x)-.*$/, "");

/** `rustup check`: toolchain → newer version, when an update is available. */
export function parseRustupCheck(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const m = /^(\S+) - Update available : .*-> (\S+)/.exec(line.trim());
    if (m) out[m[1]] = m[2];
  }
  return out;
}

// --- Node: fnm, nvm -------------------------------------------------------------------

/** `fnm list`: `* v22.11.0 default`. */
export function parseFnmList(text: string): Runtime[] {
  return text.split("\n").map((l) => l.trim().replace(/^\*\s*/, "")).filter((l) => /^v\d/.test(l)).map((l) => {
    const [version, ...aliases] = l.split(/[\s,]+/);
    return {
      manager: "fnm" as const,
      tool: "node",
      version,
      current: aliases.includes("default"),
      installed: true,
      source: aliases.length ? aliases.join(", ") : undefined,
    };
  });
}

/** nvm's default alias (`22`, `lts/*`, `v22.11.0`, `node`) → the installed version it means. */
export function resolveNvmAlias(alias: string, installed: string[], ltsNames: string[] = []): string | undefined {
  const a = alias.trim().replace(/^v/, "");
  const sorted = [...installed].sort((x, y) => compareVersions(y, x));
  if (!a) return undefined;
  if (a === "node" || a === "stable") return sorted[0];
  if (a.startsWith("lts/")) {
    // lts/* or lts/iron: the newest even major among the installed ones.
    return sorted.find((v) => Number(parts(v)[0]) % 2 === 0) ?? (ltsNames.length ? undefined : sorted[0]);
  }
  return sorted.find((v) => {
    const plain = v.replace(/^v/, "");
    return plain === a || plain.startsWith(`${a}.`);
  });
}

export function nvmRuntimes(installed: string[], alias: string): Runtime[] {
  const def = resolveNvmAlias(alias, installed);
  return [...installed].sort((x, y) => compareVersions(y, x)).map((version) => ({
    manager: "nvm" as const,
    tool: "node",
    version,
    current: version === def,
    installed: true,
    source: version === def ? `default → ${alias.trim()}` : undefined,
  }));
}

/** `fnm ls-remote --lts`: `v20.18.0 (Iron)` → newest version. */
export const latestOf = (lines: string) => stableVersions(lines.split("\n"))[0];

// --- pyenv, sdkman --------------------------------------------------------------------

export function pyenvRuntimes(bare: string, global: string): Runtime[] {
  const globals = global.split("\n").map((l) => l.trim()).filter(Boolean);
  return bare.split("\n").map((l) => l.trim()).filter(Boolean).map((version) => ({
    manager: "pyenv" as const,
    tool: "python",
    version,
    current: globals.includes(version),
    installed: true,
    source: globals.includes(version) ? "pyenv global" : undefined,
  }));
}

export function sdkmanRuntimes(candidates: Record<string, { versions: string[]; current?: string }>): Runtime[] {
  return Object.entries(candidates).flatMap(([tool, c]) =>
    c.versions.sort((x, y) => compareVersions(y, x)).map((version) => ({
      manager: "sdkman" as const,
      tool,
      version,
      current: version === c.current,
      installed: true,
      source: version === c.current ? "default" : undefined,
    }))
  );
}

// --- Commands -------------------------------------------------------------------------

export type Op = "install" | "use" | "uninstall" | "update";

const q = (arg: string) => /^[\w@%+=:,./-]+$/.test(arg) ? arg : `'${arg.replace(/'/g, `'\\''`)}'`;

/** The shell command doing `op` for a tool and version, or undefined when the manager can't. */
export function command(
  manager: Manager,
  op: Op,
  tool: string,
  version: string,
  options: { asdfGo?: boolean } = {},
): string | undefined {
  const t = q(tool), v = q(version);
  switch (manager) {
    case "mise":
      return {
        install: `mise install ${t}@${v}`,
        use: `mise use --global ${t}@${v}`,
        uninstall: `mise uninstall ${t}@${v}`,
        update: `mise upgrade ${t}`,
      }[op];
    case "asdf":
      return {
        install: `asdf install ${t} ${v}`,
        use: options.asdfGo ? `asdf set -u ${t} ${v}` : `asdf global ${t} ${v}`,
        uninstall: `asdf uninstall ${t} ${v}`,
        update: `asdf install ${t} latest`,
      }[op];
    case "rustup":
      return {
        install: `rustup toolchain install ${v}`,
        use: `rustup default ${v}`,
        uninstall: `rustup toolchain uninstall ${v}`,
        update: `rustup update ${v}`,
      }[op];
    case "fnm":
      return {
        install: `fnm install ${v}`,
        use: `fnm default ${v}`,
        uninstall: `fnm uninstall ${v}`,
        update: "fnm install --lts",
      }[op];
    case "nvm": {
      const nvm = (args: string) => `. "\${NVM_DIR:-$HOME/.nvm}/nvm.sh" && nvm ${args}`;
      return {
        install: nvm(`install ${v}`),
        use: nvm(`alias default ${v}`),
        uninstall: nvm(`uninstall ${v}`),
        update: nvm("install --lts --reinstall-packages-from=current"),
      }[op];
    }
    case "pyenv":
      return {
        install: `pyenv install ${v}`,
        use: `pyenv global ${v}`,
        uninstall: `pyenv uninstall -f ${v}`,
        update: undefined,
      }[op];
    case "sdkman": {
      const sdk = (args: string) => `. "\${SDKMAN_DIR:-$HOME/.sdkman}/bin/sdkman-init.sh" && sdk ${args}`;
      return {
        install: sdk(`install ${t} ${v}`),
        use: sdk(`default ${t} ${v}`),
        uninstall: sdk(`uninstall ${t} ${v}`),
        update: sdk(`upgrade ${t}`),
      }[op];
    }
  }
}

/** The script a terminal runs: the command, how it went, then wait for Enter. */
export function terminalScript(title: string, line: string): string {
  return [
    `printf '\\033[1m==> %s\\033[0m\\n' ${q(title)}`,
    `printf '\\033[2m$ %s\\033[0m\\n' ${q(line)}`,
    line,
    "code=$?",
    `if [ "$code" = 0 ]; then printf '\\n\\033[32mDone.\\033[0m '; else printf '\\n\\033[31mFailed (%s).\\033[0m ' "$code"; fi`,
    "printf 'Press Enter to close…'; read -r _",
  ].join("\n");
}

// --- Display --------------------------------------------------------------------------

const TOOLS: Record<string, { name: string; color: Color }> = {
  node: { name: "Node.js", color: "green" },
  nodejs: { name: "Node.js", color: "green" },
  python: { name: "Python", color: "blue" },
  ruby: { name: "Ruby", color: "red" },
  go: { name: "Go", color: "teal" },
  golang: { name: "Go", color: "teal" },
  rust: { name: "Rust", color: "orange" },
  java: { name: "Java", color: "orange" },
  kotlin: { name: "Kotlin", color: "purple" },
  gradle: { name: "Gradle", color: "teal" },
  maven: { name: "Maven", color: "red" },
  deno: { name: "Deno", color: "gray" },
  bun: { name: "Bun", color: "pink" },
  erlang: { name: "Erlang", color: "red" },
  elixir: { name: "Elixir", color: "purple" },
  php: { name: "PHP", color: "purple" },
  zig: { name: "Zig", color: "orange" },
  terraform: { name: "Terraform", color: "purple" },
  kubectl: { name: "kubectl", color: "blue" },
  scala: { name: "Scala", color: "red" },
  dotnet: { name: ".NET", color: "purple" },
  lua: { name: "Lua", color: "blue" },
  pnpm: { name: "pnpm", color: "orange" },
  uv: { name: "uv", color: "purple" },
};

export function toolInfo(r: Pick<Runtime, "manager" | "tool">): { name: string; color: Color } {
  if (r.manager === "rustup") return { name: `Rust ${channel(r.tool)}`, color: "orange" };
  const key = r.tool.replace(/^(core|aqua|ubi|cargo|npm|pipx|go|asdf|vfox):/, "").split("/").pop() ?? r.tool;
  return TOOLS[key] ?? { name: key, color: "gray" };
}

export const tildify = (path: string, home: string) =>
  home && (path === home || path.startsWith(`${home}/`)) ? `~${path.slice(home.length)}` : path;

/** Current versions first, then newest first, by tool. */
export function sortRuntimes(list: Runtime[]): Runtime[] {
  return [...list].sort((a, b) =>
    a.tool.localeCompare(b.tool) || Number(b.current) - Number(a.current) || compareVersions(b.version, a.version)
  );
}
