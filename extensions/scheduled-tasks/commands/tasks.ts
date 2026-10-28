import {
  type Action,
  action,
  type Color,
  copy,
  detail,
  exec,
  Icons,
  type Item,
  list,
  meta,
  type Metadata,
  open,
  refresh,
  toast,
} from "@backslash/api";
import {
  type CronEntry,
  cronLogLines,
  type Crontab,
  dateTime,
  explainCron,
  nextRun,
  parseCron,
  parseCrontab,
  parseShow,
  parseTimerList,
  parseUnitFiles,
  previousRun,
  relative,
  serviceOf,
  terminalScript,
  type TimerProps,
  timerSchedule,
  type TimerTimes,
  toggleEntry,
} from "../lib.ts";
import { runInTerminal } from "../terminal.ts";

type Prefs = { terminal?: string };

const ME = (() => {
  try {
    return Deno.env.get("USER");
  } catch {
    return undefined;
  }
})();

// ---------------------------------------------------------------------------
// Loading

interface UserCrontab {
  text: string;
  tab: Crontab;
  installed: boolean;
}

async function userCrontab(signal: AbortSignal): Promise<UserCrontab> {
  try {
    const text = await exec("crontab", ["-l"], { signal });
    return { text: text + "\n", tab: parseCrontab(text), installed: true };
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) return { text: "", tab: { entries: [], env: {} }, installed: false };
    // "no crontab for <user>" exits with 1.
    if (/no crontab/i.test(String(e))) return { text: "", tab: { entries: [], env: {} }, installed: true };
    throw new Error(`crontab -l failed: ${e instanceof Error ? e.message : e}`);
  }
}

interface SystemFile {
  path: string;
  tab: Crontab;
}

async function systemCrontabs(): Promise<SystemFile[]> {
  const files = ["/etc/crontab"];
  try {
    for await (const f of Deno.readDir("/etc/cron.d")) {
      // cron skips names with dots (backup copies, .placeholder) and ~.
      if (f.isFile && /^[\w-]+$/.test(f.name)) files.push(`/etc/cron.d/${f.name}`);
    }
  } catch {
    // No /etc/cron.d.
  }
  const out = await Promise.all(
    files.sort().map(async (path) => {
      try {
        return { path, tab: parseCrontab(await Deno.readTextFile(path), true) };
      } catch {
        return undefined;
      }
    }),
  );
  return out.filter((f): f is SystemFile => !!f);
}

const PERIODIC = [
  { dir: "/etc/cron.hourly", words: "Every hour" },
  { dir: "/etc/cron.daily", words: "Every day" },
  { dir: "/etc/cron.weekly", words: "Every week" },
  { dir: "/etc/cron.monthly", words: "Every month" },
];

async function periodicScripts(): Promise<{ path: string; words: string }[]> {
  const out: { path: string; words: string }[] = [];
  for (const { dir, words } of PERIODIC) {
    try {
      for await (const f of Deno.readDir(dir)) {
        if (!f.name.startsWith(".") && f.name !== "README" && /^[\w-]+$/.test(f.name)) {
          out.push({ path: `${dir}/${f.name}`, words });
        }
      }
    } catch {
      // Not there.
    }
  }
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

interface Timer extends TimerTimes {
  user: boolean;
  props?: TimerProps;
  state?: string;
}

const SHOW_PROPS =
  "Id,Description,Unit,UnitFileState,ActiveState,Persistent,FragmentPath,TimersCalendar,TimersMonotonic";

async function timers(user: boolean, signal: AbortSignal): Promise<Timer[]> {
  const scope = user ? ["--user"] : [];
  const [listed, files] = await Promise.all([
    exec("systemctl", [...scope, "list-timers", "--all", "--output=json", "--no-pager"], { signal })
      .then(parseTimerList).catch(() => [] as TimerTimes[]),
    exec("systemctl", [...scope, "list-unit-files", "--type=timer", "--output=json", "--no-pager"], { signal })
      .then(parseUnitFiles).catch(() => ({} as Record<string, string>)),
  ]);
  const byUnit = new Map<string, Timer>(listed.map((t) => [t.unit, { ...t, user }]));
  for (const unit of Object.keys(files)) {
    // Templates (foo@.timer) can't run by themselves.
    if (!byUnit.has(unit) && !unit.endsWith("@.timer")) byUnit.set(unit, { unit, user });
  }
  const units = [...byUnit.keys()];
  if (units.length) {
    const shown = await exec("systemctl", [...scope, "show", "-p", SHOW_PROPS, "--", ...units.slice(0, 300)], {
      signal,
    }).then(parseShow).catch(() => [] as TimerProps[]);
    for (const p of shown) {
      const t = byUnit.get(p.id);
      if (t) t.props = p;
    }
  }
  for (const t of byUnit.values()) t.state = t.props?.unitFileState ?? files[t.unit];
  return [...byUnit.values()];
}

// ---------------------------------------------------------------------------
// Actions

function terminal(prefs: Prefs, argv: string[], what: string) {
  return async () => {
    const term = runInTerminal(argv, prefs.terminal?.trim() || undefined);
    await toast(`${what} in ${term}`, { style: "success" });
  };
}

async function systemctl(t: Timer, args: string[]) {
  // System units ask for authentication through polkit when needed.
  try {
    await exec("systemctl", [...(t.user ? ["--user"] : []), ...args]);
  } catch (e) {
    const text = e instanceof Error ? e.message : String(e);
    if (/authentication|access denied|interactive/i.test(text)) {
      throw new Error("Authentication was refused or cancelled");
    }
    throw e;
  }
}

async function journal(t: Timer): Promise<string> {
  const service = serviceOf(t.unit, t.activates ?? t.props?.unit);
  try {
    return await exec("journalctl", [
      ...(t.user ? ["--user"] : []),
      "-u",
      service,
      "-n",
      "150",
      "--no-pager",
      "-o",
      "short-iso",
    ]) || "No logs yet.";
  } catch (e) {
    return `Could not read the logs: ${e instanceof Error ? e.message : e}`;
  }
}

async function cronJournal(command: string): Promise<string> {
  try {
    const out = await exec("journalctl", [
      "--no-pager",
      "-o",
      "short-iso",
      "-n",
      "5000",
      "-t",
      "CRON",
      "-t",
      "CROND",
      "-t",
      "crond",
      "-t",
      "cron",
    ]);
    const lines = cronLogLines(out, command);
    return lines.length
      ? lines.join("\n")
      : "No run of this command in the journal (cron logs may need you in the adm or systemd-journal group).";
  } catch (e) {
    return `Could not read the journal: ${e instanceof Error ? e.message : e}`;
  }
}

// ---------------------------------------------------------------------------
// Rows

const truncate = (s: string, n = 80) => s.length > n ? `${s.slice(0, n - 1)}…` : s;

function timeAccessories(next?: number, last?: number, enabled = true) {
  if (!enabled) return [{ tag: "disabled", color: "gray" as Color }];
  if (next) return [{ text: relative(next), icon: Icons.clock, tooltip: `Next run: ${dateTime(next)}` }];
  if (last) return [{ text: relative(last), icon: Icons.history, tooltip: `Last run: ${dateTime(last)}` }];
  return [];
}

function timeMeta(next?: number, last?: number, lastLabel = "Last run"): Metadata[] {
  return [
    meta.text("Next run", next ? `${dateTime(next)} (${relative(next)})` : "—", { icon: Icons.clock }),
    meta.text(lastLabel, last ? `${dateTime(last)} (${relative(last)})` : "Never", { icon: Icons.history }),
  ];
}

function timerItem(t: Timer, prefs: Prefs): Item {
  const p = t.props;
  const name = t.unit.replace(/\.timer$/, "");
  const service = serviceOf(t.unit, t.activates ?? p?.unit);
  const enabled = t.state !== "disabled" && t.state !== "masked";
  const active = p?.activeState === "active" || (!p && !!t.next);
  const color: Color = !enabled ? "gray" : active ? "green" : "yellow";
  const schedule = p ? timerSchedule(p) : "—";
  const scope = t.user ? ["--user"] : [];
  const scopeName = t.user ? "Your timers" : "System timers";
  const actions: Action[] = [
    action("Run Now", async () => {
      await systemctl(t, ["start", "--no-block", service]);
      await toast(`Started ${service}`, { style: "success" });
      return refresh();
    }, { icon: Icons.play }),
    action("Show Logs", async () => {
      const logs = await journal(t);
      return detail({
        title: service,
        markdown: `\`\`\`\n${logs}\n\`\`\``,
        metadata: [meta.text("Timer", t.unit), meta.text("Schedule", schedule), ...timeMeta(t.next, t.last)],
        status: `${t.user ? "User" : "System"} journal · last 150 lines`,
        actions: [
          copy(logs, "Copy Logs"),
          action(
            "Follow Logs in Terminal",
            terminal(prefs, ["journalctl", ...scope, "-f", "-n", "50", "-u", service], "Logs opened"),
            { icon: Icons.terminal },
          ),
        ],
      });
    }, { icon: Icons.text, shortcut: "<Ctrl>l" }),
    action(
      "Follow Logs in Terminal",
      terminal(prefs, ["journalctl", ...scope, "-f", "-n", "50", "-u", service], "Logs opened"),
      { icon: Icons.terminal, shortcut: "<Ctrl>t", section: "Logs" },
    ),
    enabled
      ? action("Disable Timer", async () => {
        await systemctl(t, ["disable", "--now", t.unit]);
        await toast(`${t.unit} disabled`, { style: "success" });
        return refresh();
      }, {
        icon: Icons.pause,
        destructive: true,
        confirm: `Disable ${t.unit}? It won't run again until you enable it.`,
        shortcut: "<Ctrl>d",
        section: "Timer",
      })
      : action("Enable Timer", async () => {
        await systemctl(t, ["enable", "--now", t.unit]);
        await toast(`${t.unit} enabled`, { style: "success" });
        return refresh();
      }, { icon: Icons.play, shortcut: "<Ctrl>d", section: "Timer" }),
    copy(t.unit, "Copy Timer Name", { section: "Copy" }),
    copy(`systemctl ${t.user ? "--user " : ""}start ${service}`, "Copy Run Command", { section: "Copy" }),
    ...(p?.fragmentPath ? [open(p.fragmentPath, "Open Unit File", { icon: Icons.file, section: "Timer" })] : []),
  ];
  return {
    id: `${t.user ? "user" : "system"}:${t.unit}`,
    title: name,
    subtitle: schedule,
    icon: { source: Icons.timer, tint: color },
    section: scopeName,
    keywords: [service, p?.description ?? "", t.user ? "user" : "system", "systemd", "timer"],
    accessories: timeAccessories(t.next, t.last, enabled),
    detail: {
      markdown: p?.description ? `**${p.description}**` : undefined,
      metadata: [
        meta.text("Schedule", schedule, { icon: Icons.calendar }),
        ...(p?.calendar.length ? [meta.text("OnCalendar", p.calendar.join(" · "))] : []),
        ...(p?.monotonic.length
          ? [meta.text("Timer", p.monotonic.map((m) => `${m.base}=${m.value}`).join(" · "))]
          : []),
        ...timeMeta(t.next, t.last),
        meta.separator(),
        meta.text("Runs", service, { icon: Icons.server }),
        meta.tags("State", [
          { text: t.state ?? "unknown", color: enabled ? "green" : "gray" },
          ...(p?.activeState ? [{ text: p.activeState, color: active ? "green" as Color : "gray" as Color }] : []),
          ...(p?.persistent ? [{ text: "persistent" }] : []),
        ]),
        meta.text("Scope", t.user ? "Your user" : "System (asks for your password to change)", {
          icon: t.user ? Icons.person : Icons.lock,
        }),
        ...(p?.fragmentPath ? [meta.text("Unit file", p.fragmentPath, { icon: Icons.file })] : []),
      ],
    },
    actions,
  };
}

interface CronRow {
  entry: CronEntry;
  /** Undefined for your own crontab. */
  file?: string;
  env: Record<string, string>;
}

function cronItem(row: CronRow, prefs: Prefs, now: Date): Item {
  const { entry, file } = row;
  let words: string, next: number | undefined, last: number | undefined;
  try {
    const s = parseCron(entry.schedule);
    words = explainCron(entry.schedule);
    next = nextRun(s, now)?.getTime();
    last = previousRun(s, now)?.getTime();
  } catch {
    words = entry.schedule;
  }
  const mine = file === undefined;
  const runAs = entry.user ?? ME;
  const terminalArgv = terminalScript(entry.command, entry.user, ME);
  const toggle = (enable: boolean) => async () => {
    // Re-read the crontab right before writing, so a change made meanwhile isn't lost.
    const current = await userCrontab(new AbortController().signal);
    const text = toggleEntry(current.text, entry, enable);
    await exec("crontab", ["-"], { stdin: text });
    await toast(enable ? "Job enabled" : "Job disabled (commented out)", { style: "success" });
    return refresh();
  };
  const actions: Action[] = [
    action(
      mine || runAs === ME ? "Run Now in Terminal" : `Run Now in Terminal as ${runAs}`,
      terminal(prefs, terminalArgv, "Running"),
      { icon: Icons.play },
    ),
    action("Show Logs", async () => {
      const logs = await cronJournal(entry.command);
      return detail({
        title: truncate(entry.note ?? entry.command, 60),
        markdown: `\`\`\`\n${logs}\n\`\`\``,
        metadata: [
          meta.text("Schedule", words),
          meta.text("Expression", entry.schedule),
          ...timeMeta(next, last, "Last scheduled"),
        ],
        status: "Cron's lines in the system journal",
        actions: [copy(logs, "Copy Logs")],
      });
    }, { icon: Icons.text, shortcut: "<Ctrl>l" }),
    ...(mine
      ? [
        entry.enabled
          ? action("Disable Job", toggle(false), {
            icon: Icons.pause,
            destructive: true,
            confirm: "Comment out this line of your crontab?",
            shortcut: "<Ctrl>d",
            section: "Crontab",
          })
          : action("Enable Job", toggle(true), {
            icon: Icons.play,
            confirm: "Uncomment this line of your crontab?",
            shortcut: "<Ctrl>d",
            section: "Crontab",
          }),
        action("Edit Crontab", terminal(prefs, ["crontab", "-e"], "crontab -e opened"), {
          icon: Icons.terminal,
          shortcut: "<Ctrl>e",
          section: "Crontab",
        }),
      ]
      : [open(file!, "Open File", { icon: Icons.file, shortcut: "<Ctrl>o", section: "Crontab" })]),
    copy(entry.command, "Copy Command", { shortcut: "<Ctrl><Shift>c", section: "Copy" }),
    copy(entry.raw.trim().replace(/^#+\s*/, ""), "Copy Crontab Line", { section: "Copy" }),
  ];
  const envLines = Object.entries(row.env).filter(([k]) => ["MAILTO", "SHELL", "PATH", "CRON_TZ", "TZ"].includes(k));
  return {
    id: `${file ?? "user"}:${entry.line}`,
    title: truncate(entry.note ?? entry.command),
    subtitle: words,
    icon: { source: Icons.clock, tint: entry.enabled ? "blue" : "gray" },
    section: mine ? "Your crontab" : file === "/etc/crontab" ? "/etc/crontab" : "/etc/cron.d",
    keywords: [entry.command, entry.schedule, entry.user ?? "", "cron", "crontab", file ?? ""],
    accessories: [
      ...(entry.user && entry.user !== ME ? [{ tag: entry.user, color: "purple" as Color, tooltip: "Runs as" }] : []),
      ...timeAccessories(next, last, entry.enabled),
    ],
    detail: {
      markdown: `\`\`\`sh\n${entry.command}\n\`\`\``,
      metadata: [
        meta.text("Schedule", words, { icon: Icons.calendar }),
        meta.text("Expression", entry.schedule),
        ...timeMeta(next, last, "Last scheduled"),
        meta.separator(),
        meta.tags("State", [entry.enabled ? { text: "enabled", color: "green" } : { text: "commented out" }]),
        meta.text("Runs as", runAs ?? "you", { icon: Icons.person }),
        meta.text("File", file ?? "Your crontab (crontab -e)", { icon: Icons.file }),
        ...(entry.note ? [meta.text("Comment", entry.note, { icon: Icons.comment })] : []),
        ...envLines.map(([k, v]) => meta.text(k, v)),
      ],
    },
    actions,
  };
}

function periodicItem(s: { path: string; words: string }, prefs: Prefs): Item {
  const name = s.path.split("/").pop()!;
  return {
    id: s.path,
    title: name,
    subtitle: `${s.words} (run-parts or anacron)`,
    icon: { source: Icons.file, tint: "teal" },
    section: "Periodic scripts",
    keywords: [s.path, "cron", "anacron", "run-parts"],
    accessories: [{ tag: s.path.split("/")[2].replace("cron.", "") }],
    detail: {
      metadata: [
        meta.text("Schedule", s.words, { icon: Icons.calendar }),
        meta.text("Script", s.path, { icon: Icons.file }),
        meta.text("Runs as", "root", { icon: Icons.lock }),
      ],
    },
    actions: [
      open(s.path, "Open Script", { icon: Icons.file }),
      action("Run Now in Terminal as root", terminal(prefs, terminalScript(s.path, "root", ME), "Running"), {
        icon: Icons.play,
      }),
      copy(s.path, "Copy Path", { section: "Copy" }),
    ],
  };
}

// ---------------------------------------------------------------------------

let summary = "";

export default list({
  placeholder: "Filter cron jobs and systemd timers…",
  filter: {
    options: [
      { value: "all", title: "All" },
      { value: "mine", title: "Yours" },
      { value: "system", title: "System" },
    ],
    default: "all",
  },
  empty: {
    title: "No scheduled tasks",
    description: "Add a cron job with Edit Crontab (Ctrl+K), or a systemd timer",
    icon: Icons.calendar,
  },
  status: () => summary,
  actions: [
    action(
      "Edit Crontab",
      ({ preferences }) => terminal(preferences as Prefs, ["crontab", "-e"], "crontab -e opened")(),
      { icon: Icons.terminal, shortcut: "<Ctrl>e" },
    ),
    action("Reload", () => refresh(), { icon: Icons.refresh, shortcut: "<Ctrl>r" }),
  ],
  async items({ preferences, filter, signal }) {
    const prefs = preferences as Prefs;
    const wantMine = filter !== "system", wantSystem = filter !== "mine";
    const [user, system, userTimers, systemTimers, periodic] = await Promise.all([
      userCrontab(signal),
      wantSystem ? systemCrontabs() : Promise.resolve([]),
      wantMine ? timers(true, signal) : Promise.resolve([]),
      wantSystem ? timers(false, signal) : Promise.resolve([]),
      wantSystem ? periodicScripts() : Promise.resolve([]),
    ]);
    const now = new Date();
    const byNext = (a: Item, b: Item) => (nextOf(a) ?? Infinity) - (nextOf(b) ?? Infinity);
    const nextAt = new Map<string, number>();
    const nextOf = (i: Item) => nextAt.get(i.id!);
    const remember = (i: Item, next?: number) => {
      if (next) nextAt.set(i.id!, next);
      return i;
    };
    const cronNext = (e: CronEntry) => {
      try {
        return e.enabled ? nextRun(parseCron(e.schedule), now)?.getTime() : undefined;
      } catch {
        return undefined;
      }
    };
    const mineCron = wantMine
      ? user.tab.entries.map((entry) => remember(cronItem({ entry, env: user.tab.env }, prefs, now), cronNext(entry)))
        .sort(byNext)
      : [];
    const mineTimers = userTimers.map((t) => remember(timerItem(t, prefs), t.next)).sort(byNext);
    const sysTimers = systemTimers.map((t) => remember(timerItem(t, prefs), t.next)).sort(byNext);
    const sysCron = system.flatMap((f) =>
      f.tab.entries.map((entry) =>
        remember(cronItem({ entry, file: f.path, env: f.tab.env }, prefs, now), cronNext(entry))
      )
    ).sort(byNext);
    const items = [
      ...mineCron,
      ...mineTimers,
      ...sysTimers,
      ...sysCron,
      ...periodic.map((s) => periodicItem(s, prefs)),
    ];
    const soon = items.map(nextOf).filter((n): n is number => !!n).sort((a, b) => a - b)[0];
    summary = [
      `${mineCron.length + sysCron.length} cron job${mineCron.length + sysCron.length === 1 ? "" : "s"}`,
      `${mineTimers.length + sysTimers.length} timer${mineTimers.length + sysTimers.length === 1 ? "" : "s"}`,
      ...(soon ? [`next ${relative(soon)}`] : []),
      ...(!user.installed && wantMine ? ["crontab is not installed"] : []),
    ].join(" · ");
    return items;
  },
});
