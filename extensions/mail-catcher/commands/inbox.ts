import {
  type Action,
  action,
  close,
  copy,
  detail,
  type DetailSpec,
  Icons,
  type Item,
  list,
  meta,
  open,
  openExternal,
  pop,
  submenu,
  toast,
  updateCommandMetadata,
} from "@backslash/api";
import {
  type Config,
  config,
  deleteAll,
  deleteMessage,
  htmlUrl,
  inbox,
  markRead,
  partUrl,
  peekMessage,
  readMessage,
  SetupError,
  setupItem,
  webUrl,
} from "../api.ts";
import {
  addressLine,
  bytes,
  findCodes,
  findLinks,
  type Kind,
  type Message,
  messageMarkdown,
  messageText,
  senderName,
  shortDate,
  shortUrl,
  type Summary,
} from "../lib.ts";

const POLL = 3000;
const HTML_DIR = "/tmp/backslash-mail-catcher";

// Changes made from the list wake the polling loop at once.
const changes = new EventTarget();
const changed = () => changes.dispatchEvent(new Event("change"));

function pause(ms: number, signal: AbortSignal): Promise<void> {
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

// Messages never change once caught: kept for the codes and links of the list.
const cache = new Map<string, Message>();

async function preload(c: Config, kind: Kind, list: Summary[], signal: AbortSignal, max = 15) {
  if (kind !== "mailpit") return;
  const missing = list.filter((m) => !cache.has(m.id)).slice(0, max);
  for (let i = 0; i < missing.length; i += 5) {
    await Promise.all(
      missing.slice(i, i + 5).map((m) =>
        peekMessage(c, m, signal).then((full) => void cache.set(m.id, full), () => {})
      ),
    );
  }
}

/** A message's HTML in the browser: Mailpit serves it; MailHog's is written to a file first. */
async function htmlTarget(c: Config, kind: Kind, m: Message): Promise<string> {
  if (kind === "mailpit") return htmlUrl(c, m.id);
  await Deno.mkdir(HTML_DIR, { recursive: true });
  const path = `${HTML_DIR}/${m.id.replace(/[^\w.-]/g, "_")}.html`;
  await Deno.writeTextFile(path, m.html ?? "");
  return path;
}

// ---------------------------------------------------------------------------
// Actions

/** Copy the code, open the verification link, then every other link in a submenu. */
function findingsActions(m: Summary, full: Message | undefined): Action[] {
  const text = full ? messageText(full) : m.snippet ?? "";
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
    ...(verify[0] ? [copy(verify[0].url, "Copy Verification Link", { icon: Icons.link, section: "Copy" })] : []),
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

function messageActions(c: Config, kind: Kind, m: Summary, full: Message | undefined, after: "stay" | "pop"): Action[] {
  // Only a message read through Mailpit's API knows its parts.
  const downloads = kind === "mailpit" ? (full?.files ?? []).filter((f) => f.partId) : [];
  return [
    ...(kind === "mailpit" && (full ? !!full.html : true)
      ? [open(htmlUrl(c, m.id), "Open HTML in Browser", { icon: Icons.globe, shortcut: "<Ctrl>b" })]
      : full?.html
      ? [action("Open HTML in Browser", async () => {
        await openExternal(await htmlTarget(c, kind, full));
        return close();
      }, { icon: Icons.globe, shortcut: "<Ctrl>b" })]
      : []),
    open(webUrl(c, kind, m.id), kind === "mailpit" ? "Open in Mailpit" : "Open MailHog", { section: "Message" }),
    ...(downloads.length
      ? [submenu(
        `Attachments (${downloads.length})`,
        downloads.map((f) => open(partUrl(c, m.id, f.partId!), `${f.name} · ${bytes(f.size)}`, { icon: Icons.file })),
        { icon: Icons.file, section: "Message" },
      )]
      : []),
    ...(full ? [copy(messageText(full), "Copy Text", { section: "Copy" })] : []),
    ...(full?.html ? [copy(full.html, "Copy HTML Source", { icon: Icons.code, section: "Copy" })] : []),
    ...(m.from ? [copy(m.from.address, "Copy Sender Address", { section: "Copy" })] : []),
    ...(m.to[0] ? [copy(m.to[0].address, "Copy Recipient Address", { section: "Copy" })] : []),
    action("Delete Message", async () => {
      await deleteMessage(c, kind, m.id);
      cache.delete(m.id);
      changed();
      return after === "pop" ? pop() : undefined;
    }, { icon: Icons.trash, destructive: true, shortcut: "<Ctrl>x", section: "Danger" }),
  ];
}

function inboxActions(c: Config, kind: Kind, unread: number, total: number): Action[] {
  return [
    ...(kind === "mailpit" && unread
      ? [action("Mark All Read", async () => {
        await markRead(c, true);
        changed();
      }, { icon: Icons.check, shortcut: "<Ctrl><Shift>m", section: "Inbox" })]
      : []),
    open(webUrl(c, kind), kind === "mailpit" ? "Open Mailpit" : "Open MailHog", {
      icon: Icons.globe,
      section: "Inbox",
    }),
    ...(total
      ? [action("Delete All Messages", async () => {
        await deleteAll(c);
        cache.clear();
        await toast("Inbox emptied", { style: "success" });
        changed();
      }, {
        icon: Icons.trash,
        destructive: true,
        shortcut: "<Ctrl><Shift>x",
        confirm: `Delete all ${total} messages caught by ${kind === "mailpit" ? "Mailpit" : "MailHog"}?`,
        section: "Danger",
      })]
      : []),
  ];
}

// ---------------------------------------------------------------------------
// Views

async function readView(c: Config, kind: Kind, s: Summary): Promise<DetailSpec> {
  const full = kind === "mailpit" ? await readMessage(c, s.id) : cache.get(s.id)!;
  cache.set(s.id, full);
  if (!s.read) changed();
  const codes = findCodes(messageText(full), full.subject);
  const links = findLinks(full);
  return detail({
    title: full.subject || "(no subject)",
    markdown: messageMarkdown(full),
    metadata: [
      meta.person("From", senderName(full.from)),
      ...(full.from ? [meta.text("Address", full.from.address, { icon: Icons.mail })] : []),
      meta.text("To", addressLine(full.to) || "?", { icon: Icons.inbox }),
      ...(full.cc.length ? [meta.text("Cc", addressLine(full.cc))] : []),
      ...(full.date ? [meta.text("Received", new Date(full.date).toLocaleString("en-GB"), { icon: Icons.clock })] : []),
      ...(codes.length
        ? [meta.tags("Codes", codes.slice(0, 3).map((x) => ({ text: x.code, color: "green" as const })))]
        : []),
      ...links.filter((l) => l.verify).slice(0, 3).map((l) => meta.link("Link", l.label ?? shortUrl(l.url), l.url)),
      ...(full.files.length ? [meta.tags("Attachments", full.files.map((f) => f.name))] : []),
      ...(full.tags.length ? [meta.tags("Tags", full.tags)] : []),
      ...(full.size ? [meta.text("Size", bytes(full.size))] : []),
    ],
    actions: [...findingsActions(s, full), ...messageActions(c, kind, s, full, "pop")],
  });
}

function messageItem(c: Config, kind: Kind, m: Summary, unread: number, total: number): Item {
  const full = cache.get(m.id);
  const text = full ? messageText(full) : m.snippet ?? "";
  const code = findCodes(text, m.subject)[0];
  const link = full ? findLinks(full).find((l) => l.verify) : undefined;
  const to = m.to[0]?.address;
  return {
    id: m.id,
    title: m.subject || "(no subject)",
    subtitle: `${senderName(m.from)}${to ? ` → ${to}` : ""}`,
    icon: { source: m.read ? Icons.mail : Icons.inbox, tint: m.read ? "gray" : "blue" },
    keywords: [
      m.from?.address ?? "",
      ...m.to.map((a) => a.address),
      m.snippet ?? "",
      ...m.tags,
      ...(code ? [code.code] : []),
    ],
    accessories: [
      ...(code ? [{ tag: code.code, color: "green" as const, tooltip: "Verification code" }] : []),
      ...(link ? [{ icon: { source: Icons.link, tint: "blue" as const }, tooltip: "Verification link" }] : []),
      ...(m.attachments
        ? [{ icon: Icons.file, tooltip: `${m.attachments} attachment${m.attachments === 1 ? "" : "s"}` }]
        : []),
      ...m.tags.slice(0, 2).map((t) => ({ tag: t })),
      { text: shortDate(m.date) },
    ],
    detail: {
      markdown: full ? messageMarkdown(full).slice(0, 6000) : `## ${m.subject || "(no subject)"}\n\n${m.snippet ?? ""}`,
      metadata: [
        meta.text("From", m.from ? `${senderName(m.from)} <${m.from.address}>` : "?", { icon: Icons.mail }),
        meta.text("To", addressLine(m.to) || "?", { icon: Icons.inbox }),
        ...(m.date ? [meta.text("Received", new Date(m.date).toLocaleString("en-GB"), { icon: Icons.clock })] : []),
        ...(code ? [meta.tags("Code", [{ text: code.code, color: "green" }])] : []),
        ...(link ? [meta.link("Link", link.label ?? shortUrl(link.url), link.url)] : []),
      ],
    },
    actions: [
      ...findingsActions(m, full),
      action("Read Message", () => readView(c, kind, m), { icon: Icons.eye, shortcut: "<Ctrl>r" }),
      ...messageActions(c, kind, m, full, "stay"),
      ...inboxActions(c, kind, unread, total),
    ],
  };
}

let summary = "";

// The catcher's inbox, checked every few seconds while open.
export default list({
  placeholder: "Filter mail by subject, sender, recipient or code…",
  empty: {
    title: "No mail caught yet",
    description: "Send something to the catcher's SMTP port (1025): it shows up here at once",
    icon: Icons.inbox,
  },
  status: () => summary,
  async *items({ preferences, signal }) {
    summary = "";
    let c: Config;
    try {
      c = config(preferences);
    } catch (e) {
      if (e instanceof SetupError) return yield [setupItem(e)];
      throw e;
    }
    let failures = 0;
    let lastUnread = -1;
    while (!signal.aborted) {
      try {
        const box = await inbox(c, signal);
        for (const [id, m] of box.full) cache.set(id, m);
        const render = () => box.messages.map((m) => messageItem(c, box.kind, m, box.unread, box.total));
        yield render();
        await preload(c, box.kind, box.messages, signal);
        failures = 0;
        const name = box.kind === "mailpit" ? "Mailpit" : "MailHog";
        summary = `${name} · ${box.total} message${box.total === 1 ? "" : "s"}${
          box.unread ? ` · ${box.unread} unread` : ""
        } · live`;
        if (box.unread !== lastUnread) {
          lastUnread = box.unread;
          await updateCommandMetadata({ subtitle: box.unread ? `${box.unread} unread` : null }).catch(() => {});
        }
        yield render();
      } catch (e) {
        if (signal.aborted) return;
        if (e instanceof SetupError) {
          summary = "Not connected";
          yield [setupItem(e)];
          await pause(10_000, signal);
          continue;
        }
        // A hiccup while polling keeps the last list; three in a row show the error.
        if (++failures < 3) {
          await pause(POLL, signal);
          continue;
        }
        throw e;
      }
      await pause(POLL, signal);
    }
  },
});
