import {
  type Action,
  action,
  copy,
  Icons,
  type Item,
  list,
  type ListSpec,
  meta,
  open,
  refresh,
  updateCommandMetadata,
} from "@backslash/api";
import {
  consulConfig,
  consulProblems,
  consulServices,
  consulServiceUrl,
  datacenter,
  type Service,
  serviceInstances,
  SetupError,
  setupItem,
} from "../api.ts";
import {
  type Check,
  CHECK_COLORS,
  checksMarkdown,
  type ConsulService,
  instanceAddress,
  instanceHealth,
  nodeProblems,
  SERVICE_HEALTH,
  type ServiceEntry,
  serviceHealth,
  sortServices,
} from "../lib.ts";

function instanceItem(s: Service, dc: string, svc: ConsulService, e: ServiceEntry): Item {
  const h = SERVICE_HEALTH[instanceHealth(e)];
  const address = instanceAddress(e);
  const web = e.Service.Port && !/^(5432|3306|6379|27017|9092|53)$/.test(String(e.Service.Port));
  const failing = e.Checks.filter((c) => c.Status !== "passing");
  const actions: Action[] = [
    ...(web ? [open(`http://${address}`, `Open ${address}`, { icon: Icons.globe })] : []),
    copy(address, "Copy Address", { shortcut: "<Ctrl><Shift>c" }),
    open(consulServiceUrl(s, dc, svc.name), "Open in Consul", { shortcut: "<Ctrl>o" }),
    ...failing.slice(0, 1).map((c) => copy(c.Output ?? "", "Copy Failing Check Output", { section: "Copy" })),
    copy(e.Service.ID, "Copy Service ID", { section: "Copy" }),
  ];
  return {
    id: `${e.Node.Node}/${e.Service.ID}`,
    title: e.Service.ID,
    subtitle: `${e.Node.Node} · ${address}`,
    icon: { source: h.color === "red" ? Icons.alert : Icons.server, tint: h.color },
    section: h.section,
    keywords: [e.Node.Node, address, ...(e.Service.Tags ?? []), ...e.Checks.map((c) => c.Name)],
    accessories: [
      ...e.Checks.slice(0, 4).map((c) => ({
        icon: { source: Icons.dot, tint: CHECK_COLORS[c.Status] ?? "gray" },
        tooltip: `${c.Name}: ${c.Status}`,
      })),
      { tag: h.title, color: h.color },
    ],
    detail: {
      markdown: checksMarkdown(e),
      metadata: [
        meta.text("Health", h.title, { icon: Icons.dot, color: h.color }),
        meta.text("Address", address, { icon: Icons.globe }),
        meta.text("Node", `${e.Node.Node} (${e.Node.Address})`, { icon: Icons.server }),
        ...(e.Service.Tags?.length ? [meta.tags("Tags", e.Service.Tags)] : []),
        ...Object.entries(e.Service.Meta ?? {}).slice(0, 6).map(([k, v]) => meta.text(k, v)),
      ],
    },
    actions,
  };
}

function instancesView(s: Service, dc: string, svc: ConsulService): ListSpec {
  return list({
    title: svc.name,
    placeholder: `Filter instances of ${svc.name}…`,
    empty: { title: "No instances", description: "Nothing is registered for this service now", icon: Icons.server },
    status: (items) => `${svc.name} · ${items.length} instance${items.length === 1 ? "" : "s"}`,
    actions: [action("Reload", () => refresh(), { icon: Icons.refresh, shortcut: "<Ctrl><Shift>r" })],
    async items({ signal }) {
      const entries = await serviceInstances(s, svc.name, signal);
      const order = (e: ServiceEntry) => SERVICE_HEALTH[instanceHealth(e)].order;
      return entries.sort((a, b) => order(a) - order(b) || a.Node.Node.localeCompare(b.Node.Node))
        .map((e) => instanceItem(s, dc, svc, e));
    },
  });
}

function serviceItem(s: Service, dc: string, svc: ConsulService): Item {
  const h = SERVICE_HEALTH[serviceHealth(svc)];
  return {
    id: svc.name,
    title: svc.name,
    subtitle: svc.tags.slice(0, 4).join(", ") || undefined,
    icon: { source: h.color === "red" ? Icons.alert : Icons.globe, tint: h.color },
    section: h.section,
    keywords: [...svc.tags, ...svc.nodes, svc.kind ?? "", ...svc.sources],
    accessories: [
      ...(svc.critical ? [{ text: `${svc.critical} critical`, color: "red" as const }] : []),
      ...(svc.warning ? [{ text: `${svc.warning} warning`, color: "orange" as const }] : []),
      ...(svc.instances !== undefined
        ? [{ text: `${svc.instances} instance${svc.instances === 1 ? "" : "s"}`, icon: Icons.server }]
        : []),
      { tag: h.title, color: h.color },
    ],
    detail: {
      stats: [
        ...(svc.instances !== undefined ? [{ label: "instances", value: svc.instances }] : []),
        { label: "passing", value: svc.passing, color: "green" as const },
        ...(svc.warning ? [{ label: "warning", value: svc.warning, color: "orange" as const }] : []),
        ...(svc.critical ? [{ label: "critical", value: svc.critical, color: "red" as const }] : []),
      ],
      metadata: [
        meta.text("Health", h.title, { icon: Icons.dot, color: h.color }),
        ...(svc.tags.length ? [meta.tags("Tags", svc.tags)] : []),
        ...(svc.nodes.length ? [meta.tags("Nodes", svc.nodes.slice(0, 12))] : []),
        ...(svc.kind ? [meta.text("Kind", svc.kind)] : []),
        ...(svc.sources.length ? [meta.tags("Registered by", svc.sources)] : []),
        meta.text("DNS", `${svc.name}.service.consul`, { icon: Icons.globe }),
        meta.text("Datacenter", dc, { icon: Icons.server }),
      ],
    },
    actions: [
      action("Show Instances", () => instancesView(s, dc, svc), { icon: Icons.server }),
      open(consulServiceUrl(s, dc, svc.name), "Open in Consul"),
      copy(`${svc.name}.service.consul`, "Copy DNS Name", { shortcut: "<Ctrl><Shift>c", section: "Copy" }),
      copy(svc.name, "Copy Name", { shortcut: "<Ctrl>period", section: "Copy" }),
    ],
  };
}

function nodeCheckItem(s: Service, dc: string, c: Check): Item {
  return {
    id: `node/${c.Node}/${c.CheckID}`,
    title: `${c.Node}: ${c.Name}`,
    subtitle: "Node check",
    icon: { source: Icons.alert, tint: CHECK_COLORS[c.Status] ?? "red" },
    section: "Nodes",
    accessories: [{ tag: c.Status, color: CHECK_COLORS[c.Status] ?? "red" }],
    detail: {
      markdown: `### ${c.Name}\n\n\`\`\`\n${(c.Output ?? "").trim().replace(/```/g, "ʼʼʼ") || "(no output)"}\n\`\`\``,
    },
    actions: [
      open(
        `${s.url}/ui/${encodeURIComponent(dc)}/nodes/${encodeURIComponent(c.Node)}/health-checks`,
        "Open Node in Consul",
      ),
      copy(c.Output ?? "", "Copy Output"),
    ],
  };
}

let summary = "";

export default list({
  placeholder: "Filter services by name, tag, node…",
  filter: {
    options: [{ value: "all", title: "All" }, { value: "problems", title: "Failing Checks" }],
    default: "all",
  },
  empty: { title: "No services here", description: "Nothing matches, or nothing is registered", icon: Icons.globe },
  status: () => summary,
  actions: [action("Reload", () => refresh(), { icon: Icons.refresh, shortcut: "<Ctrl><Shift>r" })],
  async items({ preferences, filter, signal }) {
    summary = "";
    try {
      const s = consulConfig(preferences);
      const [services, critical, dc] = await Promise.all([
        consulServices(s, signal),
        consulProblems(s, signal).catch(() => [] as Check[]),
        datacenter(s, signal),
      ]);
      let sorted = sortServices(services);
      const nodes = nodeProblems(critical);
      const failing = sorted.filter((x) => x.critical || x.warning).length;
      updateCommandMetadata({ subtitle: failing ? `${failing} failing` : null }).catch(() => {});
      if (filter === "problems") sorted = sorted.filter((x) => x.critical || x.warning);
      summary = [
        `${new URL(s.url).host} · ${dc}`,
        `${services.length} service${services.length === 1 ? "" : "s"}`,
        failing ? `${failing} failing` : "all passing",
        ...(nodes.length ? [`${nodes.length} node check${nodes.length === 1 ? "" : "s"} failing`] : []),
      ].join(" · ");
      return [...nodes.map((c) => nodeCheckItem(s, dc, c)), ...sorted.map((x) => serviceItem(s, dc, x))];
    } catch (e) {
      if (e instanceof SetupError) return [setupItem(e, "Consul")];
      throw e;
    }
  },
});
