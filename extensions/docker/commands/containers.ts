import { action, copy, detail, exec, Icons, type Item, list, meta, open, refresh } from "@backslash/api";

interface Container {
  ID: string;
  Image: string;
  Names: string;
  State: string;
  Status: string;
  Ports?: string;
  CreatedAt?: string;
  RunningFor?: string;
  Networks?: string;
  Labels?: string | Record<string, string>;
}

/** `0.0.0.0:8080->80/tcp, :::8080->80/tcp` → host ports reachable in a browser. */
export function hostPorts(ports: string | undefined): { host: number; container: string }[] {
  const seen = new Set<number>();
  const out: { host: number; container: string }[] = [];
  for (const m of (ports ?? "").matchAll(/:(\d+)->(\d+\/\w+)/g)) {
    const host = Number(m[1]);
    if (!seen.has(host)) {
      seen.add(host);
      out.push({ host, container: m[2] });
    }
  }
  return out;
}

/** The Compose project a container belongs to, if any. */
function project(c: Container): string | undefined {
  if (typeof c.Labels === "object" && c.Labels) return c.Labels["com.docker.compose.project"];
  return c.Labels?.match(/com\.docker\.compose\.project=([^,]+)/)?.[1];
}

/** Docker first, Podman otherwise (same CLI). */
async function engine(): Promise<string> {
  for (const program of ["docker", "podman"]) {
    try {
      await exec(program, ["version", "--format", "{{.Client.Version}}"]);
      return program;
    } catch {
      // try the next one
    }
  }
  throw new Error("Neither Docker nor Podman is available");
}

function item(cli: string, c: Container): Item {
  const running = c.State === "running";
  const ports = hostPorts(c.Ports);
  const compose = project(c);
  const run = (verb: string) => async () => {
    await exec(cli, [verb, c.ID]);
    return refresh();
  };
  return {
    id: c.ID,
    title: c.Names,
    subtitle: c.Image,
    icon: { source: Icons.box, tint: running ? "green" : c.State === "exited" ? "gray" : "orange" },
    section: compose ? `${compose} (Compose)` : running ? "Running" : "Stopped",
    keywords: [c.ID, c.Image, compose ?? ""],
    accessories: [
      ...ports.slice(0, 2).map((p) => ({ text: `:${p.host}`, icon: Icons.plug, tooltip: `→ ${p.container}` })),
      { text: running ? (c.RunningFor ?? c.Status) : c.Status, color: running ? undefined : "gray" as const },
      ...(running ? [] : [{ tag: c.State, color: "gray" as const }]),
    ],
    detail: {
      metadata: [
        meta.text("State", c.Status, { icon: Icons.box, color: running ? "green" : undefined }),
        meta.text("Image", c.Image, { icon: Icons.package }),
        ...(ports.length ? [meta.tags("Ports", ports.map((p) => `${p.host} → ${p.container}`))] : []),
        ...(compose ? [meta.text("Compose", compose, { icon: Icons.apps })] : []),
        ...(c.Networks ? [meta.text("Networks", c.Networks, { icon: Icons.globe })] : []),
        meta.separator(),
        ...(c.CreatedAt ? [meta.text("Created", c.CreatedAt.replace(/ [+-]\d{4} \w+$/, ""))] : []),
        meta.text("ID", c.ID.slice(0, 12)),
        meta.text("Engine", cli === "docker" ? "Docker" : "Podman"),
      ],
    },
    actions: [
      action("Show Logs", async () => {
        const logs = await exec(cli, ["logs", "--tail", "200", c.ID]).catch((e) => e.message);
        return detail({
          title: c.Names,
          markdown: `\`\`\`\n${logs || "No logs."}\n\`\`\``,
          metadata: [
            meta.text("State", c.Status, { color: running ? "green" : undefined }),
            meta.text("Image", c.Image),
            ...(ports.length ? [meta.tags("Ports", ports.map((p) => String(p.host)))] : []),
            meta.text("ID", c.ID.slice(0, 12)),
          ],
          status: "Last 200 lines",
          actions: [copy(logs, "Copy Logs")],
        });
      }, { icon: Icons.text }),
      ...ports.slice(0, 1).map((p) =>
        open(`http://localhost:${p.host}`, `Open localhost:${p.host}`, { shortcut: "<Ctrl>o" })
      ),
      running
        ? action("Stop", run("stop"), { icon: Icons.stop, shortcut: "<Ctrl>s", section: "Container" })
        : action("Start", run("start"), { icon: Icons.play, shortcut: "<Ctrl>s", section: "Container" }),
      action("Restart", run("restart"), { icon: Icons.refresh, shortcut: "<Ctrl>r", section: "Container" }),
      copy(`${cli} exec -it ${c.Names} sh`, "Copy Shell Command", { icon: Icons.terminal, section: "Copy" }),
      copy(c.ID, "Copy ID", { section: "Copy" }),
      action("Remove", run("rm"), {
        icon: Icons.trash,
        destructive: true,
        confirm: `Remove ${c.Names}?`,
        section: "Danger",
      }),
    ],
  };
}

let running = 0;

export default list({
  placeholder: "Filter containers…",
  empty: { title: "No containers", description: "Nothing created yet", icon: "bs-box" },
  status: (items) => `${running} running · ${items.length} container${items.length === 1 ? "" : "s"}`,
  items: async () => {
    const cli = await engine();
    const out = await exec(cli, ["ps", "-a", "--format", "{{json .}}"]);
    const containers = out.split("\n").filter(Boolean).map((l) => JSON.parse(l) as Container)
      // Podman prints `Names` as an array.
      .map((c) => ({ ...c, Names: Array.isArray(c.Names) ? c.Names.join(", ") : c.Names }));
    running = containers.filter((c) => c.State === "running").length;
    // Compose projects together, running first.
    return containers.sort((a, b) =>
      (project(a) ?? "~").localeCompare(project(b) ?? "~") ||
      Number(b.State === "running") - Number(a.State === "running")
    ).map((c) => item(cli, c));
  },
});
