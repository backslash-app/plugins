import {
  type Action,
  action,
  type Color,
  copy,
  detail,
  type DetailSpec,
  Icons,
  type Item,
  list,
  meta,
  open,
  refresh,
  replace,
  submenu,
  toast,
} from "@backslash/api";
import {
  canStart,
  claudeAddCommand,
  claudeAddJsonCommand,
  claudeScope,
  type ClientId,
  CLIENTS,
  commandLine,
  type Group,
  group,
  groupState,
  isLocalUrl,
  jsonConfig,
  mask,
  maskArgs,
  maskHeader,
  maskUrl,
  packageOf,
  plural,
  RUNNERS,
  type Source,
  target,
  tilde,
  TRANSPORT_TITLE,
  vscodeAddCommand,
} from "../lib.ts";
import { probe } from "../probe.ts";
import { HOME, loadAll, setEnabled } from "../sources.ts";

interface Prefs {
  projects?: string;
}

const TRANSPORT_ICON = { stdio: Icons.terminal, http: Icons.globe, sse: Icons.rss, extension: Icons.package };
const STATE: Record<ReturnType<typeof groupState>, { tint: Color; section: string; text: string }> = {
  on: { tint: "green", section: "Servers", text: "On" },
  pending: { tint: "yellow", section: "Waiting for Approval", text: "Not approved yet" },
  off: { tint: "gray", section: "Turned Off", text: "Off" },
};

const where = (s: Source) => `${CLIENTS[s.client]} · ${s.scope}${s.project ? ` · ${tilde(s.project, HOME)}` : ""}`;

const stateText = (s: Source) => s.status ?? (s.enabled === false ? "Off" : s.enabled ? "On" : "Unknown");

const hasSecrets = (g: Group) =>
  Object.keys(g.server.env).length > 0 || Object.keys(g.server.headers).length > 0 ||
  maskArgs(g.server.args).join(" ") !== g.server.args.join(" ") || maskUrl(g.server.url ?? "") !== (g.server.url ?? "");

function parseProjects(pref: string | undefined): string[] {
  return (pref ?? "").split(/[,\n]/).map((p) => p.trim().replace(/^~(?=\/|$)/, HOME).replace(/\/+$/, ""))
    .filter((p) => p.startsWith("/"));
}

// ---------------------------------------------------------------------------
// Test Start

async function testView(g: Group, signal?: AbortSignal): Promise<DetailSpec> {
  const s = g.server;
  const r = await probe(s, signal);
  const seconds = `${(r.ms / 1000).toFixed(1)} s`;
  const lines: string[] = [];
  if (r.ok && r.info) {
    lines.push(`## ${r.info.title ?? r.info.name} ${r.info.version}`, "");
    if (r.info.instructions) lines.push(`> ${r.info.instructions.replace(/\n+/g, " ").slice(0, 600)}`, "");
    if (r.tools.length) {
      lines.push(`### ${plural(r.tools.length, "tool")}`, "", "| Tool | Description |", "|---|---|");
      for (const t of r.tools) {
        lines.push(
          `| \`${t.name}\` | ${(t.description ?? "").replace(/\s+/g, " ").replace(/\|/g, "\\|").slice(0, 160)} |`,
        );
      }
    } else lines.push("_No tools._");
  } else {
    lines.push(`## Didn't start`, "", r.error ?? "Unknown error");
  }
  if (r.stderr.trim() && (!r.ok || r.stderr.length < 1500)) {
    lines.push("", "### stderr", "", "```", r.stderr.trim().split("\n").slice(-25).join("\n"), "```");
  }
  return detail({
    title: `${s.name} · ${r.ok ? `started in ${seconds}` : "failed"}`,
    markdown: lines.join("\n"),
    stats: r.ok
      ? [
        { label: "Tools", value: r.tools.length, color: "green" },
        ...(r.prompts !== undefined ? [{ label: "Prompts", value: r.prompts }] : []),
        ...(r.resources !== undefined ? [{ label: "Resources", value: r.resources }] : []),
        { label: "Time", value: seconds },
      ]
      : [{ label: "Status", value: "Failed", color: "red" }],
    metadata: [
      ...(r.info
        ? [
          meta.text("Server", r.info.name, { icon: Icons.server }),
          meta.text("Version", r.info.version, { icon: Icons.tag }),
          meta.text("Protocol", r.info.protocol),
          meta.tags("Capabilities", r.info.capabilities.map((c) => ({ text: c, color: "blue" as const }))),
        ]
        : []),
      meta.text(s.transport === "stdio" ? "Command" : "URL", target(s), {
        icon: s.transport === "stdio" ? Icons.terminal : Icons.globe,
      }),
      meta.text("Time", seconds, { icon: Icons.clock }),
    ],
    status: r.ok ? "The server was stopped after the test" : r.error,
    actions: [
      action("Test Again", async ({ signal }) => replace(await testView(g, signal)), {
        icon: Icons.refresh,
        shortcut: "<Ctrl>r",
      }),
      ...(r.tools.length ? [copy(r.tools.map((t) => t.name).join("\n"), "Copy Tool Names")] : []),
      ...(r.stderr.trim() ? [copy(r.stderr, "Copy stderr", { icon: Icons.terminal })] : []),
      copy(commandLine(s), "Copy Command Line", { concealed: true, icon: Icons.terminal }),
    ],
  });
}

// ---------------------------------------------------------------------------
// Rows

function toggleActions(g: Group): Action[] {
  const out: Action[] = [];
  for (const src of g.sources) {
    if (!src.toggle) continue;
    const label = `${CLIENTS[src.client]}${src.project ? ` (${tilde(src.project, HOME).split("/").pop()})` : ""}`;
    const run = (enable: boolean) => async () => {
      await setEnabled(src, g.server.name, enable);
      await toast(`${g.server.name} ${enable ? "turned on" : "turned off"} in ${label}`, {
        style: "success",
        message: `Restart ${CLIENTS[src.client]} or reload its MCP servers`,
      });
      return refresh();
    };
    if (src.toggle.kind === "claude-approval" && src.enabled === undefined) {
      out.push(
        action(`Approve in ${label}`, run(true), { icon: Icons.check, section: "On and Off" }),
        action(`Reject in ${label}`, run(false), { icon: Icons.cross, section: "On and Off" }),
      );
    } else if (src.enabled === false) {
      out.push(action(`Turn On in ${label}`, run(true), { icon: Icons.power, section: "On and Off" }));
    } else {
      out.push(action(`Turn Off in ${label}`, run(false), { icon: Icons.power, section: "On and Off" }));
    }
  }
  return out;
}

function groupItem(g: Group): Item {
  const s = g.server;
  const state = STATE[groupState(g)];
  const secrets = hasSecrets(g);
  const clients = [...new Set(g.sources.map((x) => x.client))] as ClientId[];
  const scope = claudeScope(g.sources.find((x) => x.client === "claude-code") ?? g.sources[0]) ?? "user";
  const testable = canStart(s) || ((s.transport === "http") && isLocalUrl(s.url));
  const pkg = packageOf(s);

  const test = action("Test Start", async ({ signal }) => await testView(g, signal), {
    icon: Icons.play,
    shortcut: "<Ctrl>t",
  });
  const copyJson = copy(jsonConfig(s), "Copy JSON Config", { concealed: secrets, icon: Icons.braces });
  const files = [...new Set(g.sources.map((x) => x.file))];
  const actions: Action[] = [
    ...(testable ? [test, copyJson] : [copyJson]),
    copy(claudeAddCommand(s, scope === "local" ? undefined : scope), "Copy claude mcp add Command", {
      concealed: secrets,
      icon: Icons.terminal,
      shortcut: "<Ctrl><Shift>c",
      section: "Copy",
    }),
    ...(secrets
      ? [
        copy(jsonConfig(s, false), "Copy JSON Config Without Secrets", { icon: Icons.braces, section: "Copy" }),
        copy(claudeAddCommand(s, undefined, false), "Copy claude mcp add Without Secrets", {
          icon: Icons.terminal,
          section: "Copy",
        }),
      ]
      : []),
    copy(claudeAddJsonCommand(s), "Copy claude mcp add-json Command", {
      concealed: secrets,
      icon: Icons.terminal,
      section: "Copy",
    }),
    copy(vscodeAddCommand(s), "Copy code --add-mcp Command", { concealed: secrets, icon: Icons.code, section: "Copy" }),
    ...(s.transport === "stdio" && s.command
      ? [copy(commandLine(s), "Copy Command Line", { concealed: secrets, icon: Icons.terminal, section: "Copy" })]
      : []),
    ...(s.url ? [copy(s.url, "Copy URL", { concealed: secrets, icon: Icons.link, section: "Copy" })] : []),
    copy(s.name, "Copy Name", { section: "Copy" }),
    ...toggleActions(g),
    files.length === 1
      ? open(files[0], "Open Config File", { icon: Icons.file, shortcut: "<Ctrl>o", section: "Files" })
      : submenu(
        "Open Config File",
        files.map((f) => open(f, tilde(f, HOME), { icon: Icons.file })),
        { icon: Icons.file, shortcut: "<Ctrl>o", section: "Files" },
      ),
    action("Reload", () => refresh(), { icon: Icons.refresh, shortcut: "<Ctrl>r", section: "Files" }),
  ];

  const env = Object.entries(s.env);
  const headers = Object.entries(s.headers);
  return {
    id: g.key,
    title: s.name,
    subtitle: target(s),
    section: state.section,
    icon: { source: TRANSPORT_ICON[s.transport], tint: state.tint },
    keywords: [
      ...clients.map((c) => CLIENTS[c]),
      s.transport,
      ...(pkg ? [pkg] : []),
      ...(s.command ? [s.command] : []),
      ...env.map(([k]) => k),
    ],
    accessories: [
      ...clients.map((c) => ({ tag: CLIENTS[c] })),
      { text: TRANSPORT_TITLE[s.transport] },
    ],
    detail: {
      markdown:
        g.sources.map((x) =>
          `- **${CLIENTS[x.client]}**, ${x.scope.toLowerCase()}${
            x.project ? ` in \`${tilde(x.project, HOME)}\`` : ""
          }: ${stateText(x)}  \n  \`${tilde(x.file, HOME)}\``
        ).join("\n") + (testable
          ? ""
          : s.transport === "stdio"
          ? `\n\n_Test Start runs servers started with ${RUNNERS.join(", ")}._`
          : s.transport === "extension"
          ? "\n\n_Zed starts this server from one of its extensions._"
          : "\n\n_Only servers on localhost can be tested from here._"),
      metadata: [
        meta.tags("Transport", [{ text: TRANSPORT_TITLE[s.transport], color: "blue" }]),
        meta.tags("State", [{ text: state.text, color: state.tint }]),
        ...(s.command ? [meta.text("Command", s.command, { icon: Icons.terminal })] : []),
        ...(s.args.length ? [meta.text("Arguments", maskArgs(s.args).join(" "))] : []),
        ...(s.url ? [meta.text("URL", maskUrl(s.url), { icon: Icons.globe })] : []),
        ...(s.cwd ? [meta.text("Working folder", tilde(s.cwd, HOME), { icon: Icons.folder })] : []),
        ...(env.length ? [meta.tags("Environment", env.map(([k, v]) => `${k}=${mask(v)}`))] : []),
        ...(headers.length ? [meta.tags("Headers", headers.map(([k, v]) => `${k}: ${maskHeader(v)}`))] : []),
        meta.separator(),
        meta.tags("Used by", clients.map((c) => ({ text: CLIENTS[c], color: "purple" as const }))),
        ...g.sources.map((x) => meta.text(where(x), stateText(x), { icon: Icons.file })),
      ],
    },
    actions,
  };
}

const FILTERS = [
  { value: "all", title: "All" },
  ...(Object.entries(CLIENTS) as [ClientId, string][]).map(([value, title]) => ({ value, title })),
];

let footer = "";

export default list({
  placeholder: "Filter MCP servers by name, client, command or package…",
  filter: { options: FILTERS, default: "all" },
  empty: {
    title: "No MCP server configured",
    description:
      "Looked in ~/.claude.json, .mcp.json, ~/.cursor/mcp.json, VS Code's mcp.json, Zed's settings, Claude Desktop, Windsurf, Cline, Codex and Gemini CLI",
    icon: Icons.plug,
  },
  status: () => footer,
  async items({ preferences, filter }) {
    const prefs = preferences as Prefs;
    const loaded = await loadAll(parseProjects(prefs.projects));
    const all = group(loaded.entries);
    const shown = filter && filter !== "all" ? all.filter((g) => g.sources.some((s) => s.client === filter)) : all;
    const on = shown.filter((g) => groupState(g) === "on").length;
    const clients = new Set(loaded.entries.map((e) => e.source.client));
    footer = `${plural(shown.length, "server")} · ${on} on · ${plural(clients.size, "client")}`;
    const items: Item[] = shown.map(groupItem);
    for (const p of loaded.problems) {
      items.push({
        id: `problem:${p.file}`,
        title: `${tilde(p.file, HOME)} can't be read`,
        subtitle: p.message,
        section: "Problems",
        icon: { source: Icons.alert, tint: "red" },
        detail: { markdown: `**${p.message}**\n\nFix the file, then reload (Ctrl+R).` },
        actions: [
          open(p.file, "Open File", { icon: Icons.file }),
          action("Reload", () => refresh(), { icon: Icons.refresh, shortcut: "<Ctrl>r" }),
        ],
      });
    }
    if (loaded.unreadable.length && (!filter || filter === "all" || filter === "claude-code")) {
      items.push({
        id: "unreadable",
        title: `${plural(loaded.unreadable.length, "Claude Code project")} not checked for .mcp.json`,
        subtitle: "Outside ~/Projects, ~/code, ~/src, ~/dev… which this extension may read",
        section: "Notes",
        icon: { source: Icons.info, tint: "gray" },
        detail: {
          markdown: [
            "For your privacy this extension only reads project files in the usual code folders of your home:",
            "**~/Projects, ~/projects, ~/Code, ~/code, ~/dev, ~/Developer, ~/src, ~/git, ~/repos, ~/workspace, ~/work, ~/Work**.",
            "",
            ...loaded.unreadable.slice(0, 30).map((p) => `- \`${tilde(p, HOME)}\``),
            ...(loaded.unreadable.length > 30 ? [`- … and ${loaded.unreadable.length - 30} more`] : []),
          ].join("\n"),
        },
      });
    }
    return items;
  },
});
