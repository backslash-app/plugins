// Microsoft Graph: the sign-in, response types and pure logic (mail, To Do, OneDrive, calendar).

import { type Color, Icons, meta, type Metadata, type OAuthProvider } from "@backslash/api";

export const GRAPH = "https://graph.microsoft.com/v1.0";
export const ENTRA_URL = "https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade";
export const ENTRA_DOCS = "https://learn.microsoft.com/entra/identity-platform/quickstart-register-app";
export const REDIRECT_URI = "http://127.0.0.1/callback";
export const SCOPES = [
  "offline_access",
  "User.Read",
  "Mail.ReadWrite",
  "Tasks.ReadWrite",
  "Files.Read",
  "Calendars.Read",
];

/** The app isn't registered yet, or Microsoft refused the token: lists show how to connect. */
export class AuthError extends Error {}

/** The user's own Entra app registration (there is no shared Backslash app). */
export function provider(prefs: Record<string, unknown>): OAuthProvider {
  const clientId = String(prefs.clientId ?? "").trim();
  if (!clientId) throw new AuthError("Connect your Microsoft account");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(clientId)) {
    throw new AuthError("The Application (client) ID is a GUID like 1b2c3d4e-…: check the preference");
  }
  const tenant = String(prefs.tenant ?? "").trim() || "common";
  if (!/^[\w.-]+$/.test(tenant)) throw new AuthError(`“${tenant}” is not a tenant: use common, or your tenant ID`);
  const base = `https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0`;
  return {
    id: "microsoft",
    title: "Microsoft 365",
    authorizeUrl: `${base}/authorize`,
    tokenUrl: `${base}/token`,
    clientId,
    scopes: SCOPES,
    params: { prompt: "select_account" },
  };
}

/** A Graph error body: `{ error: { code, message } }`. */
export function graphError(status: number, text: string, retryAfter?: string | null): Error {
  let code = "";
  let message = "";
  try {
    const body = JSON.parse(text);
    code = body?.error?.code ?? "";
    message = body?.error?.message ?? body?.error_description ?? "";
  } catch {
    message = text.slice(0, 160);
  }
  if (code === "MailboxNotEnabledForRESTAPI" || (code === "ResourceNotFound" && /mailbox/i.test(message))) {
    return new Error("This account has no Exchange Online mailbox");
  }
  if (status === 401) return new AuthError("Microsoft signed you out");
  if (status === 403) {
    return new Error(
      `Microsoft refused it${message ? `: ${message}` : ""}. Sign out and in again to grant the permissions`,
    );
  }
  if (status === 404) return new Error("Not found: it may have been moved or deleted");
  if (status === 429) {
    const wait = Number(retryAfter);
    return new Error(`Microsoft Graph is throttling: try again in ${wait > 0 ? `${wait} s` : "a minute"}`);
  }
  return new Error(`Microsoft Graph answered ${status}${message ? `: ${message}` : code ? `: ${code}` : ""}`);
}

// ---------------------------------------------------------------------------
// Shared formatting

export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** "now", "5 min", "3 h", "yesterday", "Mon", "12 Oct", "12 Oct 2024". */
export function shortAgo(date: Date, now = new Date()): string {
  const s = (now.getTime() - date.getTime()) / 1000;
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)} min`;
  if (dayDiff(date, now) === 0) return `${Math.floor(s / 3600)} h`;
  if (dayDiff(date, now) === -1) return "yesterday";
  if (dayDiff(date, now) > -7) return date.toLocaleDateString("en-GB", { weekday: "short" });
  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    ...(date.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }),
  });
}

export function fullDate(date: Date): string {
  return date.toLocaleString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export const clock = (date: Date) => date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

/** Whole days from `now`'s day to `date`'s day (negative in the past). */
export function dayDiff(date: Date, now = new Date()): number {
  return Math.round((startOfDay(date).getTime() - startOfDay(now).getTime()) / 86_400_000);
}

/** Plain text of an escaped preview, safe inside markdown. */
export function mdEscape(text: string): string {
  return text.replace(/([\\`*_[\]#<>|])/g, "\\$1");
}

// ---------------------------------------------------------------------------
// Outlook mail

export interface Address {
  emailAddress?: { name?: string; address?: string };
}

export interface Message {
  id: string;
  subject?: string | null;
  bodyPreview?: string;
  from?: Address;
  toRecipients?: Address[];
  ccRecipients?: Address[];
  receivedDateTime: string;
  webLink?: string;
  inferenceClassification?: "focused" | "other";
  flag?: { flagStatus?: "notFlagged" | "flagged" | "complete" };
  importance?: "low" | "normal" | "high";
  hasAttachments?: boolean;
  isRead?: boolean;
}

export const MAIL_FIELDS =
  "id,subject,bodyPreview,from,toRecipients,ccRecipients,receivedDateTime,webLink,inferenceClassification,flag,importance,hasAttachments,isRead";

/**
 * Unread inbox messages, newest first. Graph wants the `$orderby` property in
 * `$filter` too, and first, or it refuses the query as too complex.
 */
export function unreadPath(top = 50): string {
  const q = new URLSearchParams({
    $filter: "receivedDateTime ge 1900-01-01T00:00:00Z and isRead eq false",
    $orderby: "receivedDateTime desc",
    $top: String(top),
    $select: MAIL_FIELDS,
  });
  return `/me/mailFolders/inbox/messages?${q}`;
}

/** Focused before Other, each newest first. */
export function sortMail(messages: Message[]): Message[] {
  const rank = (m: Message) => (m.inferenceClassification === "other" ? 1 : 0);
  return [...messages].sort((a, b) =>
    rank(a) - rank(b) || Date.parse(b.receivedDateTime) - Date.parse(a.receivedDateTime)
  );
}

export const mailSection = (m: Message) => (m.inferenceClassification === "other" ? "Other" : "Focused");

export function senderOf(m: Message): { name: string; address: string } {
  const e = m.from?.emailAddress ?? {};
  return { name: (e.name || e.address || "Unknown sender").trim(), address: (e.address ?? "").trim() };
}

const people = (list?: Address[]) =>
  (list ?? []).map((a) => a.emailAddress?.name || a.emailAddress?.address || "").filter(Boolean);

/** The message's page in Outlook on the web (Graph's own link when it has one). */
export function mailUrl(m: Message): string {
  return m.webLink || `https://outlook.office.com/mail/inbox/id/${encodeURIComponent(m.id)}`;
}

export function mailMarkdown(m: Message): string {
  const subject = m.subject?.trim() || "(no subject)";
  const preview = (m.bodyPreview ?? "").replace(/\r/g, "").trim();
  return [`### ${mdEscape(subject)}`, "", preview ? mdEscape(preview) : "*No preview*"].join("\n");
}

export function mailMetadata(m: Message): Metadata[] {
  const from = senderOf(m);
  const to = people(m.toRecipients);
  const cc = people(m.ccRecipients);
  const lines: Metadata[] = [
    meta.person(
      "From",
      from.address && from.address !== from.name ? `${from.name} <${from.address}>` : from.name,
      from.name,
    ),
    ...(to.length ? [meta.text("To", to.slice(0, 4).join(", ") + (to.length > 4 ? ` +${to.length - 4}` : ""))] : []),
    ...(cc.length ? [meta.text("Cc", cc.slice(0, 4).join(", ") + (cc.length > 4 ? ` +${cc.length - 4}` : ""))] : []),
    meta.text("Received", fullDate(new Date(m.receivedDateTime)), { icon: Icons.clock }),
    meta.separator(),
  ];
  const tags: { text: string; color?: Color }[] = [
    { text: m.inferenceClassification === "other" ? "Other" : "Focused", color: "blue" },
  ];
  if (m.importance === "high") tags.push({ text: "Important", color: "red" });
  if (m.flag?.flagStatus === "flagged") tags.push({ text: "Flagged", color: "orange" });
  if (m.hasAttachments) tags.push({ text: "Attachments", color: "gray" });
  lines.push(meta.tags("Labels", tags));
  return lines;
}

// ---------------------------------------------------------------------------
// Microsoft To Do

export interface TodoList {
  id: string;
  displayName: string;
  wellknownListName?: "none" | "defaultList" | "flaggedEmails" | "unknownFutureValue";
  isShared?: boolean;
}

export interface TodoTask {
  id: string;
  title: string;
  status: "notStarted" | "inProgress" | "completed" | "waitingOnOthers" | "deferred";
  importance: "low" | "normal" | "high";
  dueDateTime?: { dateTime: string; timeZone: string } | null;
  reminderDateTime?: { dateTime: string; timeZone: string } | null;
  isReminderOn?: boolean;
  body?: { content?: string; contentType?: string };
  createdDateTime?: string;
  lastModifiedDateTime?: string;
  categories?: string[];
  checklistItems?: { id: string; displayName: string; isChecked: boolean }[];
  linkedResources?: { webUrl?: string; applicationName?: string; displayName?: string }[];
  /** Set by us: the list the task came from. */
  listId?: string;
}

/** The default "Tasks" list first, then "Flagged email", then the others by name. */
export function sortLists(lists: TodoList[]): TodoList[] {
  const rank = (l: TodoList) =>
    l.wellknownListName === "defaultList" ? 0 : l.wellknownListName === "flaggedEmails" ? 2 : 1;
  return [...lists].sort((a, b) => rank(a) - rank(b) || a.displayName.localeCompare(b.displayName));
}

/**
 * To Do keeps a due *date*: midnight in some time zone. The calendar day is
 * what the user picked, so read it from the string, never through a time zone.
 */
export function dueOf(task: Pick<TodoTask, "dueDateTime">): Date | undefined {
  const m = task.dueDateTime?.dateTime?.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : undefined;
}

/** A due date as To Do writes it. */
export function graphDue(date: Date): { dateTime: string; timeZone: string } {
  const p = (n: number) => String(n).padStart(2, "0");
  return { dateTime: `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}T00:00:00`, timeZone: "UTC" };
}

export const BUCKETS = ["Overdue", "Today", "Tomorrow", "This Week", "Later", "No Due Date"] as const;
export type Bucket = typeof BUCKETS[number];

export function dueBucket(due: Date | undefined, now = new Date()): Bucket {
  if (!due) return "No Due Date";
  const d = dayDiff(due, now);
  if (d < 0) return "Overdue";
  if (d === 0) return "Today";
  if (d === 1) return "Tomorrow";
  if (d < 7) return "This Week";
  return "Later";
}

/** "today", "tomorrow", "Fri", "3 days ago", "12 Nov". */
export function shortDue(due: Date, now = new Date()): string {
  const d = dayDiff(due, now);
  if (d === 0) return "today";
  if (d === 1) return "tomorrow";
  if (d === -1) return "yesterday";
  if (d < 0 && d > -7) return `${-d} days ago`;
  if (d > 1 && d < 7) return due.toLocaleDateString("en-GB", { weekday: "short" });
  return due.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    ...(due.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }),
  });
}

/** Overdue first, then by due date (undated last), important first within a day. */
export function sortTasks(tasks: TodoTask[]): TodoTask[] {
  const imp = { high: 0, normal: 1, low: 2 };
  return [...tasks].sort((a, b) => {
    const da = dueOf(a)?.getTime() ?? Infinity;
    const db = dueOf(b)?.getTime() ?? Infinity;
    if (da !== db) return da - db;
    return imp[a.importance] - imp[b.importance] ||
      Date.parse(b.createdDateTime ?? "") - Date.parse(a.createdDateTime ?? "") || 0;
  });
}

export const IMPORTANCE = [
  { value: "high", title: "High", color: "red" as Color },
  { value: "normal", title: "Normal", color: undefined },
  { value: "low", title: "Low", color: "gray" as Color },
] as const;

/** Notes are HTML for tasks made in Outlook, text for those made in To Do. */
export function taskNotes(task: TodoTask): string {
  const raw = task.body?.content ?? "";
  if (task.body?.contentType?.toLowerCase() !== "html") return raw.trim();
  return raw
    .replace(/<(br|\/p|\/div|\/li)\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function taskMarkdown(task: TodoTask): string {
  const lines = [`### ${mdEscape(task.title || "Untitled")}`];
  const notes = taskNotes(task);
  if (notes) lines.push("", notes);
  const steps = task.checklistItems ?? [];
  if (steps.length) {
    lines.push(
      "",
      "**Steps**",
      "",
      ...steps.map((s) => `- ${s.isChecked ? "~~" : ""}${mdEscape(s.displayName)}${s.isChecked ? "~~" : ""}`),
    );
  }
  return lines.join("\n");
}

export function taskMetadata(task: TodoTask, list: TodoList | undefined, now = new Date()): Metadata[] {
  const due = dueOf(task);
  const bucket = dueBucket(due, now);
  const imp = IMPORTANCE.find((i) => i.value === task.importance) ?? IMPORTANCE[1];
  const steps = task.checklistItems ?? [];
  const done = steps.filter((s) => s.isChecked).length;
  const lines: Metadata[] = [
    meta.text("List", list?.displayName ?? "Tasks", { icon: Icons.inbox }),
    meta.text(
      "Due",
      due
        ? `${due.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })} (${
          shortDue(due, now)
        })`
        : "No due date",
      {
        icon: Icons.calendar,
        color: bucket === "Overdue" ? "red" : undefined,
      },
    ),
    meta.text("Importance", imp.title, { icon: Icons.flag, color: imp.color }),
  ];
  if (task.isReminderOn && task.reminderDateTime) {
    lines.push(
      meta.text("Reminder", fullDate(new Date(`${task.reminderDateTime.dateTime.replace(/\.\d+$/, "")}Z`)), {
        icon: Icons.bell,
      }),
    );
  }
  if (steps.length) lines.push(meta.progress("Steps", done / steps.length, `${done} of ${steps.length}`));
  if (task.categories?.length) lines.push(meta.tags("Categories", task.categories));
  const link = task.linkedResources?.find((r) => r.webUrl);
  if (link?.webUrl) lines.push(meta.link("Linked", link.displayName || link.applicationName || "Open", link.webUrl));
  if (task.createdDateTime) {
    lines.push(meta.separator(), meta.text("Created", fullDate(new Date(task.createdDateTime)), { icon: Icons.clock }));
  }
  return lines;
}

/** Microsoft To Do on the web: tasks have no web link in Graph. */
export function todoUrl(tenant: unknown): string {
  return String(tenant ?? "").trim() === "consumers"
    ? "https://to-do.live.com/tasks/"
    : "https://to-do.office.com/tasks/";
}

const WEEKDAYS: Record<string, number> = {
  sunday: 0,
  dimanche: 0,
  monday: 1,
  lundi: 1,
  tuesday: 2,
  mardi: 2,
  wednesday: 3,
  mercredi: 3,
  thursday: 4,
  jeudi: 4,
  friday: 5,
  vendredi: 5,
  saturday: 6,
  samedi: 6,
};

export interface QuickAdd {
  title: string;
  due?: Date;
  importance?: "high" | "normal" | "low";
  list?: string;
}

/**
 * "Call Bob tomorrow !high #Work" → title, due date, importance, list name.
 * Dates: today, tomorrow, a weekday (the next one), "next week", "in 3 days",
 * 2026-11-02, 2/11 (day/month), and their French words.
 */
export function parseQuickAdd(text: string, now = new Date()): QuickAdd {
  let rest = ` ${text.trim()} `;
  const out: QuickAdd = { title: "" };
  const take = (re: RegExp, fn: (m: RegExpMatchArray) => boolean | void) => {
    const m = rest.match(re);
    if (m && fn(m) !== false) rest = rest.replace(m[0], " ");
  };
  const day = (offset: number) => new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);

  take(/\s#("[^"]+"|\S+)/, (m) => {
    out.list = m[1].replace(/^"|"$/g, "");
  });
  take(/\s(!high|!important|!!|!low|!normal|!)(?=\s)/i, (m) => {
    const v = m[1].toLowerCase();
    out.importance = v === "!low" ? "low" : v === "!normal" ? "normal" : "high";
  });
  take(/\s(today|aujourd'hui)(?=\s)/i, () => {
    out.due = day(0);
  });
  if (!out.due) take(/\s(tomorrow|tmr|demain)(?=\s)/i, () => void (out.due = day(1)));
  if (!out.due) take(/\s(?:after tomorrow|après-demain)(?=\s)/i, () => void (out.due = day(2)));
  if (!out.due) {
    take(/\s(?:next week|la semaine prochaine|semaine prochaine)(?=\s)/i, () => {
      const toMonday = (8 - now.getDay()) % 7 || 7;
      out.due = day(toMonday);
    });
  }
  if (!out.due) {
    take(/\s(?:in|dans) (\d{1,3}) (days?|jours?|weeks?|semaines?)(?=\s)/i, (m) => {
      const n = Number(m[1]) * (/^(w|s)/i.test(m[2]) ? 7 : 1);
      out.due = day(n);
    });
  }
  if (!out.due) {
    take(/\s(\d{4})-(\d{2})-(\d{2})(?=\s)/, (m) => {
      out.due = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    });
  }
  if (!out.due) {
    take(/\s(\d{1,2})\/(\d{1,2})(?=\s)/, (m) => {
      const d = Number(m[1]), mo = Number(m[2]);
      if (d < 1 || d > 31 || mo < 1 || mo > 12) return false;
      let date = new Date(now.getFullYear(), mo - 1, d);
      if (dayDiff(date, now) < 0) date = new Date(now.getFullYear() + 1, mo - 1, d);
      out.due = date;
    });
  }
  if (!out.due) {
    take(new RegExp(`\\s(?:on |next )?(${Object.keys(WEEKDAYS).join("|")})(?=\\s)`, "i"), (m) => {
      const diff = (WEEKDAYS[m[1].toLowerCase()] - now.getDay() + 7) % 7 || 7;
      out.due = day(diff);
    });
  }
  out.title = rest.replace(/\s+/g, " ").trim();
  return out;
}

/** The list a quick add names, by exact then prefix match, ignoring case and accents. */
export function findList(lists: TodoList[], name?: string): TodoList | undefined {
  if (!name) return undefined;
  const norm = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();
  const n = norm(name);
  return lists.find((l) => norm(l.displayName) === n) ?? lists.find((l) => norm(l.displayName).startsWith(n));
}

// ---------------------------------------------------------------------------
// OneDrive

export interface DriveItem {
  id: string;
  name: string;
  size?: number;
  webUrl: string;
  lastModifiedDateTime?: string;
  createdDateTime?: string;
  parentReference?: { driveId?: string; id?: string; path?: string; name?: string };
  file?: { mimeType?: string };
  folder?: { childCount?: number };
  package?: { type?: string };
  lastModifiedBy?: { user?: { displayName?: string; email?: string } };
  createdBy?: { user?: { displayName?: string } };
  shared?: { scope?: string; owner?: { user?: { displayName?: string } } };
  /** Items shared with the user (recent files) carry the real item here. */
  remoteItem?: Omit<DriveItem, "remoteItem">;
}

export const DRIVE_FIELDS =
  "id,name,size,webUrl,lastModifiedDateTime,createdDateTime,parentReference,file,folder,package,lastModifiedBy,createdBy,shared,remoteItem";

/** OData strings double their single quotes; the whole call is then URL-encoded. */
export function searchPath(query: string, top = 30): string {
  const q = query.trim().replace(/'/g, "''");
  return `/me/drive/root/search(q='${encodeURIComponent(q)}')?$top=${top}&$select=${DRIVE_FIELDS}`;
}

/** A shared item's own fields, with the id/link of where it lives. */
export function flatten(item: DriveItem): DriveItem {
  const remote = item.remoteItem;
  if (!remote) return item;
  return {
    ...remote,
    ...item,
    remoteItem: undefined,
    parentReference: remote.parentReference ?? item.parentReference,
    size: item.size ?? remote.size,
    file: item.file ?? remote.file,
    folder: item.folder ?? remote.folder,
    shared: item.shared ?? remote.shared,
  };
}

/** "/drive/root:/Documents/Reports" → "Documents/Reports"; the root → "OneDrive". */
export function drivePath(item: DriveItem): string {
  const path = item.parentReference?.path;
  if (!path) {
    return item.parentReference?.name && item.parentReference.name !== "root" ? item.parentReference.name : "OneDrive";
  }
  const after = decodeURIComponent(path.replace(/^\/drives?\/[^/]*\/?root:?/, "").replace(/^\/drive\/root:?/, ""));
  return after.replace(/^\/+/, "") || "OneDrive";
}

export function formatSize(bytes?: number): string {
  if (bytes === undefined || bytes === null) return "—";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let n = bytes / 1024;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n < 10 ? n.toFixed(1) : Math.round(n)} ${units[i]}`;
}

export interface Kind {
  label: string;
  icon: string;
  tint?: Color;
}

/** A glyph and a word for a file, from its extension then its MIME type. */
export function fileKind(item: Pick<DriveItem, "name" | "file" | "folder" | "package">): Kind {
  if (item.folder || item.package?.type === "oneNote") {
    return item.package?.type === "oneNote"
      ? { label: "OneNote notebook", icon: Icons.book, tint: "purple" }
      : { label: "Folder", icon: Icons.folder, tint: "blue" };
  }
  const ext = item.name.includes(".") ? item.name.split(".").pop()!.toLowerCase() : "";
  const mime = item.file?.mimeType ?? "";
  const by: [RegExp, Kind][] = [
    [/^(docx?|odt|rtf|dotx?)$/, { label: "Word document", icon: Icons.text, tint: "blue" }],
    [/^(xlsx?|xlsm|ods|csv|tsv)$/, { label: "Spreadsheet", icon: Icons.chartUp, tint: "green" }],
    [/^(pptx?|odp|key)$/, { label: "Presentation", icon: Icons.layers, tint: "orange" }],
    [/^pdf$/, { label: "PDF", icon: Icons.file, tint: "red" }],
    [/^(one|onetoc2)$/, { label: "OneNote", icon: Icons.book, tint: "purple" }],
    [/^(png|jpe?g|gif|webp|heic|bmp|svg|tiff?)$/, { label: "Image", icon: Icons.image, tint: "purple" }],
    [/^(mp4|mov|mkv|avi|webm|m4v)$/, { label: "Video", icon: Icons.film, tint: "pink" }],
    [/^(mp3|wav|flac|m4a|ogg|aac)$/, { label: "Audio", icon: Icons.music, tint: "pink" }],
    [/^(zip|7z|rar|tar|gz|tgz|xz|bz2)$/, { label: "Archive", icon: Icons.archive, tint: "yellow" }],
    [/^(json|ya?ml|toml|xml)$/, { label: "Data", icon: Icons.braces, tint: "teal" }],
    [/^(ts|js|py|rs|go|java|c|cpp|h|sh|rb|php|cs|swift|kt|html|css)$/, {
      label: "Code",
      icon: Icons.code,
      tint: "teal",
    }],
    [/^(txt|md|log)$/, { label: "Text", icon: Icons.note }],
  ];
  for (const [re, kind] of by) if (re.test(ext)) return kind;
  if (mime.startsWith("image/")) return { label: "Image", icon: Icons.image, tint: "purple" };
  if (mime.startsWith("video/")) return { label: "Video", icon: Icons.film, tint: "pink" };
  if (mime.startsWith("audio/")) return { label: "Audio", icon: Icons.music, tint: "pink" };
  if (mime.startsWith("text/")) return { label: "Text", icon: Icons.note };
  return { label: ext ? `${ext.toUpperCase()} file` : "File", icon: Icons.file, tint: "gray" };
}

export function driveMetadata(item: DriveItem, now = new Date()): Metadata[] {
  const kind = fileKind(item);
  const lines: Metadata[] = [
    meta.text("Kind", kind.label, { icon: { source: kind.icon, tint: kind.tint } }),
    item.folder
      ? meta.text("Contains", plural(item.folder.childCount ?? 0, "item"))
      : meta.text("Size", formatSize(item.size)),
    meta.text("Location", drivePath(item), { icon: Icons.folder }),
  ];
  if (item.lastModifiedDateTime) {
    const at = new Date(item.lastModifiedDateTime);
    lines.push(meta.text("Modified", `${fullDate(at)} (${shortAgo(at, now)})`, { icon: Icons.clock }));
  }
  const by = item.lastModifiedBy?.user?.displayName;
  if (by) lines.push(meta.person("Modified by", by));
  const owner = item.shared?.owner?.user?.displayName;
  if (item.shared) {
    lines.push(
      meta.tags("Sharing", [{
        text: item.shared.scope === "anonymous" ? "Anyone with the link" : "Shared",
        color: "blue",
      }]),
    );
    if (owner) lines.push(meta.person("Owner", owner));
  }
  return lines;
}

// ---------------------------------------------------------------------------
// Calendar

export interface CalEvent {
  id: string;
  subject?: string;
  start: { dateTime: string; timeZone: string };
  end: { dateTime: string; timeZone: string };
  isAllDay?: boolean;
  isCancelled?: boolean;
  isOnlineMeeting?: boolean;
  onlineMeeting?: { joinUrl?: string } | null;
  onlineMeetingUrl?: string | null;
  onlineMeetingProvider?: string;
  location?: { displayName?: string };
  organizer?: { emailAddress?: { name?: string; address?: string } };
  attendees?: { emailAddress?: { name?: string; address?: string }; status?: { response?: string }; type?: string }[];
  responseStatus?: { response?: string };
  showAs?: "free" | "tentative" | "busy" | "oof" | "workingElsewhere" | "unknown";
  bodyPreview?: string;
  webLink?: string;
  categories?: string[];
}

export const EVENT_FIELDS =
  "id,subject,start,end,isAllDay,isCancelled,isOnlineMeeting,onlineMeeting,onlineMeetingUrl,onlineMeetingProvider,location,organizer,attendees,responseStatus,showAs,bodyPreview,webLink,categories";

/** The local day `offset` days from now, as the UTC instants Graph wants. */
export function dayRange(now = new Date(), offset = 0, days = 1): { start: string; end: string } {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset + days);
  return { start: start.toISOString(), end: end.toISOString() };
}

/** Graph answers in UTC by default, without a zone suffix. */
export function graphTime(t: { dateTime: string; timeZone?: string }): Date {
  const s = t.dateTime.replace(/(\.\d{3})\d*$/, "$1");
  return new Date(/Z|[+-]\d\d:\d\d$/.test(s) ? s : `${s}Z`);
}

/** All-day events span local calendar days: read the date only. */
export function allDayDate(t: { dateTime: string }): Date {
  const m = t.dateTime.match(/^(\d{4})-(\d{2})-(\d{2})/)!;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

const MEETING_LINKS: [RegExp, string][] = [
  [/https:\/\/teams\.microsoft\.com\/l\/meetup-join\/[^\s<>"')\]]+/i, "Microsoft Teams"],
  [/https:\/\/teams\.live\.com\/meet\/[^\s<>"')\]]+/i, "Microsoft Teams"],
  [/https:\/\/(?:[\w-]+\.)*zoom\.us\/(?:j|my|w|s)\/[^\s<>"')\]]+/i, "Zoom"],
  [/https:\/\/meet\.google\.com\/[a-z]{3}-[a-z]{4}-[a-z]{3}[^\s<>"')\]]*/i, "Google Meet"],
  [/https:\/\/[\w-]+\.webex\.com\/[^\s<>"')\]]+/i, "Webex"],
];

/** The meeting to join: Teams' own link, else one found in the location or the text. */
export function joinLink(e: CalEvent): { url: string; service: string } | undefined {
  const teams = e.onlineMeeting?.joinUrl || e.onlineMeetingUrl;
  if (teams) {
    const service = /zoom/i.test(e.onlineMeetingProvider ?? "") ? "Zoom" : "Microsoft Teams";
    return { url: teams, service };
  }
  for (const text of [e.location?.displayName ?? "", e.bodyPreview ?? ""]) {
    for (const [re, service] of MEETING_LINKS) {
      const m = text.match(re);
      if (m) return { url: m[0], service };
    }
  }
  return undefined;
}

export function eventSection(e: CalEvent, now = new Date()): "All Day" | "Now" | "Upcoming" | "Earlier" {
  if (e.isAllDay) return "All Day";
  const start = graphTime(e.start).getTime();
  const end = graphTime(e.end).getTime();
  if (start <= now.getTime() && now.getTime() < end) return "Now";
  return end <= now.getTime() ? "Earlier" : "Upcoming";
}

export function formatDuration(ms: number): string {
  const min = Math.round(ms / 60_000);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  return min % 60 ? `${h} h ${min % 60}` : `${h} h`;
}

/** "in 25 min", "in 2 h", "ends in 10 min", "ended". */
export function eventRelative(e: CalEvent, now = new Date()): string {
  if (e.isAllDay) return "all day";
  const start = graphTime(e.start).getTime();
  const end = graphTime(e.end).getTime();
  const t = now.getTime();
  if (t < start) return `in ${formatDuration(start - t)}`;
  if (t < end) return `ends in ${formatDuration(end - t)}`;
  return "ended";
}

export function eventTime(e: CalEvent): string {
  if (e.isAllDay) return "All day";
  return `${clock(graphTime(e.start))} – ${clock(graphTime(e.end))}`;
}

/** "Next: Standup at 10:00", "Weekly sync now", or a count. */
export function calendarSubtitle(events: CalEvent[], now = new Date()): string | null {
  const live = events.filter((e) => !e.isCancelled && !e.isAllDay);
  const current = live.find((e) => eventSection(e, now) === "Now");
  if (current) return `${current.subject || "Event"} now`;
  const next = live.find((e) => eventSection(e, now) === "Upcoming");
  if (next) return `Next: ${next.subject || "event"} at ${clock(graphTime(next.start))}`;
  return events.length ? plural(events.length, "event") : null;
}

export const RESPONSES: Record<string, { text: string; color?: Color }> = {
  accepted: { text: "Accepted", color: "green" },
  tentativelyAccepted: { text: "Tentative", color: "yellow" },
  declined: { text: "Declined", color: "red" },
  notResponded: { text: "Not answered", color: "gray" },
  organizer: { text: "Organizer", color: "blue" },
};

export function eventMarkdown(e: CalEvent): string {
  const lines = [`### ${mdEscape(e.subject || "(no title)")}`];
  if (e.isCancelled) lines.push("", "**Canceled**");
  const text = (e.bodyPreview ?? "")
    .replace(/_{5,}[\s\S]*$/, "") // Teams' join block
    .replace(/\r/g, "")
    .trim();
  if (text) lines.push("", mdEscape(text));
  return lines.join("\n");
}

export function eventMetadata(e: CalEvent): Metadata[] {
  const lines: Metadata[] = [meta.text("When", eventTime(e), { icon: Icons.clock })];
  if (!e.isAllDay) {
    lines.push(meta.text("Duration", formatDuration(graphTime(e.end).getTime() - graphTime(e.start).getTime())));
  }
  const place = e.location?.displayName?.trim();
  if (place && !/^https?:\/\//.test(place)) lines.push(meta.text("Location", place, { icon: Icons.pin }));
  const join = joinLink(e);
  if (join) lines.push(meta.link("Meeting", join.service, join.url));
  const organizer = e.organizer?.emailAddress?.name || e.organizer?.emailAddress?.address;
  if (organizer) lines.push(meta.person("Organizer", organizer));
  const people = (e.attendees ?? []).filter((a) => a.type !== "resource");
  if (people.length) {
    const yes = people.filter((a) => a.status?.response === "accepted").length;
    lines.push(meta.text("Attendees", `${people.length} invited · ${yes} accepted`, { icon: Icons.person }));
  }
  const response = RESPONSES[e.responseStatus?.response ?? ""];
  if (response) lines.push(meta.tags("Your answer", [response]));
  if (e.categories?.length) lines.push(meta.tags("Categories", e.categories));
  return lines;
}
