// Pure helpers, tested in lib_test.ts.

/**
 * "25m", "1h30", "1h 30m", "90s", "10:00", "1:30:00", "25" (minutes) → seconds.
 * Undefined when it can't be read.
 */
export function parseDuration(text: string): number | undefined {
  const t = text.trim().toLowerCase().replace(/,/g, ".");
  if (!t) return undefined;
  if (/^\d+(\.\d+)?$/.test(t)) return Number(t) > 0 ? Math.round(Number(t) * 60) : undefined;
  const clock = t.match(/^(\d+):(\d{1,2})(?::(\d{1,2}))?$/);
  if (clock) {
    const [a, b, c] = [Number(clock[1]), Number(clock[2]), clock[3] ? Number(clock[3]) : undefined];
    return c === undefined ? a * 60 + b : a * 3600 + b * 60 + c;
  }
  let total = 0;
  let matched = "";
  const unit = /(\d+(?:\.\d+)?)\s*(hours?|heures?|hrs|hr|h|minutes?|mins|min|m|secondes?|seconds?|secs|sec|s)?/g;
  for (const m of t.matchAll(unit)) {
    if (!m[0].trim()) continue;
    matched += m[0];
    const n = Number(m[1]);
    const u = m[2] ?? "";
    if (u.startsWith("h")) total += n * 3600;
    else if (u.startsWith("s")) total += n;
    // "1h30": a bare number after hours means minutes.
    else total += n * 60;
  }
  if (matched.replace(/\s/g, "") !== t.replace(/\s/g, "")) return undefined;
  return total > 0 ? Math.round(total) : undefined;
}

/** 1500 → "25 min", 5400 → "1 h 30", 45 → "45 s". */
export function humanize(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h) return m ? `${h} h ${String(m).padStart(2, "0")}` : `${h} h`;
  if (m) return s ? `${m} min ${s} s` : `${m} min`;
  return `${s} s`;
}

/** Remaining time as a clock: "24:59", "1:02:03". */
export function countdown(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const mm = String(Math.floor((s % 3600) / 60)).padStart(h ? 2 : 1, "0");
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** Single-quotes a string for sh. */
export const shellQuote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

/** The `systemd-run` arguments of a timer. */
export function timerArgs(unit: string, seconds: number, name: string): string[] {
  const title = shellQuote(`⏰ ${name}`);
  const body = shellQuote(`Time is up (${humanize(seconds)})`);
  const sound = "/usr/share/sounds/freedesktop/stereo/complete.oga";
  const script = [
    `notify-send -a Backslash -u critical -i alarm-symbolic ${title} ${body}`,
    `(canberra-gtk-play -i complete || paplay ${sound} || pw-play ${sound}) >/dev/null 2>&1`,
    "true",
  ].join("; ");
  return [
    "--user",
    `--unit=${unit}`,
    `--on-active=${seconds}s`,
    "--timer-property=AccuracySec=1s",
    `--description=Backslash: ${name}`,
    "--collect",
    "/bin/sh",
    "-c",
    script,
  ];
}
