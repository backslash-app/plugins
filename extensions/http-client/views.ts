// Views shared by the commands: the response page, the request form, saved and history items.

import {
  type Action,
  action,
  close,
  type Context,
  copy,
  detail,
  type DetailSpec,
  field,
  form,
  type FormSpec,
  Icons,
  type Item,
  meta,
  open,
  pop,
  replace,
  storage,
  toast,
} from "@backslash/api";
import {
  addHistory,
  ago,
  formatBytes,
  formatMs,
  hasSecret,
  headerText,
  type HistoryEntry,
  htmlTitle,
  METHODS,
  parseHeaders,
  prettyBody,
  reason,
  type Request,
  type Response,
  type SavedRequest,
  send,
  shortUrl,
  statusTint,
  toCurl,
  validate,
} from "./lib.ts";

type Json = Parameters<typeof storage.set>[1];

// --- Storage -------------------------------------------------------------------

const changes = new EventTarget();

export const loadSaved = async () =>
  ((await storage.get("saved").catch(() => undefined)) as SavedRequest[] | undefined) ?? [];
export const loadHistory = async () =>
  ((await storage.get("history").catch(() => undefined)) as HistoryEntry[] | undefined) ?? [];

async function writeSaved(list: SavedRequest[]) {
  await storage.set("saved", list as unknown as Json);
  changes.dispatchEvent(new Event("change"));
}

async function remember(r: Request, res: Response) {
  const entry: HistoryEntry = { ...r, status: res.status, ms: res.ms, at: Date.now() };
  await storage.set("history", addHistory(await loadHistory(), entry) as unknown as Json);
  changes.dispatchEvent(new Event("change"));
}

/** Yields `load()` again after every change made from this process. */
export async function* live<T>(load: () => Promise<T>, signal: AbortSignal): AsyncGenerator<T> {
  while (!signal.aborted) {
    yield await load();
    await new Promise<void>((resolve) => {
      const done = () => {
        changes.removeEventListener("change", done);
        signal.removeEventListener("abort", done);
        resolve();
      };
      changes.addEventListener("change", done);
      signal.addEventListener("abort", done);
    });
  }
}

// --- Sending ---------------------------------------------------------------------

const TIMEOUT = 30_000;

/** Sends, records it in the history, and shows the response. */
export async function sendAndShow(r: Request, ctx: Context): Promise<DetailSpec> {
  const signal = AbortSignal.any([ctx.signal, AbortSignal.timeout(TIMEOUT)]);
  let res: Response;
  try {
    res = await send(r, { signal });
  } catch (e) {
    if (e instanceof DOMException && e.name === "TimeoutError") throw new Error(`No answer after ${TIMEOUT / 1000} s`);
    const message = e instanceof Error ? e.message : String(e);
    throw new Error(message.replace(/^error sending request for url \([^)]*\): /, ""));
  }
  await remember(r, res).catch(() => {});
  return responseView(r, res);
}

const fence = (text: string, lang = "") => {
  const ticks = "`".repeat(Math.max(3, ...[...text.matchAll(/`{3,}/g)].map((m) => m[0].length + 1)));
  return `${ticks}${lang}\n${text}\n${ticks}`;
};

const LIMIT = 30_000;

export function responseView(r: Request, res: Response): DetailSpec {
  const status = `${res.status} ${reason(res.status, res.statusText)}`.trim();
  const tint = statusTint(res.status);
  let body: string;
  if (res.text === undefined) {
    body = `_Binary body (${res.contentType || "unknown type"}), ${formatBytes(res.size)}._`;
  } else if (!res.text) {
    body = "_Empty body._";
  } else {
    const pretty = prettyBody(res.contentType, res.text);
    const shown = pretty.text.length > LIMIT
      ? `${pretty.text.slice(0, LIMIT)}\n… (${formatBytes(res.size)} in all)`
      : pretty.text;
    body = fence(shown, pretty.lang);
  }
  const title = res.text && /html/.test(res.contentType) ? htmlTitle(res.text) : undefined;
  return detail({
    title: status,
    markdown: [`## ${status}`, "", `\`${r.method} ${r.url}\``, ...(title ? ["", `**${title}**`] : []), "", body].join(
      "\n",
    ),
    stats: [
      { label: "Status", value: res.status, color: tint },
      { label: "Time", value: formatMs(res.ms) },
      { label: "Size", value: formatBytes(res.size) },
    ],
    metadata: [
      meta.text("Method", r.method, { icon: Icons.arrowRight }),
      meta.link("URL", shortUrl(res.url), res.url),
      ...(res.redirected ? [meta.text("Redirected", "Yes, the URL above is the final one", { color: "purple" })] : []),
      ...(res.contentType ? [meta.text("Content type", res.contentType, { icon: Icons.file })] : []),
      meta.separator(),
      ...res.headers.map(([k, v]) => meta.text(k, v)),
    ],
    status: `${status} · ${formatMs(res.ms)} · ${formatBytes(res.size)}`,
    actions: [
      ...(res.text ? [copy(res.text, "Copy Body")] : []),
      action("Send Again", async (c) => replace(await sendAndShow(r, c)), { icon: Icons.refresh, shortcut: "<Ctrl>r" }),
      copy(toCurl(r), "Copy as curl", {
        concealed: hasSecret(r),
        icon: Icons.terminal,
        shortcut: "<Ctrl><Shift>c",
        section: "Copy",
      }),
      copy(headerText(res.headers), "Copy Response Headers", { section: "Copy" }),
      copy(res.url, "Copy URL", { icon: Icons.link, section: "Copy" }),
      ...(res.text && /json/.test(res.contentType)
        ? [
          copy(prettyBody(res.contentType, res.text).text, "Copy Formatted JSON", {
            icon: Icons.braces,
            section: "Copy",
          }),
        ]
        : []),
      action("Save Request…", () => requestForm({ request: r }), { icon: Icons.bookmark, shortcut: "<Ctrl>s" }),
      ...(r.method === "GET" ? [open(res.url, "Open in Browser", { shortcut: "<Ctrl>o" })] : []),
    ],
  });
}

// --- Form ------------------------------------------------------------------------

/**
 * Creates or edits a saved request. `after` decides where saving leads:
 * back to a live list (`pop`), or closes when it's the command itself.
 */
export function requestForm(
  options: { request?: Request; saved?: SavedRequest; after?: "pop" | "close" } = {},
): FormSpec {
  const r = options.saved ?? options.request;
  return form({
    title: options.saved ? `Edit “${options.saved.name}”` : "Save Request",
    submitTitle: options.saved ? "Save Changes" : "Save Request",
    fields: [
      field.text("name", "Name", {
        required: true,
        value: options.saved?.name ?? (r ? `${r.method} ${shortUrl(r.url)}` : ""),
        placeholder: "List users (staging)",
      }),
      field.dropdown("method", "Method", METHODS, { value: r?.method ?? "GET" }),
      field.text("url", "URL", {
        required: true,
        value: r?.url ?? "",
        placeholder: "https://api.example.com/v1/users",
      }),
      field.textArea("headers", "Headers", {
        value: r ? headerText(r.headers) : "",
        placeholder: "Authorization: Bearer …\nAccept: application/json",
      }),
      field.textArea("body", "Body", { value: r?.body ?? "", placeholder: '{"name": "Ada"}' }),
    ],
    async submit(values) {
      const request: Request = {
        method: String(values.method || "GET"),
        url: String(values.url).trim(),
        headers: parseHeaders(String(values.headers ?? "")),
        body: String(values.body ?? "") || undefined,
      };
      validate(request);
      const name = String(values.name).trim();
      const list = await loadSaved();
      const id = options.saved?.id ?? crypto.randomUUID();
      const entry: SavedRequest = { ...request, id, name };
      await writeSaved(options.saved ? list.map((s) => s.id === id ? entry : s) : [entry, ...list]);
      if (options.after === "pop") return pop();
      await toast(`Saved “${name}”`, { style: "success" });
      return close(`Saved “${name}”`);
    },
  });
}

// --- Items -----------------------------------------------------------------------

const methodTint = (m: string) =>
  ({ GET: "green", POST: "blue", PUT: "orange", PATCH: "purple", DELETE: "red" } as const)[m as "GET"] ?? "gray";

function requestDetail(r: Request) {
  return {
    markdown: [
      fence(toCurl(r), "sh"),
      ...(r.body ? ["", "**Body**", "", fence(prettyBody(header(r, "content-type"), r.body).text)] : []),
    ].join("\n"),
    metadata: [
      meta.text("Method", r.method, { icon: Icons.arrowRight, color: methodTint(r.method) }),
      meta.link("URL", shortUrl(r.url), r.url),
      ...(r.headers.length
        ? [
          meta.separator(),
          ...r.headers.map(([k, v]) => meta.text(k, /authorization|token|key|cookie/i.test(k) ? "••••••" : v)),
        ]
        : []),
    ],
  };
}

const header = (r: Request, name: string) => r.headers.find(([k]) => k.toLowerCase() === name)?.[1] ?? "";

function requestActions(r: Request): Action[] {
  return [
    action("Send Request", (ctx) => sendAndShow(r, ctx), { icon: Icons.arrowRight }),
    copy(toCurl(r), "Copy as curl", {
      concealed: hasSecret(r),
      icon: Icons.terminal,
      shortcut: "<Ctrl><Shift>c",
      section: "Copy",
    }),
    copy(r.url, "Copy URL", { icon: Icons.link, section: "Copy" }),
  ];
}

export function savedItem(s: SavedRequest, after: "pop" | "close"): Item {
  return {
    id: `saved:${s.id}`,
    title: s.name,
    subtitle: `${s.method} ${shortUrl(s.url)}`,
    icon: { source: Icons.bookmark, tint: methodTint(s.method) },
    section: "Saved",
    keywords: [s.url, s.method],
    accessories: [{ tag: s.method, color: methodTint(s.method) }],
    detail: requestDetail(s),
    actions: [
      ...requestActions(s),
      action("Edit Request…", () => requestForm({ saved: s, after }), { icon: Icons.text, shortcut: "<Ctrl>e" }),
      action("Duplicate", async () => {
        await writeSaved([{ ...s, id: crypto.randomUUID(), name: `${s.name} (copy)` }, ...await loadSaved()]);
        await toast("Duplicated", { style: "success" });
      }, { icon: Icons.copy }),
      action("Delete Request", async () => {
        await writeSaved((await loadSaved()).filter((x) => x.id !== s.id));
        await toast(`Deleted “${s.name}”`);
      }, { icon: Icons.trash, destructive: true, confirm: `Delete “${s.name}”?`, section: "Danger" }),
    ],
  };
}

export function historyItem(h: HistoryEntry, after: "pop" | "close"): Item {
  return {
    id: `history:${h.method}:${h.url}`,
    title: shortUrl(h.url),
    subtitle: h.method,
    icon: { source: Icons.history, tint: statusTint(h.status) },
    section: "History",
    keywords: [h.url, h.method, String(h.status)],
    accessories: [
      { tag: String(h.status), color: statusTint(h.status) },
      { text: formatMs(h.ms), tooltip: "Response time" },
      { text: ago(h.at) },
    ],
    detail: requestDetail(h),
    actions: [
      ...requestActions(h),
      action("Save Request…", () => requestForm({ request: h, after }), { icon: Icons.bookmark, shortcut: "<Ctrl>s" }),
    ],
  };
}

export async function clearHistory() {
  await storage.delete("history");
  changes.dispatchEvent(new Event("change"));
}
