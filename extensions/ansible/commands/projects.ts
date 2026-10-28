import {
  type Action,
  action,
  copy,
  detail,
  Icons,
  type Item,
  list,
  type ListSpec,
  meta,
  open,
  refresh,
  submenu,
  toast,
  updateCommandMetadata,
} from "@backslash/api";
import {
  cachedInventory,
  cachedProjects,
  chooseInventory,
  chosenInventory,
  commandLine,
  errorItem,
  HOME,
  inTerminal,
  inventoriesOf,
  loadInventory,
  Missing,
  missingItem,
  type Prefs,
  readText,
  run,
  scan,
} from "../ansible.ts";
import {
  type Group,
  type Host,
  type Inventory,
  type InventoryRef,
  isMagicVar,
  naturalCompare,
  parseListTasks,
  parsePlaybook,
  type Play,
  playbookArgv,
  playHosts,
  playTags,
  type Project,
  relativeTime,
  relativeTo,
  sshTarget,
  tilde,
  varText,
} from "../lib.ts";

const fence = (text: string) => `\`\`\`\n${text.replace(/```/g, "ʼʼʼ") || "(empty)"}\n\`\`\``;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const inventoryCount = (n: number) => `${n} ${n === 1 ? "inventory" : "inventories"}`;

interface Book {
  path: string;
  /** Undefined when the file couldn't be read (outside the default folders) or isn't a playbook. */
  plays?: Play[];
  readable: boolean;
}

async function readBooks(project: Project): Promise<Book[]> {
  const books = await Promise.all(project.playbooks.map(async (path) => {
    const text = await readText(path);
    if (text === undefined) return { path, readable: false };
    return { path, plays: parsePlaybook(text), readable: true };
  }));
  // Readable YAML files that aren't playbooks (vars files, CI configs) are dropped.
  return books.filter((b) => !b.readable || b.plays);
}

// ---------------------------------------------------------------------------
// Playbooks

function runOptions(prefs: Prefs) {
  return { askBecome: prefs.askBecome === true, askVault: prefs.askVault === true };
}

function playbookActions(project: Project, book: Book, inv: InventoryRef, prefs: Prefs): Action[] {
  const pb = relativeTo(book.path, project.path);
  const i = inv.path ? relativeTo(inv.path, project.path) : "";
  const argv = (o: Parameters<typeof playbookArgv>[2] = {}) => playbookArgv(pb, i, { ...runOptions(prefs), ...o });
  const t = (title: string, a: string[], o: Parameters<typeof inTerminal>[4] = {}) =>
    inTerminal(title, a, project.path, prefs, o);
  const tags = book.plays ? playTags(book.plays) : [];
  return [
    t("Run Playbook", argv(), {
      icon: Icons.play,
      confirm: `Run ${pb} against ${inv.name}?`,
    }),
    t("Check (Dry Run with Diff)", argv({ check: true }), { icon: Icons.search, shortcut: "<Ctrl><Shift>d" }),
    submenu("Limit to Host", async () => {
      const inventory = (await cachedInventory(project, inv)) ?? await loadInventory(project, inv);
      return [
        ...inventory.groups.filter((g) => g.name !== "all").map((g) =>
          t(`${g.name} (${plural(g.allHosts.length, "host")})`, argv({ limit: g.name }), { icon: Icons.layers })
        ),
        ...inventory.hosts.map((h) => t(h.name, argv({ limit: h.name }), { icon: Icons.server })),
      ];
    }, { icon: Icons.filter, shortcut: "<Ctrl>l" }),
    ...(tags.length
      ? [submenu("Run with Tag", tags.map((tag) => t(tag, argv({ tags: tag }), { icon: Icons.tag })), {
        icon: Icons.tag,
        shortcut: "<Ctrl>t",
      })]
      : []),
    action("List Hosts and Tasks", () => tasksView(project, book, inv), { icon: Icons.note, shortcut: "<Ctrl>i" }),
    t("Check Syntax", argv({ syntax: true }), { icon: Icons.check, section: "Playbook" }),
    open(book.path, "Open Playbook", { icon: Icons.file, shortcut: "<Ctrl>o", section: "Playbook" }),
    copy(commandLine(argv(), project.path), "Copy Command", { section: "Copy", shortcut: "<Ctrl><Shift>c" }),
    copy(book.path, "Copy Path", { section: "Copy" }),
  ];
}

function playLines(plays: Play[]): string {
  return plays.map((p, n) => {
    if (p.imports) return `${n + 1}. **${p.name}** → imports \`${p.imports}\``;
    const bits = [
      `hosts \`${p.hosts || "?"}\``,
      p.tasks ? plural(p.tasks, "task") : "",
      p.roles.length ? `roles ${p.roles.map((r) => `\`${r}\``).join(", ")}` : "",
      p.become ? "become" : "",
      p.serial ? `serial ${p.serial}` : "",
      p.tags.length ? `tags ${p.tags.join(", ")}` : "",
    ].filter(Boolean);
    return `${n + 1}. **${p.name || "(unnamed play)"}**: ${bits.join(" · ")}`;
  }).join("\n");
}

function playbookItem(project: Project, book: Book, inv: InventoryRef, prefs: Prefs): Item {
  const name = relativeTo(book.path, project.path);
  const plays = book.plays ?? [];
  const tasks = plays.reduce((n, p) => n + p.tasks, 0);
  const roles = [...new Set(plays.flatMap((p) => p.roles))];
  return {
    id: `pb:${book.path}`,
    title: name,
    subtitle: plays.length ? playHosts(plays) || undefined : book.readable ? undefined : "Plays not read",
    icon: { source: Icons.play, tint: "green" },
    section: "Playbooks",
    keywords: ["playbook", ...plays.map((p) => p.name), ...roles],
    accessories: [
      ...(plays.length ? [{ tag: plural(plays.length, "play"), color: "blue" as const }] : []),
      ...(tasks ? [{ text: plural(tasks, "task") }] : []),
    ],
    detail: {
      markdown: plays.length
        ? `## Plays\n\n${playLines(plays)}`
        : book.readable
        ? "_No plays._"
        : "Backslash may only read playbooks in the default folders. **List Hosts and Tasks** (Ctrl+I) asks ansible-playbook instead.",
      metadata: [
        meta.text("Playbook", name, { icon: Icons.file }),
        meta.text("Inventory", inv.path ? `${inv.name} (${relativeTo(inv.path, project.path)})` : inv.name, {
          icon: Icons.server,
        }),
        ...(roles.length ? [meta.tags("Roles", roles)] : []),
        ...(playTags(plays).length ? [meta.tags("Tags", playTags(plays))] : []),
      ],
    },
    actions: playbookActions(project, book, inv, prefs),
  };
}

function tasksView(project: Project, book: Book, inv: InventoryRef) {
  return detail({
    title: relativeTo(book.path, project.path),
    markdown: async ({ signal }) => {
      const args = [
        ...(inv.path ? ["-i", inv.path] : []),
        book.path,
        "--list-hosts",
        "--list-tasks",
      ];
      let out: string;
      try {
        out = await run("ansible-playbook", args, { cwd: project.path, signal });
      } catch (e) {
        if (e instanceof Missing) return "**ansible-playbook is not installed.**";
        return `## ansible-playbook failed\n\n${fence((e as Error).message)}`;
      }
      const plays = parseListTasks(out);
      if (!plays.length) return fence(out);
      return plays.map((p) => {
        const hosts = p.hosts.length ? p.hosts.map((h) => `\`${h}\``).join(" ") : "_no host matches_";
        const tasks = p.tasks.length
          ? p.tasks.map((t) =>
            `- ${t.role ? `**${t.role}** · ` : ""}${t.name}${t.tags.length ? ` _(${t.tags.join(", ")})_` : ""}`
          ).join("\n")
          : "_No tasks._";
        return `## ${p.number}. ${p.name || "(unnamed)"}\n\nHosts (${p.pattern}): ${hosts}\n\n${tasks}`;
      }).join("\n\n");
    },
    metadata: [
      meta.text("Playbook", relativeTo(book.path, project.path), { icon: Icons.file }),
      meta.text("Inventory", inv.name, { icon: Icons.server }),
    ],
  });
}

// ---------------------------------------------------------------------------
// Inventory: hosts and groups

function hostItem(project: Project, inv: InventoryRef, host: Host, books: Book[], prefs: Prefs): Item {
  const target = sshTarget(host);
  const i = inv.path ? ["-i", relativeTo(inv.path, project.path)] : [];
  const t = (title: string, a: string[], o: Parameters<typeof inTerminal>[4] = {}) =>
    inTerminal(title, a, project.path, prefs, o);
  const vars = Object.entries(host.vars).filter(([k]) => !isMagicVar(k)).sort(([a], [b]) => a.localeCompare(b));
  const actions: Action[] = [];
  if (target) actions.push(t("SSH", target.argv, { icon: Icons.terminal }));
  actions.push(
    t("Ping", ["ansible", ...i, host.name, "-m", "ping"], { icon: Icons.activity, shortcut: "<Ctrl>p" }),
    t("Gather Facts", ["ansible", ...i, host.name, "-m", "setup"], { icon: Icons.info, shortcut: "<Ctrl>g" }),
  );
  if (books.length) {
    actions.push(submenu(
      "Run Playbook on This Host",
      books.map((b) =>
        t(
          relativeTo(b.path, project.path),
          playbookArgv(relativeTo(b.path, project.path), i[1] ?? "", { ...runOptions(prefs), limit: host.name }),
          { icon: Icons.play },
        )
      ),
      { icon: Icons.play, shortcut: "<Ctrl>r" },
    ));
    actions.push(submenu(
      "Check Playbook on This Host",
      books.map((b) =>
        t(
          relativeTo(b.path, project.path),
          playbookArgv(relativeTo(b.path, project.path), i[1] ?? "", {
            ...runOptions(prefs),
            limit: host.name,
            check: true,
          }),
          { icon: Icons.search },
        )
      ),
      { icon: Icons.search },
    ));
  }
  if (target) {
    actions.push(copy(target.address, "Copy Address", { section: "Copy", shortcut: "<Ctrl><Shift>c" }));
    actions.push(copy(target.argv.join(" "), "Copy SSH Command", { section: "Copy" }));
  }
  actions.push(copy(host.name, "Copy Host Name", { section: "Copy", shortcut: "<Ctrl>." }));
  const connection = String(host.vars.ansible_connection ?? "ssh");
  return {
    id: `host:${host.name}`,
    title: host.name,
    subtitle: target && target.address !== host.name ? target.address : connection !== "ssh" ? connection : undefined,
    icon: { source: Icons.server, tint: target ? "blue" : "gray" },
    section: "Hosts",
    keywords: [...host.groups, target?.address ?? "", String(host.vars.ansible_user ?? "")].filter(Boolean),
    accessories: host.groups.slice(0, 3).map((g) => ({ tag: g, color: "purple" as const })),
    detail: {
      metadata: [
        meta.text("Host", host.name, { icon: Icons.server }),
        ...(target ? [meta.text("Address", target.address, { icon: Icons.globe })] : []),
        meta.text("Connection", connection),
        ...(host.vars.ansible_user ? [meta.text("User", String(host.vars.ansible_user), { icon: Icons.person })] : []),
        ...(host.groups.length ? [meta.tags("Groups", host.groups)] : []),
        ...(vars.length ? [meta.separator()] : []),
        ...vars.slice(0, 40).map(([k, v]) => meta.text(k, varText(k, v))),
      ],
    },
    actions,
  };
}

function groupItem(
  project: Project,
  inv: InventoryRef,
  g: Group,
  inventory: Inventory,
  books: Book[],
  prefs: Prefs,
): Item {
  const i = inv.path ? ["-i", relativeTo(inv.path, project.path)] : [];
  return {
    id: `group:${g.name}`,
    title: g.name,
    subtitle: g.children.length ? `Children: ${g.children.join(", ")}` : undefined,
    icon: { source: Icons.layers, tint: "purple" },
    section: "Groups",
    keywords: ["group", ...g.children],
    accessories: [{ tag: plural(g.allHosts.length, "host"), color: "purple" as const }],
    detail: {
      metadata: [
        meta.text("Group", g.name, { icon: Icons.layers }),
        meta.text("Hosts", String(g.allHosts.length)),
        ...(g.children.length ? [meta.tags("Children", g.children)] : []),
        ...(g.allHosts.length ? [meta.tags("Members", g.allHosts.slice(0, 30))] : []),
      ],
    },
    actions: [
      action("Show Hosts", () => groupView(project, inv, g, inventory, books, prefs), { icon: Icons.server }),
      inTerminal("Ping Group", ["ansible", ...i, g.name, "-m", "ping"], project.path, prefs, {
        icon: Icons.activity,
        shortcut: "<Ctrl>p",
      }),
      copy(g.allHosts.join("\n"), "Copy Host Names", { section: "Copy" }),
      copy(g.name, "Copy Group Name", { section: "Copy", shortcut: "<Ctrl>." }),
    ],
  };
}

function groupView(project: Project, inv: InventoryRef, g: Group, inventory: Inventory, books: Book[], prefs: Prefs) {
  const members = new Set(g.allHosts);
  return list({
    title: `${g.name} · ${inv.name}`,
    placeholder: `Filter hosts of ${g.name}…`,
    empty: { title: "No hosts in this group", icon: Icons.server },
    status: (items) => plural(items.length, "host"),
    items: () => inventory.hosts.filter((h) => members.has(h.name)).map((h) => hostItem(project, inv, h, books, prefs)),
  });
}

function inventoryView(project: Project, inv: InventoryRef, books: Book[], prefs: Prefs): ListSpec {
  const build = (inventory: Inventory) => [
    ...inventory.groups.filter((g) => g.name !== "all").map((g) => groupItem(project, inv, g, inventory, books, prefs)),
    ...inventory.hosts.map((h) => hostItem(project, inv, h, books, prefs)),
  ];
  return list({
    title: `${project.name} · ${inv.name}`,
    placeholder: "Filter hosts and groups…",
    empty: {
      title: "No hosts in this inventory",
      description: "ansible-inventory found no host. Check the inventory file.",
      icon: Icons.server,
    },
    status: (items) => {
      const hosts = items.filter((i) => i.section === "Hosts").length;
      return items[0]?.id === "error" ? "" : `${plural(hosts, "host")} · ${inv.name}`;
    },
    items: async function* ({ signal }) {
      const cached = await cachedInventory(project, inv);
      if (cached) yield build(cached);
      try {
        yield build(await loadInventory(project, inv, signal));
      } catch (e) {
        if (signal.aborted) return;
        yield [e instanceof Missing ? await missingItem() : errorItem(e), ...(cached ? build(cached) : [])];
      }
    },
  });
}

// ---------------------------------------------------------------------------
// One project

function inventoryItem(project: Project, ref: InventoryRef, chosen: boolean, books: Book[], prefs: Prefs): Item {
  return {
    id: `inv:${ref.path || ref.name}`,
    title: ref.name,
    subtitle: ref.path ? relativeTo(ref.path, project.path) : "ansible's default inventory",
    icon: { source: Icons.server, tint: chosen ? "green" : "gray" },
    section: "Inventories",
    keywords: ["inventory", "hosts"],
    accessories: chosen ? [{ tag: "Used for runs", color: "green" }] : [],
    actions: [
      action("Show Hosts", () => inventoryView(project, ref, books, prefs), { icon: Icons.server }),
      action("Use for Runs", async () => {
        await chooseInventory(project, ref);
        await toast(`Playbooks now run against ${ref.name}`, { style: "success" });
        return refresh();
      }, { icon: Icons.check, shortcut: "<Ctrl>u" }),
      ...(ref.path ? [open(ref.path, "Open Inventory", { icon: Icons.file, shortcut: "<Ctrl>o" })] : []),
      inTerminal(
        "Show Inventory Graph",
        ["ansible-inventory", ...(ref.path ? ["-i", relativeTo(ref.path, project.path)] : []), "--graph", "--vars"],
        project.path,
        prefs,
        { icon: Icons.layers, shortcut: "<Ctrl>g" },
      ),
      ...(ref.path ? [copy(ref.path, "Copy Path", { section: "Copy" })] : []),
    ],
  };
}

async function roleItems(project: Project): Promise<Item[]> {
  if (!project.hasRoles) return [];
  const names: string[] = [];
  try {
    for await (const e of Deno.readDir(`${project.path}/roles`)) {
      if (e.isDirectory && !e.name.startsWith(".")) names.push(e.name);
    }
  } catch {
    return [];
  }
  return names.sort(naturalCompare).map((name) => ({
    id: `role:${name}`,
    title: name,
    icon: { source: Icons.package, tint: "orange" },
    section: "Roles",
    keywords: ["role"],
    actions: [
      open(`${project.path}/roles/${name}`, "Open Role Folder", { icon: Icons.folder }),
      copy(name, "Copy Role Name", { section: "Copy" }),
    ],
  }));
}

function projectView(project: Project, prefs: Prefs): ListSpec {
  return list({
    title: project.name,
    placeholder: `Filter playbooks and inventories of ${project.name}…`,
    empty: { title: "No playbook or inventory here", icon: Icons.file },
    status: (items) => {
      const books = items.filter((i) => i.section === "Playbooks").length;
      return `${plural(books, "playbook")} · ${tilde(project.path, HOME)}`;
    },
    items: async () => {
      const [books, inventories, roles] = await Promise.all([
        readBooks(project),
        inventoriesOf(project),
        roleItems(project),
      ]);
      const chosen = await chosenInventory(project, inventories);
      return [
        ...books.map((b) => playbookItem(project, b, chosen, prefs)),
        ...inventories.map((r) => inventoryItem(project, r, r === chosen, books, prefs)),
        ...roles,
      ];
    },
    actions: [open(project.path, "Open Folder", { icon: Icons.folder })],
  });
}

function projectItem(project: Project, prefs: Prefs): Item {
  const where = tilde(project.path, HOME);
  return {
    id: project.path,
    title: project.name,
    subtitle: where,
    icon: { source: Icons.project, tint: "red" },
    keywords: [where, ...project.playbooks.map((p) => p.split("/").pop()!)],
    accessories: [
      ...(project.playbooks.length
        ? [{ tag: plural(project.playbooks.length, "playbook"), color: "green" as const }]
        : []),
      ...(project.inventories.length
        ? [{ tag: inventoryCount(project.inventories.length), color: "blue" as const }]
        : []),
      ...(project.modified ? [{ text: relativeTime(project.modified) }] : []),
    ],
    detail: {
      metadata: [
        meta.text("Folder", where, { icon: Icons.folder }),
        meta.text("ansible.cfg", project.hasConfig ? "Yes" : "No", { icon: Icons.settings }),
        meta.text("Roles folder", project.hasRoles ? "Yes" : "No", { icon: Icons.package }),
        ...(project.playbooks.length
          ? [meta.tags("Playbooks", project.playbooks.map((p) => relativeTo(p, project.path)))]
          : []),
        ...(project.inventories.length ? [meta.tags("Inventories", project.inventories.map((i) => i.name))] : []),
        ...(project.modified ? [meta.text("Changed", relativeTime(project.modified), { icon: Icons.clock })] : []),
      ],
    },
    actions: [
      action("Open Project", () => projectView(project, prefs), { icon: Icons.project }),
      action("Show Hosts", async () => {
        const all = await inventoriesOf(project);
        return inventoryView(project, await chosenInventory(project, all), await readBooks(project), prefs);
      }, { icon: Icons.server }),
      open(project.path, "Open Folder", { icon: Icons.folder, shortcut: "<Ctrl>o" }),
      inTerminal("Open Terminal Here", ["sh", "-c", 'exec "${SHELL:-sh}"'], project.path, prefs, {
        icon: Icons.terminal,
        shortcut: "<Ctrl>t",
      }),
      copy(project.path, "Copy Path", { section: "Copy", shortcut: "<Ctrl><Shift>c" }),
    ],
  };
}

// ---------------------------------------------------------------------------
// The command

export default list({
  placeholder: "Search Ansible projects…",
  empty: {
    title: "No Ansible project found",
    description:
      "Looked for ansible.cfg, inventories and playbooks. Add your folders in Settings → Extensions → Ansible.",
    icon: Icons.folder,
  },
  status: (items) => items[0]?.id === "missing" ? "" : plural(items.length, "project"),
  items: async function* ({ preferences, signal }) {
    const prefs = preferences as Prefs;
    const cached = await cachedProjects();
    if (cached.length) yield cached.map((p) => projectItem(p, prefs));
    try {
      await run("ansible-inventory", ["--version"], { signal });
    } catch (e) {
      if (e instanceof Missing) {
        yield [await missingItem(), ...cached.map((p) => projectItem(p, prefs))];
        return;
      }
    }
    const projects = await scan(prefs, signal);
    updateCommandMetadata({ subtitle: projects.length ? plural(projects.length, "project") : null }).catch(() => {});
    yield projects.map((p) => projectItem(p, prefs));
  },
});
