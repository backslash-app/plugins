// The live list of top processes, shared by the "Top Processes" command and the monitor's actions.

import { action, copy, exec, Icons, type Item, list, type ListSpec, meta, refresh, toast } from "@backslash/api";
import {
  bytes,
  levelColor,
  parseCpuStat,
  parseMeminfo,
  parseProcStat,
  parsePs,
  parsePsArgs,
  PROCESS_STATES,
  processCpu,
  type ProcStat,
  type PsRow,
} from "./lib.ts";
import { capture, readFiles, sleep } from "./system.ts";

export type Sort = "cpu" | "memory";

interface Proc extends ProcStat {
  cpu: number;
  rss: number;
  command: string;
  user: string;
  own: boolean;
}

const TICKS_PER_SECOND = 100; // USER_HZ, 100 on every mainstream Linux build
const SHOWN = 40;

interface Sample {
  ps: Map<number, PsRow>;
  stats: Map<number, ProcStat>;
  cpu: ReturnType<typeof parseCpuStat>;
  memTotal: number;
  memUsed: number;
  uptime: number;
}

/** Owners and memory from ps, CPU ticks from /proc/<pid>/stat (finer than ps' seconds). */
async function sample(): Promise<Sample> {
  const ps = new Map(parsePs(await capture("ps", ["-e", "-o", "pid=,uid=,rss=,user:32="])).map((r) => [r.pid, r]));
  const files = await readFiles([
    "/proc/stat",
    "/proc/meminfo",
    "/proc/uptime",
    ...[...ps.keys()].map((pid) => `/proc/${pid}/stat`),
  ]);
  const stats = new Map<number, ProcStat>();
  for (const pid of ps.keys()) {
    const s = parseProcStat(files.get(`/proc/${pid}/stat`) ?? "");
    if (s) stats.set(pid, s);
  }
  const mem = parseMeminfo(files.get("/proc/meminfo") ?? "");
  return {
    ps,
    stats,
    cpu: parseCpuStat(files.get("/proc/stat") ?? ""),
    memTotal: mem.total,
    memUsed: mem.used,
    uptime: Number((files.get("/proc/uptime") ?? "").split(" ")[0]) || 0,
  };
}

/** Command lines, cached: they don't change during a process' life (exec aside). */
const commands = new Map<number, string>();

async function commandLines(pids: number[]): Promise<void> {
  const missing = pids.filter((pid) => !commands.has(pid));
  if (!missing.length) return;
  const args = parsePsArgs(await capture("ps", ["-o", "pid=,args=", "-p", missing.join(",")]));
  for (const pid of missing) commands.set(pid, args.get(pid) ?? "");
}

function signal(p: Proc, sig: "TERM" | "KILL") {
  return async () => {
    await exec("kill", [`-${sig}`, String(p.pid)]);
    await toast(sig === "TERM" ? `Asked ${p.name} to quit` : `Killed ${p.name}`, { style: "success" });
    await sleep(400);
    return refresh();
  };
}

function item(p: Proc, sort: Sort, memTotal: number, boot: number): Item {
  const memRatio = memTotal ? p.rss / memTotal : 0;
  const [state, stateColor] = PROCESS_STATES[p.state] ?? [p.state, "gray"];
  const started = new Date((boot + p.startTicks / TICKS_PER_SECOND) * 1000);
  const cpuText = `${p.cpu.toFixed(p.cpu >= 10 ? 0 : 1)} %`;
  const command = p.command.length > 400 ? `${p.command.slice(0, 400)}…` : p.command;
  return {
    id: String(p.pid),
    title: p.name,
    subtitle: /^\[.*\]$/.test(p.command) ? "Kernel thread" : command.slice(0, 80),
    icon: sort === "cpu"
      ? { source: Icons.cpu, tint: levelColor(p.cpu / 100) }
      : { source: Icons.layers, tint: levelColor(memRatio * 4) },
    keywords: [String(p.pid), p.user, p.command],
    accessories: [
      ...(p.own ? [] : [{ tag: p.user, color: "gray" as const }]),
      { text: cpuText, icon: Icons.cpu, tooltip: "CPU (100 % = one core)" },
      { text: bytes(p.rss), icon: Icons.layers, tooltip: "Memory (resident)" },
    ],
    detail: {
      stats: [
        { label: "CPU", value: cpuText, color: levelColor(p.cpu / 100) },
        { label: "Memory", value: bytes(p.rss) },
        { label: "Threads", value: p.threads },
      ],
      markdown: `\`${command.replaceAll("`", "'")}\``,
      metadata: [
        meta.progress("Share of RAM", memRatio, `${(memRatio * 100).toFixed(1)} %`),
        meta.text("State", state, { icon: Icons.dottedCircle, color: stateColor }),
        meta.separator(),
        meta.text("PID", p.pid, { icon: Icons.hash }),
        meta.text("Parent PID", p.ppid),
        meta.person("User", p.user),
        meta.text("Started", started.toLocaleString(), { icon: Icons.clock }),
      ],
    },
    actions: [
      action("Quit Process", signal(p, "TERM"), {
        icon: Icons.stop,
        destructive: true,
        confirm: `Ask ${p.name} (pid ${p.pid}) to quit?`,
        shortcut: "<Ctrl>k",
        section: "Process",
      }),
      action("Force Kill", signal(p, "KILL"), {
        icon: Icons.cross,
        destructive: true,
        confirm: `Kill ${p.name} right away? Unsaved work is lost.`,
        shortcut: "<Ctrl><Shift>k",
        section: "Process",
      }),
      copy(String(p.pid), "Copy PID", { section: "Copy", shortcut: "<Ctrl><Shift>c" }),
      copy(p.command, "Copy Command Line", { section: "Copy" }),
      copy(p.name, "Copy Name", { section: "Copy" }),
    ],
  };
}

/** A live list of the busiest processes. `title` keeps the remembered sort separate per entry point. */
export function processView(title = "Top Processes", defaultSort: Sort = "cpu"): ListSpec {
  let summary = "";
  return list({
    title,
    placeholder: "Filter processes by name, command, user or PID…",
    filter: {
      options: [{ value: "cpu", title: "By CPU" }, { value: "memory", title: "By Memory" }],
      default: defaultSort,
    },
    empty: { title: "No processes", description: "/proc could not be read", icon: Icons.activity },
    status: () => summary,
    async *items({ filter, signal }) {
      const sort: Sort = filter === "memory" ? "memory" : "cpu";
      let prev = await sample();
      await sleep(500, signal);
      while (!signal.aborted) {
        const cur = await sample();
        // ps lists itself and grep; the deno process tells which uid is ours.
        const me = cur.ps.get(Deno.pid)?.uid;
        const elapsed = cur.cpu.total.total - prev.cpu.total.total;
        const cpus = cur.cpu.cores.length || 1;
        const procs = [...cur.stats.values()].filter((p) => p.pid !== Deno.pid && p.ppid !== Deno.pid).map((p) => ({
          ...p,
          cpu: processCpu(prev.stats.get(p.pid)?.ticks ?? p.ticks, p.ticks, elapsed, cpus),
          rss: cur.ps.get(p.pid)?.rss ?? 0,
        }));
        procs.sort((a, b) => sort === "cpu" ? b.cpu - a.cpu || b.rss - a.rss : b.rss - a.rss || b.cpu - a.cpu);
        const shown = procs.slice(0, SHOWN);
        await commandLines(shown.map((p) => p.pid));
        for (const pid of commands.keys()) if (!cur.ps.has(pid)) commands.delete(pid);
        const top: Proc[] = shown.map((p) => {
          const row = cur.ps.get(p.pid);
          return {
            ...p,
            command: commands.get(p.pid) || `[${p.name}]`,
            user: row?.user ?? "?",
            own: me !== undefined && row?.uid === me,
          };
        });
        const boot = Date.now() / 1000 - cur.uptime;
        const totalCpu = procs.reduce((a, p) => a + p.cpu, 0) / cpus;
        summary = `${procs.length} processes · CPU ${Math.round(Math.min(100, totalCpu))} % · RAM ${
          Math.round((cur.memUsed / (cur.memTotal || 1)) * 100)
        } % · top ${top.length} by ${sort === "cpu" ? "CPU" : "memory"}`;
        yield top.map((p) => item(p, sort, cur.memTotal, boot));
        prev = cur;
        await sleep(2000, signal);
      }
    },
  });
}
