import { action, type Context, copy, Icons, type Item, list, meta, open, updateCommandMetadata } from "@backslash/api";
import { countries, publicHolidays } from "../api.ts";
import {
  addDays,
  type Bridge,
  bridges,
  countdown,
  countdownColor,
  countdownTag,
  type Day,
  daysBetween,
  type Holiday,
  holidaysFor,
  holidayTitle,
  isDayOff,
  longDay,
  normalizeCountry,
  normalizeRegion,
  shortDay,
  takeLabel,
  today,
  typeLabel,
  weekdayName,
  weekendNote,
} from "../lib.ts";
import bridgesView from "./bridges.ts";

function holidayItem(h: Holiday, on: Day, country: string, region: string | undefined, bridge?: Bridge): Item {
  const dayOff = isDayOff(h);
  const lost = weekendNote(h);
  const past = h.date < on;
  const year = h.date.slice(0, 4);
  return {
    id: `${h.date}|${h.name}`,
    title: holidayTitle(h),
    subtitle: shortDay(h.date),
    icon: {
      source: past ? Icons.calendar : dayOff ? Icons.starFilled : Icons.star,
      tint: past ? "gray" : countdownColor(on, h.date),
    },
    section: past ? `Past in ${year}` : year === on.slice(0, 4) ? "Upcoming" : year,
    keywords: [h.localName, h.date, ...(h.counties ?? []), ...h.types],
    accessories: [
      ...(lost
        ? [{ tag: lost.replace("Falls on a ", "on "), color: "gray" as const, tooltip: "Lost to the weekend" }]
        : []),
      ...(bridge
        ? [{ tag: `bridge ${takeLabel(bridge)}`, color: "teal" as const, tooltip: `${bridge.total} days off in a row` }]
        : []),
      ...(!h.global && h.counties?.length
        ? [{ tag: "regional", color: "purple" as const, tooltip: h.counties.join(", ") }]
        : []),
      ...(!dayOff ? [{ tag: h.types.map(typeLabel).join(", "), color: "gray" as const }] : []),
      { text: countdownTag(on, h.date), color: countdownColor(on, h.date), tooltip: countdown(on, h.date) },
    ],
    detail: {
      stats: [
        { label: past ? "Days ago" : "Days left", value: Math.abs(daysBetween(on, h.date)) },
        { label: "Weekday", value: weekdayName(h.date) },
      ],
      markdown: [
        `## ${h.name}`,
        h.localName && h.localName !== h.name ? `*${h.localName}*` : "",
        `${longDay(h.date)} — **${countdown(on, h.date).toLowerCase()}**.`,
        lost ? `${lost}: no extra day off this year.` : "",
        bridge
          ? `Take **${takeLabel(bridge)}** off for **${bridge.total} days** in a row (${shortDay(bridge.start)} → ${
            shortDay(bridge.end)
          }).`
          : "",
      ].filter(Boolean).join("\n\n"),
      metadata: [
        meta.text("Date", h.date, { icon: Icons.calendar }),
        meta.tags("Type", h.types.map((t) => ({ text: typeLabel(t), color: t === "Public" ? "green" : "gray" }))),
        meta.text("Where", h.global || !h.counties?.length ? `All of ${country}` : h.counties.join(", "), {
          icon: Icons.globe,
        }),
        ...(region && h.counties?.includes(region) ? [meta.text("Your region", region, { icon: Icons.pin })] : []),
        ...(h.launchYear ? [meta.text("Since", h.launchYear)] : []),
      ],
    },
    actions: [
      copy(`${h.name}: ${longDay(h.date)}`, "Copy Holiday", { shortcut: "<Ctrl><Shift>c" }),
      copy(h.date, "Copy Date", { icon: Icons.calendar, shortcut: "<Ctrl>.", section: "Copy" }),
      action("Show Bridge Days", (c) => bridgesView(c), { icon: Icons.sun, shortcut: "<Ctrl>b" }),
      open(
        `https://en.wikipedia.org/wiki/Special:Search?search=${encodeURIComponent(`${h.name} ${country}`)}`,
        "Look Up on Wikipedia",
        { icon: Icons.book, section: "Open" },
      ),
      open(`https://date.nager.at/PublicHoliday/Country/${country}/${year}`, "Open Nager.Date", {
        icon: Icons.globe,
        section: "Open",
      }),
    ],
  };
}

export default (ctx: Context<{ country?: string }>) => {
  const argCountry = String(ctx.args?.country ?? "").trim();
  const country = normalizeCountry(argCountry || ctx.preferences.country);
  const region = argCountry ? undefined : normalizeRegion(ctx.preferences.region, country);
  return list({
    title: `Public Holidays · ${country}${region ? ` (${region})` : ""}`,
    placeholder: "Filter holidays…",
    empty: {
      title: "No public holiday",
      description: "Nager.Date lists none for this country: check the country code in Settings",
      icon: Icons.calendar,
    },
    status: (items) => {
      const next = items.find((i) => i.section === "Upcoming" || /^\d{4}$/.test(i.section ?? ""));
      return next ? `Next: ${next.title.split(" · ")[0]} · ${next.subtitle}` : `${items.length} holidays`;
    },
    async *items({ signal }) {
      const on = today();
      const year = Number(on.slice(0, 4));
      const names = countries(signal);
      const [now, next] = await Promise.all([
        publicHolidays(country, year, signal),
        publicHolidays(country, year + 1, signal),
      ]);
      const all = holidaysFor([...now, ...next], region);
      const upcoming = all.filter((h) => h.date >= on);
      const past = all.filter((h) => h.date < on && h.date.startsWith(String(year))).reverse();
      const breaks = bridges(all, `${year}-01-01`, addDays(on, 400));
      const bridgeOf = (h: Holiday) => breaks.find((b) => b.holidays.some((x) => x.date === h.date));
      const rows = [...upcoming, ...past].map((h) => holidayItem(h, on, country, region, bridgeOf(h)));
      yield rows;
      const name = (await names).get(country);
      const first = upcoming.find(isDayOff);
      if (!argCountry && first) {
        updateCommandMetadata({ subtitle: `${first.name}: ${countdown(on, first.date).toLowerCase()}` }).catch(
          () => {},
        );
      }
      if (name) {
        yield rows.map((r) => ({
          ...r,
          detail: {
            ...r.detail,
            metadata: r.detail?.metadata?.map((m) =>
              m.label === "Where" ? { ...m, value: m.value?.replace(country, name) } : m
            ),
          },
        }));
      }
    },
  });
};
