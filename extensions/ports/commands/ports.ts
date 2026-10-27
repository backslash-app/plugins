import { action, copy, exec, Icons, type Item, list, meta, open, refresh, toast } from "@backslash/api";
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
  const addresses = [...new Set(sockets.map((s) => s.address))];
  return {
    id: String(port),
    title: `:${port}`,
    subtitle: proc ? proc.name : KNOWN[port] ?? "System service",
    icon: { source: proc ? Icons.plug : Icons.server, tint: proc ? (local ? "green" : "orange") : "gray" },
    section: proc ? "Yours" : "System",
    keywords: [proc?.command ?? "", proc?.cwd ?? "", KNOWN[port] ?? "", String(proc?.pid ?? "")],
    accessories: [
      ...(project ? [{ icon: Icons.folder, text: project }] : []),
      local ? { tag: "localhost", color: "gray" as const } : { tag: "network", color: "orange" as const },
      ...(proc ? [{ text: `pid ${proc.pid}` }] : []),
    ],
    detail: {
      markdown: proc ? `\`${proc.command.length > 300 ? proc.command.slice(0, 300) + "…" : proc.command}\`` : undefined,
      metadata: [
        meta.text("Port", port, { icon: Icons.plug }),
        meta.text(
          "Reachable",
          local ? "From this computer only" : "From the network",
          { icon: local ? Icons.lock : Icons.globe, color: local ? undefined : "orange" },
        ),
        meta.tags("Listening on", addresses),
        ...(proc
          ? [
            meta.separator(),
            meta.text("Program", proc.name, { icon: Icons.terminal }),
            meta.text("PID", proc.pid),
            ...(proc.cwd ? [meta.text("Folder", tilde(proc.cwd), { icon: Icons.folder })] : []),
          ]
          : [meta.text("Service", KNOWN[port] ?? "Unknown")]),
        meta.link("Open", url.replace("http://", ""), url),
      ],
    },
    actions: [
      open(url, "Open in Browser"),
      ...(proc
        ? [
          kill("TERM", "Stop Process", {
            icon: Icons.stop,
            destructive: true,
            confirm: `Stop ${proc.name} (pid ${proc.pid})?`,
            shortcut: "<Ctrl>k",
            section: "Process",
          }),
          kill("KILL", "Force Kill", {
            icon: Icons.cross,
            destructive: true,
            confirm: `Kill ${proc.name} right away?`,
            section: "Process",
          }),
          ...(proc.cwd ? [open(proc.cwd, "Open Folder", { icon: Icons.folder, section: "Process" })] : []),
          copy(proc.command, "Copy Command Line", { section: "Copy" }),
          copy(String(proc.pid), "Copy PID", { section: "Copy" }),
        ]
        : []),
      copy(url, "Copy URL", { shortcut: "<Ctrl><Shift>c", section: "Copy" }),
    ],
  };
}

export default list({
  placeholder: "Filter ports, programs, projects…",
  empty: { title: "Nothing is listening", description: "Start a dev server and it shows up here", icon: "bs-plug" },
  status: (items) => {
    const yours = items.filter((i) => i.section === "Yours").length;
    return `${items.length} port${items.length === 1 ? "" : "s"} · ${yours} yours`;
  },
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
