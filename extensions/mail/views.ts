// Unread messages, account problems and setup as launcher items.

import {
  type Accessory,
  type Action,
  action,
  type Color,
  copy,
  Icons,
  type Item,
  meta,
  type Metadata,
  open,
  refresh,
  toast,
} from "@backslash/api";
import { ImapError, session } from "./imap.ts";
import {
  type Account,
  type AccountProblem,
  fullDate,
  type Message,
  PRESETS,
  replyUrl,
  senderName,
  shortDate,
  size,
  webmailUrl,
} from "./lib.ts";

export const ACCOUNT_COLORS: Color[] = ["blue", "purple", "teal"];
export const accountColor = (index: number) => ACCOUNT_COLORS[(index - 1) % ACCOUNT_COLORS.length];

/** Runs an IMAP change and reloads the list, or shows why it failed. */
function change(a: Account, title: string, done: string, fn: Parameters<typeof session>[1], o: Partial<Action> = {}) {
  return action(title, async () => {
    try {
      await session(a, fn);
    } catch (e) {
      await toast(`${title} failed`, { style: "failure", message: e instanceof Error ? e.message : String(e) });
      return;
    }
    await toast(done, { style: "success" });
    return refresh();
  }, o);
}

export function messageActions(m: Message, a: Account, unreadUids: number[]): Action[] {
  const web = webmailUrl(a, m.messageId);
  const markRead = change(a, "Mark as Read", "Marked as read", (c) => c.markRead([m.uid]), {
    icon: Icons.check,
    shortcut: "<Ctrl>Return",
  });
  const actions: Action[] = [];
  if (web) {
    actions.push(open(web, `Open in ${a.preset.id === "custom" ? "Webmail" : a.preset.name}`, { shortcut: "<Ctrl>o" }));
  }
  actions.push(
    markRead,
    change(a, "Archive", "Archived", (c) => c.moveTo([m.uid], "archive"), {
      icon: Icons.archive,
      shortcut: "<Ctrl>e",
    }),
    open(replyUrl(m), "Reply in Mail App", { icon: Icons.comment, shortcut: "<Ctrl><Shift>r" }),
  );
  if (unreadUids.length > 1) {
    actions.push(
      change(
        a,
        `Mark All ${unreadUids.length} as Read`,
        `${a.email}: all read`,
        (c) => c.markRead(unreadUids),
        { icon: Icons.squareCheck, section: "Inbox", shortcut: "<Ctrl><Shift>Return" },
      ),
    );
  }
  actions.push(
    copy(m.subject, "Copy Subject", { section: "Copy", shortcut: "<Ctrl><Shift>c" }),
    copy(m.from.email, "Copy Sender Address", { section: "Copy" }),
    ...(m.messageId ? [copy(m.messageId, "Copy Message-ID", { section: "Copy" })] : []),
    change(a, "Delete", "Moved to the trash", (c) => c.moveTo([m.uid], "trash"), {
      icon: Icons.trash,
      section: "Danger",
      destructive: true,
      confirm: "Delete this message?",
      shortcut: "<Ctrl>Delete",
    }),
  );
  return actions;
}

export function messageItem(
  m: Message,
  a: Account,
  o: { unreadUids: number[]; section: string; now?: number },
): Item {
  const name = senderName(m.from);
  const accessories: Accessory[] = [];
  if (m.flags.some((f) => f.toLowerCase() === "\\flagged")) {
    accessories.push({ icon: { source: Icons.flag, tint: "orange" }, tooltip: "Flagged" });
  }
  if (m.attachments) accessories.push({ icon: Icons.file, tooltip: "Has attachments" });
  if (m.date) accessories.push({ text: shortDate(m.date, o.now), tooltip: fullDate(m.date) });
  accessories.push({ avatar: name, tooltip: m.from.email });
  const metadata: Metadata[] = [
    meta.person("From", name),
    meta.text("Address", m.from.email, { icon: Icons.mail }),
  ];
  if (m.to.length) {
    const to = m.to.slice(0, 3).map((t) => t.name || t.email).join(", ");
    metadata.push(meta.text("To", m.to.length > 3 ? `${to} +${m.to.length - 3}` : to, { icon: Icons.person }));
  }
  if (m.date) metadata.push(meta.text("Date", fullDate(m.date), { icon: Icons.calendar }));
  metadata.push(
    meta.separator(),
    meta.text("Account", a.email, { icon: { source: Icons.inbox, tint: accountColor(a.index) } }),
  );
  const s = size(m.size);
  if (s) metadata.push(meta.text("Size", s));
  const tags = [
    ...(m.attachments ? [{ text: "Attachments", color: "gray" as Color }] : []),
    ...(m.flags.some((f) => f.toLowerCase() === "\\flagged") ? [{ text: "Flagged", color: "orange" as Color }] : []),
  ];
  if (tags.length) metadata.push(meta.tags("Labels", tags));
  return {
    id: `${a.index}:${m.uid}`,
    title: m.subject,
    subtitle: m.preview ? `${name} · ${m.preview}` : name,
    icon: { source: Icons.mail, tint: accountColor(a.index) },
    section: o.section,
    keywords: [m.from.email, name, a.email],
    accessories,
    detail: {
      markdown: [`### ${m.subject.replace(/[#*_`[\]]/g, "\\$&")}`, "", m.preview || "*No text preview*"].join("\n"),
      metadata,
    },
    actions: messageActions(m, a, o.unreadUids),
  };
}

/** A clean inbox, per account. */
export function inboxZeroItem(a: Account, section: string): Item {
  const web = webmailUrl(a);
  return {
    id: `${a.index}:zero`,
    title: "No unread mail",
    subtitle: a.email,
    section,
    icon: { source: Icons.done, tint: "green" },
    detail: { markdown: `**Inbox zero** on ${a.email}.`, metadata: [meta.text("Server", `${a.host}:${a.port}`)] },
    actions: [
      ...(web ? [open(web, `Open ${a.preset.id === "custom" ? "Webmail" : a.preset.name}`)] : []),
      action("Refresh", () => refresh(), { icon: Icons.refresh, shortcut: "<Ctrl>r" }),
    ],
  };
}

const SETTINGS = "**Settings → Extensions → Mail → Configure**";

function passwordActions(preset: AccountProblem["preset"]): Action[] {
  return preset.passwordUrl ? [open(preset.passwordUrl, "Create App Password", { icon: Icons.key })] : [];
}

/** An account that failed to load: sign-in, network, or certificate. */
export function accountErrorItem(a: Account, error: unknown, section: string): Item {
  const message = error instanceof Error ? error.message : String(error);
  const auth = error instanceof ImapError && error.kind === "auth";
  const lines = auth
    ? [
      `## ${a.preset.name} refused the sign-in`,
      "",
      `> ${message}`,
      "",
      `The password must be: ${a.preset.passwordHelp.charAt(0).toLowerCase()}${a.preset.passwordHelp.slice(1)}.`,
      "",
      `Paste it in ${SETTINGS} (Password ${a.index}).`,
      ...(a.preset.id === "gmail" ? ["", "IMAP must also be on: Gmail → Settings → Forwarding and POP/IMAP."] : []),
    ]
    : [
      `## Can't load ${a.email}`,
      "",
      `> ${message}`,
      "",
      `Server: \`${a.host}:${a.port}\` (${a.security === "tls" ? "TLS" : "STARTTLS"})`,
    ];
  return {
    id: `${a.index}:error`,
    title: auth ? `Can't sign in to ${a.email}` : `Can't reach ${a.email}`,
    subtitle: message,
    section,
    icon: { source: auth ? Icons.key : Icons.alert, tint: auth ? "orange" : "red" },
    detail: { markdown: lines.join("\n") },
    actions: [
      ...(auth ? passwordActions(a.preset) : []),
      action("Try Again", () => refresh(), { icon: Icons.refresh, shortcut: "<Ctrl>r" }),
      ...(a.preset.id === "proton"
        ? [open("https://proton.me/support/protonmail-bridge-install", "Proton Mail Bridge Help")]
        : []),
    ],
  };
}

export function problemItem(p: AccountProblem): Item {
  const unsupported = !!p.preset.unsupported;
  return {
    id: `${p.index}:problem`,
    title: unsupported ? `${p.email}: ${p.preset.name} isn't supported` : p.message,
    subtitle: unsupported ? "Microsoft turned off IMAP passwords" : `Account ${p.index}`,
    section: "Setup",
    icon: { source: unsupported ? Icons.cross : Icons.settings, tint: "orange" },
    detail: {
      markdown: unsupported
        ? [
          "## Outlook and Microsoft 365",
          "",
          `${p.preset.unsupported}.`,
          "",
          `Remove this account from ${SETTINGS}.`,
        ].join("\n")
        : [`## ${p.message}`, "", `In ${SETTINGS}, account ${p.index}.`].join("\n"),
    },
    actions: unsupported
      ? [
        open(
          "https://learn.microsoft.com/exchange/clients-and-mobile-in-exchange-online/deprecation-of-basic-authentication-exchange-online",
          "Why (Microsoft)",
        ),
      ]
      : passwordActions(p.preset),
  };
}

export function setupItems(): Item[] {
  const presets = ["gmail", "fastmail", "icloud", "yahoo", "proton", "custom"].map((id) => PRESETS[id]);
  return [{
    id: "setup",
    title: "Add a mail account",
    subtitle: "Gmail, Fastmail, iCloud, Yahoo, Proton Mail Bridge or any IMAP server",
    icon: { source: Icons.mail, tint: "blue" },
    section: "Setup",
    detail: {
      markdown: [
        "## Connect your mail",
        "",
        `In ${SETTINGS}, fill account 1 (up to 3):`,
        "",
        "- **Provider**: `gmail`, `fastmail`, `icloud`, `yahoo`, `proton` or `custom`",
        "- **Address**: you@example.com",
        "- **Password**: an *app password* for most providers",
        "- **Server**: only for `custom`, e.g. `imap.example.com` or `mail.example.com:143`",
        "",
        "### App passwords",
        "",
        ...presets.filter((p) => p.passwordUrl).map((p) => `- **${p.name}**: ${p.passwordHelp}`),
        "",
        "Outlook.com and Microsoft 365 don't accept IMAP passwords any more: use the Microsoft 365 extension.",
      ].join("\n"),
    },
    actions: presets.filter((p) => p.passwordUrl).map((p, i) =>
      open(p.passwordUrl!, `${p.name} App Passwords`, { icon: Icons.key, section: i ? "App Passwords" : undefined })
    ),
  }];
}

export const sectionTitle = (a: Account, total: number) => `${a.email} · ${total ? `${total} unread` : "no unread"}`;
