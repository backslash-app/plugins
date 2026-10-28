import { action, close, type Color, copy, detail, Icons, type Item, list, meta, open } from "@backslash/api";
import {
  age,
  type Agent,
  AGENT_NAMES,
  parseFolders,
  quote,
  resumeArgv,
  type Session,
  sessionTitle,
  tilde,
} from "../lib.ts";
import { HOME, recentSessions } from "../sessions.ts";
import { resumeScript, runInTerminal, shellArgv, shellLine } from "../terminal.ts";

interface Prefs {
  agents?: string;
  max?: number;
  folders?: string;
  depth?: number;
  terminal?: string;
}

const STYLE: Record<Agent, { icon: string; tint: Color }> = {
  claude: { icon: Icons.sparkle, tint: "orange" },
  codex: { icon: Icons.terminal, tint: "teal" },
  aider: { icon: Icons.code, tint: "purple" },
};

const ALL: Agent[] = ["claude", "codex", "aider"];

function enabledAgents(pref: string | undefined): Set<Agent> {
  const wanted = (pref ?? "").toLowerCase().split(/[\s,]+/).filter(Boolean);
  const agents = ALL.filter((a) => wanted.some((w) => a.startsWith(w) || w.startsWith(a)));
  return new Set(agents.length ? agents : ALL);
}

const when = (ms?: number) => ms ? new Date(ms).toLocaleString("en", { dateStyle: "medium", timeStyle: "short" }) : "";
const project = (s: Session) => s.cwd ? s.cwd.split("/").filter(Boolean).pop() ?? s.cwd : "";

function resume(s: Session, prefs: Prefs) {
  const argv = resumeArgv(s);
  runInTerminal(shellArgv(Deno.env.get("SHELL"), resumeScript(s.cwd, argv)), prefs.terminal || undefined);
  return close(`Resuming in ${s.cwd ? tilde(s.cwd, HOME) : "a terminal"}`);
}

function markdown(s: Session, full: boolean): string {
  const parts: string[] = [];
  if (s.title && s.prompts[0]) parts.push(`## ${s.title}`);
  if (s.summary) parts.push(`_${s.summary}_`);
  const prompts = full ? s.prompts : s.prompts.slice(0, 2);
  if (prompts.length) {
    parts.push(`### ${prompts.length === 1 ? "First prompt" : "First prompts"}`);
    parts.push(prompts.map(quote).join("\n\n"));
  }
  if (s.lastReply) {
    parts.push(`### Last answer from ${AGENT_NAMES[s.agent]}`);
    parts.push(full ? s.lastReply : s.lastReply.slice(0, 700) + (s.lastReply.length > 700 ? "…" : ""));
  }
  return parts.join("\n\n") || "_No message yet._";
}

function sessionItem(s: Session, prefs: Prefs, now: number): Item {
  const style = STYLE[s.agent];
  const argv = resumeArgv(s);
  const command = s.cwd ? `cd ${shellLine([s.cwd])} && ${shellLine(argv)}` : shellLine(argv);
  const metadata = [
    meta.tags("Agent", [{ text: AGENT_NAMES[s.agent], color: style.tint }]),
    ...(s.cwd ? [meta.text("Project", tilde(s.cwd, HOME), { icon: Icons.folder })] : []),
    ...(s.branch ? [meta.text("Branch", s.branch, { icon: Icons.branch })] : []),
    ...(s.started ? [meta.text("Started", when(s.started), { icon: Icons.calendar })] : []),
    ...(s.updated ? [meta.text("Last activity", when(s.updated), { icon: Icons.clock })] : []),
    meta.text(
      "Messages",
      `${s.promptCount} prompt${s.promptCount === 1 ? "" : "s"}, ${s.replyCount} repl${
        s.replyCount === 1 ? "y" : "ies"
      }`,
      {
        icon: Icons.comment,
      },
    ),
    ...(s.chats && s.chats > 1 ? [meta.text("Chats in history", s.chats)] : []),
    ...(s.model ? [meta.text("Model", s.model, { icon: Icons.cpu })] : []),
    ...(s.version ? [meta.text("Version", s.version)] : []),
    meta.separator(),
    ...(s.agent !== "aider" ? [meta.text("Session", s.id, { icon: Icons.hash })] : []),
    meta.text("Log", tilde(s.file, HOME), { icon: Icons.file }),
  ];
  return {
    id: `${s.agent}:${s.id}`,
    title: sessionTitle(s),
    subtitle: project(s),
    icon: { source: style.icon, tint: style.tint },
    keywords: [
      AGENT_NAMES[s.agent],
      s.cwd ?? "",
      s.branch ?? "",
      s.id,
      ...s.prompts.slice(1, 3).map((p) => p.slice(0, 120)),
    ]
      .filter(Boolean),
    accessories: [
      ...(s.branch ? [{ tag: s.branch, color: "blue" as const }] : []),
      {
        text: `${s.promptCount}`,
        icon: Icons.comment,
        tooltip: `${s.promptCount} prompt${s.promptCount === 1 ? "" : "s"}`,
      },
      { text: age(s.updated, now), tooltip: when(s.updated) },
    ],
    detail: { markdown: markdown(s, false), metadata },
    actions: [
      action(`Resume in Terminal`, () => resume(s, prefs), { icon: Icons.terminal }),
      ...(s.cwd ? [open(s.cwd, "Open Project Folder", { icon: Icons.folder })] : []),
      action("Show Conversation Summary", () =>
        detail({
          title: sessionTitle(s),
          markdown: markdown(s, true),
          metadata,
          actions: [
            action("Resume in Terminal", () => resume(s, prefs), { icon: Icons.terminal }),
            ...(s.lastReply ? [copy(s.lastReply, "Copy Last Answer")] : []),
            ...(s.prompts[0] ? [copy(s.prompts[0], "Copy First Prompt")] : []),
          ],
        }), { icon: Icons.eye, shortcut: "<Ctrl>d" }),
      ...(s.agent !== "aider"
        ? [copy(s.id, "Copy Session ID", { icon: Icons.hash, shortcut: "<Ctrl><Shift>c", section: "Copy" })]
        : []),
      copy(command, "Copy Resume Command", { icon: Icons.terminal, shortcut: "<Ctrl><Shift>r", section: "Copy" }),
      ...(s.prompts[0] ? [copy(s.prompts[0], "Copy First Prompt", { section: "Copy" })] : []),
      ...(s.lastReply ? [copy(s.lastReply, "Copy Last Answer", { section: "Copy" })] : []),
      ...(s.agent === "aider"
        ? [
          action("Start Aider Without History", () => {
            runInTerminal(
              shellArgv(Deno.env.get("SHELL"), resumeScript(s.cwd, ["aider"])),
              prefs.terminal || undefined,
            );
            return close(`Aider started in ${tilde(s.cwd ?? "", HOME)}`);
          }, { icon: Icons.play, section: "Aider" }),
        ]
        : []),
      open(s.file, "Open Log File", { icon: Icons.file, section: "Files" }),
    ],
  };
}

export default list({
  placeholder: "Filter sessions by prompt, project, branch or agent…",
  filter: {
    options: [
      { value: "all", title: "All" },
      { value: "claude", title: "Claude Code" },
      { value: "codex", title: "Codex" },
      { value: "aider", title: "Aider" },
    ],
    default: "all",
  },
  empty: {
    title: "No session found",
    description:
      "Sessions of Claude Code (~/.claude/projects), Codex (~/.codex/sessions) and Aider (.aider.chat.history.md in your code folders) show here",
    icon: Icons.sparkle,
  },
  status: (items) => `${items.length} session${items.length === 1 ? "" : "s"}`,
  async items({ preferences, signal, filter }) {
    const prefs = preferences as Prefs;
    let agents = enabledAgents(prefs.agents);
    if (filter && filter !== "all") agents = new Set([...agents].filter((a) => a === filter));
    const sessions = await recentSessions({
      folders: parseFolders(prefs.folders, HOME),
      depth: Math.max(1, Math.min(8, Math.round(Number(prefs.depth) || 3))),
      max: Math.max(5, Math.min(500, Math.round(Number(prefs.max) || 60))),
      agents,
    }, signal);
    const now = Date.now();
    return sessions.map((s) => sessionItem(s, prefs, now));
  },
});
