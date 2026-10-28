// What the command shows before a calendar is configured: how to get the
// private iCal address of each service.

import { copy, Icons, type Item, open } from "@backslash/api";

const WHERE =
  "Then paste it in **Settings → Extensions → Calendar → Calendar addresses** (several addresses: one per line). " +
  "It is kept in your system keyring.";

const PROVIDERS: { id: string; title: string; subtitle: string; markdown: string; links: [string, string][] }[] = [
  {
    id: "google",
    title: "Google Calendar",
    subtitle: "Settings → your calendar → Integrate calendar → Secret address in iCal format",
    markdown: `# Google Calendar

1. Open **Google Calendar settings** (the gear, then *Settings*).
2. Under **Settings for my calendars**, click the calendar to show.
3. In **Integrate calendar**, copy the **Secret address in iCal format**
   (it ends with \`/basic.ics\`).

${WHERE}

> The secret address gives read access to your events to whoever has it.
> If it leaks, use **Reset** next to it in Google Calendar.`,
    links: [
      ["Open Google Calendar Settings", "https://calendar.google.com/calendar/r/settings"],
      [
        "Google Help: Secret Address",
        "https://support.google.com/calendar/answer/37648#zippy=%2Cget-your-calendar-view-only",
      ],
    ],
  },
  {
    id: "outlook",
    title: "Outlook & Microsoft 365",
    subtitle: "Settings → Calendar → Shared calendars → Publish a calendar → ICS",
    markdown: `# Outlook and Microsoft 365

1. In Outlook on the web, open **Settings → Calendar → Shared calendars**.
2. Under **Publish a calendar**, pick the calendar and **Can view all details**, then **Publish**.
3. Copy the **ICS** link.

${WHERE}`,
    links: [
      ["Open Outlook Calendar Settings", "https://outlook.office.com/calendar/options/calendar/SharedCalendars"],
      ["Open Outlook.com Calendar Settings", "https://outlook.live.com/calendar/options/calendar/SharedCalendars"],
    ],
  },
  {
    id: "icloud",
    title: "iCloud Calendar",
    subtitle: "Share the calendar as a Public Calendar and copy its webcal:// link",
    markdown: `# iCloud Calendar

1. On icloud.com/calendar (or in Calendar on a Mac or iPhone), share the calendar.
2. Turn on **Public Calendar** and copy the link (\`webcal://p…-caldav.icloud.com/…\`).

${WHERE} \`webcal://\` links work as they are.`,
    links: [["Open iCloud Calendar", "https://www.icloud.com/calendar/"]],
  },
  {
    id: "fastmail",
    title: "Fastmail, Proton, Zoho, Yahoo",
    subtitle: "Their “share / export as iCal” link",
    markdown: `# Other services

- **Fastmail**: Settings → Calendars → the calendar → **Share** → *Share with others* → copy the **iCal (.ics)** link.
- **Proton Calendar**: Settings → Calendars → **Share via link** → *Full view*.
- **Zoho** and **Yahoo**: the calendar's **Export / iCal** address.

${WHERE}

Self-hosted servers (Nextcloud, Radicale…) can't be reached: the extension
may only connect to the services listed here.`,
    links: [["Fastmail Help", "https://www.fastmail.help/hc/en-us/articles/1500000278242"]],
  },
];

export function setupItems(): Item[] {
  return PROVIDERS.map((p) => ({
    id: `setup:${p.id}`,
    title: p.title,
    subtitle: p.subtitle,
    icon: { source: Icons.calendar, tint: "blue" },
    section: "Add a Calendar",
    detail: { markdown: p.markdown },
    actions: [
      ...p.links.map(([title, url]) => open(url, title)),
      copy("Settings → Extensions → Calendar → Calendar addresses", "Copy Where to Paste It", { section: "Copy" }),
    ],
  }));
}
