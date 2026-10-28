// Reading the session logs of Claude Code, Codex CLI and Aider, line by line. Pure, tested in lib_test.ts.

export type Agent = "claude" | "codex" | "aider";

export const AGENT_NAMES: Record<Agent, string> = { claude: "Claude Code", codex: "Codex", aider: "Aider" };

export interface Session {
  agent: Agent;
  /** Claude Code and Codex session id; for Aider, the history file path. */
  id: string;
  /** The folder the agent ran in. */
  cwd?: string;
  branch?: string;
  /** A title the user gave the session (Claude Code `/rename`). */
  title?: string;
  /** Claude Code's own summary of the conversation. */
  summary?: string;
  /** The first prompts, in order, each cut to a few hundred characters. */
  prompts: string[];
  promptCount: number;
  replyCount: number;
  /** The last thing the agent said, cut. */
  lastReply?: string;
  /** Unix milliseconds. */
  started?: number;
  updated?: number;
  model?: string;
  version?: string;
  /** Aider: how many chats the history file holds. */
  chats?: number;
  /** The log file. */
  file: string;
}

/** How many first prompts a session keeps. */
export const KEEP_PROMPTS = 3;
const PROMPT_MAX = 600;
const REPLY_MAX = 1500;
/** Lines longer than this are tool outputs and file dumps: never parsed. */
const MAX_LINE = 256 * 1024;

export function clip(text: string, max: number): string {
  const t = text.trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

/** One line for a title: the first non-empty line, whitespace collapsed. */
export function firstLine(text: string, max = 90): string {
  const line = text.split("\n").map((l) => l.trim()).find(Boolean) ?? "";
  return clip(line.replace(/\s+/g, " "), max);
}

const time = (v: unknown): number | undefined => {
  if (typeof v !== "string") return undefined;
  const t = Date.parse(v);
  return Number.isNaN(t) ? undefined : t;
};

function parse(line: string): Record<string, unknown> | undefined {
  if (!line || line.length > MAX_LINE || line[0] !== "{") return undefined;
  try {
    const v = JSON.parse(line);
    return v && typeof v === "object" && !Array.isArray(v) ? v : undefined;
  } catch {
    return undefined; // a line being written, or a corrupt one
  }
}

/** The text blocks of a message content: a string, or `[{ type: "text" | "input_text" | "output_text", text }]`. */
export function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((b) => b && typeof b === "object" && /^(text|input_text|output_text)$/.test(String(b.type)))
    .map((b) => String(b.text ?? ""))
    .join("\n")
    .trim();
}

// ---------------------------------------------------------------------------
// Claude Code: ~/.claude/projects/<folder>/<session-id>.jsonl

/** Prompts that are the CLI talking to itself, not the user. */
const CLAUDE_NOISE =
  /^(<local-command-stdout>|<local-command-stderr>|<system-reminder>|Caveat: The messages below|\[Request interrupted)/;

/** `<command-name>/review</command-name><command-args>auth.ts</command-args>` → `/review auth.ts`. */
export function slashCommand(text: string): string | undefined {
  const name = text.match(/<command-name>\s*([^<]+?)\s*<\/command-name>/)?.[1];
  if (!name) return undefined;
  const args = text.match(/<command-args>([\s\S]*?)<\/command-args>/)?.[1]?.trim();
  return `${name.startsWith("/") ? name : `/${name}`}${args ? ` ${args}` : ""}`;
}

/**
 * Builds a Claude Code session from its lines. Lines are checked with cheap
 * string tests first, so tool results and file contents (most of a log) are
 * never parsed.
 */
export class ClaudeReader {
  s: Session;
  private replies = new Set<string>();
  private lastAssistantLine?: string;

  constructor(file: string, id: string) {
    this.s = { agent: "claude", id, file, prompts: [], promptCount: 0, replyCount: 0 };
  }

  add(line: string): void {
    const s = this.s;
    if (line.includes('"type":"assistant"')) {
      const id = line.match(/"message":\{[^{}]*?"id":"([^"]+)"/)?.[1] ?? line.match(/"id":"(msg_[^"]+)"/)?.[1];
      if (line.includes('"isSidechain":true')) return;
      if (id) this.replies.add(id);
      else this.replies.add(`line${this.replies.size}`);
      // Only assistant lines with text count as the last reply (not tool calls).
      if (line.includes('"type":"text"')) this.lastAssistantLine = line;
      this.stamp(line);
      return;
    }
    if (line.includes('"type":"user"')) {
      this.stamp(line);
      if (line.includes('"isSidechain":true') || line.includes('"isMeta":true')) return;
      if (line.includes('"type":"tool_result"')) return;
      const o = parse(line);
      if (!o) return;
      this.context(o);
      const message = o.message as { content?: unknown } | undefined;
      const raw = textOf(message?.content);
      const text = slashCommand(raw) ?? raw;
      if (!text || CLAUDE_NOISE.test(text)) return;
      s.promptCount++;
      if (s.prompts.length < KEEP_PROMPTS) s.prompts.push(clip(text, PROMPT_MAX));
      return;
    }
    if (line.includes('"type":"summary"')) {
      const o = parse(line);
      if (typeof o?.summary === "string") s.summary = o.summary;
    } else if (line.includes('"type":"custom-title"')) {
      const o = parse(line);
      if (typeof o?.customTitle === "string") s.title = o.customTitle;
    } else if (!s.cwd && line.includes('"cwd":"')) {
      const o = parse(line);
      if (o) this.context(o);
    }
  }

  private stamp(line: string) {
    const t = time(line.match(/"timestamp":"([^"]+)"/)?.[1]);
    if (t === undefined) return;
    this.s.started ??= t;
    if (!this.s.updated || t > this.s.updated) this.s.updated = t;
  }

  private context(o: Record<string, unknown>) {
    const s = this.s;
    if (!s.cwd && typeof o.cwd === "string") s.cwd = o.cwd;
    if (typeof o.gitBranch === "string" && o.gitBranch && o.gitBranch !== "HEAD") s.branch = o.gitBranch;
    if (typeof o.version === "string") s.version = o.version;
    if (typeof o.sessionId === "string") s.id = o.sessionId;
  }

  finish(): Session {
    const s = this.s;
    s.replyCount = this.replies.size;
    if (this.lastAssistantLine) {
      const o = parse(this.lastAssistantLine);
      const message = o?.message as { content?: unknown; model?: unknown } | undefined;
      const text = textOf(message?.content);
      if (text) s.lastReply = clip(text, REPLY_MAX);
      if (typeof message?.model === "string") s.model = message.model;
    }
    return s;
  }
}

/** `-home-me-Projects-app` → `/home/me/Projects/app` (lossy: dashes in names are ambiguous; the log's cwd wins). */
export function claudeFolder(dirName: string): string {
  return dirName.replace(/-/g, "/");
}

// ---------------------------------------------------------------------------
// Codex CLI: ~/.codex/sessions/YYYY/MM/DD/rollout-<time>-<id>.jsonl

/** Messages Codex adds itself at the start of a session. */
const CODEX_NOISE =
  /^\s*<(environment_context|user_instructions|permissions instructions|INSTRUCTIONS)>|^# AGENTS\.md instructions/;

/** The session id in a rollout file name: `rollout-2025-09-12T10-11-12-<uuid>.jsonl`. */
export function codexIdFromName(name: string): string | undefined {
  return name.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i)?.[1];
}

/**
 * Builds a Codex session. Current rollouts are `{timestamp, type, payload}`
 * lines (`session_meta`, `response_item`, `event_msg`, `turn_context`);
 * rollouts from before September 2025 start with a bare `{id, timestamp,
 * git}` line followed by bare items. Both are read.
 */
export class CodexReader {
  s: Session;
  private eventPrompts: string[] = [];
  private eventCount = 0;
  private itemPrompts: string[] = [];
  private itemCount = 0;
  private eventReplies = 0;
  private itemReplies = 0;
  private lastEventReply?: string;
  private lastItemReply?: string;
  private first = true;

  constructor(file: string, id: string) {
    this.s = { agent: "codex", id, file, prompts: [], promptCount: 0, replyCount: 0 };
  }

  add(line: string): void {
    const isFirst = this.first;
    this.first = false;
    const o = parse(line);
    if (!o) return;
    const s = this.s;
    const t = time(o.timestamp);
    if (t !== undefined) {
      s.started ??= t;
      if (!s.updated || t > s.updated) s.updated = t;
    }
    const type = String(o.type ?? "");
    const payload = (o.payload ?? {}) as Record<string, unknown>;
    if (type === "session_meta") return this.meta(payload);
    if (isFirst && typeof o.id === "string" && !o.type) return this.meta(o); // legacy first line
    if (type === "turn_context") {
      if (typeof payload.cwd === "string") s.cwd ??= payload.cwd;
      if (typeof payload.model === "string") s.model = payload.model;
      return;
    }
    if (type === "event_msg") {
      const kind = String(payload.type ?? "");
      const message = typeof payload.message === "string" ? payload.message : "";
      if (kind === "user_message" && message && !CODEX_NOISE.test(message)) {
        this.eventCount++;
        if (this.eventPrompts.length < KEEP_PROMPTS) this.eventPrompts.push(clip(message, PROMPT_MAX));
      } else if (kind === "agent_message" && message) {
        this.eventReplies++;
        this.lastEventReply = message;
      }
      return;
    }
    // A response item, wrapped (current) or bare (legacy).
    const item = type === "response_item" ? payload : o;
    if (item.type !== "message") return;
    const text = textOf(item.content);
    if (!text) return;
    if (item.role === "user") {
      const cwd = text.match(/<cwd>([^<]+)<\/cwd>/)?.[1];
      if (cwd) s.cwd ??= cwd.trim();
      if (CODEX_NOISE.test(text)) return;
      this.itemCount++;
      if (this.itemPrompts.length < KEEP_PROMPTS) this.itemPrompts.push(clip(text, PROMPT_MAX));
    } else if (item.role === "assistant") {
      this.itemReplies++;
      this.lastItemReply = text;
    }
  }

  private meta(m: Record<string, unknown>) {
    const s = this.s;
    if (typeof m.id === "string") s.id = m.id;
    if (typeof m.cwd === "string") s.cwd = m.cwd;
    if (typeof m.cli_version === "string") s.version = m.cli_version;
    const t = time(m.timestamp);
    if (t !== undefined) s.started = t;
    const git = m.git as { branch?: unknown } | undefined;
    if (git && typeof git.branch === "string") s.branch = git.branch;
  }

  finish(): Session {
    const s = this.s;
    // Recent rollouts log each prompt twice (an event and an item): prefer the events.
    const events = this.eventCount > 0;
    s.prompts = events ? this.eventPrompts : this.itemPrompts;
    s.promptCount = events ? this.eventCount : this.itemCount;
    s.replyCount = this.eventReplies || this.itemReplies;
    const last = this.lastEventReply ?? this.lastItemReply;
    if (last) s.lastReply = clip(last, REPLY_MAX);
    return s;
  }
}

// ---------------------------------------------------------------------------
// Aider: .aider.chat.history.md in each project

export const AIDER_HISTORY = ".aider.chat.history.md";

/**
 * Reads an Aider chat history: chats start with `# aider chat started at
 * 2025-01-31 10:00:00`, the user's messages are `#### ` lines, command output
 * is quoted with `> `, the rest is the model's answer. The last chat is the
 * one shown; the file's change time is its last activity.
 */
export function parseAiderHistory(text: string, file: string, modified?: number): Session {
  const dir = file.replace(/\/[^/]*$/, "");
  const s: Session = { agent: "aider", id: file, file, cwd: dir, prompts: [], promptCount: 0, replyCount: 0, chats: 0 };
  const chats = text.split(/^# aider chat started at /m);
  const starts = [...text.matchAll(/^# aider chat started at (\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2})/gm)];
  s.chats = starts.length;
  const last = starts.length ? chats[chats.length - 1] : text;
  if (starts.length) {
    const t = Date.parse(starts[starts.length - 1][1].replace(" ", "T"));
    if (!Number.isNaN(t)) s.started = t;
  }
  s.updated = modified ?? s.started;
  const prompts: string[] = [];
  let current: string[] = [];
  let reply: string[] = [];
  let lastReply = "";
  const flushPrompt = () => {
    if (current.length) {
      prompts.push(current.join("\n"));
      current = [];
    }
  };
  const flushReply = () => {
    const r = reply.join("\n").trim();
    if (r) {
      s.replyCount++;
      lastReply = r;
    }
    reply = [];
  };
  for (const line of last.split("\n").slice(starts.length ? 1 : 0)) {
    if (line === "####" || line.startsWith("#### ")) {
      if (!current.length) flushReply();
      current.push(line.slice(5));
    } else {
      flushPrompt();
      if (line.startsWith(">")) {
        const model = line.match(/^> (?:Main )?[Mm]odel: ([^\s]+)/)?.[1];
        if (model) s.model = model;
        continue;
      }
      reply.push(line);
    }
  }
  flushPrompt();
  flushReply();
  const real = prompts.map((p) => p.trim()).filter((p) => p && !/^\/(exit|quit)$/.test(p));
  s.promptCount = real.length;
  s.prompts = real.slice(0, KEEP_PROMPTS).map((p) => clip(p, PROMPT_MAX));
  if (lastReply) s.lastReply = clip(lastReply, REPLY_MAX);
  return s;
}

// ---------------------------------------------------------------------------
// Showing sessions

/** What the row is called: its given title, else its first prompt. */
export function sessionTitle(s: Session): string {
  if (s.title) return firstLine(s.title);
  const p = s.prompts.find((x) => x.trim());
  if (p) return firstLine(p);
  if (s.summary) return firstLine(s.summary);
  return s.agent === "aider" ? "Aider chat" : "Empty session";
}

/** "now", "5m", "3h", "2d", "3w", "4mo", "1y". */
export function age(ms: number | undefined, now: number): string {
  if (!ms) return "";
  const m = Math.floor((now - ms) / 60_000);
  if (m < 1) return "now";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 14) return `${d}d`;
  if (d < 60) return `${Math.floor(d / 7)}w`;
  if (d < 365) return `${Math.floor(d / 30)}mo`;
  return `${Math.floor(d / 365)}y`;
}

/** The command line that resumes a session. */
export function resumeArgv(s: Session): string[] {
  switch (s.agent) {
    case "claude":
      return ["claude", "--resume", s.id];
    case "codex":
      return ["codex", "resume", s.id];
    case "aider":
      return ["aider", "--restore-chat-history"];
  }
}

/** Newest first; sessions without dates last. */
export function byRecency(a: Session, b: Session): number {
  return (b.updated ?? 0) - (a.updated ?? 0);
}

/** A block quote of a text, for markdown. */
export function quote(text: string): string {
  return text.split("\n").map((l) => `> ${l}`).join("\n");
}

export const DEFAULT_FOLDERS =
  "~/Projects, ~/projects, ~/code, ~/Code, ~/src, ~/dev, ~/git, ~/repos, ~/workspace, ~/work";

/** The folders preference: commas or new lines; `~` expanded; duplicates dropped. */
export function parseFolders(pref: string | undefined, home: string): string[] {
  const raw = (pref?.trim() || DEFAULT_FOLDERS).split(/[,\n]/).map((f) => f.trim()).filter(Boolean);
  const expanded = raw.map((f) => f.replace(/^~(?=\/|$)/, home).replace(/\/+$/, "") || "/");
  return [...new Set(expanded)].filter((f) => f.startsWith("/"));
}

export const tilde = (path: string, home: string) =>
  home && (path === home || path.startsWith(`${home}/`)) ? `~${path.slice(home.length)}` : path;
