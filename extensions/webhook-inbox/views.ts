// The inbox list: the URL, the requests as they arrive, replays and their result.

import {
  type Action,
  action,
  clipboard,
  copy,
  detail,
  type DetailSpec,
  field,
  form,
  Icons,
  type Item,
  meta,
  open,
  replace,
  submenu,
  toast,
} from "@backslash/api";
import {
  clearRequests,
  deleteRequest,
  dropInbox,
  forgetInbox,
  newInbox,
  pick,
  type Prefs,
  replay,
  type ReplayResult,
  type ReplaySettings,
  saveReplaySettings,
} from "./api.ts";
import {
  ago,
  fence,
  formatBytes,
  formatMs,
  header,
  headerList,
  type Hook,
  hookMarkdown,
  type Inbox,
  METHOD_COLORS,
  parseDate,
  parseTarget,
  prettyBody,
  queryList,
  type Replay,
  replayRequest,
  requestPath,
  senderOf,
  shortId,
  toCurl,
  viewUrl,
  webhookUrl,
} from "./lib.ts";

// Changes made from the list (a deletion, a new URL) wake the polling loop at once.
export const changes = new EventTarget();
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

// ---------------------------------------------------------------------------
// Replays

function resultView(r: Replay, res: ReplayResult): DetailSpec {
  const status = `${res.status} ${res.statusText}`.trim();
  const color = res.status >= 500 ? "red" : res.status >= 400 ? "orange" : res.status >= 300 ? "purple" : "green";
  const body = res.text ? prettyBody(res.contentType, res.text) : undefined;
  return detail({
    title: `Replayed: ${status}`,
    markdown: [
      `## ${status}`,
      `\`${r.method} ${r.url}\``,
      body ? fence(body.text.slice(0, 20_000), body.lang) : "_Empty body._",
    ].join("\n\n"),
    stats: [
      { label: "Status", value: res.status, color },
      { label: "Time", value: formatMs(res.ms) },
      { label: "Size", value: formatBytes(res.size) },
    ],
    metadata: [
      meta.text("URL", r.url, { icon: Icons.link }),
      meta.separator(),
      ...res.headers.map(([k, v]) => meta.text(k, v)),
    ],
    status: `${status} · ${formatMs(res.ms)}`,
    actions: [
      action("Replay Again", async (ctx) => replace(resultView(r, await replay(r, ctx.signal))), {
        icon: Icons.refresh,
        shortcut: "<Ctrl>r",
      }),
      ...(res.text ? [copy(res.text, "Copy Response Body", { section: "Copy" })] : []),
      copy(toCurl(r), "Copy as curl", { icon: Icons.terminal, section: "Copy" }),
    ],
  });
}

function replayForm(h: Hook, uuid: string, saved?: { target: string; keepPath: boolean }) {
  const { path } = requestPath(h.url, uuid);
  return form({
    title: `Replay ${h.method} ${path}`,
    submitTitle: "Replay",
    fields: [
      field.text("target", "Send to", {
        required: true,
        value: saved?.target ?? "http://localhost:3000",
        placeholder: "http://localhost:3000/webhooks",
      }),
      field.checkbox("keepPath", `Add the original path (${path})`, { value: saved?.keepPath ?? true }),
    ],
    async submit(values, ctx) {
      const target = parseTarget(String(values.target ?? ""));
      const keepPath = !!values.keepPath;
      await saveReplaySettings({ target, keepPath });
      const r = replayRequest(target, h, uuid, keepPath);
      return replace(resultView(r, await replay(r, ctx.signal)));
    },
  });
}

function replayActions(h: Hook, uuid: string, saved: ReplaySettings | undefined): Action[] {
  const quick = saved ? replayRequest(saved.target, h, uuid, saved.keepPath) : undefined;
  return [
    ...(quick
      ? [
        action(`Replay to ${quick.url.replace(/^https?:\/\//, "")}`, async (ctx) =>
          resultView(quick, await replay(quick, ctx.signal)), {
          icon: Icons.play,
        }),
      ]
      : []),
    action("Replay to…", () => replayForm(h, uuid, saved), { icon: Icons.arrowRight, shortcut: "<Ctrl>p" }),
  ];
}

// ---------------------------------------------------------------------------
// Rows

function inboxActions(prefs: Prefs, inbox: Inbox, all: Inbox[]): Action[] {
  const url = webhookUrl(inbox.uuid);
  return [
    copy(url, "Copy Webhook URL", { icon: Icons.link, shortcut: "<Ctrl><Shift>c", section: "Inbox" }),
    open(viewUrl(inbox.uuid), "Open on webhook.site", { shortcut: "<Ctrl>o", section: "Inbox" }),
    copy(`${inbox.uuid}@emailhook.site`, "Copy Email Address", { icon: Icons.mail, section: "Inbox" }),
    action("New Webhook URL", async () => {
      const created = await newInbox(prefs);
      await clipboard.write(webhookUrl(created.uuid));
      await toast("New URL copied", { style: "success", message: webhookUrl(created.uuid) });
      changed();
    }, { icon: Icons.plus, shortcut: "<Ctrl>n", section: "Inbox" }),
    ...(all.length > 1
      ? [submenu(
        "Switch Inbox",
        all.map((i) =>
          action(`${shortId(i.uuid)}… · ${ago(i.created)}${i.uuid === inbox.uuid ? " (current)" : ""}`, async () => {
            await pick(i.uuid);
            changed();
          }, { icon: i.uuid === inbox.uuid ? Icons.check : Icons.inbox })
        ),
        { icon: Icons.inbox, section: "Inbox" },
      )]
      : []),
    action("Clear Requests", async () => {
      await clearRequests(prefs, inbox.uuid);
      await toast("Requests cleared");
      changed();
    }, { icon: Icons.trash, destructive: true, confirm: "Delete every request of this inbox?", section: "Danger" }),
    action("Delete Inbox", async () => {
      await dropInbox(prefs, inbox.uuid);
      await toast("Inbox deleted", { message: "Its URL stops answering" });
      changed();
    }, {
      icon: Icons.trash,
      destructive: true,
      confirm: "Delete this webhook URL and its requests? Senders will get errors.",
      section: "Danger",
    }),
  ];
}

export function urlItem(prefs: Prefs, inbox: Inbox, all: Inbox[], total: number): Item {
  const url = webhookUrl(inbox.uuid);
  return {
    id: "url",
    title: url.replace("https://", ""),
    subtitle: total ? `${total} request${total === 1 ? "" : "s"}` : "Waiting for requests…",
    icon: { source: Icons.link, tint: "blue" },
    section: "Webhook URL",
    accessories: [{ text: `created ${ago(inbox.created)}` }, {
      icon: { source: Icons.dot, tint: "green" },
      tooltip: "Live",
    }],
    detail: {
      markdown: [
        "Send requests to this URL: they show up here within a few seconds.",
        fence(url),
        "Try it:",
        fence(`curl -X POST ${url}/test -H 'Content-Type: application/json' -d '{"hello": "world"}'`, "sh"),
        "Free webhook.site URLs are temporary and keep a limited number of requests.",
      ].join("\n\n"),
    },
    actions: inboxActions(prefs, inbox, all),
  };
}

export function hookItem(prefs: Prefs, h: Hook, inbox: Inbox, all: Inbox[], saved: ReplaySettings | undefined): Item {
  const { path, search } = requestPath(h.url, inbox.uuid);
  const headers = headerList(h.headers);
  const type = header(headers, "content-type");
  const sender = senderOf(h);
  const at = parseDate(h.created_at);
  const color = METHOD_COLORS[h.method.toUpperCase()] ?? "gray";
  const r = replayRequest(saved?.target ?? "http://localhost:3000", h, inbox.uuid, saved?.keepPath ?? true);
  return {
    id: h.uuid,
    title: `${h.method} ${path}${search}`,
    subtitle: [sender, type?.split(";")[0]].filter(Boolean).join(" · ") || h.ip,
    icon: { source: h.type === "email" ? Icons.mail : Icons.arrowRight, tint: color },
    section: "Requests",
    keywords: [h.ip ?? "", sender ?? "", type ?? "", ...queryList(h.query).map(([k]) => k)],
    accessories: [{ text: formatBytes(h.size) }, {
      text: ago(at),
      tooltip: at ? new Date(at).toLocaleString() : undefined,
    }],
    detail: {
      markdown: hookMarkdown(h, inbox.uuid),
      metadata: [
        meta.text("Method", h.method, { icon: Icons.arrowRight, color }),
        meta.text("Path", `${path}${search}`, { icon: Icons.link }),
        ...(sender ? [meta.text("Sender", sender, { icon: Icons.person })] : []),
        ...(h.ip ? [meta.text("From", h.ip, { icon: Icons.globe })] : []),
        ...(at ? [meta.text("Received", new Date(at).toLocaleString("en-GB"), { icon: Icons.clock })] : []),
        meta.text("Size", formatBytes(h.size), { icon: Icons.file }),
      ],
    },
    actions: [
      ...replayActions(h, inbox.uuid, saved),
      ...(h.content
        ? [
          copy(h.content, "Copy Body", { icon: Icons.copy, shortcut: "<Ctrl>b", section: "Copy" }),
          ...(/json/.test(type ?? "") || /^\s*[[{]/.test(h.content)
            ? [copy(prettyBody(type, h.content).text, "Copy Formatted Body", { icon: Icons.braces, section: "Copy" })]
            : []),
        ]
        : []),
      copy(headers.map(([k, v]) => `${k}: ${v}`).join("\n"), "Copy Headers", { section: "Copy" }),
      copy(toCurl(r), `Copy as curl (to ${new URL(r.url).host})`, {
        icon: Icons.terminal,
        section: "Copy",
      }),
      open(viewUrl(inbox.uuid, h.uuid), "Open on webhook.site", { section: "Request" }),
      action("Delete Request", async () => {
        await deleteRequest(prefs, inbox.uuid, h.uuid);
        changed();
      }, { icon: Icons.trash, destructive: true, shortcut: "<Ctrl>x", section: "Request" }),
      ...inboxActions(prefs, inbox, all),
    ],
  };
}

export function createItem(prefs: Prefs, gone?: Inbox): Item {
  return {
    id: "create",
    title: gone ? "This webhook URL expired" : "Create a webhook URL",
    subtitle: gone ? "webhook.site no longer has it: create a new one" : "A temporary public URL from webhook.site",
    icon: { source: gone ? Icons.alert : Icons.plus, tint: gone ? "orange" : "blue" },
    detail: {
      markdown: [
        "## Catch webhooks",
        "",
        "Creates a URL on **webhook.site** that records every request sent to it.",
        "Point Stripe, GitHub or your own app at it, watch the requests arrive here,",
        "and replay them to your local server (http://localhost:3000…).",
        "",
        "Anyone with the URL can see what is sent to it: don't use it for real secrets.",
      ].join("\n"),
    },
    actions: [action("Create Webhook URL", async () => {
      if (gone) await forgetInbox(gone.uuid);
      const inbox = await newInbox(prefs);
      await clipboard.write(webhookUrl(inbox.uuid));
      await toast("Webhook URL copied", { style: "success", message: webhookUrl(inbox.uuid) });
      changed();
    }, { icon: Icons.plus })],
  };
}
