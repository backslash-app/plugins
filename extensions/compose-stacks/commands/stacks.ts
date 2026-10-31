import {
  type Action,
  action,
  close,
  copy,
  detail,
  type DetailSpec,
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
import { compose, engine, forget, loadStacks, MissingError } from "../compose.ts";
import {
  cleanError,
  composeCommand,
  isProblem,
  logsArgs,
  logsCommand,
  pullScript,
  rebuildScript,
  type Service,
  serviceColor,
  serviceLabel,
  servicesTable,
  shellCommand,
  type Stack,
  STACK_COLORS,
  stackPorts,
  stackSummary,
  tildify,
} from "../lib.ts";
import { runInTerminal, shellLine } from "../terminal.ts";

interface Prefs {
  engine?: string;
  terminal?: string;
}

const HOME = (() => {
  try {
    return Deno.env.get("HOME") ?? "";
  } catch {
    return "";
  }
})();

const SECTIONS = {
  problem: "Problems",
  partial: "Partly Running",
  running: "Running",
  stopped: "Stopped",
  down: "Down",
};

const fence = (text: string) => `\`\`\`\n${text.replace(/```/g, "ʼʼʼ") || "(no output)"}\n\`\`\``;

/** Runs a compose subcommand, tells how it went, and reloads the list. */
function composeAction(
  title: string,
  stack: Stack,
  args: string[],
  done: string,
  o: { icon?: string; shortcut?: string; section?: string; destructive?: boolean; confirm?: string } = {},
): Action {
  return action(title, async () => {
    try {
      await compose(stack, ...args);
    } catch (e) {
      await toast(`${title} failed`, { style: "failure", message: cleanError(e) });
      return refresh();
    }
    await toast(done, { style: "success" });
    return refresh();
  }, o);
}

function inTerminal(
  title: string,
  argv: string[],
  prefs: Prefs,
  o: { icon?: string; shortcut?: string; section?: string } = {},
) {
  return action(title, () => {
    runInTerminal(argv, prefs.terminal || undefined);
    return close();
  }, { icon: Icons.terminal, ...o });
}

async function logsView(stack: Stack, prefs: Prefs, service?: string): Promise<DetailSpec> {
  const text = await compose(stack, ...logsArgs(service))
    .catch((e) => cleanError(e));
  const lines = text ? text.split("\n").length : 0;
  return detail({
    title: service ? `${stack.name} · ${service}` : stack.name,
    markdown: fence(text),
    status: `Last ${Math.min(lines, 200)} lines${service ? ` of ${service}` : ""}`,
    actions: [
      copy(text, "Copy Logs", { shortcut: "<Ctrl><Shift>c" }),
      action("Reload", () => logsView(stack, prefs, service), { icon: Icons.refresh, shortcut: "<Ctrl>r" }),
      inTerminal("Follow in Terminal", logsCommand(stack, service, true), prefs, { shortcut: "<Ctrl>t" }),
    ],
  });
}

function portActions(ports: { host: number; protocol: string; service?: string }[]): Action[] {
  return ports.filter((p) => p.protocol === "tcp").slice(0, 3).map((p, i) =>
    open(`http://localhost:${p.host}`, `Open localhost:${p.host}${p.service ? ` (${p.service})` : ""}`, {
      icon: Icons.globe,
      ...(i === 0 ? { shortcut: "<Ctrl>o" } : {}),
    })
  );
}

// ---------------------------------------------------------------------------
// Services of a stack

function serviceItem(stack: Stack, s: Service, prefs: Prefs): Item {
  const color = serviceColor(s);
  const running = s.state === "running";
  const hasFiles = stack.configFiles.length > 0;
  return {
    id: s.container,
    title: s.service,
    subtitle: s.image.replace(/^(docker\.io|registry-1\.docker\.io)\/(library\/)?/, ""),
    icon: { source: isProblem(s) ? Icons.alert : Icons.box, tint: color },
    section: isProblem(s) ? "Problems" : running ? "Running" : "Stopped",
    keywords: [s.container, s.image, s.state, ...s.ports.map((p) => String(p.host))],
    accessories: [
      ...s.ports.slice(0, 2).map((p) => ({
        text: `:${p.host}`,
        icon: Icons.plug,
        tooltip: `→ ${p.container}/${p.protocol}`,
      })),
      { tag: serviceLabel(s), color },
    ],
    detail: {
      metadata: [
        meta.text("State", s.status, { icon: Icons.dot, color }),
        ...(s.health ? [meta.text("Health", s.health, { icon: Icons.activity, color })] : []),
        meta.text("Image", s.image, { icon: Icons.package }),
        ...(s.ports.length ? [meta.tags("Ports", s.ports.map((p) => `${p.host} → ${p.container}/${p.protocol}`))] : []),
        meta.separator(),
        meta.text("Container", s.container, { icon: Icons.box }),
        meta.text("ID", s.id),
        meta.text("Stack", stack.name, { icon: Icons.layers }),
      ],
    },
    actions: [
      action("Show Logs", () => logsView(stack, prefs, s.service), { icon: Icons.text }),
      inTerminal("Follow Logs in Terminal", logsCommand(stack, s.service, true), prefs, { shortcut: "<Ctrl>t" }),
      ...portActions(s.ports),
      ...(running ? [inTerminal("Open Shell", shellCommand(stack, s.service), prefs, { shortcut: "<Ctrl>s" })] : []),
      composeAction("Restart Service", stack, ["restart", s.service], `${s.service} restarted`, {
        icon: Icons.refresh,
        shortcut: "<Ctrl>r",
        section: "Service",
      }),
      running
        ? composeAction("Stop Service", stack, ["stop", s.service], `${s.service} stopped`, {
          icon: Icons.stop,
          section: "Service",
        })
        : composeAction("Start Service", stack, ["start", s.service], `${s.service} started`, {
          icon: Icons.play,
          section: "Service",
        }),
      ...(hasFiles
        ? [
          inTerminal("Pull & Recreate Service", pullScript(stack, s.service), prefs, {
            icon: Icons.download,
            section: "Service",
          }),
          inTerminal("Rebuild Service", rebuildScript(stack, s.service), prefs, {
            icon: Icons.bolt,
            section: "Service",
          }),
        ]
        : []),
      copy(s.container, "Copy Container Name", { section: "Copy" }),
      copy(shellLine(composeCommand(stack, "exec", s.service, "sh")), "Copy Shell Command", {
        icon: Icons.terminal,
        section: "Copy",
      }),
    ],
  };
}

function servicesView(stack: Stack, prefs: Prefs): ListSpec {
  return list({
    title: stack.name,
    placeholder: `Filter services of ${stack.name}…`,
    empty: { title: "No containers", description: "Bring the stack up to create them", icon: Icons.box },
    status: () => `${stack.name} · ${stackSummary(stack)}`,
    actions: [action("Reload", () => refresh(), { icon: Icons.refresh, shortcut: "<Ctrl><Shift>r" })],
    async items({ signal }) {
      const fresh = (await loadStacks(stack.engine, signal)).find((s) => s.name === stack.name);
      if (fresh) Object.assign(stack, fresh);
      return (fresh?.services ?? []).map((s) => serviceItem(fresh!, s, prefs));
    },
  });
}

// ---------------------------------------------------------------------------
// Stacks

function stackItem(stack: Stack, prefs: Prefs): Item {
  const color = STACK_COLORS[stack.state];
  const ports = stackPorts(stack);
  const hasFiles = stack.configFiles.length > 0;
  const problems = stack.services.filter(isProblem);
  const up = hasFiles
    ? composeAction("Up", stack, ["up", "-d"], `${stack.name} is up`, { icon: Icons.play, shortcut: "<Ctrl>u" })
    : undefined;
  const showServices = action("Show Services", () => servicesView(stack, prefs), { icon: Icons.layers });
  const live = stack.services.length > 0;
  const actions: Action[] = [
    ...(live ? [showServices] : up ? [up] : []),
    ...(live
      ? [inTerminal("Follow Logs in Terminal", logsCommand(stack, undefined, true), prefs, { shortcut: "<Ctrl>t" })]
      : []),
    ...portActions(ports),
    ...(live ? [action("Show Logs", () => logsView(stack, prefs), { icon: Icons.text, shortcut: "<Ctrl>l" })] : []),
    ...(live && up ? [{ ...up, section: "Stack" }] : []),
    ...(live
      ? [
        composeAction("Restart", stack, ["restart"], `${stack.name} restarted`, {
          icon: Icons.refresh,
          shortcut: "<Ctrl>r",
          section: "Stack",
        }),
        composeAction("Stop", stack, ["stop"], `${stack.name} stopped`, { icon: Icons.stop, section: "Stack" }),
      ]
      : []),
    ...(hasFiles
      ? [
        inTerminal("Pull & Recreate", pullScript(stack), prefs, {
          icon: Icons.download,
          shortcut: "<Ctrl>p",
          section: "Stack",
        }),
        inTerminal("Rebuild", rebuildScript(stack), prefs, { icon: Icons.bolt, shortcut: "<Ctrl>b", section: "Stack" }),
      ]
      : []),
    ...(stack.services.length > 1
      ? [submenu(
        "Logs of Service",
        stack.services.map((s) => action(s.service, () => logsView(stack, prefs, s.service), { icon: Icons.box })),
        { icon: Icons.text, section: "Stack" },
      )]
      : []),
    ...(stack.workingDir ? [open(stack.workingDir, "Open Folder", { icon: Icons.folder, section: "Files" })] : []),
    ...stack.configFiles.slice(0, 3).map((f) =>
      open(f, `Open ${f.split("/").pop()}`, { icon: Icons.file, section: "Files" })
    ),
    ...(stack.workingDir ? [copy(stack.workingDir, "Copy Folder Path", { section: "Copy" })] : []),
    copy(shellLine(composeCommand(stack, "ps")), "Copy Compose Command", { icon: Icons.terminal, section: "Copy" }),
    ...(live
      ? [
        composeAction("Down", stack, ["down"], `${stack.name} is down`, {
          icon: Icons.power,
          shortcut: "<Ctrl><Shift>d",
          destructive: true,
          confirm: `Bring ${stack.name} down? Its containers and networks are removed (volumes are kept).`,
          section: "Danger",
        }),
        composeAction(
          "Down and Remove Volumes",
          stack,
          ["down", "--volumes"],
          `${stack.name} and its volumes removed`,
          {
            icon: Icons.trash,
            destructive: true,
            confirm: `Remove ${stack.name} with its volumes? The data in them is lost.`,
            section: "Danger",
          },
        ),
      ]
      : []),
    ...(stack.remembered
      ? [action("Forget Stack", async () => {
        await forget(stack);
        return refresh();
      }, { icon: Icons.eyeOff, section: "Danger" })]
      : []),
  ];
  const file = stack.configFiles[0];
  return {
    id: `${stack.engine}/${stack.name}`,
    title: stack.name,
    subtitle: stack.workingDir ? tildify(stack.workingDir, HOME) : undefined,
    icon: { source: stack.state === "problem" ? Icons.alert : Icons.layers, tint: color },
    section: SECTIONS[stack.state],
    keywords: [...stack.services.map((s) => s.service), ...stack.services.map((s) => s.image)],
    accessories: [
      ...ports.filter((p) => p.protocol === "tcp").slice(0, 2).map((p) => ({
        text: `:${p.host}`,
        icon: Icons.plug,
        tooltip: `${p.service} → ${p.container}`,
      })),
      ...(problems.length
        ? [{
          tag: `${problems.length} failing`,
          color: "red" as const,
          tooltip: problems.map((p) => p.service).join(", "),
        }]
        : []),
      { text: stackSummary(stack), color: stack.state === "running" ? undefined : color },
    ],
    detail: {
      stats: live
        ? [
          {
            label: "running",
            value: `${stack.services.filter((s) => s.state === "running").length}/${stack.services.length}`,
            color,
          },
          ...(problems.length ? [{ label: "failing", value: problems.length, color: "red" as const }] : []),
          ...(ports.length ? [{ label: "ports", value: ports.length }] : []),
        ]
        : undefined,
      markdown: servicesTable(stack),
      metadata: [
        meta.text("State", stackSummary(stack), { icon: Icons.dot, color }),
        ...(stack.workingDir ? [meta.text("Folder", tildify(stack.workingDir, HOME), { icon: Icons.folder })] : []),
        ...(file ? [meta.tags("Compose files", stack.configFiles.map((f) => f.split("/").pop()!))] : []),
        ...(ports.length ? [meta.tags("Ports", ports.map((p) => `${p.host} → ${p.service}`))] : []),
        meta.text("Engine", stack.engine === "docker" ? "Docker Compose" : "Podman Compose", { icon: Icons.box }),
      ],
    },
    actions,
  };
}

function missingItem(e: Error): Item {
  return {
    id: "missing",
    title: e.message,
    subtitle: "Install Docker with the compose plugin, or Podman",
    icon: { source: Icons.alert, tint: "orange" },
    detail: {
      markdown: [
        "This extension runs **docker compose** or **podman compose**.",
        "",
        "```sh",
        "sudo dnf install docker-compose-plugin   # Fedora, Docker's repository",
        "sudo apt install docker-compose-plugin   # Debian, Ubuntu",
        "sudo pacman -S docker-compose            # Arch",
        "sudo dnf install podman-compose          # Podman",
        "```",
        "",
        "To choose the engine yourself, set **Engine** to `docker` or `podman` in Settings.",
      ].join("\n"),
    },
    actions: [open("https://docs.docker.com/compose/install/linux/", "Install Docker Compose")],
  };
}

let summary = "";

export default list({
  placeholder: "Filter stacks by name, service or image…",
  empty: {
    title: "No Compose stacks",
    description: "Start one with docker compose up: it shows up here, and stays listed after down",
    icon: Icons.layers,
  },
  status: () => summary,
  actions: [action("Reload", () => refresh(), { icon: Icons.refresh, shortcut: "<Ctrl><Shift>r" })],
  async items({ preferences, signal }) {
    const prefs = preferences as Prefs;
    summary = "";
    let stacks: Stack[];
    try {
      stacks = await loadStacks(await engine(prefs.engine, signal), signal);
    } catch (e) {
      if (e instanceof MissingError) return [missingItem(e)];
      throw new Error(`Can't list the stacks: ${cleanError(e)}`);
    }
    const running = stacks.filter((s) => s.state === "running" || s.state === "partial").length;
    const failing = stacks.filter((s) => s.state === "problem").length;
    summary = [
      `${stacks.length} stack${stacks.length === 1 ? "" : "s"}`,
      `${running} running`,
      ...(failing ? [`${failing} with problems`] : []),
    ].join(" · ");
    updateCommandMetadata({ subtitle: failing ? `${failing} with problems` : running ? `${running} running` : null })
      .catch(() => {});
    return stacks.map((s) => stackItem(s, prefs));
  },
});
