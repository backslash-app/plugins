// The inbox: the address, the messages with the codes and links found in them, and the message page.

import {
  type Action,
  action,
  clipboard,
  copy,
  detail,
  type DetailSpec,
  Icons,
  type Item,
  meta,
  open,
  pop,
  submenu,
  toast,
} from "@backslash/api";
import { createAccount, deleteAccount, deleteMessage, markSeen, message, pick } from "./api.ts";
import {
  type Account,
  findCodes,
  findLinks,
  type Message,
  messageMarkdown,
  messageText,
  senderName,
  shortDate,
  shortUrl,
  type Summary,
} from "./lib.ts";

// Changes made from the list wake the polling loop at once.
const changes = new EventTarget();
export const changed = () => changes.dispatchEvent(new Event("change"));

/** Waits `ms`, or less when the list changes or the user leaves. */
export function pause(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      changes.removeEventListener("change", done);
      signal.removeEventListener("abort", done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    changes.addEventListener("change", done);
    signal.addEventListener("abort", done);
  });
}

// Messages never change once received: read ones are kept for the codes and links of the list.
const cache = new Map<string, Message>();

/** The full messages of the newest summaries, a few at a time (mail.tm allows 8 requests a second). */
export async function loadFull(a: Account, list: Summary[], signal: AbortSignal, max = 12): Promise<void> {
  const missing = list.filter((m) => !cache.has(m.id)).slice(0, max);
  for (let i = 0; i < missing.length; i += 4) {
    await Promise.all(
      missing.slice(i, i + 4).map((m) => message(a, m.id, signal).then((full) => void cache.set(m.id, full), () => {})),
    );
  }
}

// ---------------------------------------------------------------------------
// Actions

function addressActions(a: Account, all: Account[]): Action[] {
  return [
    copy(a.address, "Copy Address", { icon: Icons.copy, shortcut: "<Ctrl><Shift>c", section: "Address" }),
    action("New Address", async () => {
      const created = await createAccount();
      await clipboard.write(created.address);
      await toast("New address copied", { style: "success", message: created.address });
      changed();
    }, { icon: Icons.plus, shortcut: "<Ctrl>n", section: "Address" }),
    ...(all.length > 1
      ? [submenu(
        "Switch Address",
        all.map((x) =>
          action(x.id === a.id ? `${x.address} (current)` : x.address, async () => {
            await pick(x.id);
            changed();
          }, { icon: x.id === a.id ? Icons.check : Icons.mail })
        ),
        { icon: Icons.inbox, section: "Address" },
      )]
      : []),
    action("Delete Address", async () => {
      await deleteAccount(a);
      await toast("Address deleted", { message: a.address });
      changed();
    }, {
      icon: Icons.trash,
      destructive: true,
      confirm: `Delete ${a.address} and its messages? It can't be used again.`,
      section: "Danger",
    }),
  ];
}

/** Copy the code, open the verification link, then every other link in a submenu. */
function findingsActions(m: Summary, full: Message | undefined): Action[] {
  const text = full ? messageText(full) : m.intro ?? "";
  const codes = findCodes(text, m.subject);
  const links = full ? findLinks(full) : [];
  const verify = links.filter((l) => l.verify);
  return [
    ...codes.slice(0, 3).map((c, i) =>
      copy(c.code, `Copy Code ${c.code}`, {
        icon: Icons.key,
        concealed: true,
        ...(i === 0 ? { shortcut: "<Ctrl>y" } : {}),
      })
    ),
    ...verify.slice(0, 2).map((l, i) =>
      open(l.url, l.label ? `Open “${l.label.slice(0, 40)}”` : `Open ${shortUrl(l.url)}`, {
        icon: Icons.external,
        ...(i === 0 ? { shortcut: "<Ctrl>o" } : {}),
      })
    ),
    ...(verify[0]
      ? [copy(verify[0].url, "Copy Verification Link", { icon: Icons.link, concealed: true, section: "Copy" })]
      : []),
    ...(links.length
      ? [submenu(
        `All Links (${links.length})`,
        links.slice(0, 40).map((l) =>
          open(l.url, l.label ? `${l.label.slice(0, 50)} · ${shortUrl(l.url)}` : shortUrl(l.url))
        ),
        { icon: Icons.link, section: "Copy" },
      )]
      : []),
  ];
}

function messageActions(a: Account, m: Summary, full: Message | undefined, after: "stay" | "pop"): Action[] {
  return [
    ...(full ? [copy(messageText(full), "Copy Text", { section: "Copy" })] : []),
    copy(m.from?.address ?? "", "Copy Sender Address", { section: "Copy" }),
    action("Delete Message", async () => {
      await deleteMessage(a, m.id);
      cache.delete(m.id);
      changed();
      return after === "pop" ? pop() : undefined;
    }, { icon: Icons.trash, destructive: true, shortcut: "<Ctrl>x", section: "Danger" }),
  ];
}

// ---------------------------------------------------------------------------
// Views

async function readView(a: Account, m: Summary): Promise<DetailSpec> {
  const full = cache.get(m.id) ?? await message(a, m.id);
  cache.set(m.id, full);
  if (!m.seen) {
    await markSeen(a, m.id).catch(() => {});
    changed();
  }
  const codes = findCodes(messageText(full), full.subject);
  const links = findLinks(full);
  return detail({
    title: full.subject || "(no subject)",
    markdown: messageMarkdown(full),
    metadata: [
      meta.person("From", senderName(full.from)),
      meta.text("Address", full.from?.address ?? "", { icon: Icons.mail }),
      meta.text("To", a.address, { icon: Icons.inbox }),
      meta.text("Received", new Date(full.createdAt).toLocaleString("en-GB"), { icon: Icons.clock }),
      ...(codes.length
        ? [meta.tags("Codes", codes.slice(0, 3).map((c) => ({ text: c.code, color: "green" as const })))]
        : []),
      ...links.filter((l) => l.verify).slice(0, 3).map((l) => meta.link("Link", l.label ?? shortUrl(l.url), l.url)),
      ...(full.attachments?.length ? [meta.tags("Attachments", full.attachments.map((x) => x.filename))] : []),
    ],
    actions: [...findingsActions(m, full), ...messageActions(a, m, full, "pop")],
  });
}

export function addressItem(a: Account, all: Account[], count: number): Item {
  return {
    id: "address",
    title: a.address,
    subtitle: count ? `${count} message${count === 1 ? "" : "s"}` : "Waiting for mail…",
    icon: { source: Icons.mail, tint: "blue" },
    section: "Address",
    accessories: [{ text: `created ${shortDate(new Date(a.created).toISOString())}` }, {
      icon: { source: Icons.dot, tint: "green" },
      tooltip: "Live",
    }],
    detail: {
      markdown: [
        "## Your disposable address",
        "",
        `\`${a.address}\``,
        "",
        "Use it to sign up somewhere: messages show up here within seconds, with their",
        "verification code or link ready to copy or open.",
        "",
        "Addresses come from **mail.tm**. Anyone who guesses the address can't read it, but",
        "don't use it for anything you want to keep.",
      ].join("\n"),
    },
    actions: addressActions(a, all),
  };
}

export function messageItem(a: Account, all: Account[], m: Summary): Item {
  const full = cache.get(m.id);
  const text = full ? messageText(full) : m.intro ?? "";
  const code = findCodes(text, m.subject)[0];
  const link = full ? findLinks(full).find((l) => l.verify) : undefined;
  return {
    id: m.id,
    title: m.subject || "(no subject)",
    subtitle: senderName(m.from),
    icon: { source: m.seen ? Icons.mail : Icons.inbox, tint: m.seen ? "gray" : "blue" },
    section: "Messages",
    keywords: [m.from?.address ?? "", m.intro ?? "", ...(code ? [code.code] : [])],
    accessories: [
      ...(code ? [{ tag: code.code, color: "green" as const, tooltip: "Verification code" }] : []),
      ...(link ? [{ icon: { source: Icons.link, tint: "blue" as const }, tooltip: "Verification link" }] : []),
      ...(m.hasAttachments ? [{ icon: Icons.file, tooltip: "Attachments" }] : []),
      { text: shortDate(m.createdAt) },
    ],
    detail: {
      markdown: full ? messageMarkdown(full).slice(0, 6000) : `**${m.subject}**\n\n${m.intro ?? ""}`,
    },
    actions: [
      ...findingsActions(m, full),
      action("Read Message", () => readView(a, m), { icon: Icons.eye, shortcut: "<Ctrl>r" }),
      ...messageActions(a, m, full, "stay"),
      ...addressActions(a, all),
    ],
  };
}

export function createItem(gone?: Account): Item {
  return {
    id: "create",
    title: gone ? `${gone.address} is gone` : "Create a disposable address",
    subtitle: gone ? "mail.tm deleted it: create a new one" : "A random address on a mail.tm domain",
    icon: { source: gone ? Icons.alert : Icons.plus, tint: gone ? "orange" : "blue" },
    detail: {
      markdown: [
        "## A throwaway inbox",
        "",
        "Creates a random address on a public **mail.tm** domain and copies it.",
        "Sign up with it, and the confirmation mail shows up here with its code or link.",
      ].join("\n"),
    },
    actions: [action("Create Address", async () => {
      const a = await createAccount();
      await clipboard.write(a.address);
      await toast("Address copied", { style: "success", message: a.address });
      changed();
    }, { icon: Icons.plus })],
  };
}
