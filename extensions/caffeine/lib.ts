// Durations and the inhibitor's command line. Pure, tested in lib_test.ts.

/**
 * "25m", "1h30", "1h 30m", "90s", "10:00", "2" (hours?) → seconds.
 * A bare number is minutes. Undefined when it can't be read.
 */
export function parseDuration(text: string): number | undefined {
  const t = text.trim().toLowerCase().replace(/,/g, ".");
  if (!t) return undefined;
  if (/^\d+(\.\d+)?$/.test(t)) return Number(t) > 0 ? Math.round(Number(t) * 60) : undefined;
  const clock = t.match(/^(\d+):(\d{1,2})$/);
  if (clock) return Number(clock[1]) * 3600 + Number(clock[2]) * 60 || undefined;
  let total = 0;
  let matched = "";
  const unit = /(\d+(?:\.\d+)?)\s*(hours?|heures?|hrs|hr|h|minutes?|mins|min|mn|m|secondes?|seconds?|secs|sec|s)?/g;
  for (const m of t.matchAll(unit)) {
    if (!m[0].trim()) continue;
    matched += m[0];
    const n = Number(m[1]);
    const u = m[2] ?? "";
    if (u.startsWith("h")) total += n * 3600;
    else if (u.startsWith("s")) total += n;
    else total += n * 60; // "1h30": a bare number after hours is minutes
  }
  if (matched.replace(/\s/g, "") !== t.replace(/\s/g, "")) return undefined;
  return total > 0 ? Math.round(total) : undefined;
}

/** 1500 → "25 min", 5400 → "1 h 30", 7200 → "2 h", 45 → "1 min" (rounded up to the minute). */
export function humanize(seconds: number): string {
  const total = Math.max(1, Math.ceil(seconds / 60));
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h) return m ? `${h} h ${String(m).padStart(2, "0")}` : `${h} h`;
  return `${m} min`;
}

/** Remaining time as a clock: "24:59", "1:02:03". */
export function countdown(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const mm = String(Math.floor((s % 3600) / 60)).padStart(h ? 2 : 1, "0");
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export interface Session {
  /** Unix ms. */
  started: number;
  /** Unix ms; null until turned off. */
  until: number | null;
}

/** The root search line: "Awake for 23 min", "Awake until turned off". */
export function subtitle(s: Session | undefined, now = Date.now()): string | null {
  if (!s) return null;
  return s.until === null ? "Awake until turned off" : `Awake for ${humanize((s.until - now) / 1000)}`;
}

/** Single-quotes a string for sh. */
export const q = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

export const UNIT = "backslash-caffeine";

/**
 * The unit's script: systemd-inhibit holds idle and sleep for as long as
 * `sleep` runs. GNOME and KDE also get their own session inhibitor, which
 * their screen blanking listens to.
 */
export function inhibitScript(seconds: number | undefined, why = "Caffeine: keeping the computer awake"): string {
  const sleep = seconds ? `sleep ${Math.round(seconds)}` : "sleep infinity";
  return [
    `set -- systemd-inhibit --what=idle:sleep --who=Backslash --why=${q(why)} --mode=block ${sleep}`,
    `case "\${XDG_CURRENT_DESKTOP:-}" in`,
    `  *GNOME*) command -v gnome-session-inhibit >/dev/null 2>&1 && set -- gnome-session-inhibit --inhibit idle:suspend --reason ${
      q(why)
    } "$@" ;;`,
    `  *KDE*) command -v kde-inhibit >/dev/null 2>&1 && set -- kde-inhibit --power --screenSaver "$@" ;;`,
    "esac",
    `exec "$@"`,
  ].join("\n");
}

export function systemdRunArgs(seconds: number | undefined, desktop?: string): string[] {
  return [
    "--user",
    "--quiet",
    `--unit=${UNIT}`,
    `--description=Backslash: Caffeine${seconds ? ` (${humanize(seconds)})` : ""}`,
    "--collect",
    ...(desktop ? [`--setenv=XDG_CURRENT_DESKTOP=${desktop}`] : []),
    "/bin/sh",
    "-c",
    inhibitScript(seconds),
  ];
}

/** `systemd-inhibit --list --no-legend --no-pager`: other programs keeping the computer awake. */
export function parseInhibitors(out: string): { who: string; what: string; why: string }[] {
  return out.split("\n").flatMap((line) => {
    // WHO UID USER PID COMM WHAT WHY MODE; WHO and WHY may contain spaces.
    const m = line.trim().match(/^(.+?)\s+(\d+)\s+(\S+)\s+(\d+)\s+(\S+)\s+(\S+)\s+(.*?)\s+(block|delay)$/);
    if (!m) return [];
    const [, who, , , , , what, why, mode] = m;
    if (mode !== "block" || who === "Backslash" || !/idle|sleep/.test(what)) return [];
    return [{ who, what, why }];
  });
}
