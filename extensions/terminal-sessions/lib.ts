// Parsing tmux and zellij session lists. Pure, tested in lib_test.ts.

export type Backend = "tmux" | "zellij";

export interface Window {
  index: number;
  name: string;
  active: boolean;
  panes: number;
  command?: string;
  path?: string;
}

export interface Session {
  backend: Backend;
  name: string;
  /** Clients attached right now. */
  attached: number;
  created?: Date;
  activity?: Date;
  windows?: number;
  path?: string;
  group?: string;
  windowList: Window[];
  /** zellij: the session this command runs in. */
  current?: boolean;
  /** zellij: exited, can be resurrected by attaching. */
  exited?: boolean;
}

// tmux prints control characters (tabs) as "_", and non-ASCII too without a UTF-8 locale.
export const SEP = "|:|";

/** What `tmux list-sessions -F` prints, one field per {@link SEP}. */
export const TMUX_SESSION_FORMAT = [
  "#{session_name}",
  "#{session_windows}",
  "#{session_attached}",
  "#{session_created}",
  "#{session_activity}",
  "#{session_path}",
  "#{session_group}",
].join(SEP);

export const TMUX_WINDOW_FORMAT = [
  "#{session_name}",
  "#{window_index}",
  "#{window_name}",
  "#{window_active}",
  "#{window_panes}",
  "#{pane_current_command}",
  "#{pane_current_path}",
].join(SEP);

const unix = (s: string | undefined) => (s && /^\d+$/.test(s) ? new Date(Number(s) * 1000) : undefined);

export function parseTmuxSessions(out: string, windowsOut = ""): Session[] {
  const windows = new Map<string, Window[]>();
  for (const line of windowsOut.split("\n")) {
    const [session, index, name, active, panes, command, path] = line.split(SEP);
    if (!session || index === undefined) continue;
    const list = windows.get(session) ?? [];
    list.push({
      index: Number(index),
      name: name ?? "",
      active: active === "1",
      panes: Number(panes) || 1,
      command: command || undefined,
      path: path || undefined,
    });
    windows.set(session, list);
  }
  return out.split("\n").filter((l) => l.includes(SEP)).map((line) => {
    const [name, count, attached, created, activity, path, group] = line.split(SEP);
    return {
      backend: "tmux" as const,
      name,
      windows: Number(count) || 0,
      attached: Number(attached) || 0,
      created: unix(created),
      activity: unix(activity),
      path: path || undefined,
      group: group || undefined,
      windowList: windows.get(name) ?? [],
    };
  });
}

/** "2h 3m 10s", "3days", "1day 4h" → seconds. */
export function zellijDuration(text: string): number {
  let seconds = 0;
  for (const m of text.matchAll(/(\d+)\s*(days?|d|h|m|s)\b/g)) {
    const n = Number(m[1]);
    seconds += m[2].startsWith("d") ? n * 86400 : m[2] === "h" ? n * 3600 : m[2] === "m" ? n * 60 : n;
  }
  return seconds;
}

/** `zellij list-sessions --no-formatting`. */
export function parseZellijSessions(out: string, now = new Date()): Session[] {
  return out.split("\n").flatMap((line) => {
    const m = line.trim().match(/^(\S+)\s+\[Created (.+?) ago\]\s*(.*)$/);
    if (!m) return [];
    const flags = m[3];
    return [{
      backend: "zellij" as const,
      name: m[1],
      attached: 0,
      created: new Date(now.getTime() - zellijDuration(m[2]) * 1000),
      current: /\(current\)/.test(flags),
      exited: /EXITED/.test(flags),
      windowList: [],
    }];
  });
}

/** Why a session name is refused, or undefined when it is fine. */
export function invalidName(name: string, existing: string[] = []): string | undefined {
  const n = name.trim();
  if (!n) return "Give the session a name";
  if (/[.:]/.test(n)) return "Session names can't contain “.” or “:”";
  if (/\s/.test(n)) return "Session names can't contain spaces";
  if (existing.includes(n)) return `A session named “${n}” already exists`;
  return undefined;
}

/** The command a terminal runs to attach (`window` only for tmux). */
export function attachCommand(s: Session, window?: number): string[] {
  if (s.backend === "zellij") return ["zellij", "attach", s.name];
  return ["tmux", "attach-session", "-t", window === undefined ? `=${s.name}` : `=${s.name}:${window}`];
}

export function newSessionCommand(backend: Backend, name: string, detached: boolean, dir?: string): string[] {
  if (backend === "zellij") {
    return ["zellij", "attach", detached ? "--create-background" : "--create", name];
  }
  return ["tmux", "new-session", ...(detached ? ["-d"] : []), "-s", name, ...(dir ? ["-c", dir] : [])];
}

export function killCommand(s: Session): string[] {
  if (s.backend === "zellij") {
    return s.exited ? ["zellij", "delete-session", s.name] : ["zellij", "kill-session", s.name];
  }
  return ["tmux", "kill-session", "-t", `=${s.name}`];
}

export function renameCommand(s: Session, to: string): string[] {
  if (s.backend === "zellij") return ["zellij", "--session", s.name, "action", "rename-session", to];
  return ["tmux", "rename-session", "-t", `=${s.name}`, to];
}

/** Attached first, then the most recently used. */
export function sortSessions(sessions: Session[]): Session[] {
  return [...sessions].sort((a, b) =>
    Number(!!a.exited) - Number(!!b.exited) ||
    Number(b.attached > 0 || !!b.current) - Number(a.attached > 0 || !!a.current) ||
    ((b.activity ?? b.created)?.getTime() ?? 0) - ((a.activity ?? a.created)?.getTime() ?? 0)
  );
}

/** "3h", "2d", "now". */
export function short(date: Date | undefined, now = new Date()): string {
  if (!date) return "";
  const s = Math.max(0, (now.getTime() - date.getTime()) / 1000);
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 86400 * 365) return `${Math.floor(s / 86400)}d`;
  return `${Math.floor(s / (86400 * 365))}y`;
}

/** "Tue 28 Oct, 09:12 (3h ago)" */
export function longDate(date: Date, now = new Date()): string {
  const text = date.toLocaleString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
  const ago = short(date, now);
  return `${text} (${ago === "now" ? "just now" : `${ago} ago`})`;
}
