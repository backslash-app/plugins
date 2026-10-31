// Rows for bookings and event types.

import {
  type Action,
  action,
  clipboard,
  close,
  copy,
  Icons,
  type Item,
  meta,
  open,
  paste,
  refresh,
  toast,
} from "@backslash/api";
import { cancel, type each, singleUseLink } from "./api.ts";
import {
  type Account,
  attendeeSummary,
  type Booking,
  bookingMarkdown,
  bookingSummary,
  dayTitle,
  duration,
  type EventLink,
  joinable,
  minutesBetween,
  PROVIDER_NAMES,
  SetupError,
  setupItem,
  timeRange,
  untilLabel,
} from "./lib.ts";

/** Setup rows when nothing loaded because of the settings; a toast when only one service failed. */
export async function report<T>(r: Awaited<ReturnType<typeof each<T>>>): Promise<Item[] | undefined> {
  if (!r.errors.length) return undefined;
  if (!r.ok.length) {
    const setup = r.errors.find((e) => e.error instanceof SetupError);
    if (setup) return [setupItem(setup.error as SetupError)];
    throw r.errors[0].error;
  }
  await toast(`${r.errors.map((e) => PROVIDER_NAMES[e.account.provider]).join(", ")} didn't answer`, {
    style: "failure",
    message: r.errors.map((e) => e.error.message).join(" · "),
  });
  return undefined;
}

const reload = (): Action => action("Reload", () => refresh(), { icon: Icons.refresh, shortcut: "<Ctrl>r" });

// ---------------------------------------------------------------------------
// Bookings

export function bookingItem(a: Account, b: Booking, many: boolean, now = Date.now()): Item {
  const soon = joinable(b, now);
  const until = untilLabel(b.start, b.end, now);
  const who = attendeeSummary(b);
  const emails = b.attendees.map((x) => x.email).filter(Boolean);
  const reschedule = b.attendees.find((x) => x.rescheduleUrl)?.rescheduleUrl;
  const actions: Action[] = [
    ...(b.joinUrl ? [open(b.joinUrl, "Join Meeting", { icon: Icons.video })] : []),
    open(b.webUrl, `Open in ${PROVIDER_NAMES[b.provider]}`, { shortcut: "<Ctrl>o" }),
    ...(b.joinUrl ? [copy(b.joinUrl, "Copy Join Link", { shortcut: "<Ctrl><Shift>c", section: "Copy" })] : []),
    ...(emails.length
      ? [copy(emails.join(", "), emails.length > 1 ? "Copy Attendee Emails" : "Copy Attendee Email", {
        shortcut: "<Ctrl>e",
        section: "Copy",
      })]
      : []),
    copy(bookingSummary(b), "Copy Summary", { section: "Copy" }),
    ...(emails.length
      ? [open(`mailto:${emails.join(",")}?subject=${encodeURIComponent(b.title)}`, "Email Attendees", {
        icon: Icons.mail,
        section: "Booking",
      })]
      : []),
    ...(reschedule ? [open(reschedule, "Reschedule", { icon: Icons.calendar, section: "Booking" })] : []),
    action("Cancel Booking", async () => {
      await cancel(a, b, "Canceled by the host");
      await toast(`Canceled “${b.title}”`, {
        style: "success",
        message: who ? `${PROVIDER_NAMES[b.provider]} tells ${who}` : undefined,
      });
      return refresh();
    }, {
      icon: Icons.trash,
      destructive: true,
      confirm: `Cancel “${b.title}”${who ? ` with ${who}` : ""}? ${PROVIDER_NAMES[b.provider]} emails the attendees`,
      shortcut: "<Ctrl>Delete",
      section: "Danger",
    }),
    reload(),
  ];
  return {
    id: `${b.provider}:${b.id}`,
    title: who ? `${b.title} · ${who}` : b.title,
    subtitle: `${timeRange(b.start, b.end)}${b.location ? ` · ${b.location}` : ""}`,
    icon: {
      source: b.status === "pending" ? Icons.hourglass : b.joinUrl ? Icons.video : Icons.calendar,
      tint: b.status === "pending" ? "orange" : soon ? "green" : "blue",
    },
    section: dayTitle(b.start),
    keywords: [...b.attendees.flatMap((x) => [x.name, x.email]), b.location ?? "", PROVIDER_NAMES[b.provider]],
    accessories: [
      ...(many ? [{ tag: PROVIDER_NAMES[b.provider], color: "gray" as const }] : []),
      ...(b.status === "pending" ? [{ tag: "Unconfirmed", color: "orange" as const }] : []),
      ...(b.attendees.length > 1
        ? [{ icon: Icons.person, text: String(b.attendees.length), tooltip: "Attendees" }]
        : []),
      { text: until, color: until === "now" || soon ? "green" as const : undefined },
    ],
    detail: {
      markdown: bookingMarkdown(b),
      metadata: [
        meta.text("When", `${dayTitle(b.start)}, ${timeRange(b.start, b.end)}`, { icon: Icons.calendar }),
        meta.text("Length", duration(minutesBetween(b.start, b.end)), { icon: Icons.clock }),
        ...(b.location ? [meta.text("Where", b.location, { icon: Icons.globe })] : []),
        ...(b.joinUrl ? [meta.link("Join", new URL(b.joinUrl).host, b.joinUrl)] : []),
        ...b.attendees.slice(0, 6).map((x) => meta.person("Attendee", x.name)),
        ...(b.hosts.length ? [meta.text("Hosts", b.hosts.join(", "), { icon: Icons.person })] : []),
        meta.separator(),
        meta.text("Source", PROVIDER_NAMES[b.provider]),
      ],
    },
    actions,
  };
}

// ---------------------------------------------------------------------------
// Event types

export function linkItem(a: Account, l: EventLink, many: boolean): Item {
  const label = l.minutes ? `${l.title} (${duration(l.minutes)})` : l.title;
  return {
    id: `${l.provider}:${l.id}`,
    title: l.title,
    subtitle: l.url.replace(/^https?:\/\//, ""),
    icon: { source: l.hidden ? Icons.eyeOff : Icons.link, tint: l.hidden ? "gray" : "blue" },
    section: many ? PROVIDER_NAMES[l.provider] : l.hidden ? "Hidden" : "Event Types",
    keywords: [l.slug, l.kind ?? "", l.hidden ? "hidden secret" : ""],
    accessories: [
      ...(l.hidden ? [{ tag: "Hidden", color: "gray" as const }] : []),
      ...(l.kind ? [{ tag: l.kind, color: "purple" as const }] : []),
      ...(l.minutes ? [{ text: duration(l.minutes), icon: Icons.clock }] : []),
    ],
    detail: {
      markdown: [`## ${l.title}`, "", l.description ?? "", "", `<${l.url}>`].join("\n"),
      metadata: [
        meta.link("Link", l.url.replace(/^https?:\/\//, ""), l.url),
        ...(l.minutes ? [meta.text("Length", duration(l.minutes), { icon: Icons.clock })] : []),
        ...(l.kind ? [meta.text("Kind", l.kind)] : []),
        meta.text("Visibility", l.hidden ? "Hidden from your page" : "On your page", {
          icon: l.hidden ? Icons.eyeOff : Icons.eye,
        }),
        meta.text("Source", PROVIDER_NAMES[l.provider]),
      ],
    },
    actions: [
      copy(l.url, "Copy Link"),
      paste(l.url, "Paste Link"),
      copy(`[${label}](${l.url})`, "Copy as Markdown Link", { section: "Copy" }),
      copy(`Book a time with me: ${l.url}`, "Copy Invitation", { section: "Copy" }),
      ...(l.provider === "calendly" && l.uri
        ? [action("Copy Single-Use Link", async () => {
          await clipboard.write(await singleUseLink(a, l));
          return close("Single-use link copied: it works for one booking");
        }, { icon: Icons.ticket, shortcut: "<Ctrl>u", section: "Copy" })]
        : []),
      open(l.url, "Open Booking Page", { shortcut: "<Ctrl>o" }),
      reload(),
    ],
  };
}

export function pageItem(provider: Account["provider"], page: { url: string; name: string }, many: boolean): Item {
  return {
    id: `${provider}:page`,
    title: `${PROVIDER_NAMES[provider]} page`,
    subtitle: page.url.replace(/^https?:\/\//, ""),
    icon: { source: Icons.globe, tint: "green" },
    section: many ? PROVIDER_NAMES[provider] : "Your Page",
    keywords: [page.name, "profile", "all"],
    detail: {
      markdown: `## ${page.name}\n\nEvery public event type, on one page.\n\n<${page.url}>`,
      metadata: [meta.link("Link", page.url.replace(/^https?:\/\//, ""), page.url)],
    },
    actions: [
      copy(page.url, "Copy Link"),
      paste(page.url, "Paste Link"),
      open(page.url, "Open Page", { shortcut: "<Ctrl>o" }),
      reload(),
    ],
  };
}
