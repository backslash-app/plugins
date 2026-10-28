import { type Context, copy, Icons, type Item, list, open, updateCommandMetadata } from "@backslash/api";
import { all, type Client, guarded, signOutAction } from "../api.ts";
import {
  calendarSubtitle,
  type CalEvent,
  dayRange,
  EVENT_FIELDS,
  eventMarkdown,
  eventMetadata,
  eventRelative,
  eventSection,
  eventTime,
  graphTime,
  joinLink,
  plural,
  RESPONSES,
} from "../lib.ts";

let summary = "";

const OUTLOOK_CALENDAR = "https://outlook.office.com/calendar/view/day";

async function events(api: Client, offset: number, days: number, signal: AbortSignal): Promise<CalEvent[]> {
  const { start, end } = dayRange(new Date(), offset, days);
  const q = new URLSearchParams({
    startDateTime: start,
    endDateTime: end,
    $orderby: "start/dateTime",
    $top: "100",
    $select: EVENT_FIELDS,
  });
  // Without a Prefer: outlook.timezone header, Graph gives the times in UTC.
  return await all<CalEvent>(api, `/me/calendarView?${q}`, signal, 300);
}

function eventItem(e: CalEvent, now: Date, section: string): Item {
  const join = joinLink(e);
  const declined = e.responseStatus?.response === "declined";
  const live = eventSection(e, now) === "Now";
  const response = RESPONSES[e.responseStatus?.response ?? ""];
  const place = e.location?.displayName?.trim();
  return {
    id: e.id,
    title: e.subject || "(no title)",
    subtitle: eventTime(e),
    icon: {
      source: join ? Icons.video : Icons.calendar,
      tint: e.isCancelled || declined ? "gray" : live ? "green" : e.showAs === "tentative" ? "yellow" : "blue",
    },
    section,
    keywords: [place ?? "", e.organizer?.emailAddress?.name ?? "", join?.service ?? ""].filter(Boolean),
    accessories: [
      ...(e.isCancelled ? [{ tag: "Canceled", color: "red" as const }] : []),
      ...(response && response.text !== "Accepted" && response.text !== "Organizer"
        ? [{ tag: response.text, color: response.color }]
        : []),
      ...(place && !/^https?:\/\//.test(place) && !/teams meeting/i.test(place)
        ? [{ icon: Icons.pin, text: place.length > 24 ? `${place.slice(0, 23)}…` : place }]
        : []),
      ...(join ? [{ icon: Icons.video, tooltip: join.service }] : []),
      { text: eventRelative(e, now), color: live ? "green" as const : undefined },
    ],
    detail: { markdown: eventMarkdown(e), metadata: eventMetadata(e) },
    actions: [
      ...(join ? [open(join.url, `Join ${join.service}`, { icon: Icons.video })] : []),
      open(e.webLink || OUTLOOK_CALENDAR, "Open in Outlook"),
      ...(join ? [copy(join.url, "Copy Meeting Link", { shortcut: "<Ctrl><Shift>c", section: "Copy" })] : []),
      copy(
        `${e.subject || "(no title)"} · ${eventTime(e)}${join ? `\n${join.url}` : ""}`,
        "Copy Details",
        { shortcut: "<Ctrl>period", section: "Copy" },
      ),
    ],
  };
}

const DAYS: Record<string, { offset: number; days: number; title: string }> = {
  today: { offset: 0, days: 1, title: "today" },
  tomorrow: { offset: 1, days: 1, title: "tomorrow" },
  week: { offset: 0, days: 7, title: "this week" },
};

export default (ctx: Context) =>
  list({
    placeholder: "Filter events by title, place or organizer…",
    filter: {
      options: [
        { value: "today", title: "Today" },
        { value: "tomorrow", title: "Tomorrow" },
        { value: "week", title: "Next 7 Days" },
      ],
    },
    empty: { title: "Nothing on the calendar", description: "Enjoy the free time.", icon: Icons.calendar },
    status: (items) => items[0]?.id === "setup" ? "Not connected" : summary,
    actions: [
      open(OUTLOOK_CALENDAR, "Open Outlook Calendar", { icon: Icons.calendar }),
      signOutAction(ctx.preferences, () => {}),
    ],
    items: ({ signal, filter }) =>
      guarded(ctx.preferences, async (api) => {
        const view = DAYS[filter ?? "today"] ?? DAYS.today;
        const now = new Date();
        const found = await events(api, view.offset, view.days, signal);
        const meetings = found.filter((e) => !e.isCancelled);
        if (view === DAYS.today) {
          updateCommandMetadata({ subtitle: calendarSubtitle(found, now) }).catch(() => {});
        }
        const next = meetings.find((e) => eventSection(e, now) === "Upcoming" && !e.isAllDay);
        summary = [
          `${plural(meetings.length, "event")} ${view.title}`,
          next && view.offset === 0 ? `next ${eventRelative(next, now)}` : "",
        ].filter(Boolean).join(" · ");
        if (view.days === 1) {
          const order = ["Now", "Upcoming", "All Day", "Earlier"];
          return found
            .map((e) => ({ e, s: view.offset === 0 ? eventSection(e, now) : e.isAllDay ? "All Day" : "Events" }))
            .sort((a, b) =>
              order.indexOf(a.s) - order.indexOf(b.s) || graphTime(a.e.start).getTime() - graphTime(b.e.start).getTime()
            )
            .map(({ e, s }) => eventItem(e, now, s));
        }
        return found.map((e) => {
          const day = e.isAllDay ? new Date(e.start.dateTime.slice(0, 10) + "T00:00:00") : graphTime(e.start);
          const title = day.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
          return eventItem(e, now, title);
        });
      }),
  });
