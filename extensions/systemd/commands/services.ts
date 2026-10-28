import { action, type Color, copy, detail, exec, Icons, type Item, list, meta, refresh, toast } from "@backslash/api";

interface Unit {
  name: string;
  active: string;
  sub: string;
  description: string;
  user: boolean;
}

async function units(user: boolean): Promise<Unit[]> {
  const args = [...(user ? ["--user"] : []), "list-units", "--type=service", "--all", "--plain", "--no-legend"];
  const out = await exec("systemctl", args).catch(() => "");
  return out.split("\n").filter(Boolean).map((line) => {
    const [name, _load, active, sub, ...description] = line.trim().split(/\s+/);
    return { name, active, sub, description: description.join(" "), user };
  }).filter((u) => u.name?.endsWith(".service"));
}

const color = (u: Unit): Color => (u.active === "active" ? "green" : u.active === "failed" ? "red" : "gray");

function control(u: Unit, verb: string) {
  return async () => {
    // System units ask for authentication through polkit when needed.
    await exec("systemctl", [...(u.user ? ["--user"] : []), verb, u.name]);
    await toast(`${u.name}: ${verb} done`, { style: "success" });
    return refresh();
  };
}

/** `systemctl show` properties, for the logs page. */
async function show(u: Unit): Promise<Record<string, string>> {
  const out = await exec("systemctl", [
    ...(u.user ? ["--user"] : []),
    "show",
    u.name,
    "-p",
    "MainPID,MemoryCurrent,ActiveEnterTimestamp,FragmentPath,NRestarts",
  ]).catch(() => "");
  return Object.fromEntries(out.split("\n").map((l) => l.split("=", 2)).filter((kv) => kv.length === 2));
}

const bytes = (n: number) =>
  n >= 1 << 30
    ? `${(n / (1 << 30)).toFixed(1)} GB`
    : n >= 1 << 20
    ? `${(n / (1 << 20)).toFixed(0)} MB`
    : `${Math.round(n / 1024)} kB`;

function item(u: Unit): Item {
  const running = u.active === "active";
  const failed = u.active === "failed";
  return {
    id: `${u.user ? "user" : "system"}:${u.name}`,
    title: u.name.replace(/\.service$/, ""),
    subtitle: u.description,
    icon: { source: failed ? Icons.alert : Icons.server, tint: color(u) },
    section: failed ? "Failed" : u.user ? "User services" : "System services",
    keywords: [u.sub, u.active],
    accessories: [{ tag: u.sub, color: color(u) }],
    detail: {
      metadata: [
        meta.text("State", `${u.active} (${u.sub})`, { icon: failed ? Icons.alert : Icons.server, color: color(u) }),
        meta.text("Scope", u.user ? "Your user" : "System (asks for your password to change)", {
          icon: u.user ? Icons.person : Icons.lock,
        }),
        meta.text("Unit", u.name),
      ],
    },
    actions: [
      action("Show Logs", async () => {
        const [logs, props] = await Promise.all([
          exec("journalctl", [
            ...(u.user ? ["--user"] : []),
            "-u",
            u.name,
            "-n",
            "150",
            "--no-pager",
            "-o",
            "short-iso",
          ]).catch((e) => `Could not read the logs: ${e.message}`),
          show(u),
        ]);
        const memory = Number(props.MemoryCurrent);
        return detail({
          title: u.name,
          markdown: `\`\`\`\n${logs || "No logs."}\n\`\`\``,
          metadata: [
            meta.text("State", `${u.active} (${u.sub})`, { color: color(u) }),
            ...(props.ActiveEnterTimestamp
              ? [meta.text("Since", props.ActiveEnterTimestamp, { icon: Icons.clock })]
              : []),
            ...(props.MainPID && props.MainPID !== "0" ? [meta.text("PID", props.MainPID)] : []),
            ...(memory > 0 && memory < 2 ** 60 ? [meta.text("Memory", bytes(memory), { icon: Icons.cpu })] : []),
            ...(props.NRestarts && props.NRestarts !== "0"
              ? [meta.text("Restarts", props.NRestarts, { color: "orange" })]
              : []),
            ...(props.FragmentPath ? [meta.text("Unit file", props.FragmentPath, { icon: Icons.file })] : []),
          ],
          status: `${u.user ? "User" : "System"} service · last 150 lines`,
          actions: [copy(logs, "Copy Logs")],
        });
      }, { icon: Icons.text }),
      action("Restart", control(u, "restart"), { icon: Icons.refresh, shortcut: "<Ctrl>r", section: "Service" }),
      running
        ? action("Stop", control(u, "stop"), {
          icon: Icons.stop,
          destructive: true,
          confirm: `Stop ${u.name}?`,
          shortcut: "<Ctrl>s",
          section: "Service",
        })
        : action("Start", control(u, "start"), { icon: Icons.play, shortcut: "<Ctrl>s", section: "Service" }),
      copy(u.name, "Copy Unit Name", { section: "Copy" }),
    ],
  };
}

export default list({
  placeholder: "Filter services…",
  filter: {
    options: [
      { value: "running", title: "Running" },
      { value: "failed", title: "Failed" },
      { value: "all", title: "All" },
    ],
  },
  empty: { title: "No services here", description: "Nothing matches this filter", icon: "bs-server" },
  status: (items) => `${items.length} service${items.length === 1 ? "" : "s"}`,
  items: async ({ filter }) => {
    const [user, system] = await Promise.all([units(true), units(false)]);
    const keep = (u: Unit) =>
      filter === "failed"
        ? u.active === "failed"
        : filter === "all"
        ? true
        : u.active === "active" || u.active === "failed";
    // Failed first, then your services, then the system's.
    const order = (u: Unit) => (u.active === "failed" ? 0 : u.user ? 1 : 2);
    return [...user, ...system].filter(keep).sort((a, b) => order(a) - order(b) || a.name.localeCompare(b.name)).map(
      item,
    );
  },
});
