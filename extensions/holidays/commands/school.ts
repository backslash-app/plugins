import { type Context, copy, Icons, type Item, list, meta, open, updateCommandMetadata } from "@backslash/api";
import { schoolHolidays } from "../api.ts";
import {
  addDays,
  countdown,
  countdownColor,
  countdownTag,
  type Day,
  daysBetween,
  longDay,
  normalizeZone,
  periodLength,
  periodRange,
  periodState,
  type SchoolPeriod,
  shortDay,
  today,
  ZONES,
} from "../lib.ts";

const CALENDAR_URL = "https://www.education.gouv.fr/calendrier-scolaire-100148";

function periodItem(p: SchoolPeriod, on: Day): Item {
  const state = periodState(p, on);
  const length = periodLength(p);
  const lastDay = p.end ? addDays(p.end, -1) : undefined;
  const left = p.end ? daysBetween(on, p.end) : undefined;
  const tag = state === "now"
    ? { tag: left !== undefined ? `${left} d left` : "now", color: "green" as const }
    : state === "past"
    ? { tag: "past", color: "gray" as const }
    : { tag: countdownTag(on, p.start), color: countdownColor(on, p.start) };
  return {
    id: `${p.description}|${p.start}`,
    title: p.name,
    subtitle: periodRange(p),
    icon: {
      source: state === "now" ? Icons.sun : Icons.book,
      tint: state === "now" ? "green" : state === "past" ? "gray" : countdownColor(on, p.start),
    },
    section: state === "now" ? "Now" : `School year ${p.year}`,
    keywords: [p.description, p.zone, ...p.locations],
    accessories: [
      ...(length ? [{ text: `${length} days`, tooltip: "Days without classes, weekends included" }] : []),
      { ...tag, tooltip: state === "upcoming" ? countdown(on, p.start) : undefined },
    ],
    detail: {
      stats: [
        ...(length ? [{ label: "Days off", value: length }] : []),
        state === "upcoming"
          ? { label: "Starts in", value: `${daysBetween(on, p.start)} d`, color: countdownColor(on, p.start) }
          : state === "now" && left !== undefined
          ? { label: "Back to school in", value: `${left} d`, color: "green" as const }
          : { label: "Ended", value: p.end ? shortDay(p.end) : "—" },
      ],
      markdown: [
        `## ${p.name}`,
        `*${p.description}* · ${p.zone}`,
        `No classes from **${longDay(p.start)}**${
          lastDay ? ` to **${longDay(lastDay)}**; classes resume on **${longDay(p.end!)}**` : ""
        }.`,
        "Classes usually end the evening before the first day (or on Saturday morning where there is school on Saturdays).",
      ].join("\n\n"),
      metadata: [
        meta.text("Zone", p.zone, { icon: Icons.pin }),
        meta.text("First day", longDay(p.start), { icon: Icons.calendar }),
        ...(p.end ? [meta.text("Back to school", longDay(p.end), { icon: Icons.book })] : []),
        meta.text("School year", p.year),
        ...(p.locations.length ? [meta.tags("Académies", p.locations)] : []),
      ],
    },
    actions: [
      copy(`${p.name} (${p.zone}): ${periodRange(p)}`, "Copy Dates", { shortcut: "<Ctrl><Shift>c" }),
      copy(`${p.start}${p.end ? `/${p.end}` : ""}`, "Copy as ISO Range", { icon: Icons.calendar, section: "Copy" }),
      open(CALENDAR_URL, "Open the Official Calendar", { icon: Icons.globe, shortcut: "<Ctrl>o" }),
    ],
  };
}

export default (ctx: Context) => {
  const preferred = normalizeZone(ctx.preferences.zone);
  const options = ZONES.includes(preferred) ? ZONES : [preferred, ...ZONES];
  return list({
    title: "School Holidays",
    placeholder: "Filter school holidays…",
    filter: { options: options.map((z) => ({ value: z, title: z })), default: preferred },
    empty: {
      title: "No school holidays found",
      description: "Pick a zone above, or set yours (A, B, C, Corse, overseas académie) in Settings",
      icon: Icons.book,
    },
    status: (items) => items.find((i) => i.section === "Now")?.subtitle ?? `${items.length} periods`,
    async items({ signal, filter }) {
      const zone = normalizeZone(filter || preferred);
      const on = today();
      const periods = (await schoolHolidays(zone, on, signal)).filter((p) => periodState(p, on) !== "past");
      const now = periods.find((p) => periodState(p, on) === "now");
      const next = periods.find((p) => periodState(p, on) === "upcoming");
      if (zone === preferred) {
        const subtitle = now?.end
          ? `${now.name}: back to school ${shortDay(now.end)}`
          : next
          ? `${next.name}: ${countdown(on, next.start).toLowerCase()}`
          : null;
        updateCommandMetadata({ subtitle }).catch(() => {});
      }
      return periods.map((p) => periodItem(p, on));
    },
  });
};
