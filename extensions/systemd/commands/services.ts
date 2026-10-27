import { action, type Color, copy, detail, exec, type Item, list, refresh, toast } from "@backslash/api";

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

function item(u: Unit): Item {
  const running = u.active === "active";
  return {
    id: `${u.user ? "user" : "system"}:${u.name}`,
    title: u.name.replace(/\.service$/, ""),
    subtitle: u.description,
    icon: "system-run",
    section: u.user ? "User services" : "System services",
    keywords: [u.sub, u.active],
    accessories: [{ tag: u.sub, color: color(u) }],
    actions: [
      action("Show Logs", async () => {
        const logs = await exec("journalctl", [
          ...(u.user ? ["--user"] : []),
          "-u",
          u.name,
          "-n",
          "100",
          "--no-pager",
          "-o",
          "short-iso",
        ]).catch((e) => `Could not read the logs: ${e.message}`);
        return detail({
          title: u.name,
          markdown: `# ${u.name}\n\n${u.description}\n\n\`\`\`\n${logs || "No logs."}\n\`\`\``,
          metadata: { State: `${u.active} (${u.sub})`, Scope: u.user ? "user" : "system" },
        });
      }),
      action("Restart", control(u, "restart"), { icon: "view-refresh", shortcut: "<Ctrl>r" }),
      running
        ? action("Stop", control(u, "stop"), { destructive: true, confirm: `Stop ${u.name}?`, shortcut: "<Ctrl>s" })
        : action("Start", control(u, "start"), { shortcut: "<Ctrl>s" }),
      copy(u.name, "Copy Unit Name"),
    ],
  };
}

export default list({
  placeholder: "Filter services…",
  empty: { title: "No services", description: "systemd does not seem to run here" },
  items: async () => {
    const [user, system] = await Promise.all([units(true), units(false)]);
    // Running and failed services first.
    const order = (u: Unit) => (u.active === "failed" ? 0 : u.active === "active" ? 1 : 2);
    return [...user, ...system].sort((a, b) => Number(a.user) - Number(b.user) || order(a) - order(b)).map(item)
      .sort((a, b) => (a.section === b.section ? 0 : a.section === "User services" ? -1 : 1));
  },
});
