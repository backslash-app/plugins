import { copy, Icons, type Item, list, updateCommandMetadata } from "@backslash/api";
import { CACHE_MINUTES, eventItem, loadAll, type Loaded, type Shown, takeForce } from "../calendars.ts";
import { expand, isNow, parseUrls, sectionOf, statusFor, subtitleFor } from "../lib.ts";
import { setupItems } from "../setup.ts";

const DAY = 86_400_000;
let footer = "";

/** Sleeps until the next minute (or `signal`), so "in 12 min" stays right. */
const nextMinute = (signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const t = setTimeout(resolve, 60_000 - (Date.now() % 60_000) + 50);
    signal.addEventListener("abort", () => {
      clearTimeout(t);
      resolve();
    }, { once: true });
  });

function problemItem(c: Loaded): Item {
  return {
    id: `error:${c.index}`,
    title: c.calendar ? `${c.name}: showing an older copy` : `${c.name} could not be loaded`,
    subtitle: c.error,
    icon: { source: Icons.alert, tint: c.calendar ? "orange" : "red" },
    section: "Problems",
    detail: { markdown: `**${c.name}**\n\n${c.error}` },
    actions: [copy(c.error ?? "", "Copy Error")],
  };
}

export default list({
  placeholder: "Filter events by title, place, people, calendar…",
  filter: {
    options: [
      { value: "7", title: "Next 7 Days" },
      { value: "1", title: "Today" },
      { value: "30", title: "Next 30 Days" },
    ],
  },
  empty: { title: "Nothing planned", description: "Enjoy the free time.", icon: Icons.calendar },
  status: () => footer,
  async *items({ preferences, signal, filter }) {
    const urls = parseUrls(preferences.urls);
    if (!urls.length) {
      footer = "No calendar yet: add its private iCal address in the extension's settings";
      yield setupItems();
      return;
    }
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    const hour12 = preferences.hour12 === true;
    const days = Number(filter ?? 7) || 7;
    let calendars = await loadAll(urls, signal, takeForce());
    let loadedAt = Date.now();
    while (!signal.aborted) {
      const now = Date.now();
      if (now - loadedAt > CACHE_MINUTES * 60_000) {
        calendars = await loadAll(urls, signal);
        loadedAt = now;
      }
      const midnight = new Date(now).setHours(0, 0, 0, 0);
      const to = new Date(midnight + days * DAY + DAY / 2).setHours(0, 0, 0, 0);
      const shown: Shown[] = calendars.flatMap((c) =>
        c.calendar ? expand(c.calendar.events, midnight, to, zone).map((o) => ({ ...o, calendar: c })) : []
      ).filter((o) => o.end > now || (o.start === o.end && o.start >= now))
        .sort((a, b) => a.start - b.start || Number(b.allDay) - Number(a.allDay));
      const several = calendars.length > 1;

      // In-progress events first in Today, then the rest by start.
      const items: Item[] = [];
      const live = shown.filter((o) => !o.allDay && isNow(o, now));
      const rest = shown.filter((o) => !live.includes(o));
      for (const o of [...live, ...rest]) {
        items.push(eventItem(o, { zone, now, section: sectionOf(Math.max(o.start, now), now, zone), several, hour12 }));
      }
      items.push(...calendars.filter((c) => c.error).map(problemItem));

      footer = statusFor(shown, now, zone, calendars.length);
      updateCommandMetadata({ subtitle: subtitleFor(shown, now, zone) }).catch(() => {});
      yield items;
      await nextMinute(signal);
    }
  },
});
