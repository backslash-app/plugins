import {
  type Action,
  action,
  close,
  type Color,
  type Context,
  copy,
  detail,
  Icons,
  type Item,
  list,
  type ListSpec,
  meta,
  type Metadata,
  updateCommandMetadata,
} from "@backslash/api";
import {
  type Boot,
  codeBlock,
  duration,
  type Entry,
  FIELDS,
  firstLine,
  fullTime,
  type Group,
  groupEntries,
  logLine,
  mergeEntries,
  orderGroups,
  parseBoots,
  parseJournal,
  plural,
  PRIORITIES,
  shortTime,
  shortUnit,
  sourceArgs,
} from "../lib.ts";
import { runInTerminal, shellLine } from "../terminal.ts";

interface Prefs {
  terminal?: string;
}

/** Entries read per journal, newest first: enough for a boot's problems without stalling. */
const LIMIT = 3000;
/** Rows shown at most; repeated messages are already folded into one. */
const MAX_ROWS = 400;

interface Run {
  out: string;
  err: string;
  ok: boolean;
}

class NoJournal extends Error {}

/** journalctl with its stderr, which carries the "you are not seeing all messages" hint. */
async function journalctl(args: string[], signal?: AbortSignal): Promise<Run> {
  try {
    const { code, stdout, stderr } = await new Deno.Command("journalctl", {
      args: ["--no-pager", ...args],
      stdin: "null",
      stdout: "piped",
      stderr: "piped",
      signal,
    }).output();
    const dec = new TextDecoder();
    return { out: dec.decode(stdout), err: dec.decode(stderr), ok: code === 0 };
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) throw new NoJournal("journalctl not found");
    throw err;
  }
}

interface Load {
  entries: Entry[];
  /** Only the user's own logs could be read. */
  partial: boolean;
}

/** System (when readable) and user journals of one boot, within a priority range. */
async function load(boot: string, priority: string, signal?: AbortSignal): Promise<Load> {
  const args = ["-b", boot, "-p", priority, "-o", "json", "-n", String(LIMIT), `--output-fields=${FIELDS.join(",")}`];
  const [system, user] = await Promise.all([
    journalctl(args, signal),
    journalctl(["--user", ...args], signal).catch((err) => {
      if (err instanceof NoJournal) throw err;
      return { out: "", err: "", ok: false };
    }),
  ]);
  const partial = /not seeing messages from other users and the system|insufficient permissions/i.test(system.err);
  if (!system.ok && !user.ok && !system.out && /no such boot|specifies boot id|not found/i.test(system.err)) {
    return { entries: [], partial };
  }
  return { entries: mergeEntries(parseJournal(system.out), parseJournal(user.out)), partial };
}

// --- Views ---------------------------------------------------------------------

function priorityTag(p: number): { text: string; color: Color } {
  return {
    text: PRIORITIES[p] ?? `Priority ${p}`,
    color: p <= 2 ? "red" : p === 3 ? "red" : p === 4 ? "orange" : "gray",
  };
}

function unitLogs(e: Entry, boot: string, prefs: Prefs) {
  const src = sourceArgs(e);
  const name = e.transport === "kernel" ? "Kernel" : e.unit ?? e.identifier ?? e.comm ?? "Logs";
  return detail({
    title: `${name} — last 200 lines`,
    async markdown({ signal }) {
      const run = await journalctl([...src, "-b", boot, "-n", "200", "-o", "short-iso"], signal);
      const text = run.out.trim() || run.err.trim() || "No lines.";
      return codeBlock(text);
    },
    metadata: [
      meta.text("Source", name, { icon: Icons.server }),
      meta.text("Boot", boot === "0" ? "Current" : boot === "-1" ? "Previous" : boot),
      meta.text("Command", `journalctl ${shellLine([...src, "-b", boot, "-n", "200"])}`, { icon: Icons.terminal }),
    ],
    actions: [
      follow(e, prefs),
      copy(`journalctl ${shellLine([...src, "-b", boot])}`, "Copy journalctl Command", { section: "Copy" }),
    ],
  });
}

function follow(e: Entry, prefs: Prefs): Action {
  const argv = ["journalctl", "-f", "-n", "50", ...sourceArgs(e)];
  return action("Follow in Terminal", () => {
    const term = runInTerminal(argv, prefs.terminal || undefined);
    return close(`Following in ${term}`);
  }, { icon: Icons.terminal, shortcut: "<Ctrl>t" });
}

function groupItem(g: Group, boot: string, prefs: Prefs): Item {
  const e = g.latest;
  const tag = priorityTag(g.priority);
  const name = shortUnit(g.source);
  const metadata: Metadata[] = [
    meta.tags("Priority", [tag]),
    meta.text("Unit", e.unit ?? "–", { icon: Icons.server }),
    ...(e.identifier && e.identifier !== shortUnit(e.unit ?? "") ? [meta.text("Identifier", e.identifier)] : []),
    ...(e.userUnit ? [meta.text("Journal", "Your user session", { icon: Icons.person })] : []),
    meta.separator(),
    meta.text("Time", fullTime(e.time), { icon: Icons.clock }),
    ...(g.count > 1
      ? [
        meta.text("Occurrences", `${g.count}×`, { icon: Icons.repeat }),
        meta.text("First", fullTime(g.first)),
      ]
      : []),
    ...(g.pids.length ? [meta.text(g.pids.length > 1 ? "PIDs" : "PID", g.pids.slice(0, 6).join(", "))] : []),
    ...(e.exe ? [meta.text("Executable", e.exe, { icon: Icons.terminal })] : []),
    ...(e.cmdline && e.cmdline !== e.exe ? [meta.text("Command line", e.cmdline)] : []),
    ...(e.uid !== undefined ? [meta.text("User ID", e.uid)] : []),
    ...(e.hostname ? [meta.text("Host", e.hostname)] : []),
  ];
  return {
    id: g.key,
    title: firstLine(e.message) || "(empty message)",
    icon: { source: g.priority <= 2 ? Icons.urgent : Icons.alert, tint: tag.color },
    section: name,
    keywords: [g.source, e.identifier ?? "", e.comm ?? "", tag.text, String(e.pid ?? "")],
    accessories: [
      ...(g.count > 1 ? [{ tag: `×${g.count}`, color: tag.color, tooltip: `${g.count} times this boot` }] : []),
      { text: shortTime(e.time), tooltip: fullTime(e.time) },
    ],
    detail: { markdown: codeBlock(e.message), metadata },
    actions: [
      action(`Show ${name} Logs`, () => unitLogs(e, boot, prefs), { icon: Icons.text }),
      follow(e, prefs),
      copy(e.message, "Copy Message", { shortcut: "<Ctrl><Shift>c", section: "Copy" }),
      copy(logLine(e), "Copy Log Line", { section: "Copy" }),
      copy(`journalctl ${shellLine([...sourceArgs(e), "-b", boot])}`, "Copy journalctl Command", {
        icon: Icons.terminal,
        section: "Copy",
      }),
    ],
  };
}

const permissionItem: Item = {
  id: "permission",
  title: "Only your own logs are shown",
  subtitle: "Join the systemd-journal group to see the system's",
  icon: { source: Icons.lock, tint: "yellow" },
  section: "Note",
  detail: {
    markdown: [
      "Your account can't read the system journal, so services, the kernel and other users are missing.",
      "",
      "Add yourself to the `systemd-journal` group (or `adm` on Debian and Ubuntu), then log out and back in:",
      "",
      codeBlock("sudo usermod -aG systemd-journal $USER"),
    ].join("\n"),
  },
  actions: [copy("sudo usermod -aG systemd-journal $USER", "Copy Command")],
};

const noJournalItem: Item = {
  id: "no-journal",
  title: "journalctl isn't available",
  subtitle: "This system doesn't log with systemd's journal",
  icon: { source: Icons.info, tint: "gray" },
  detail: {
    markdown: [
      "System Logs reads systemd's journal with `journalctl`.",
      "",
      "Distributions without systemd (Alpine, Void, Gentoo with OpenRC, Devuan…) log to text files in `/var/log` instead.",
    ].join("\n"),
  },
};

interface Counts {
  errors: number;
  warnings: number;
}
let counts: Counts = { errors: 0, warnings: 0 };

async function problems(
  boot: string,
  priority: string,
  prefs: Prefs,
  signal: AbortSignal,
  subtitle: boolean,
): Promise<Item[]> {
  let loaded: Load;
  try {
    loaded = await load(boot, priority, signal);
  } catch (err) {
    if (err instanceof NoJournal) return [noJournalItem];
    throw err;
  }
  const { entries, partial } = loaded;
  counts = {
    errors: entries.filter((e) => e.priority <= 3).length,
    warnings: entries.filter((e) => e.priority === 4).length,
  };
  if (subtitle) {
    updateCommandMetadata({
      subtitle: counts.errors ? `${plural(counts.errors, "error")} this boot` : "No errors this boot",
    }).catch(() => {});
  }
  const groups = orderGroups(groupEntries(entries)).slice(0, MAX_ROWS);
  return [...(partial ? [permissionItem] : []), ...groups.map((g) => groupItem(g, boot, prefs))];
}

function bootList(b: Boot, prefs: Prefs): ListSpec {
  const boot = String(b.index);
  return list({
    title: `Problems of ${bootName(b)}`,
    placeholder: "Filter by message, unit, program…",
    empty: { title: "No errors or warnings", icon: Icons.done },
    status: () => `${plural(counts.errors, "error")} · ${plural(counts.warnings, "warning")}`,
    items: ({ signal }) => problems(b.id || boot, "0..4", prefs, signal, false),
  });
}

function bootName(b: Boot): string {
  if (b.index === 0) return "Current boot";
  if (b.index === -1) return "Previous boot";
  return `Boot of ${fullTime(b.first).slice(0, 16)}`;
}

async function boots(prefs: Prefs, signal: AbortSignal): Promise<Item[]> {
  let run: Run;
  try {
    run = await journalctl(["--list-boots", "-o", "json"], signal);
    if (!run.ok || !run.out.trim().startsWith("[")) run = await journalctl(["--list-boots"], signal);
  } catch (err) {
    if (err instanceof NoJournal) return [noJournalItem];
    throw err;
  }
  return parseBoots(run.out).map((b) => ({
    id: `boot:${b.id}`,
    title: bootName(b),
    subtitle: `${fullTime(b.first).slice(0, 16)} → ${
      b.index === 0
        ? "now"
        : fullTime(b.last).slice(0, 10) === fullTime(b.first).slice(0, 10)
        ? fullTime(b.last).slice(11, 16)
        : fullTime(b.last).slice(0, 16)
    }`,
    icon: { source: b.index === 0 ? Icons.power : Icons.history, tint: b.index === 0 ? "green" : "gray" },
    section: "Boots",
    keywords: [b.id, String(b.index)],
    accessories: [{ text: duration((b.index === 0 ? Date.now() : b.last) - b.first), tooltip: "Uptime" }, {
      tag: String(b.index),
      color: "gray",
    }],
    detail: {
      metadata: [
        meta.text("Boot", bootName(b), { icon: Icons.power }),
        meta.text("Started", fullTime(b.first), { icon: Icons.clock }),
        meta.text(b.index === 0 ? "Last entry" : "Ended", fullTime(b.last)),
        meta.text("Lasted", duration(b.last - b.first), { icon: Icons.timer }),
        meta.separator(),
        meta.text("Index", b.index),
        meta.text("Boot ID", b.id),
      ],
    },
    actions: [
      action("Show Errors and Warnings", () => bootList(b, prefs), { icon: Icons.alert }),
      action("Open Full Log in Terminal", () => {
        const term = runInTerminal(["journalctl", "-b", b.id, "-e"], prefs.terminal || undefined);
        return close(`Opened in ${term}`);
      }, { icon: Icons.terminal }),
      copy(b.id, "Copy Boot ID", { section: "Copy" }),
      copy(`journalctl -b ${b.id} -p 0..4`, "Copy journalctl Command", { section: "Copy" }),
    ],
  }));
}

export default (ctx: Context<Record<string, unknown>, Prefs>) =>
  list({
    placeholder: "Filter by message, unit, program…",
    filter: {
      options: [
        { value: "errors", title: "Errors" },
        { value: "warnings", title: "Warnings" },
        { value: "all", title: "All" },
        { value: "previous", title: "Previous Boot" },
        { value: "boots", title: "Boots" },
      ],
      default: "errors",
    },
    empty: { title: "Nothing to worry about", description: "No problems logged in this boot", icon: Icons.done },
    status: (items) => {
      if (items.some((i) => i.section === "Boots")) return plural(items.length, "boot");
      const parts = [];
      if (counts.errors) parts.push(plural(counts.errors, "error"));
      if (counts.warnings) parts.push(plural(counts.warnings, "warning"));
      return parts.join(" · ") || "No problems";
    },
    items: ({ filter, signal }) => {
      const prefs = ctx.preferences;
      switch (filter) {
        case "warnings":
          return problems("0", "4..4", prefs, signal, false);
        case "all":
          return problems("0", "0..4", prefs, signal, true);
        case "previous":
          return problems("-1", "0..4", prefs, signal, false);
        case "boots":
          return boots(prefs, signal);
        default:
          return problems("0", "0..3", prefs, signal, true);
      }
    },
  });
