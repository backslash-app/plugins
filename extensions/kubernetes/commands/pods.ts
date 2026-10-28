import {
  type Action,
  action,
  close,
  copy,
  detail,
  type DetailSpec,
  exec,
  Icons,
  type Item,
  list,
  meta,
  type Metadata,
  refresh,
  submenu,
  toast,
} from "@backslash/api";
import {
  age,
  deleteCommand,
  describeCommand,
  filterPods,
  HEALTH_COLORS,
  localPort,
  logsCommand,
  parsePods,
  type Pod,
  type PodFilter,
  portForwardCommand,
  shellCommand,
  sortPods,
  type Target,
} from "../lib.ts";
import {
  clusterActions,
  errorItem,
  isMissing,
  kubeconfig,
  kubectl,
  kubectlMissing,
  noContext,
  showTarget,
  target,
} from "../kube.ts";
import { runInTerminal, shellLine } from "../terminal.ts";

interface Prefs {
  terminal?: string;
}

const SECTIONS = { failed: "Problems", pending: "Starting", ok: "Running", done: "Completed" };

const fence = (text: string) => `\`\`\`\n${text.replace(/```/g, "ʼʼʼ") || "(empty)"}\n\`\`\``;

async function logsView(t: Target, pod: Pod, prefs: Prefs, container?: string, previous = false): Promise<DetailSpec> {
  const argv = logsCommand(t, pod.name, { container, previous });
  const text = await exec(argv[0], argv.slice(1)).catch((e) => `${e.message}`);
  const lines = text ? text.split("\n").length : 0;
  return detail({
    title: `${pod.name}${container ? ` · ${container}` : ""}`,
    markdown: fence(text),
    metadata: podMetadata(pod, t),
    status: `${previous ? "Previous container · " : ""}Last ${Math.min(lines, 200)} lines${
      container ? ` of ${container}` : ""
    }`,
    actions: [
      copy(text, "Copy Logs", { shortcut: "<Ctrl><Shift>c" }),
      action("Reload", () => logsView(t, pod, prefs, container, previous), {
        icon: Icons.refresh,
        shortcut: "<Ctrl>r",
      }),
      action("Follow in Terminal", () => {
        runInTerminal(logsCommand(t, pod.name, { container, follow: true, tail: 50 }), prefs.terminal || undefined);
        return close();
      }, { icon: Icons.terminal, shortcut: "<Ctrl>t" }),
    ],
  });
}

async function describeView(t: Target, pod: Pod): Promise<DetailSpec> {
  const argv = describeCommand(t, pod.name);
  const text = await exec(argv[0], argv.slice(1));
  return detail({
    title: pod.name,
    markdown: fence(text),
    metadata: podMetadata(pod, t),
    status: `kubectl describe pod ${pod.name}`,
    actions: [copy(text, "Copy Description", { shortcut: "<Ctrl><Shift>c" })],
  });
}

function podMetadata(pod: Pod, t: Target): Metadata[] {
  const color = HEALTH_COLORS[pod.health];
  const appLabels = ["app.kubernetes.io/name", "app", "app.kubernetes.io/version", "version", "tier", "component"]
    .filter((k) => pod.labels[k])
    .map((k) => `${k.replace("app.kubernetes.io/", "")}=${pod.labels[k]}`);
  const lastCrash = pod.containers.find((c) => c.lastTermination?.reason);
  return [
    meta.text("Status", pod.status, { icon: Icons.dot, color }),
    meta.tags(
      "Containers",
      pod.containers.map((c) => ({
        text: c.name,
        color: c.ready ? "green" as const : c.state === "terminated" ? "gray" as const : "red" as const,
      })),
    ),
    ...(pod.workload ? [meta.text(pod.workload.kind, pod.workload.name, { icon: Icons.layers })] : []),
    ...(pod.node ? [meta.text("Node", pod.node, { icon: Icons.server })] : []),
    ...(pod.ip ? [meta.text("Pod IP", pod.ip, { icon: Icons.globe })] : []),
    ...(lastCrash
      ? [meta.text(
        "Last restart",
        `${lastCrash.lastTermination!.reason}${
          lastCrash.lastTermination!.exitCode !== undefined ? ` (exit ${lastCrash.lastTermination!.exitCode})` : ""
        }`,
        { icon: Icons.alert, color: "orange" },
      )]
      : []),
    ...(appLabels.length ? [meta.tags("Labels", appLabels)] : []),
    meta.separator(),
    meta.tags("Images", pod.containers.map((c) => c.image.split("/").pop()!)),
    ...(pod.qos ? [meta.text("QoS", pod.qos)] : []),
    meta.text("Namespace", t.namespace, { icon: Icons.layers }),
    meta.text("Context", t.context, { icon: Icons.server }),
    ...(pod.created ? [meta.text("Created", pod.created.toLocaleString("en-GB"), { icon: Icons.calendar })] : []),
  ];
}

function podItem(pod: Pod, t: Target, prefs: Prefs): Item {
  const color = HEALTH_COLORS[pod.health];
  const term = prefs.terminal || undefined;
  const inTerminal = (title: string, argv: string[], o: { icon?: string; shortcut?: string; section?: string } = {}) =>
    action(title, () => {
      runInTerminal(argv, term);
      return close();
    }, { icon: Icons.terminal, ...o });
  const multi = pod.containers.length > 1;
  const ports = pod.containers.flatMap((c) => c.ports.map((p) => ({ ...p, container: c.name })));
  const actions: Action[] = [
    action("Show Logs", () => logsView(t, pod, prefs), { icon: Icons.text }),
    action("Describe", () => describeView(t, pod), { icon: Icons.info, shortcut: "<Ctrl>d" }),
  ];
  if (multi) {
    actions.push(submenu(
      "Logs of Container",
      pod.containers.map((c) => action(c.name, () => logsView(t, pod, prefs, c.name), { icon: Icons.box })),
      { icon: Icons.text, shortcut: "<Ctrl>l" },
    ));
  }
  if (pod.restarts > 0) {
    actions.push(action("Logs Before Last Restart", () => {
      const crashed = pod.containers.find((c) => c.restarts > 0);
      return logsView(t, pod, prefs, crashed?.name, true);
    }, { icon: Icons.history, shortcut: "<Ctrl><Shift>l" }));
  }
  actions.push(inTerminal("Follow Logs in Terminal", logsCommand(t, pod.name, { follow: true, tail: 50 }), {
    shortcut: "<Ctrl>f",
    section: "Terminal",
  }));
  if (pod.health === "ok" || pod.health === "pending") {
    actions.push(
      multi
        ? submenu("Open Shell", pod.containers.map((c) => inTerminal(c.name, shellCommand(t, pod.name, c.name))), {
          icon: Icons.terminal,
          shortcut: "<Ctrl>s",
          section: "Terminal",
        })
        : inTerminal("Open Shell", shellCommand(t, pod.name), { shortcut: "<Ctrl>s", section: "Terminal" }),
    );
  }
  if (ports.length) {
    actions.push(submenu(
      "Port Forward",
      ports.map((p) =>
        inTerminal(
          `localhost:${localPort(p.port)} → ${p.port}${p.name ? ` (${p.name})` : ""}`,
          portForwardCommand(t, pod.name, p.port, localPort(p.port)),
          { icon: Icons.plug },
        )
      ),
      { icon: Icons.plug, shortcut: "<Ctrl>p", section: "Terminal" },
    ));
  }
  actions.push(
    copy(pod.name, "Copy Pod Name", { shortcut: "<Ctrl>period", section: "Copy" }),
    copy(shellLine(logsCommand(t, pod.name)), "Copy Logs Command", { icon: Icons.terminal, section: "Copy" }),
    ...(ports.length
      ? [
        copy(
          shellLine(portForwardCommand(t, pod.name, ports[0].port, localPort(ports[0].port))),
          "Copy Port-Forward Command",
          {
            icon: Icons.plug,
            section: "Copy",
          },
        ),
      ]
      : []),
    ...clusterActions(),
    action("Delete Pod", async () => {
      const argv = deleteCommand(t, pod.name);
      await exec(argv[0], argv.slice(1));
      await toast(`Deleted ${pod.name}`, {
        style: "success",
        message: pod.owner
          ? `${pod.workload?.kind ?? pod.owner.kind} ${pod.workload?.name ?? pod.owner.name} recreates it`
          : undefined,
      });
      return refresh();
    }, {
      icon: Icons.trash,
      destructive: true,
      shortcut: "<Ctrl><Shift>Delete",
      confirm: pod.owner
        ? `Delete ${pod.name}? Its ${pod.workload?.kind ?? pod.owner.kind} starts a new one (restart).`
        : `Delete ${pod.name}? It has no controller: it will not come back.`,
      section: "Danger",
    }),
  );
  const restartColor = pod.restarts > 5 ? "red" as const : "orange" as const;
  return {
    id: pod.name,
    title: pod.name,
    subtitle: pod.workload ? pod.workload.name : undefined,
    icon: { source: Icons.box, tint: color },
    section: SECTIONS[pod.health],
    keywords: [pod.status, pod.node ?? "", ...pod.containers.map((c) => c.name), ...Object.values(pod.labels)],
    accessories: [
      ...(pod.health !== "ok" ? [{ tag: pod.status, color }] : []),
      ...(pod.restarts
        ? [{ icon: { source: Icons.refresh, tint: restartColor }, text: String(pod.restarts), tooltip: "Restarts" }]
        : []),
      {
        text: `${pod.ready}/${pod.total}`,
        tooltip: "Containers ready",
        color: pod.ready === pod.total ? undefined : color,
      },
      { text: age(pod.created), tooltip: "Age" },
    ],
    detail: {
      stats: [
        { label: "ready", value: `${pod.ready}/${pod.total}`, color: pod.ready === pod.total ? "green" : color },
        { label: "restarts", value: pod.restarts, color: pod.restarts ? restartColor : undefined },
        { label: "age", value: age(pod.created) },
      ],
      metadata: podMetadata(pod, t),
    },
    actions,
  };
}

let summary = "";

export default list({
  placeholder: "Filter pods by name, status, node, label…",
  filter: {
    options: [
      { value: "running", title: "Running" },
      { value: "problem", title: "Problems" },
      { value: "all", title: "All" },
    ],
    default: "all",
  },
  empty: { title: "No pods here", description: "Nothing matches in this namespace", icon: Icons.box },
  status: () => summary,
  actions: clusterActions(),
  async items({ preferences, filter, signal }) {
    const prefs = preferences as Prefs;
    summary = "";
    let t: Target | undefined;
    try {
      t = target(await kubeconfig(signal));
    } catch (err) {
      return [isMissing(err) ? kubectlMissing : errorItem(err)];
    }
    await showTarget(t);
    if (!t) return [noContext];
    let pods: Pod[];
    try {
      pods = parsePods(await kubectl(["--context", t.context, "-n", t.namespace, "get", "pods", "-o", "json"], signal));
    } catch (err) {
      return [errorItem(err, t)];
    }
    const problems = pods.filter((p) => p.health === "failed").length;
    summary = `${t.context} · ${t.namespace} · ${pods.length} pod${pods.length === 1 ? "" : "s"}${
      problems ? ` · ${problems} with problems` : ""
    }`;
    return sortPods(filterPods(pods, (filter ?? "all") as PodFilter)).map((p) => podItem(p, t!, prefs));
  },
});
