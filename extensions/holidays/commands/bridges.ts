import { type Context, copy, Icons, type Item, list, meta } from "@backslash/api";
import { publicHolidays, schoolHolidays } from "../api.ts";
import {
  addDays,
  type Bridge,
  bridges,
  countdown,
  countdownTag,
  type Day,
  daysBetween,
  holidaysFor,
  isWeekend,
  longDay,
  normalizeCountry,
  normalizeRegion,
  ratio,
  ratioColor,
  type SchoolPeriod,
  shortDay,
  takeLabel,
  today,
} from "../lib.ts";

/** The school holidays a break overlaps, for parents (France only). */
const overlapping = (b: Bridge, periods: SchoolPeriod[]) =>
  periods.filter((p) => p.start <= b.end && (p.end ?? addDays(p.start, 62)) > b.start);

function calendar(b: Bridge): string {
  const lines: string[] = [];
  for (let d = b.start; d <= b.end; d = addDays(d, 1)) {
    const holiday = b.holidays.find((h) => h.date === d);
    const what = holiday
      ? `**${holiday.name}**`
      : b.take.includes(d)
      ? "*day off to take*"
      : isWeekend(d)
      ? "weekend"
      : "";
    lines.push(`- ${shortDay(d)} — ${what}`);
  }
  return lines.join("\n");
}

function bridgeItem(b: Bridge, on: Day, periods: SchoolPeriod[], zone: string): Item {
  const school = overlapping(b, periods);
  const names = b.holidays.map((h) => h.name).join(" + ");
  const days = b.take.length === 1 ? "1 day" : `${b.take.length} days`;
  const summary = `Take ${takeLabel(b)} off: ${b.total} days in a row for ${days} (${names})`;
  return {
    id: b.take[0],
    title: `Take ${takeLabel(b)} off`,
    subtitle: names,
    icon: { source: b.take.length === 1 ? Icons.sun : Icons.cloudSun, tint: ratioColor(b) },
    section: b.take[0].slice(0, 4),
    keywords: [b.kind, "pont", ...b.holidays.map((h) => h.localName)],
    accessories: [
      ...(school.length ? [{ tag: "school holidays", color: "purple" as const, tooltip: school[0].name }] : []),
      {
        tag: `${days} → ${b.total} days`,
        color: ratioColor(b),
        tooltip: `${ratio(b).toFixed(1)} days off per day taken`,
      },
      { text: countdownTag(on, b.take[0]), tooltip: countdown(on, b.take[0]) },
    ],
    detail: {
      stats: [
        { label: "Days to take", value: b.take.length },
        { label: "Days off", value: b.total, color: ratioColor(b) },
        { label: "Starts in", value: `${Math.max(0, daysBetween(on, b.start))} d` },
      ],
      markdown: [
        `## ${b.kind}: ${names}`,
        `From **${longDay(b.start)}** to **${longDay(b.end)}**.`,
        calendar(b),
        school.length
          ? `Overlaps the ${school.map((p) => p.name.toLowerCase()).join(" and ")} of ${zone}: book early.`
          : "",
      ].filter(Boolean).join("\n\n"),
      metadata: [
        meta.text("Days to take", b.take.map(shortDay).join(", "), { icon: Icons.calendar }),
        meta.text("Break", `${shortDay(b.start)} → ${shortDay(b.end)}`, { icon: Icons.sun }),
        meta.tags("Holidays", b.holidays.map((h) => ({ text: h.name, color: "green" }))),
        meta.text("Value", `${ratio(b).toFixed(1)} days off per day taken`, { color: ratioColor(b) }),
      ],
    },
    actions: [
      copy(summary, "Copy Suggestion", { shortcut: "<Ctrl><Shift>c" }),
      copy(b.take.join(", "), "Copy Dates", { icon: Icons.calendar, shortcut: "<Ctrl>.", section: "Copy" }),
    ],
  };
}

export default (ctx: Context) => {
  const country = normalizeCountry(ctx.preferences.country);
  const region = normalizeRegion(ctx.preferences.region, country);
  const zone = String(ctx.preferences.zone ?? "");
  return list({
    title: `Bridge Days · ${country}`,
    placeholder: "Filter bridge days…",
    empty: {
      title: "No bridge day ahead",
      description: "No public holiday falls next to a weekend in the next twelve months",
      icon: Icons.sun,
    },
    status: (items) => {
      const total = items.reduce((n, i) => n + Number(i.detail?.stats?.[0]?.value ?? 0), 0);
      return `${items.length} bridges · ${total} days to take`;
    },
    async items({ signal }) {
      const on = today();
      const year = Number(on.slice(0, 4));
      const [now, next, periods] = await Promise.all([
        publicHolidays(country, year, signal),
        publicHolidays(country, year + 1, signal),
        country === "FR" ? schoolHolidays(zone, on, signal).catch(() => [] as SchoolPeriod[]) : [],
      ]);
      const all = holidaysFor([...now, ...next], region);
      return bridges(all, addDays(on, 1), addDays(on, 365)).map((b) => bridgeItem(b, on, periods, zone));
    },
  });
};
