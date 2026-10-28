import {
  type Action,
  action,
  close,
  type Color,
  type Context,
  copy,
  Icons,
  type Item,
  list,
  meta,
  refresh,
  submenu,
  updateCommandMetadata,
} from "@backslash/api";
import {
  FLATPAK_COLUMNS,
  type Manager,
  MANAGERS,
  ORDER,
  parseApt,
  parseCheckupdates,
  parseDnf,
  parseDnfSecurity,
  parseFlatpak,
  parseFwupd,
  parseRpmVersions,
  parseSnap,
  parseZypper,
  plural,
  size,
  TERMINAL_ARGS,
  terminalOrder,
  terminalScript,
  type Update,
  updateAllCommand,
  updateOneCommand,
} from "../lib.ts";

interface Prefs {
  terminal?: string;
}

interface Output {
  code: number;
  stdout: string;
  stderr: string;
}

/** Runs a program, whatever its exit code (dnf says 100 and checkupdates 2 for "updates" and "none"). */
async function run(program: string, args: string[], signal: AbortSignal, timeout = 180_000): Promise<Output> {
  const { code, stdout, stderr } = await new Deno.Command(program, {
    args,
    stdin: "null",
    stdout: "piped",
    stderr: "piped",
    env: { LC_ALL: "C.UTF-8" },
    signal: AbortSignal.any([signal, AbortSignal.timeout(timeout)]),
  }).output();
  const text = (b: Uint8Array) => new TextDecoder().decode(b);
  return { code, stdout: text(stdout), stderr: text(stderr).trim() };
}

class CheckError extends Error {
  constructor(message: string, readonly hint?: string) {
    super(message);
  }
}

function fail(o: Output, program: string): never {
  throw new CheckError(
    o.stderr.split("\n").filter((l) => !/^WARNING: apt does not/.test(l)).join("\n") ||
      `${program} exited with ${o.code}`,
  );
}

const CHECKS: Record<Manager, (signal: AbortSignal) => Promise<Update[]>> = {
  async apt(signal) {
    const o = await run("apt", ["list", "--upgradable"], signal);
    if (o.code !== 0) fail(o, "apt");
    return parseApt(o.stdout);
  },
  async dnf(signal) {
    const o = await run("dnf", ["check-update", "-q"], signal);
    if (o.code !== 0 && o.code !== 100) fail(o, "dnf");
    const updates = parseDnf(o.stdout);
    if (!updates.length) return updates;
    const [security, installed] = await Promise.all([
      run("dnf", ["updateinfo", "list", "--security", "-q"], signal).then((s) => parseDnfSecurity(s.stdout))
        .catch(() => new Set<string>()),
      run(
        "rpm",
        ["-q", "--qf", "%{NAME}.%{ARCH} %{VERSION}-%{RELEASE}\\n", ...new Set(updates.map((u) => u.name))],
        signal,
      )
        .then((r) => parseRpmVersions(r.stdout)).catch(() => new Map<string, string>()),
    ]);
    return updates.map((u) => ({
      ...u,
      security: security.has(u.name),
      from: installed.get(`${u.name}.${u.arch}`) ?? installed.get(`${u.name}.noarch`),
    }));
  },
  async pacman(signal) {
    let o: Output;
    try {
      o = await run("checkupdates", [], signal);
    } catch (err) {
      if (err instanceof Deno.errors.NotFound) {
        throw new CheckError(
          "checkupdates is not installed",
          "Install **pacman-contrib** (`sudo pacman -S pacman-contrib`): it checks for updates without touching the system's package database.",
        );
      }
      throw err;
    }
    if (o.code === 2) return [];
    if (o.code !== 0) fail(o, "checkupdates");
    return parseCheckupdates(o.stdout);
  },
  async zypper(signal) {
    const o = await run("zypper", ["-n", "-q", "list-updates"], signal);
    if (o.code !== 0) fail(o, "zypper");
    return parseZypper(o.stdout);
  },
  async flatpak(signal) {
    const [updates, installed] = await Promise.all([
      run("flatpak", ["remote-ls", "--updates", `--columns=${FLATPAK_COLUMNS}`], signal),
      run("flatpak", ["list", "--columns=application,version,branch"], signal),
    ]);
    if (updates.code !== 0) fail(updates, "flatpak");
    return parseFlatpak(updates.stdout, installed.stdout);
  },
  async snap(signal) {
    const [updates, installed] = await Promise.all([
      run("snap", ["refresh", "--list"], signal),
      run("snap", ["list"], signal),
    ]);
    if (updates.code !== 0) fail(updates, "snap");
    return parseSnap(updates.stdout, installed.stdout);
  },
  async fwupd(signal) {
    const o = await run("fwupdmgr", ["get-updates", "--json"], signal, 60_000);
    // 2: nothing to update, or no device fwupd can update.
    if (o.code === 2 || /No updat|no updatable/i.test(o.stderr)) return [];
    if (o.code !== 0) fail(o, "fwupdmgr");
    return parseFwupd(o.stdout);
  },
};

/** Managers installed here: their program starts. */
async function installed(): Promise<Manager[]> {
  const found = await Promise.all(ORDER.map(async (m) => {
    try {
      await run(MANAGERS[m].program, ["--version"], AbortSignal.timeout(10_000), 10_000);
      return true;
    } catch {
      return false;
    }
  }));
  return ORDER.filter((_, i) => found[i]);
}

/** Starts the commands in a terminal window that outlives Backslash. */
function openTerminal(script: string, preferred?: string) {
  const desktop = Deno.env.get("XDG_CURRENT_DESKTOP") ?? "";
  const argv = ["sh", "-c", script];
  for (const term of preferred ? [preferred, ...terminalOrder(desktop)] : terminalOrder(desktop)) {
    try {
      const args = (TERMINAL_ARGS[term] ?? ((a: string[]) => ["-e", ...a]))(argv);
      new Deno.Command(term, { args, stdin: "null", stdout: "null", stderr: "null" }).spawn().unref();
      return term;
    } catch (err) {
      if (!(err instanceof Deno.errors.NotFound || err instanceof Deno.errors.NotCapable)) throw err;
    }
  }
  throw new Error("No terminal found: install one (GNOME Console, Konsole, kitty…) or set it in the preferences");
}

async function isRolling(): Promise<boolean> {
  const os = await Deno.readTextFile("/etc/os-release").catch(() => "");
  return /^ID="?opensuse-tumbleweed"?$/m.test(os) || /^ID="?opensuse-slowroll"?$/m.test(os);
}

function inTerminal(title: string, steps: { title: string; command: string }[], prefs: Prefs, options = {}): Action {
  return action(title, () => {
    openTerminal(terminalScript(steps), prefs.terminal || undefined);
    return close(steps.length === 1 ? `Running ${steps[0].command}` : `Running ${steps.length} updates`);
  }, { icon: Icons.terminal, ...options });
}

const ICONS: Record<string, [string, Color]> = {
  system: [Icons.package, "blue"],
  apps: [Icons.box, "purple"],
  firmware: [Icons.cpu, "orange"],
};

function updateItem(u: Update, updateAll: Action, prefs: Prefs): Item {
  const info = MANAGERS[u.manager];
  const [glyph, tint] = ICONS[info.kind];
  const one = updateOneCommand(u);
  const title = u.label ?? u.name;
  return {
    id: `${u.manager}:${u.name}:${u.arch ?? ""}`,
    title,
    subtitle: u.from ? `${u.from} → ${u.to}` : `→ ${u.to}`,
    icon: u.security ? { source: Icons.shield, tint: "red" } : { source: glyph, tint },
    section: info.title,
    keywords: [u.name, u.manager, info.title, u.source ?? "", ...(u.security ? ["security", "sécurité", "cve"] : [])],
    accessories: [
      ...(u.security ? [{ tag: "Security", color: "red" as const }] : []),
      ...(u.size ? [{ text: size(u.size), tooltip: "Download size" }] : []),
      ...(u.source ? [{ text: u.source, tooltip: "Source" }] : []),
    ],
    detail: {
      stats: [
        { label: "Installed", value: u.from ?? "–" },
        { label: "Available", value: u.to, color: u.security ? "red" : "green" },
      ],
      markdown: u.summary,
      metadata: [
        meta.text(u.manager === "fwupd" ? "Device" : "Package", u.name, { icon: glyph }),
        ...(u.label ? [meta.text("Name", u.label)] : []),
        meta.tags("Kind", [
          { text: info.title, color: tint },
          ...(u.security ? [{ text: "Security fix", color: "red" as const }] : []),
        ]),
        ...(u.source
          ? [meta.text(u.manager === "fwupd" ? "Vendor" : u.manager === "snap" ? "Publisher" : "Source", u.source, {
            icon: Icons.globe,
          })]
          : []),
        ...(u.arch ? [meta.text(u.manager === "flatpak" ? "Branch" : "Architecture", u.arch)] : []),
        ...(u.size ? [meta.text("Download", size(u.size), { icon: Icons.download })] : []),
        meta.separator(),
        meta.text("Command", one ?? updateAllCommand(u.manager), { icon: Icons.terminal }),
      ],
    },
    actions: [
      updateAll,
      ...(one ? [inTerminal(`Update ${title} Only`, [{ title, command: one }], prefs, { section: "Update" })] : []),
      copy(u.name, u.manager === "fwupd" ? "Copy Device Name" : "Copy Package Name", { section: "Copy" }),
      copy(one ?? updateAllCommand(u.manager), "Copy Update Command", { section: "Copy" }),
      action("Check Again", () => refresh(), { icon: Icons.refresh, shortcut: "<Ctrl>r", section: "View" }),
    ],
  };
}

function errorItem(m: Manager, err: unknown): Item {
  const info = MANAGERS[m];
  const message = err instanceof Error ? err.message : String(err);
  const hint = err instanceof CheckError ? err.hint : undefined;
  return {
    id: `${m}:error`,
    title: `${info.title}: could not check`,
    subtitle: message.split("\n")[0].slice(0, 120),
    icon: { source: Icons.alert, tint: "orange" },
    section: info.title,
    detail: {
      markdown: [hint, `\`\`\`\n${message.slice(0, 2000)}\n\`\`\``].filter(Boolean).join("\n\n"),
      metadata: [meta.text("Manager", info.title, { icon: Icons.package })],
    },
    actions: [
      action("Try Again", () => refresh(), { icon: Icons.refresh, shortcut: "<Ctrl>r" }),
      copy(message, "Copy Error", { section: "Copy" }),
    ],
  };
}

function upToDateItem(m: Manager): Item {
  const info = MANAGERS[m];
  return {
    id: `${m}:ok`,
    title: info.title,
    subtitle: "Up to date",
    icon: { source: Icons.done, tint: "green" },
    section: "Up to Date",
    keywords: [m, "up to date", "à jour"],
    detail: {
      metadata: [
        meta.text("Manager", info.title, { icon: Icons.package }),
        meta.text("Status", "Nothing to update", { icon: Icons.check, color: "green" }),
        meta.text("Checked", new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }), {
          icon: Icons.clock,
        }),
      ],
    },
    actions: [action("Check Again", () => refresh(), { icon: Icons.refresh, shortcut: "<Ctrl>r" })],
  };
}

export default async (ctx: Context) => {
  const prefs = ctx.preferences as Prefs;
  const managers = await installed();
  let status = "";

  if (!managers.length) {
    return list({
      empty: {
        title: "No package manager found",
        description: "Backslash knows APT, DNF, Pacman, Zypper, Flatpak, Snap and fwupd",
        icon: Icons.package,
      },
      items: [],
    });
  }

  return list({
    placeholder: "Filter updates…",
    filter: {
      options: [
        { value: "all", title: "All" },
        ...managers.map((m) => ({ value: m, title: MANAGERS[m].title })),
      ],
    },
    empty: { title: "Everything is up to date", icon: Icons.done },
    status: () => status,
    async *items({ filter, signal }) {
      const wanted = filter && filter !== "all" ? managers.filter((m) => m === filter) : managers;
      const rolling = await isRolling();
      const results = new Map<Manager, Update[] | Error>();
      const pending = new Map(
        wanted.map((m) => [
          m,
          CHECKS[m](signal).then(
            (u) => [m, u] as const,
            (e) => [m, e instanceof Error ? e : new Error(String(e))] as const,
          ),
        ]),
      );
      while (pending.size && !signal.aborted) {
        const [m, result] = await Promise.race(pending.values());
        pending.delete(m);
        results.set(m, result);

        const found = [...results].flatMap(([, r]) => (Array.isArray(r) ? r : []));
        const security = found.filter((u) => u.security).length;
        const toUpdate = wanted.filter((x) => Array.isArray(results.get(x)) && (results.get(x) as Update[]).length);
        const steps = toUpdate.map((x) => ({ title: MANAGERS[x].title, command: updateAllCommand(x, rolling) }));
        const updateAll = inTerminal("Update All in Terminal", steps, prefs, { shortcut: "<Ctrl>u" });
        const perManager = submenu(
          "Update Only…",
          toUpdate.map((x) =>
            inTerminal(MANAGERS[x].title, [{ title: MANAGERS[x].title, command: updateAllCommand(x, rolling) }], prefs)
          ),
          { icon: Icons.filter, section: "Update" },
        );

        const waiting = [...pending.keys()].map((x) => MANAGERS[x].title);
        status = [
          found.length ? plural(found.length) : waiting.length ? "" : "Everything is up to date",
          security ? `${security} security` : "",
          waiting.length ? `checking ${waiting.join(", ")}…` : "",
        ].filter(Boolean).join(" · ");
        if (!pending.size && wanted.length === managers.length) {
          updateCommandMetadata({ subtitle: found.length ? plural(found.length) : "Up to date" }).catch(() => {});
        }

        const order = (u: Update) => ORDER.indexOf(u.manager) * 2 + (u.security ? 0 : 1);
        const items: Item[] = [];
        for (const x of wanted) {
          const r = results.get(x);
          if (r instanceof Error) items.push(errorItem(x, r));
        }
        const withActions = (u: Update) => {
          const item = updateItem(u, updateAll, prefs);
          if (toUpdate.length > 1) item.actions = [item.actions![0], perManager, ...item.actions!.slice(1)];
          return item;
        };
        items.push(
          ...found.sort((a, b) => order(a) - order(b) || a.name.localeCompare(b.name)).map(withActions),
          ...wanted.filter((x) => Array.isArray(results.get(x)) && !(results.get(x) as Update[]).length).map(
            upToDateItem,
          ),
        );
        yield items;
      }
    },
  });
};
