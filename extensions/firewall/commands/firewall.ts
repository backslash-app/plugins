import {
  type Action,
  action,
  type Color,
  type Context,
  copy,
  field,
  form,
  Icons,
  type Item,
  list,
  meta,
  type Metadata,
  open,
  pop,
  toast,
  updateCommandMetadata,
} from "@backslash/api";
import {
  describeRich,
  firewalldAddArgs,
  firewalldScript,
  installHint,
  parseUfwConfig,
  parseUfwScript,
  parseZones,
  pkexecError,
  type Protocol,
  removalArgs,
  ruleCommand,
  type RuleInput,
  ruleSentence,
  ruleTitle,
  shellLine,
  sortZones,
  UFW_STATUS_SCRIPT,
  ufwAddCommands,
  type UfwConfig,
  ufwDeleteArgs,
  type UfwRule,
  type UfwSnapshot,
  validatePort,
  validateSource,
  type Zone,
} from "../lib.ts";

interface Output {
  code: number;
  stdout: string;
  stderr: string;
}

async function sh(program: string, args: string[], timeout = 60_000): Promise<Output> {
  const { code, stdout, stderr } = await new Deno.Command(program, {
    args,
    stdin: "null",
    stdout: "piped",
    stderr: "piped",
    env: { LC_ALL: "C" },
    signal: AbortSignal.timeout(timeout),
  }).output();
  const text = (b: Uint8Array) => new TextDecoder().decode(b);
  return { code, stdout: text(stdout), stderr: text(stderr).trim() };
}

/** Runs a script as root, after polkit asks for the password once. */
async function asRoot(script: string): Promise<string> {
  let o: Output;
  try {
    // Two minutes to type the password.
    o = await sh("pkexec", ["/bin/sh", "-c", script], 120_000);
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) throw new Error("pkexec (polkit) is needed to change the firewall");
    throw e;
  }
  const denied = pkexecError(o.code, o.stderr);
  if (denied) throw new Error(denied);
  if (o.code !== 0) throw new Error(o.stderr.split("\n").filter(Boolean).pop() || `Exited with ${o.code}`);
  return o.stdout;
}

// --- State ---------------------------------------------------------------------

/** What `ufw status` said as root, kept while the command is open. */
let ufwRoot: UfwSnapshot | undefined;

const changes = new EventTarget();
const changed = () => changes.dispatchEvent(new Event("change"));

async function* live<T>(load: () => Promise<T>, signal: AbortSignal): AsyncGenerator<T> {
  while (!signal.aborted) {
    yield await load();
    await new Promise<void>((resolve) => {
      const done = () => {
        changes.removeEventListener("change", done);
        signal.removeEventListener("abort", done);
        resolve();
      };
      changes.addEventListener("change", done);
      signal.addEventListener("abort", done);
    });
  }
}

async function ufwConfig(): Promise<UfwConfig | undefined> {
  let conf: string;
  try {
    conf = await Deno.readTextFile("/etc/ufw/ufw.conf");
  } catch {
    return undefined;
  }
  return parseUfwConfig(conf, await Deno.readTextFile("/etc/default/ufw").catch(() => ""));
}

/** As root, then the fresh rules, in one password prompt. */
async function ufwRun(commands: string[][], message: string) {
  // The status only after the change succeeded, so its error isn't hidden.
  const script = `${commands.map((c) => shellLine(["ufw", ...c])).join(" && ")} && { ${UFW_STATUS_SCRIPT}; }`;
  ufwRoot = parseUfwScript(await asRoot(script));
  await toast(message, { style: "success" });
  changed();
}

type Firewalld = { state: "missing" } | { state: "stopped" } | { state: "running"; zones: Zone[]; error?: string };

async function firewalld(): Promise<Firewalld> {
  let state: Output;
  try {
    state = await sh("firewall-cmd", ["--state"], 10_000);
  } catch (e) {
    if (e instanceof Deno.errors.NotFound || e instanceof Deno.errors.NotCapable) return { state: "missing" };
    throw e;
  }
  if (state.code !== 0 || !/running/.test(state.stdout) || /not running/.test(state.stdout + state.stderr)) {
    return { state: "stopped" };
  }
  const all = await sh("firewall-cmd", ["--list-all-zones"]);
  if (all.code !== 0) {
    return { state: "running", zones: [], error: all.stderr || `firewall-cmd exited with ${all.code}` };
  }
  return { state: "running", zones: sortZones(parseZones(all.stdout)) };
}

async function firewalldRun(script: string, message: string) {
  await asRoot(script);
  await toast(message, { style: "success" });
  changed();
}

// --- Forms ---------------------------------------------------------------------

function ruleForm(o: { kind: "ufw" } | { kind: "firewalld"; zones: Zone[]; zone: string }, action: "allow" | "deny") {
  const ufw = o.kind === "ufw";
  return form({
    title: action === "allow" ? "Allow a Port" : "Block a Port",
    submitTitle: action === "allow" ? "Allow" : "Block",
    fields: [
      field.text("port", "Port", { placeholder: "22, 8000-8100, 80,443 or a service: ssh", required: true }),
      field.dropdown("protocol", "Protocol", [
        { value: "tcp", title: "TCP" },
        { value: "udp", title: "UDP" },
        { value: "any", title: "TCP and UDP" },
      ], { value: "tcp" }),
      field.text("from", "From", { placeholder: "Anywhere, or 192.168.1.0/24" }),
      field.dropdown(
        "action",
        "Action",
        ufw
          ? [
            { value: "allow", title: "Allow" },
            { value: "limit", title: "Allow, limiting repeated connections (SSH)" },
            { value: "deny", title: "Deny (drop silently)" },
            { value: "reject", title: "Reject (tell the sender)" },
          ]
          : [
            { value: "allow", title: "Allow" },
            { value: "deny", title: "Drop silently" },
            { value: "reject", title: "Reject (tell the sender)" },
          ],
        { value: action },
      ),
      ...(ufw ? [field.text("comment", "Comment", { placeholder: "What it is for" })] : [field.dropdown(
        "zone",
        "Zone",
        o.zones.map((z) => ({
          value: z.name,
          title: `${z.name}${z.default ? " (default)" : z.active ? " (active)" : ""}`,
        })),
        { value: o.zone },
      )]),
    ],
    async submit(values) {
      const input: RuleInput = {
        action: String(values.action) as RuleInput["action"],
        port: String(values.port ?? ""),
        protocol: String(values.protocol ?? "tcp") as Protocol,
        from: String(values.from ?? ""),
        comment: String(values.comment ?? ""),
      };
      const problem = validatePort(input.port) ?? validateSource(input.from);
      if (problem) throw new Error(problem);
      const verb = input.action === "allow" || input.action === "limit" ? "Allowed" : "Blocked";
      if (o.kind === "ufw") {
        await ufwRun(ufwAddCommands(input), `${verb} ${input.port}`);
      } else {
        const zone = String(values.zone || o.zone);
        await firewalldRun(firewalldScript(zone, firewalldAddArgs(input)), `${verb} ${input.port} in ${zone}`);
      }
      return pop();
    },
  });
}

// --- ufw items ----------------------------------------------------------------

const ACTION_LOOK: Record<string, { tint: Color; icon: string; label: string }> = {
  ALLOW: { tint: "green", icon: Icons.check, label: "Allow" },
  LIMIT: { tint: "yellow", icon: Icons.timer, label: "Limit" },
  DENY: { tint: "red", icon: Icons.cross, label: "Deny" },
  REJECT: { tint: "orange", icon: Icons.cross, label: "Reject" },
};

function ufwCommon(): Action[] {
  return [
    action("Allow a Port…", () => ruleForm({ kind: "ufw" }, "allow"), {
      icon: Icons.plus,
      shortcut: "<Ctrl>n",
      section: "Rules",
    }),
    action("Block a Port…", () => ruleForm({ kind: "ufw" }, "deny"), {
      icon: Icons.shield,
      shortcut: "<Ctrl>b",
      section: "Rules",
    }),
    action(ufwRoot ? "Reload Rules" : "Show Rules", async () => {
      ufwRoot = parseUfwScript(await asRoot(UFW_STATUS_SCRIPT));
      changed();
    }, { icon: Icons.refresh, shortcut: "<Ctrl>r", section: "Rules" }),
  ];
}

function ufwStatusItem(conf: UfwConfig): Item {
  const active = ufwRoot ? ufwRoot.status.active : conf.enabled;
  const s = ufwRoot?.status;
  const incoming = s?.incoming ?? conf.incoming ?? "?", outgoing = s?.outgoing ?? conf.outgoing ?? "?";
  const routed = s?.routed ?? conf.routed;
  const tint: Color = active ? "green" : "red";
  const metadata: Metadata[] = [
    meta.text("Firewall", active ? "Active" : "Inactive", { icon: { source: Icons.shield, tint }, color: tint }),
    meta.text("Incoming", incoming, { icon: Icons.arrowDown, color: incoming === "allow" ? "orange" : undefined }),
    meta.text("Outgoing", outgoing, { icon: Icons.arrowUp }),
    ...(routed ? [meta.text("Routed", routed, { icon: Icons.arrowRight })] : []),
    meta.text("Logging", s?.logging ?? conf.logLevel ?? "?", { icon: Icons.note }),
    ...(ufwRoot ? [meta.text("Rules", String(ufwRoot.rules.length), { icon: Icons.layers })] : []),
  ];
  const toggle = active
    ? action("Disable Firewall", () => ufwRun([["disable"]], "Firewall disabled"), {
      icon: Icons.power,
      destructive: true,
      confirm: "Turn the firewall off? Every port becomes reachable",
      section: "Firewall",
    })
    : action("Enable Firewall", () => ufwRun([["--force", "enable"]], "Firewall enabled"), {
      icon: Icons.power,
      confirm: incoming === "allow"
        ? "Enable the firewall? Incoming connections are allowed by default"
        : "Enable the firewall? Incoming connections without a rule are blocked (SSH too)",
      section: "Firewall",
    });
  const common = ufwCommon();
  return {
    id: "ufw",
    title: `ufw · ${active ? "Active" : "Inactive"}`,
    subtitle: `Incoming ${incoming} · Outgoing ${outgoing}`,
    icon: { source: Icons.shield, tint },
    section: "Status",
    keywords: ["ufw", "status", active ? "enabled" : "disabled"],
    accessories: [
      ...(ufwRoot
        ? [{ text: `${ufwRoot.rules.length} rules` }]
        : [{ text: "Rules need your password", icon: Icons.lock }]),
      { tag: active ? "On" : "Off", color: tint },
    ],
    detail: {
      stats: [
        { label: "State", value: active ? "Active" : "Inactive", color: tint },
        { label: "Incoming", value: incoming },
        { label: "Outgoing", value: outgoing },
      ],
      markdown: ufwRoot
        ? undefined
        : "Rules are readable by root only: **Enter** shows them after asking for your password.",
      metadata,
    },
    actions: ufwRoot
      ? [common[0], toggle, ...common.filter((_, i) => i !== 0)]
      : [common[2], common[0], common[1], toggle],
  };
}

function ufwRuleItem(r: UfwRule): Item {
  const look = ACTION_LOOK[r.action];
  const title = ruleTitle(r);
  return {
    id: `ufw:${r.number ?? r.spec}:${r.to}:${r.from}:${r.v6}`,
    title: r.comment ? `${title} · ${r.comment}` : title,
    subtitle: ruleSentence(r),
    icon: { source: look.icon, tint: look.tint },
    section: "Rules",
    keywords: [r.to, r.from, r.action, r.comment ?? "", r.v6 ? "ipv6" : "ipv4"],
    accessories: [
      ...(r.v6 ? [{ tag: "IPv6", color: "purple" as const }] : []),
      ...(r.direction !== "IN" ? [{ tag: r.direction === "OUT" ? "Out" : "Forward", color: "blue" as const }] : []),
      { tag: look.label, color: look.tint },
      ...(r.number !== undefined ? [{ text: `#${r.number}`, tooltip: "Rule number" }] : []),
    ],
    detail: {
      metadata: [
        meta.text("Action", look.label, { icon: { source: look.icon, tint: look.tint }, color: look.tint }),
        meta.text("To", r.to, { icon: Icons.plug }),
        meta.text("From", r.from, { icon: Icons.globe }),
        meta.text("Direction", { IN: "Incoming", OUT: "Outgoing", FWD: "Forwarded" }[r.direction], {
          icon: r.direction === "OUT" ? Icons.arrowUp : Icons.arrowDown,
        }),
        meta.text("IP version", r.v6 ? "IPv6" : "IPv4", { icon: Icons.hash }),
        ...(r.comment ? [meta.text("Comment", r.comment, { icon: Icons.comment })] : []),
        ...(r.log ? [meta.text("Logged", "Yes", { icon: Icons.note })] : []),
        meta.separator(),
        meta.text("Command", ruleCommand(r), { icon: Icons.terminal }),
      ],
    },
    actions: [
      action("Delete Rule", () => ufwRun([ufwDeleteArgs(r)], `Rule ${title} deleted`), {
        icon: Icons.trash,
        destructive: true,
        confirm: `Delete “${ruleSentence(r)}” to ${title}${r.v6 ? " (IPv6)" : ""}?`,
        shortcut: "<Ctrl>Delete",
        section: "Danger",
      }),
      ...ufwCommon(),
      copy(ruleCommand(r), "Copy as Command", { section: "Copy", shortcut: "<Ctrl><Shift>c" }),
    ],
  };
}

// --- firewalld items -----------------------------------------------------------

function zoneItem(z: Zone, fw: Firewalld & { state: "running" }): Item {
  const tint: Color = z.active ? "green" : "gray";
  const allowsAll = z.target === "ACCEPT";
  const add = (a: "allow" | "deny") =>
    action(
      a === "allow" ? "Allow a Port…" : "Block a Port…",
      () => ruleForm({ kind: "firewalld", zones: fw.zones, zone: z.name }, a),
      {
        icon: a === "allow" ? Icons.plus : Icons.shield,
        shortcut: a === "allow" ? "<Ctrl>n" : "<Ctrl>b",
        section: "Rules",
      },
    );
  const count = z.services.length + z.ports.length + z.richRules.length;
  return {
    id: `zone:${z.name}`,
    title: `Zone ${z.name}`,
    subtitle: [
      z.default ? "Default" : z.active ? "Active" : "Inactive",
      z.interfaces.length ? z.interfaces.join(", ") : "",
      z.sources.length ? z.sources.join(", ") : "",
    ].filter(Boolean).join(" · "),
    icon: { source: Icons.layers, tint },
    section: z.active || z.default ? "Active Zones" : "Other Zones",
    keywords: ["zone", z.name, ...z.interfaces, ...z.sources],
    accessories: [
      { text: `${count} rule${count === 1 ? "" : "s"}` },
      ...(z.default ? [{ tag: "Default", color: "blue" as const }] : []),
      { tag: z.active ? "Active" : "Inactive", color: tint },
    ],
    detail: {
      stats: [
        { label: "Services", value: z.services.length },
        { label: "Ports", value: z.ports.length },
        { label: "Rich rules", value: z.richRules.length },
      ],
      metadata: [
        meta.text("Target", z.target ?? "default", {
          icon: Icons.shield,
          color: allowsAll ? "orange" : undefined,
        }),
        meta.tags("Interfaces", z.interfaces.length ? z.interfaces : ["None"]),
        meta.tags("Sources", z.sources.length ? z.sources : ["None"]),
        meta.tags(
          "Services",
          z.services.length ? z.services.map((s) => ({ text: s, color: "green" as const })) : ["None"],
        ),
        meta.tags("Ports", z.ports.length ? z.ports.map((p) => ({ text: p, color: "green" as const })) : ["None"]),
        meta.text("Masquerade", z.masquerade ? "Yes" : "No", { icon: Icons.eyeOff }),
        ...(z.forwardPorts.length
          ? [meta.text("Forwarded ports", z.forwardPorts.join(", "), { icon: Icons.arrowRight })]
          : []),
        ...(z.icmpBlocks.length ? [meta.tags("ICMP blocked", z.icmpBlocks)] : []),
      ],
    },
    actions: [
      add("allow"),
      add("deny"),
      copy(`firewall-cmd --zone=${z.name} --list-all`, "Copy List Command", { section: "Copy" }),
    ],
  };
}

function zoneRuleItems(z: Zone, fw: Firewalld & { state: "running" }): Item[] {
  const section = `Zone ${z.name}`;
  const remove = (kind: "port" | "service" | "rich-rule", value: string, label: string) =>
    action(
      "Remove Rule",
      () => firewalldRun(firewalldScript(z.name, removalArgs(kind, value)), `${label} removed from ${z.name}`),
      {
        icon: Icons.trash,
        destructive: true,
        confirm: `Remove ${label} from zone ${z.name}?`,
        shortcut: "<Ctrl>Delete",
        section: "Danger",
      },
    );
  const add = action("Allow a Port…", () => ruleForm({ kind: "firewalld", zones: fw.zones, zone: z.name }, "allow"), {
    icon: Icons.plus,
    shortcut: "<Ctrl>n",
    section: "Rules",
  });
  const items: Item[] = [];
  for (const s of z.services) {
    items.push({
      id: `${z.name}:service:${s}`,
      title: s,
      subtitle: "Service allowed",
      icon: { source: Icons.box, tint: "green" },
      section,
      keywords: ["service", z.name],
      accessories: [{ tag: "Allow", color: "green" }],
      detail: {
        metadata: [
          meta.text("Service", s, { icon: Icons.box }),
          meta.text("Zone", z.name, { icon: Icons.layers }),
          meta.text("Ports", "As defined by firewalld (firewall-cmd --info-service)", { icon: Icons.plug }),
        ],
      },
      actions: [
        remove("service", s, `service ${s}`),
        add,
        copy(`firewall-cmd --info-service=${s}`, "Copy Info Command", { section: "Copy" }),
      ],
    });
  }
  for (const p of z.ports) {
    items.push({
      id: `${z.name}:port:${p}`,
      title: p,
      subtitle: "Port allowed",
      icon: { source: Icons.plug, tint: "green" },
      section,
      keywords: ["port", z.name],
      accessories: [{ tag: "Allow", color: "green" }],
      detail: {
        metadata: [meta.text("Port", p, { icon: Icons.plug }), meta.text("Zone", z.name, { icon: Icons.layers })],
      },
      actions: [remove("port", p, `port ${p}`), add, copy(p, "Copy Port", { section: "Copy" })],
    });
  }
  for (const rule of z.richRules) {
    const d = describeRich(rule);
    const allow = d.action === "Allow";
    const what = d.port ?? d.service ?? "Any port";
    items.push({
      id: `${z.name}:rich:${rule}`,
      title: what,
      subtitle: `${d.action} from ${d.from ?? "anywhere"}`,
      icon: { source: allow ? Icons.check : Icons.cross, tint: allow ? "green" : "red" },
      section,
      keywords: ["rich rule", z.name, rule],
      accessories: [{ tag: d.action, color: allow ? "green" : "red" }],
      detail: {
        markdown: `\`\`\`\n${rule}\n\`\`\``,
        metadata: [
          meta.text("Action", d.action, { icon: allow ? Icons.check : Icons.cross, color: allow ? "green" : "red" }),
          meta.text("To", what, { icon: Icons.plug }),
          meta.text("From", d.from ?? "Anywhere", { icon: Icons.globe }),
          meta.text("Zone", z.name, { icon: Icons.layers }),
        ],
      },
      actions: [remove("rich-rule", rule, `rule ${what}`), add, copy(rule, "Copy Rich Rule", { section: "Copy" })],
    });
  }
  return items;
}

function firewalldItems(fw: Firewalld): Item[] {
  if (fw.state === "missing") return [];
  if (fw.state === "stopped") {
    return [{
      id: "firewalld",
      title: "firewalld · Not Running",
      subtitle: "Every port is reachable",
      icon: { source: Icons.shield, tint: "red" },
      section: "Status",
      accessories: [{ tag: "Off", color: "red" }],
      detail: { markdown: "firewalld is installed but stopped. **Enter** starts it and enables it at boot." },
      actions: [
        action("Start firewalld", () => firewalldRun("systemctl enable --now firewalld", "firewalld started"), {
          icon: Icons.power,
          confirm: "Start firewalld? Connections the zones don't allow are blocked",
        }),
      ],
    }];
  }
  const def = fw.zones.find((z) => z.default);
  const active = fw.zones.filter((z) => z.active || z.default);
  const status: Item = {
    id: "firewalld",
    title: "firewalld · Running",
    subtitle: `Default zone ${def?.name ?? "?"}${active.length > 1 ? ` · ${active.length} active zones` : ""}`,
    icon: { source: Icons.shield, tint: "green" },
    section: "Status",
    keywords: ["firewalld", "status"],
    accessories: [{ tag: "On", color: "green" }],
    detail: {
      stats: [
        { label: "State", value: "Running", color: "green" },
        { label: "Default zone", value: def?.name ?? "?" },
        { label: "Active zones", value: active.length },
      ],
      markdown: fw.error ? `Couldn't list the zones:\n\n\`\`\`\n${fw.error}\n\`\`\`` : undefined,
      metadata: [
        meta.tags("Active zones", active.map((z) => ({ text: z.name, color: "green" as const }))),
        meta.text("Zones", String(fw.zones.length), { icon: Icons.layers }),
      ],
    },
    actions: [
      ...(def
        ? [action("Allow a Port…", () => ruleForm({ kind: "firewalld", zones: fw.zones, zone: def.name }, "allow"), {
          icon: Icons.plus,
          shortcut: "<Ctrl>n",
        })]
        : []),
      action("Stop firewalld", () => firewalldRun("systemctl disable --now firewalld", "firewalld stopped"), {
        icon: Icons.power,
        destructive: true,
        confirm: "Stop firewalld and disable it at boot? Every port becomes reachable",
        section: "Firewall",
      }),
    ],
  };
  return [
    status,
    ...active.map((z) => zoneItem(z, fw)),
    ...active.flatMap((z) => zoneRuleItems(z, fw)),
    ...fw.zones.filter((z) => !active.includes(z)).map((z) => zoneItem(z, fw)),
  ];
}

// --- Command -------------------------------------------------------------------

async function emptyItems(): Promise<Item[]> {
  const os = await Deno.readTextFile("/etc/os-release").catch(() => "");
  const hint = installHint(os);
  return [{
    id: "install",
    title: "No firewall found",
    subtitle: `Install ${hint.tool}`,
    icon: { source: Icons.shield, tint: "orange" },
    detail: {
      markdown: [
        "## No firewall installed",
        "",
        "Backslash knows **ufw** (Ubuntu, Debian, Arch) and **firewalld** (Fedora, openSUSE, RHEL). On this system:",
        "",
        "```",
        hint.command,
        "```",
      ].join("\n"),
    },
    actions: [
      copy(hint.command, "Copy Install Command"),
      open(
        hint.tool === "ufw" ? "https://help.ubuntu.com/community/UFW" : "https://firewalld.org/documentation/",
        `${hint.tool} Documentation`,
        { icon: Icons.book },
      ),
    ],
  }];
}

export default (_ctx: Context) => {
  let shown = "";
  return list({
    placeholder: "Filter rules by port, address, zone…",
    empty: { title: "No rule", description: "Ctrl+N allows a port", icon: Icons.shield },
    status: () => shown,
    items: ({ signal }) =>
      live(async () => {
        const [conf, fw] = await Promise.all([ufwConfig(), firewalld()]);
        if (!conf && fw.state === "missing") {
          shown = "";
          return await emptyItems();
        }
        const items: Item[] = [];
        const parts: string[] = [];
        if (conf) {
          items.push(ufwStatusItem(conf));
          if (ufwRoot) items.push(...ufwRoot.rules.map(ufwRuleItem));
          const active = ufwRoot ? ufwRoot.status.active : conf.enabled;
          parts.push(`ufw ${active ? "active" : "inactive"}${ufwRoot ? ` · ${ufwRoot.rules.length} rules` : ""}`);
        }
        items.push(...firewalldItems(fw));
        if (fw.state !== "missing") {
          parts.push(
            fw.state === "running"
              ? `firewalld running · zone ${fw.zones.find((z) => z.default)?.name ?? "?"}`
              : "firewalld stopped",
          );
        }
        shown = parts.join(" · ");
        const on = (conf && (ufwRoot ? ufwRoot.status.active : conf.enabled)) || fw.state === "running";
        updateCommandMetadata({ subtitle: on ? "Active" : "Off" }).catch(() => {});
        return items;
      }, signal),
  });
};
