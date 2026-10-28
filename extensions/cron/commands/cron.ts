import { type Action, copy, Icons, type Item, list, meta, type Metadata } from "@backslash/api";
import {
  explain,
  fieldLines,
  formatRun,
  nextRuns,
  parseAny,
  parseCron,
  PRESETS,
  type Schedule,
  timerUnit,
  toCron,
  toSystemd,
  until,
} from "../lib.ts";

const attempt = <T>(fn: () => T): T | Error => {
  try {
    return fn();
  } catch (e) {
    return e instanceof Error ? e : new Error(String(e));
  }
};

const runsMarkdown = (s: Schedule, now: Date, count = 5) => {
  if (s.reboot) return "Runs once at boot. Cron daemons that support it (cronie, Vixie cron) start it when they start.";
  const runs = nextRuns(s, now, count);
  if (!runs.length) return "_Never runs again._";
  return ["**Next runs** (local time)", "", ...runs.map((d) => `- ${formatRun(d, s.hasSeconds)}  ·  ${until(d, now)}`)]
    .join("\n");
};

function conversions(s: Schedule): { systemd: string[] | Error; cron: string | Error } {
  return { systemd: attempt(() => toSystemd(s)), cron: attempt(() => toCron(s)) };
}

function scheduleMetadata(s: Schedule): Metadata[] {
  const { systemd, cron } = conversions(s);
  return [
    ...fieldLines(s).map(([label, value]) => meta.text(label, value)),
    meta.separator(),
    ...(s.kind === "systemd" && typeof cron === "string" ? [meta.text("cron", cron, { icon: Icons.terminal })] : []),
    ...(s.kind === "cron" && Array.isArray(systemd)
      ? systemd.map((line, i) => meta.text(i ? "" : "OnCalendar", line, { icon: i ? undefined : Icons.calendar }))
      : []),
    ...(s.timezone ? [meta.text("Time zone", `${s.timezone} (runs shown in local time)`, { icon: Icons.globe })] : []),
  ];
}

function copyActions(s: Schedule, description: string): Action[] {
  const { systemd, cron } = conversions(s);
  return [
    copy(s.source, "Copy Expression"),
    copy(description, "Copy Explanation", { icon: Icons.text, shortcut: "<Ctrl><Shift>e" }),
    ...(s.kind === "cron" && Array.isArray(systemd)
      ? [
        copy(systemd.join("\n"), "Copy as systemd OnCalendar", { icon: Icons.calendar, shortcut: "<Ctrl><Shift>s" }),
        copy(timerUnit(systemd, description), "Copy systemd Timer Unit", { icon: Icons.file, section: "systemd" }),
      ]
      : []),
    ...(s.kind === "systemd" && typeof cron === "string"
      ? [copy(cron, "Copy as Cron Expression", { icon: Icons.terminal, shortcut: "<Ctrl><Shift>s" })]
      : []),
  ];
}

function presetItem(cron: string, title: string, now: Date): Item {
  const s = parseCron(cron);
  const next = s.reboot ? undefined : nextRuns(s, now, 1)[0];
  const description = explain(s);
  return {
    id: `preset:${cron}`,
    title: cron,
    subtitle: title,
    icon: { source: s.reboot ? Icons.power : Icons.clock, tint: "blue" },
    section: "Presets",
    keywords: [title, description],
    accessories: next ? [{ text: until(next, now), tooltip: `Next run: ${formatRun(next)}` }] : [],
    detail: {
      markdown: `## ${description}\n\n${runsMarkdown(s, now)}`,
      metadata: scheduleMetadata(s),
    },
    actions: copyActions(s, description),
  };
}

function scheduleItems(s: Schedule, now: Date): Item[] {
  const description = explain(s);
  const runs = s.reboot ? [] : nextRuns(s, now, 10);
  const { systemd, cron } = conversions(s);
  const kind = s.kind === "cron"
    ? `Cron · ${s.macro ?? `${s.hasSeconds ? s.source.split(/\s+/).length : 5} fields`}`
    : `systemd calendar event${s.macro ? ` · ${s.macro}` : ""}`;
  const items: Item[] = [{
    id: "explain",
    title: description,
    subtitle: kind,
    icon: { source: Icons.calendar, tint: "blue" },
    section: "Schedule",
    accessories: runs[0] ? [{ text: until(runs[0], now), tooltip: "Next run" }] : [],
    detail: {
      stats: runs[0]
        ? [{ label: "Next run", value: until(runs[0], now).replace(/^in /, "") }, {
          label: "Runs per day",
          value: perDay(runs),
        }]
        : [],
      markdown: `## ${description}\n\n\`${s.source}\`\n\n${runsMarkdown(s, now)}`,
      metadata: scheduleMetadata(s),
    },
    actions: copyActions(s, description),
  }];
  if (s.timezone) {
    items.push({
      id: "tz",
      title: `Times are computed in local time, not ${s.timezone}`,
      icon: { source: Icons.info, tint: "orange" },
      section: "Schedule",
    });
  }
  runs.forEach((d, i) => {
    const iso = toLocalIso(d);
    items.push({
      id: `run:${i}`,
      title: formatRun(d, s.hasSeconds),
      subtitle: until(d, now),
      icon: { source: Icons.clock, tint: i === 0 ? "green" : "gray" },
      section: "Next Runs",
      accessories: i === 0 ? [{ tag: "Next", color: "green" }] : [],
      actions: [copy(iso, "Copy Date and Time"), copy(s.source, "Copy Expression")],
    });
  });
  if (s.kind === "cron") {
    if (Array.isArray(systemd)) {
      systemd.forEach((line, i) => {
        items.push({
          id: `systemd:${i}`,
          title: line,
          subtitle: systemd.length > 1 ? `OnCalendar= (line ${i + 1} of ${systemd.length})` : "OnCalendar=",
          icon: { source: Icons.calendar, tint: "purple" },
          section: "systemd Timer",
          detail: {
            markdown: [
              systemd.length > 1
                ? "Cron runs when the day of month **or** the day of week matches; systemd needs one `OnCalendar=` line for each."
                : "Same schedule as a systemd timer.",
              "",
              "```ini",
              timerUnit(systemd, description),
              "```",
              "",
              "Check it with `systemd-analyze calendar`.",
            ].join("\n"),
          },
          actions: [
            copy(line, "Copy OnCalendar Value"),
            copy(timerUnit(systemd, description), "Copy Timer Unit", { icon: Icons.file }),
            copy(`systemd-analyze calendar --iterations=5 '${line}'`, "Copy systemd-analyze Command", {
              icon: Icons.terminal,
            }),
          ],
        });
      });
    } else items.push(unsupported(systemd, "systemd Timer"));
  } else if (typeof cron === "string") {
    items.push({
      id: "cron",
      title: cron,
      subtitle: s.hasSeconds && cron.split(" ").length === 6 ? "Cron with seconds (Quartz, Spring, node-cron)" : "Cron",
      icon: { source: Icons.terminal, tint: "purple" },
      section: "Cron",
      detail: { markdown: `\`\`\`\n# crontab -e\n${cron} /path/to/command\n\`\`\`` },
      actions: [copy(cron, "Copy Cron Expression"), copy(`${cron} `, "Copy as crontab Line Start")],
    });
  } else items.push(unsupported(cron, "Cron"));
  return items;
}

const unsupported = (e: Error, section: string): Item => ({
  id: `unsupported:${section}`,
  title: e.message,
  subtitle: "No exact equivalent",
  icon: { source: Icons.alert, tint: "orange" },
  section,
});

function perDay(runs: Date[]): string {
  if (runs.length < 2) return "–";
  const span = (runs[runs.length - 1].getTime() - runs[0].getTime()) / (runs.length - 1);
  const n = 86_400_000 / span;
  return n >= 1 ? String(Math.round(n)) : `1 per ${Math.round(1 / n)} days`;
}

const pad = (n: number) => String(n).padStart(2, "0");
const toLocalIso = (d: Date) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${
    pad(d.getSeconds())
  }`;

export default list({
  placeholder: "Type a cron expression (*/5 * * * *) or a systemd calendar (Mon..Fri 09:00)…",
  empty: { title: "Nothing to show", icon: Icons.clock },
  status: (items) => {
    const first = items[0];
    if (!first) return "";
    if (first.id === "error") return "Invalid expression";
    if (first.id?.startsWith("preset:")) return `${items.length} presets · times in local time`;
    return String(first.subtitle ?? "");
  },
  search(query) {
    const now = new Date();
    const text = query.trim();
    const presets = (filter: string) =>
      PRESETS.filter((p) => !filter || `${p.cron} ${p.title}`.toLowerCase().includes(filter.toLowerCase()))
        .map((p) => presetItem(p.cron, p.title, now));
    if (!text) return presets("");
    const s = attempt(() => parseAny(text));
    if (!(s instanceof Error)) return scheduleItems(s, now);
    // Words that aren't an expression search the presets ("weekday", "month").
    const matching = presets(text);
    if (/^[a-z ]+$/i.test(text) && matching.length) return matching;
    return [{
      id: "error",
      title: s.message,
      subtitle: "Not a valid expression",
      icon: { source: Icons.alert, tint: "red" },
      section: "Expression",
      detail: {
        markdown: [
          "## Cron",
          "",
          "`minute hour day-of-month month day-of-week`, or 6 fields with seconds first.",
          "",
          "- `*` any · `5` a value · `1-5` a range · `*/15` a step · `1,15` a list",
          "- Names: `JAN`–`DEC`, `SUN`–`SAT`",
          "- `L` last day of the month · `5L` last Friday · `1#2` second Monday",
          "- `@hourly`, `@daily`, `@weekly`, `@monthly`, `@yearly`, `@reboot`",
          "",
          "## systemd",
          "",
          "`[weekday] [year-month-day] [hour:minute[:second]]`",
          "",
          "- `Mon..Fri 09:00` · `*-*-01 00:00` · `*:0/15` · `*-*~01` (last day)",
          "- `daily`, `weekly`, `monthly`, `quarterly`, `yearly`",
        ].join("\n"),
      },
      actions: [copy(text, "Copy Input")],
    }, ...presets("")];
  },
});
