import { action, copy, exec, type Item, list, open, refresh, toast } from "@backslash/api";
import { byPort, isLocal, KNOWN, type Listener, parseSs } from "../lib.ts";

const HOME = Deno.env.get("HOME") ?? "";

interface Process {
  pid: number;
  name: string;
  command: string;
  cwd?: string;
}

/** Command line and working directory of each pid. */
async function describe(pids: { name: string; pid: number }[]): Promise<Map<number, Process>> {
  const out = new Map<number, Process>();
  if (pids.length === 0) return out;
  const unique = [...new Map(pids.map((p) => [p.pid, p])).values()];
  const ps = await exec("ps", ["-o", "pid=,args=", "-p", unique.map((p) => p.pid).join(",")]).catch(() => "");
  const args = new Map(
    ps.split("\n").map((l) => l.trim().match(/^(\d+)\s+(.*)$/)).filter((m) => m !== null).map((
      m,
    ) => [Number(m![1]), m![2]]),
  );
  await Promise.all(unique.map(async ({ pid, name }) => {
    const cwd = await exec("readlink", [`/proc/${pid}/cwd`]).catch(() => undefined);
    out.set(pid, { pid, name, command: args.get(pid) ?? name, cwd: cwd || undefined });
  }));
  return out;
}

const tilde = (p: string) => (HOME && p.startsWith(HOME) ? `~${p.slice(HOME.length)}` : p);

function item(port: number, sockets: Listener[], proc?: Process): Item {
  const local = sockets.every((s) => isLocal(s.address));
  const url = `http://localhost:${port}`;
  const project = proc?.cwd && proc.cwd !== "/" && proc.cwd !== HOME ? proc.cwd.split("/").pop() : undefined;
  const kill = (signal: string, title: string, options = {}) =>
    action(title, async () => {
      await exec("kill", [`-${signal}`, String(proc!.pid)]);
      await toast(`Sent ${signal} to ${proc!.name}`, { style: "success" });
      await new Promise((r) => setTimeout(r, 300));
      return refresh();
    }, options);
  return {
    id: String(port),
    title: `:${port}`,
    subtitle: proc
      ? [proc.name, project && `in ${tilde(proc.cwd!)}`].filter(Boolean).join(" ")
      : KNOWN[port] ?? "System service",
    icon: proc ? "application-x-executable" : "network-server",
    section: proc ? "Yours" : "System",
    keywords: [proc?.command ?? "", proc?.cwd ?? "", KNOWN[port] ?? "", String(proc?.pid ?? "")],
    accessories: [
      ...(project ? [{ text: project }] : []),
      local ? { tag: "localhost", color: "gray" as const } : { tag: "network", color: "orange" as const },
      ...(proc ? [{ text: `pid ${proc.pid}` }] : []),
    ],
    actions: [
      open(url, "Open in Browser"),
      ...(proc
        ? [
          kill("TERM", "Stop Process", {
            icon: "process-stop",
            destructive: true,
            confirm: `Stop ${proc.name} (pid ${proc.pid})?`,
            shortcut: "<Ctrl>k",
          }),
          kill("KILL", "Force Kill", { destructive: true, confirm: `Kill ${proc.name} right away?` }),
          ...(proc.cwd ? [open(proc.cwd, "Open Folder", { icon: "folder-open" })] : []),
          copy(proc.command, "Copy Command Line"),
          copy(String(proc.pid), "Copy PID"),
        ]
        : []),
      copy(url, "Copy URL"),
    ],
  };
}

export default list({
  placeholder: "Filter ports, programs, projects…",
  empty: { title: "Nothing is listening", description: "Start a dev server and it shows up here" },
  items: async () => {
    const sockets = parseSs(await exec("ss", ["-Hltnp"]));
    const procs = await describe(sockets.flatMap((s) => s.pids));
    const items = [...byPort(sockets)].map(([port, socks]) => {
      const pid = socks.flatMap((s) => s.pids)[0]?.pid;
      return item(port, socks, pid === undefined ? undefined : procs.get(pid));
    });
    // Your processes (dev servers) first.
    return items.sort((a, b) => (a.section === b.section ? 0 : a.section === "Yours" ? -1 : 1));
  },
});
