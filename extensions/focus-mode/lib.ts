// Focus Mode logic: durations, the /etc/hosts block, the scripts run by the
// timers and the Do Not Disturb commands. Pure, tested in lib_test.ts.

/** Single-quotes a string for sh, when needed. */
export function shellQuote(s: string): string {
  return /^[\w@%+=:,./-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`;
}

// ---------------------------------------------------------------------------
// Sessions

export type DndBackend = "mako" | "dunst" | "swaync" | "gnome" | "xfce" | "cinnamon" | "kde";

export interface Session {
  /** The systemd user timer ending the session: `backslash-focus-<ms>`. */
  unit: string;
  started: number;
  ends: number;
  /** What the session turned on, to turn off at the end. */
  dnd?: DndBackend;
  blocked?: string[];
  slack?: { status: boolean; snoozed: boolean; previous?: SlackStatus };
}

export interface SlackStatus {
  text: string;
  emoji: string;
  expiration: number;
}

export interface Done {
  started: number;
  /** Seconds actually spent. */
  seconds: number;
  completed: boolean;
}

/** A number of minutes from an argument or a preference, within 1 to 480. */
export function minutesOf(value: unknown, fallback = 25): number {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(480, n);
}

/** 1500 → "25 min", 5400 → "1 h 30", 45 → "45 s". */
export function humanize(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h) return m ? `${h} h ${String(m).padStart(2, "0")}` : `${h} h`;
  if (m) return `${m} min`;
  return `${s % 60} s`;
}

/** Remaining time as a clock: "24:59", "1:02:03". */
export function countdown(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const mm = String(Math.floor((s % 3600) / 60)).padStart(h ? 2 : 1, "0");
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export const clockTime = (ms: number) => {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

/** Share of the session done, 0 to 1. */
export const progress = (s: Pick<Session, "started" | "ends">, now = Date.now()) =>
  Math.max(0, Math.min(1, (now - s.started) / Math.max(1, s.ends - s.started)));

/** Today's finished sessions: how many and how long in all. */
export function today(log: Done[], now = new Date()): { count: number; seconds: number } {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const mine = log.filter((d) => d.started >= start);
  return { count: mine.length, seconds: mine.reduce((t, d) => t + d.seconds, 0) };
}

/** Keeps the last 200 sessions. */
export const appendLog = (log: Done[], d: Done) => [...log, d].slice(-200);

// ---------------------------------------------------------------------------
// Sites

/** Domains from a free list: commas, spaces or new lines, URLs and paths reduced to the host. */
export function parseSites(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split(/[\s,;]+/)) {
    const host = raw.trim().toLowerCase().replace(/^[a-z]+:\/\//, "").replace(/[/?#:].*$/, "").replace(/\.$/, "");
    const bare = host.replace(/^www\./, "");
    if (!isDomain(bare) || out.includes(bare)) continue;
    out.push(bare);
  }
  return out;
}

export const isDomain = (s: string) =>
  s.length <= 253 && /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,62}$/.test(s) &&
  s !== "localhost";

/** The names to block for each domain: itself and www., over IPv4 and IPv6. */
export function blockLines(domains: string[]): string[] {
  const names = domains.flatMap((d) => [d, `www.${d}`]);
  return [...names.map((n) => `0.0.0.0 ${n}`), ...names.map((n) => `:: ${n}`)];
}

export const BLOCK_BEGIN = "# >>> Backslash Focus Mode (removed when the session ends)";
export const BLOCK_END = "# <<< Backslash Focus Mode";

/** The domains our block holds in /etc/hosts now. */
export function blockedIn(hosts: string): string[] {
  const lines = hosts.replace(/\r\n/g, "\n").split("\n");
  const begin = lines.findIndex((l) => l.startsWith("# >>> Backslash Focus Mode"));
  if (begin < 0) return [];
  const out: string[] = [];
  for (const l of lines.slice(begin + 1)) {
    if (l.startsWith(BLOCK_END)) break;
    const m = l.match(/^0\.0\.0\.0\s+(\S+)/);
    if (m && !m[1].startsWith("www.")) out.push(m[1]);
  }
  return out;
}

/** Why the block can't be written safely, if it can't: an opened block with no end would eat the file. */
export function hostsProblem(hosts: string): string | undefined {
  const begins = hosts.split("\n").filter((l) => l.startsWith("# >>> Backslash Focus Mode")).length;
  const ends = hosts.split("\n").filter((l) => l.startsWith(BLOCK_END)).length;
  if (begins !== ends) {
    return "/etc/hosts has a Backslash Focus Mode block without its end line: fix it with Hosts File or a text editor";
  }
  return undefined;
}

/** Removes our block (and only it) from /etc/hosts; what the root timer does. */
export function removeBlock(hosts: string): string {
  const lines = hosts.split("\n");
  const out: string[] = [];
  let inside = false;
  for (const l of lines) {
    if (l.startsWith("# >>> Backslash Focus Mode")) inside = true;
    else if (inside && l.startsWith(BLOCK_END)) inside = false;
    else if (!inside) out.push(l);
  }
  return out.join("\n");
}

const SED_REMOVE = `sed '/^# >>> Backslash Focus Mode/,/^# <<< Backslash Focus Mode/d' /etc/hosts`;

/** Removes the block in place, keeping the file's owner and mode (cat >, not mv). */
const UNBLOCK = `t=$(mktemp) && ${SED_REMOVE} > "$t" && cat "$t" > /etc/hosts; rm -f "$t"`;
const FLUSH = "command -v resolvectl >/dev/null 2>&1 && resolvectl flush-caches >/dev/null 2>&1 || true";

/**
 * Run as root by pkexec, with the duration in seconds as `$1` and the block lines on stdin.
 * Only `0.0.0.0 name` and `:: name` lines get in. Replaces any previous block, keeps a
 * backup, and schedules a root timer removing the block when the session ends.
 */
export const BLOCK_SCRIPT = [
  "set -e",
  `case "$1" in ''|*[!0-9]*) echo "Bad duration" >&2; exit 2;; esac`,
  `lines=$(grep -E '^(0\\.0\\.0\\.0|::) [A-Za-z0-9.-]+$' || true)`,
  `[ -n "$lines" ] || { echo "Nothing to block" >&2; exit 3; }`,
  "cp /etc/hosts /etc/hosts.backslash-focus.bak",
  `t=$(mktemp)`,
  `${SED_REMOVE} > "$t"`,
  `[ -z "$(tail -c1 "$t")" ] || echo >> "$t"`,
  `{ cat "$t"; printf '%s\\n%s\\n%s\\n' '${BLOCK_BEGIN}' "$lines" '${BLOCK_END}'; } > /etc/hosts`,
  `rm -f "$t"`,
  "systemctl stop backslash-focus-unblock.timer >/dev/null 2>&1 || true",
  "systemctl reset-failed backslash-focus-unblock.service >/dev/null 2>&1 || true",
  `systemd-run --quiet --collect --unit=backslash-focus-unblock --on-active="$1s" ` +
  `--timer-property=AccuracySec=1s --description="Backslash Focus Mode: unblock sites" /bin/sh -c ${
    shellQuote(UNBLOCK)
  }`,
  FLUSH,
].join("\n");

/** Run as root by pkexec when the session stops early: the block goes, and its timer. */
export const UNBLOCK_SCRIPT = [
  "systemctl stop backslash-focus-unblock.timer >/dev/null 2>&1 || true",
  UNBLOCK,
  FLUSH,
].join("\n");

export function pkexecError(code: number, stderr: string): string | undefined {
  if (code === 126) return "The password prompt was dismissed";
  if (code === 127 && /not authorized|authentication/i.test(stderr)) return "Not authorized to change /etc/hosts";
  if (/No authentication agent/i.test(stderr)) return "No polkit agent to ask for your password";
  return undefined;
}

// ---------------------------------------------------------------------------
// Do Not Disturb

/** Which backend drives notifications, from the D-Bus server name, else the desktop. */
export function detectDnd(server: string | undefined, desktop: string): DndBackend | undefined {
  const s = (server ?? "").toLowerCase();
  if (s.includes("mako")) return "mako";
  if (s.includes("dunst")) return "dunst";
  if (s.includes("swaync") || s.includes("swaynotificationcenter")) return "swaync";
  if (s.includes("gnome-shell") || s === "gnome") return "gnome";
  if (s.includes("plasma") || s === "kde") return "kde";
  if (s.includes("xfce")) return "xfce";
  if (s.includes("cinnamon")) return "cinnamon";
  const d = desktop.toLowerCase();
  if (d.includes("gnome") || d.includes("unity") || d.includes("pantheon")) return "gnome";
  if (d.includes("kde")) return "kde";
  if (d.includes("xfce")) return "xfce";
  if (d.includes("cinnamon")) return "cinnamon";
  return undefined;
}

/** `gdbus call … GetServerInformation`: `('mako', 'emersion', '1.9', '1.2')`. */
export function parseServerInfo(out: string): string | undefined {
  return out.match(/^\('((?:[^'\\]|\\.)*)'/)?.[1];
}

export const DND_NAMES: Record<DndBackend, string> = {
  mako: "mako",
  dunst: "Dunst",
  swaync: "SwayNotificationCenter",
  gnome: "GNOME",
  xfce: "Xfce",
  cinnamon: "Cinnamon",
  kde: "Plasma",
};

/** The program and arguments switching Do Not Disturb, or undefined where it can't be done from outside. */
export function dndCommand(b: DndBackend, on: boolean): string[] | undefined {
  switch (b) {
    case "mako":
      return ["makoctl", "mode", on ? "-a" : "-r", "do-not-disturb"];
    case "dunst":
      return ["dunstctl", "set-paused", String(on)];
    case "swaync":
      return ["swaync-client", on ? "--dnd-on" : "--dnd-off", "-sw"];
    case "gnome":
      return ["gsettings", "set", "org.gnome.desktop.notifications", "show-banners", String(!on)];
    case "xfce":
      return ["xfconf-query", "-c", "xfce4-notifyd", "-p", "/do-not-disturb", "-n", "-t", "bool", "-s", String(on)];
    case "cinnamon":
      return ["gsettings", "set", "org.cinnamon.desktop.notifications", "display-notifications", String(!on)];
    case "kde":
      // Plasma ends an app's Do Not Disturb when the app quits: it can't outlive the command.
      return undefined;
  }
}

/** How to read the state: program, arguments, and whether the output means "on". */
export function dndQuery(b: DndBackend): { args: string[]; on: (out: string) => boolean } | undefined {
  const t = (out: string) => out.trim() === "true";
  switch (b) {
    case "mako":
      return { args: ["makoctl", "mode"], on: (o) => o.split("\n").some((l) => l.trim() === "do-not-disturb") };
    case "dunst":
      return { args: ["dunstctl", "is-paused"], on: t };
    case "swaync":
      return { args: ["swaync-client", "-D", "-sw"], on: t };
    case "gnome":
      return { args: ["gsettings", "get", "org.gnome.desktop.notifications", "show-banners"], on: (o) => !t(o) };
    case "xfce":
      return { args: ["xfconf-query", "-c", "xfce4-notifyd", "-p", "/do-not-disturb"], on: t };
    case "cinnamon":
      return {
        args: ["gsettings", "get", "org.cinnamon.desktop.notifications", "display-notifications"],
        on: (o) => !t(o),
      };
    case "kde":
      return undefined;
  }
}

/** What the end-of-session timer runs: Do Not Disturb off, then a notification and a sound. */
export function endScript(o: { dnd?: DndBackend; minutes: number }): string {
  const lines: string[] = [];
  const off = o.dnd ? dndCommand(o.dnd, false) : undefined;
  // mako before 1.8 has set-mode instead of mode -r.
  if (off) lines.push(`${off.map(shellQuote).join(" ")}${o.dnd === "mako" ? " || makoctl set-mode default" : ""}`);
  const sound = "/usr/share/sounds/freedesktop/stereo/complete.oga";
  lines.push(
    `notify-send -a Backslash -i ${shellQuote("view-reveal-symbolic")} ${shellQuote("Focus session over")} ${
      shellQuote(`${humanize(o.minutes * 60)} of focus. Time for a break.`)
    }`,
    `(canberra-gtk-play -i complete || paplay ${sound} || pw-play ${sound}) >/dev/null 2>&1`,
    "true",
  );
  return lines.join("; ");
}

/** The `systemd-run` arguments of the timer ending the session. */
export function timerArgs(unit: string, seconds: number, script: string, env: Record<string, string | undefined>) {
  return [
    "--user",
    "--quiet",
    `--unit=${unit}`,
    `--on-active=${Math.max(1, Math.round(seconds))}s`,
    "--timer-property=AccuracySec=1s",
    "--description=Backslash: end of focus session",
    "--collect",
    ...Object.entries(env).filter(([, v]) => v).map(([k, v]) => `--setenv=${k}=${v}`),
    "/bin/sh",
    "-c",
    script,
  ];
}

// ---------------------------------------------------------------------------
// Slack

/** The status put on Slack for the session, gone by itself when it ends. */
export function slackStatus(text: string, emoji: string, ends: number): SlackStatus {
  const core = emoji.trim().replace(/^:+|:+$/g, "");
  return {
    text: text.trim().slice(0, 100) || "Focusing",
    emoji: core ? `:${core}:` : "",
    expiration: Math.round(ends / 1000),
  };
}

/** The status to put back when stopping early: the previous one if it hasn't expired, else none. */
export function statusToRestore(previous: SlackStatus | undefined, nowMs = Date.now()): SlackStatus {
  if (!previous || (!previous.text && !previous.emoji)) return { text: "", emoji: "", expiration: 0 };
  if (previous.expiration && previous.expiration * 1000 <= nowMs) return { text: "", emoji: "", expiration: 0 };
  return previous;
}

/** Form encoding of Slack Web API parameters (objects as JSON). */
export function encodeParams(params: Record<string, unknown>): URLSearchParams {
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    body.set(key, typeof value === "object" ? JSON.stringify(value) : String(value));
  }
  return body;
}

export function slackError(code: string | undefined, needed?: string): string {
  switch (code) {
    case "not_authed":
    case "invalid_auth":
    case "token_revoked":
    case "token_expired":
    case "account_inactive":
      return "Slack rejected the token: check it in Settings → Extensions → Focus Mode";
    case "missing_scope":
      return `The Slack token lacks the ${needed ?? "needed"} scope`;
    case "ratelimited":
      return "Slack is rate limiting: try again in a minute";
    default:
      return `Slack: ${(code ?? "unknown error").replaceAll("_", " ")}`;
  }
}
