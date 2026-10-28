import {
  type Action,
  action,
  copy,
  type Icon,
  Icons,
  type Item,
  list,
  meta,
  type Metadata,
  open,
  refresh,
  submenu,
  toast,
} from "@backslash/api";
import { type Cache, cached, load, SetupError } from "../api.ts";
import {
  type Contact,
  contactMarkdown,
  emailWithName,
  formatAddress,
  formatBirthday,
  inDays,
  nextBirthday,
  telUri,
  typeLabel,
  upcomingBirthdays,
} from "../lib.ts";

/** Kept six hours; Ctrl+R downloads them again. */
const MAX_AGE = 6 * 3600_000;
let status = "";

function setupItems(e: SetupError): Item[] {
  return [{
    id: "setup",
    title: e.message,
    subtitle: "Settings → Extensions → Contacts",
    icon: { source: Icons.key, tint: "orange" },
    detail: {
      markdown: [
        "## Connect your contacts",
        "",
        "**A CardDAV account**: the server address, your user name and an **app password**",
        "(with two-factor authentication, the normal password is refused):",
        "",
        "| Provider | Server | Password |",
        "|---|---|---|",
        "| iCloud | `https://contacts.icloud.com` | appleid.apple.com → Sign-In and Security → App-Specific Passwords |",
        "| Fastmail | `https://carddav.fastmail.com` | Settings → Privacy & Security → App passwords |",
        "| Google | `https://www.googleapis.com/carddav/v1/principals/you@gmail.com/lists/default/` | an app password, if your account accepts one for CardDAV |",
        "| mailbox.org | `https://dav.mailbox.org` | your password, or an app password |",
        "| Posteo | `https://posteo.de:8843` | your password |",
        "| Nextcloud | `https://cloud.home.lan/remote.php/dav` | Settings → Security → Devices & sessions |",
        "",
        "Self-hosted servers (Nextcloud, Radicale, Baïkal) can be on this computer, your local network",
        "(`*.lan`, `*.local`, `192.168.x.x`…) or Tailscale (`*.ts.net`): an extension declares in advance",
        "the hosts it may reach.",
        "",
        "**Or a folder of vCard files** (`.vcf`, one or many contacts each, subfolders included as vdirsyncer",
        "makes them): `~/Contacts`, `~/.contacts`, `~/.local/share/contacts` or `~/.local/share/vdirsyncer`.",
      ].join("\n"),
    },
    actions: [
      open("https://support.apple.com/en-us/102654", "iCloud App-Specific Passwords", { icon: Icons.key }),
      open("https://www.fastmail.help/hc/en-us/articles/360058752854", "Fastmail App Passwords", { icon: Icons.key }),
    ],
  }];
}

const reload = () =>
  action("Refresh Contacts", async ({ preferences }) => {
    await toast("Downloading contacts…");
    const c = await load(preferences);
    await toast(`${c.contacts.length} contacts`, { style: "success" });
    return refresh();
  }, { icon: Icons.refresh, shortcut: "<Ctrl>r", section: "Contacts" });

function contactActions(c: Contact): Action[] {
  const email = c.emails[0]?.value;
  const phone = c.phones[0]?.value;
  const write = email
    ? [open(`mailto:${encodeURIComponent(emailWithName(c))}`, "Write Email", { icon: Icons.mail })]
    : [];
  const call = phone ? [open(telUri(phone), "Call", { icon: Icons.bell, shortcut: "<Ctrl>t" })] : [];
  const copyEmail = email ? [copy(email, "Copy Email", { shortcut: "<Ctrl><Shift>e", section: "Copy" })] : [];
  const copyPhone = phone ? [copy(phone, "Copy Phone Number", { shortcut: "<Ctrl><Shift>p", section: "Copy" })] : [];
  const main: Action[] = email ? [...write, ...copyEmail, ...call, ...copyPhone] : [...call, ...copyPhone];
  return [
    ...main,
    ...(c.emails.length > 1 || c.phones.length > 1
      ? [submenu("Copy Another", [
        ...c.emails.slice(1).map((e) =>
          copy(e.value, `${e.value}${typeLabel(e.types) ? ` (${typeLabel(e.types)})` : ""}`, { icon: Icons.mail })
        ),
        ...c.phones.slice(1).map((p) =>
          copy(p.value, `${p.value}${typeLabel(p.types) ? ` (${typeLabel(p.types)})` : ""}`, { icon: Icons.hash })
        ),
      ], { icon: Icons.copy, section: "Copy" })]
      : []),
    ...(email ? [copy(emailWithName(c), "Copy Name and Email", { section: "Copy" })] : []),
    copy(c.name, "Copy Name", { shortcut: "<Ctrl>period", section: "Copy" }),
    ...c.addresses.slice(0, 1).flatMap((a) => [
      copy(formatAddress(a), "Copy Address", { section: "Copy" }),
      open(
        `https://www.openstreetmap.org/search?query=${encodeURIComponent(formatAddress(a).replace(/\n/g, ", "))}`,
        "Show Address on a Map",
        { icon: Icons.globe, section: "Open" },
      ),
    ]),
    copy(c.vcard, "Copy vCard", { icon: Icons.file, shortcut: "<Ctrl><Shift>v", section: "Copy" }),
    ...c.urls.slice(0, 2).map((u) =>
      open(/^https?:/i.test(u) ? u : `https://${u}`, `Open ${u.replace(/^https?:\/\//, "")}`, { section: "Open" })
    ),
    ...c.phones.slice(1, 3).map((p) => open(telUri(p.value), `Call ${p.value}`, { icon: Icons.bell, section: "Open" })),
    reload(),
  ];
}

function contactMetadata(c: Contact, cache: Cache): Metadata[] {
  const b = c.birthday ? nextBirthday(c.birthday) : undefined;
  return [
    ...(c.org ? [meta.text("Organization", c.org, { icon: Icons.home })] : []),
    ...(c.title ? [meta.text("Title", c.title, { icon: Icons.person })] : []),
    ...(c.nickname ? [meta.text("Nickname", c.nickname)] : []),
    ...c.emails.map((e) =>
      meta.link(typeLabel(e.types) ? `Email · ${typeLabel(e.types)}` : "Email", e.value, `mailto:${e.value}`)
    ),
    ...c.phones.map((p) =>
      meta.link(typeLabel(p.types) ? `Phone · ${typeLabel(p.types)}` : "Phone", p.value, telUri(p.value))
    ),
    ...(c.birthday && b
      ? [meta.text("Birthday", `${formatBirthday(c.birthday)} · ${inDays(b.days)}${b.age ? ` (${b.age})` : ""}`, {
        icon: Icons.calendar,
        color: b.days <= 7 ? "pink" : undefined,
      })]
      : []),
    meta.separator(),
    meta.text("Source", c.source || "Contacts", { icon: cache.books.length ? Icons.cloud : Icons.folder }),
  ];
}

function iconOf(c: Contact, cache: Cache): Icon {
  return cache.photos[c.id] ?? c.photoUrl ?? { source: Icons.person, tint: c.org ? "blue" : "gray" };
}

function contactItem(c: Contact, cache: Cache): Item {
  return {
    id: c.id,
    title: c.name,
    subtitle: [c.title, c.org].filter(Boolean).join(", ") || undefined,
    icon: iconOf(c, cache),
    section: "Contacts",
    keywords: [
      ...c.emails.map((e) => e.value),
      ...c.phones.map((p) => p.value.replace(/\s/g, "")),
      c.nickname,
      c.given,
      c.family,
      ...c.addresses.map((a) => a.locality),
    ].filter(Boolean),
    accessories: [
      ...(c.emails[0] ? [{ text: c.emails[0].value }] : c.phones[0] ? [{ text: c.phones[0].value }] : []),
      ...(cache.books.length > 1 ? [{ tag: c.source }] : []),
    ],
    detail: {
      ...(cache.photos[c.id] || c.photoUrl ? { image: cache.photos[c.id] ?? c.photoUrl } : {}),
      markdown: contactMarkdown(c),
      metadata: contactMetadata(c, cache),
    },
    actions: contactActions(c),
  };
}

function birthdayItems(cache: Cache): Item[] {
  return upcomingBirthdays(cache.contacts).map(({ contact: c, days, age, date }) => ({
    id: `birthday:${c.id}`,
    title: c.name,
    subtitle: age ? `turns ${age}` : "birthday",
    icon: { source: Icons.calendar, tint: days <= 1 ? "pink" : days <= 7 ? "purple" : "gray" },
    section: "Upcoming Birthdays",
    keywords: ["birthday", "anniversaire", ...c.emails.map((e) => e.value)],
    accessories: [
      { text: date.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }) },
      { tag: inDays(days), color: days <= 1 ? "pink" as const : undefined },
    ],
    detail: { markdown: contactMarkdown(c), metadata: contactMetadata(c, cache) },
    actions: contactActions(c),
  }));
}

function render(cache: Cache): Item[] {
  const age = Math.round((Date.now() - cache.at) / 60_000);
  status = [
    `${cache.contacts.length} contacts`,
    ...(cache.books.length ? [cache.books.join(", ")] : []),
    age < 1 ? "just updated" : age < 60 ? `updated ${age} min ago` : `updated ${Math.round(age / 60)} h ago`,
    ...cache.errors,
  ].join(" · ");
  return [...birthdayItems(cache), ...cache.contacts.map((c) => contactItem(c, cache))];
}

export default list({
  placeholder: "Search contacts by name, email, phone, company…",
  empty: {
    title: "No contacts",
    description: "Your address book is empty, or Ctrl+R downloads it again",
    icon: Icons.person,
  },
  status: (items) => items[0]?.id === "setup" ? "Not connected" : status,
  actions: [reload()],
  async *items({ preferences, signal }) {
    const saved = await cached(preferences);
    if (saved) yield render(saved);
    if (saved && Date.now() - saved.at < MAX_AGE) return;
    try {
      yield render(await load(preferences, signal));
    } catch (e) {
      if (e instanceof SetupError) {
        yield setupItems(e);
        return;
      }
      // Offline: the saved contacts are still useful.
      if (saved && (e as Error).name !== "AbortError") {
        await toast("Couldn't update the contacts", { style: "failure", message: (e as Error).message });
        return;
      }
      throw e;
    }
  },
});
