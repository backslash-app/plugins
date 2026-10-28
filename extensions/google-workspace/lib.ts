// Google Drive and Tasks: the sign-in, response types and pure logic.

import { type Color, Icons, meta, type Metadata, type OAuthProvider } from "@backslash/api";

export const DRIVE = "https://www.googleapis.com/drive/v3";
export const TASKS = "https://tasks.googleapis.com/tasks/v1";
export const CONSOLE_URL = "https://console.cloud.google.com/apis/credentials";
export const ENABLE_URL =
  "https://console.cloud.google.com/flows/enableapi?apiid=drive.googleapis.com,tasks.googleapis.com";
export const CONSENT_URL = "https://console.cloud.google.com/auth/audience";
export const SCOPES = ["https://www.googleapis.com/auth/drive.readonly", "https://www.googleapis.com/auth/tasks"];

/** The OAuth client isn't set up, or Google refused the token: lists show how to connect. */
export class AuthError extends Error {}

/**
 * The user's own "Desktop app" OAuth client. Google wants its secret even
 * with PKCE; for installed apps it isn't confidential (Google says so too).
 * Desktop clients accept any loopback port and path, so nothing is registered.
 */
export function provider(prefs: Record<string, unknown>): OAuthProvider {
  const clientId = String(prefs.clientId ?? "").trim();
  const clientSecret = String(prefs.clientSecret ?? "").trim();
  if (!clientId) throw new AuthError("Connect your Google account");
  if (!clientId.endsWith(".apps.googleusercontent.com")) {
    throw new AuthError("The client ID ends with .apps.googleusercontent.com: check the preference");
  }
  if (!clientSecret) throw new AuthError("Add the client secret of your Google OAuth client");
  return {
    id: "google",
    title: "Google Drive & Tasks",
    authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    clientId,
    clientSecret,
    scopes: SCOPES,
    // A refresh token every time, so the sign-in lasts.
    params: { access_type: "offline", prompt: "consent" },
  };
}

/** Google's error body: `{ error: { code, message, errors: [{ reason }] } }`. */
export function googleError(status: number, text: string): Error {
  let message = "";
  let reason = "";
  try {
    const body = JSON.parse(text);
    message = body?.error?.message ?? body?.error_description ?? "";
    reason = body?.error?.errors?.[0]?.reason ?? body?.error?.status ?? "";
  } catch {
    message = text.slice(0, 160);
  }
  if (status === 401) return new AuthError("Google signed you out");
  if (
    status === 403 && /accessNotConfigured|SERVICE_DISABLED|has not been used|is disabled/i.test(`${reason} ${message}`)
  ) {
    const api = /tasks/i.test(message) ? "Google Tasks API" : /drive/i.test(message) ? "Google Drive API" : "API";
    return new Error(`Enable the ${api} in your Google Cloud project, then try again`);
  }
  if (status === 403 && /insufficient/i.test(`${reason} ${message}`)) {
    return new AuthError("Sign in again to allow Drive and Tasks access");
  }
  if (status === 403 && /rateLimit|userRateLimit/i.test(reason) || status === 429) {
    return new Error("Google is rate limiting: try again in a minute");
  }
  if (status === 404) return new Error("Not found: it may have been moved or deleted");
  return new Error(`Google answered ${status}${message ? `: ${message}` : ""}`);
}

// ---------------------------------------------------------------------------
// Shared formatting

export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

/** Whole days from `now`'s day to `date`'s day (negative in the past). */
export function dayDiff(date: Date, now = new Date()): number {
  return Math.round((startOfDay(date).getTime() - startOfDay(now).getTime()) / 86_400_000);
}

/** "now", "5 min", "3 h", "yesterday", "Mon", "12 Oct", "12 Oct 2024". */
export function shortAgo(date: Date, now = new Date()): string {
  const s = (now.getTime() - date.getTime()) / 1000;
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)} min`;
  const d = dayDiff(date, now);
  if (d === 0) return `${Math.floor(s / 3600)} h`;
  if (d === -1) return "yesterday";
  if (d > -7) return date.toLocaleDateString("en-GB", { weekday: "short" });
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

export function mdEscape(text: string): string {
  return text.replace(/([\\`*_[\]#<>|])/g, "\\$1");
}

// ---------------------------------------------------------------------------
// Drive

export interface User {
  displayName?: string;
  emailAddress?: string;
  photoLink?: string;
  me?: boolean;
}

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime?: string;
  viewedByMeTime?: string;
  sharedWithMeTime?: string;
  size?: string;
  shared?: boolean;
  starred?: boolean;
  ownedByMe?: boolean;
  webViewLink?: string;
  parents?: string[];
  owners?: User[];
  lastModifyingUser?: User;
  sharingUser?: User;
  driveId?: string;
  shortcutDetails?: { targetId?: string; targetMimeType?: string };
}

export const FILE_FIELDS =
  "id,name,mimeType,modifiedTime,viewedByMeTime,sharedWithMeTime,size,shared,starred,ownedByMe,webViewLink,parents,owners(displayName,emailAddress,photoLink,me),lastModifyingUser(displayName,photoLink,me),sharingUser(displayName,photoLink),driveId,shortcutDetails";

export const FOLDER = "application/vnd.google-apps.folder";

export type DriveView = "recent" | "starred" | "shared";

/** A string inside a Drive query: backslashes and single quotes escaped. */
export const quote = (s: string) => `'${s.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;

/**
 * The `files.list` parameters for a view and a query. Drive refuses
 * `orderBy` with `fullText` searches, so typed searches come by relevance.
 */
export function driveQuery(view: DriveView, query: string, folder?: string): Record<string, string> {
  const terms = ["trashed = false"];
  const q = query.trim();
  if (folder) terms.push(`${quote(folder)} in parents`);
  else if (view === "starred") terms.push("starred = true");
  else if (view === "shared") terms.push("sharedWithMe = true");
  if (q) terms.push(`(name contains ${quote(q)} or fullText contains ${quote(q)})`);
  const params: Record<string, string> = {
    q: terms.join(" and "),
    pageSize: folder ? "200" : "40",
    fields: `files(${FILE_FIELDS})`,
    supportsAllDrives: "true",
    includeItemsFromAllDrives: "true",
    spaces: "drive",
  };
  if (!q) {
    params.orderBy = folder
      ? "folder,name_natural"
      : view === "recent"
      ? "viewedByMeTime desc"
      : view === "shared"
      ? "sharedWithMeTime desc"
      : "modifiedTime desc";
  }
  return params;
}

export interface Kind {
  label: string;
  icon: string;
  tint?: Color;
}

const GOOGLE_KINDS: Record<string, Kind> = {
  [FOLDER]: { label: "Folder", icon: Icons.folder, tint: "gray" },
  "application/vnd.google-apps.document": { label: "Google Docs", icon: Icons.text, tint: "blue" },
  "application/vnd.google-apps.spreadsheet": { label: "Google Sheets", icon: Icons.chartUp, tint: "green" },
  "application/vnd.google-apps.presentation": { label: "Google Slides", icon: Icons.layers, tint: "yellow" },
  "application/vnd.google-apps.form": { label: "Google Forms", icon: Icons.squareCheck, tint: "purple" },
  "application/vnd.google-apps.drawing": { label: "Google Drawings", icon: Icons.palette, tint: "red" },
  "application/vnd.google-apps.site": { label: "Google Sites", icon: Icons.globe, tint: "purple" },
  "application/vnd.google-apps.script": { label: "Apps Script", icon: Icons.code, tint: "blue" },
  "application/vnd.google-apps.map": { label: "My Maps", icon: Icons.pin, tint: "red" },
  "application/vnd.google-apps.jam": { label: "Jamboard", icon: Icons.palette, tint: "orange" },
  "application/vnd.google-apps.shortcut": { label: "Shortcut", icon: Icons.link, tint: "gray" },
  "application/pdf": { label: "PDF", icon: Icons.file, tint: "red" },
};

/** A glyph and a word for a MIME type. */
export function fileKind(mime: string): Kind {
  if (GOOGLE_KINDS[mime]) return GOOGLE_KINDS[mime];
  if (mime.startsWith("image/")) return { label: "Image", icon: Icons.image, tint: "red" };
  if (mime.startsWith("video/")) return { label: "Video", icon: Icons.film, tint: "red" };
  if (mime.startsWith("audio/")) return { label: "Audio", icon: Icons.music, tint: "pink" };
  if (/zip|compressed|x-tar|x-7z|x-rar|gzip/.test(mime)) return { label: "Archive", icon: Icons.archive, tint: "gray" };
  if (/wordprocessingml|msword|opendocument\.text|rtf/.test(mime)) {
    return { label: "Word document", icon: Icons.text, tint: "blue" };
  }
  if (/spreadsheetml|ms-excel|opendocument\.spreadsheet|text\/csv/.test(mime)) {
    return { label: "Spreadsheet", icon: Icons.chartUp, tint: "green" };
  }
  if (/presentationml|ms-powerpoint|opendocument\.presentation/.test(mime)) {
    return { label: "Presentation", icon: Icons.layers, tint: "orange" };
  }
  if (/json|xml|yaml|toml/.test(mime)) return { label: "Data", icon: Icons.braces, tint: "teal" };
  if (/javascript|typescript|x-python|x-sh|x-c|x-java/.test(mime)) {
    return { label: "Code", icon: Icons.code, tint: "teal" };
  }
  if (mime.startsWith("text/")) return { label: "Text", icon: Icons.note };
  const short = mime.split("/").pop()?.replace(/^x-/, "") ?? "";
  return { label: short ? `${short.toUpperCase()} file` : "File", icon: Icons.file, tint: "gray" };
}

export function formatSize(bytes?: string | number): string {
  if (bytes === undefined || bytes === null || bytes === "") return "—";
  const n0 = Number(bytes);
  if (!Number.isFinite(n0)) return "—";
  if (n0 < 1024) return `${n0} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let n = n0 / 1024;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n < 10 ? n.toFixed(1) : Math.round(n)} ${units[i]}`;
}

/** Where to open a file: its own link, else Drive's generic one. */
export function fileUrl(f: DriveFile): string {
  if (f.webViewLink) return f.webViewLink;
  return f.mimeType === FOLDER
    ? `https://drive.google.com/drive/folders/${f.id}`
    : `https://drive.google.com/file/d/${f.id}/view`;
}

export const folderUrl = (id: string) => `https://drive.google.com/drive/folders/${id}`;

export const ownerOf = (f: DriveFile): User | undefined => f.owners?.[0];

/** "me", the owner's name, or the shared drive. */
export function ownerName(f: DriveFile): string {
  const o = ownerOf(f);
  if (!o) return f.driveId ? "Shared drive" : "";
  return o.me ? "me" : o.displayName || o.emailAddress || "";
}

/** Google profile pictures, when Drive gives one; else the name (initials). */
export function avatarOf(u?: User): string | undefined {
  if (!u) return undefined;
  if (u.photoLink && /^https:\/\/lh3\.googleusercontent\.com\//.test(u.photoLink)) return u.photoLink;
  return u.displayName || u.emailAddress;
}

export function driveMetadata(f: DriveFile, now = new Date()): Metadata[] {
  const kind = fileKind(f.mimeType);
  const lines: Metadata[] = [
    meta.text("Kind", kind.label, { icon: { source: kind.icon, tint: kind.tint } }),
  ];
  if (f.mimeType !== FOLDER) lines.push(meta.text("Size", formatSize(f.size)));
  const owner = ownerOf(f);
  if (owner) {
    const name = owner.me ? "me" : owner.displayName || owner.emailAddress || "";
    lines.push(meta.person("Owner", name, avatarOf(owner)));
  } else if (f.driveId) lines.push(meta.text("Owner", "Shared drive", { icon: Icons.drive }));
  if (f.modifiedTime) {
    const at = new Date(f.modifiedTime);
    lines.push(meta.text("Modified", `${fullDate(at)} (${shortAgo(at, now)})`, { icon: Icons.clock }));
  }
  if (f.lastModifyingUser?.displayName) {
    lines.push(meta.person(
      "Modified by",
      f.lastModifyingUser.me ? "me" : f.lastModifyingUser.displayName,
      avatarOf(f.lastModifyingUser),
    ));
  }
  if (f.viewedByMeTime) lines.push(meta.text("Opened by me", shortAgo(new Date(f.viewedByMeTime), now)));
  if (f.sharingUser?.displayName && !f.ownedByMe) {
    lines.push(meta.person("Shared by", f.sharingUser.displayName, avatarOf(f.sharingUser)));
  }
  const tags: { text: string; color?: Color }[] = [];
  if (f.starred) tags.push({ text: "Starred", color: "yellow" });
  if (f.shared) tags.push({ text: "Shared", color: "blue" });
  if (!f.ownedByMe && f.sharedWithMeTime) tags.push({ text: "Shared with me", color: "purple" });
  if (tags.length) lines.push(meta.separator(), meta.tags("Labels", tags));
  return lines;
}

// ---------------------------------------------------------------------------
// Tasks

export interface TaskList {
  id: string;
  title: string;
  updated?: string;
}

export interface Task {
  id: string;
  title: string;
  notes?: string;
  status: "needsAction" | "completed";
  /** RFC 3339, but only the date is kept by Google ("2026-10-28T00:00:00.000Z"). */
  due?: string;
  parent?: string;
  position?: string;
  updated?: string;
  webViewLink?: string;
  links?: { type?: string; description?: string; link: string }[];
  /** Set by us: the list the task came from. */
  listId?: string;
}

/** The due *date*: read the calendar day from the string, never through a time zone. */
export function dueOf(task: Pick<Task, "due">): Date | undefined {
  const m = task.due?.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : undefined;
}

/** A due date as Google Tasks writes it (midnight UTC of that day). */
export function googleDue(date: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}T00:00:00.000Z`;
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

/** By due date (undated last), then in the list's own order. */
export function sortTasks(tasks: Task[]): Task[] {
  return [...tasks].sort((a, b) => {
    const da = dueOf(a)?.getTime() ?? Infinity;
    const db = dueOf(b)?.getTime() ?? Infinity;
    return da - db || (a.position ?? "").localeCompare(b.position ?? "");
  });
}

/** Subtasks after their parent, so the indentation reads right. */
export function withSubtasks(tasks: Task[]): { task: Task; depth: number }[] {
  const ids = new Set(tasks.map((t) => t.id));
  const top = tasks.filter((t) => !t.parent || !ids.has(t.parent));
  const out: { task: Task; depth: number }[] = [];
  for (const t of top) {
    out.push({ task: t, depth: 0 });
    for (const c of tasks.filter((c) => c.parent === t.id)) out.push({ task: c, depth: 1 });
  }
  return out;
}

export function taskMarkdown(task: Task): string {
  const lines = [`### ${mdEscape(task.title || "Untitled")}`];
  if (task.notes?.trim()) lines.push("", mdEscape(task.notes.trim()));
  const links = (task.links ?? []).filter((l) => l.link);
  if (links.length) {
    lines.push("", ...links.map((l) => `- [${mdEscape(l.description || l.type || "Link")}](${l.link})`));
  }
  return lines.join("\n");
}

export function taskMetadata(task: Task, list: TaskList | undefined, parent?: Task, now = new Date()): Metadata[] {
  const due = dueOf(task);
  const lines: Metadata[] = [
    meta.text("List", list?.title ?? "My Tasks", { icon: Icons.inbox }),
    meta.text(
      "Due",
      due
        ? `${due.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })} (${
          shortDue(due, now)
        })`
        : "No due date",
      { icon: Icons.calendar, color: dueBucket(due, now) === "Overdue" ? "red" : undefined },
    ),
  ];
  if (parent) lines.push(meta.text("Subtask of", parent.title, { icon: Icons.chevronRight }));
  if (task.updated) {
    lines.push(meta.separator(), meta.text("Updated", fullDate(new Date(task.updated)), { icon: Icons.clock }));
  }
  return lines;
}

export const TASKS_URL = "https://tasks.google.com/";

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
  list?: string;
}

/**
 * "Send invoice friday #Work" → title, due date, list name. Dates: today,
 * tomorrow, a weekday (the next one), "next week", "in 3 days", 2026-11-02,
 * 2/11 (day/month), and their French words.
 */
export function parseQuickAdd(text: string, now = new Date()): QuickAdd {
  let rest = ` ${text.trim()} `;
  const out: QuickAdd = { title: "" };
  const take = (re: RegExp, fn: (m: RegExpMatchArray) => boolean | void) => {
    const m = rest.match(re);
    if (m && fn(m) !== false) rest = rest.replace(m[0], " ");
  };
  const day = (offset: number) => new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);

  take(/\s#("[^"]+"|\S+)/, (m) => void (out.list = m[1].replace(/^"|"$/g, "")));
  take(/\s(today|aujourd'hui)(?=\s)/i, () => void (out.due = day(0)));
  if (!out.due) take(/\s(tomorrow|demain)(?=\s)/i, () => void (out.due = day(1)));
  if (!out.due) take(/\s(?:after tomorrow|après-demain)(?=\s)/i, () => void (out.due = day(2)));
  if (!out.due) {
    take(/\s(?:next week|la semaine prochaine|semaine prochaine)(?=\s)/i, () => {
      out.due = day((8 - now.getDay()) % 7 || 7);
    });
  }
  if (!out.due) {
    take(/\s(?:in|dans) (\d{1,3}) (days?|jours?|weeks?|semaines?)(?=\s)/i, (m) => {
      out.due = day(Number(m[1]) * (/^(w|s)/i.test(m[2]) ? 7 : 1));
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
      out.due = day((WEEKDAYS[m[1].toLowerCase()] - now.getDay() + 7) % 7 || 7);
    });
  }
  out.title = rest.replace(/\s+/g, " ").trim();
  return out;
}

/** The list a quick add names, by exact then prefix match, ignoring case and accents. */
export function findList(lists: TaskList[], name?: string): TaskList | undefined {
  if (!name) return undefined;
  const norm = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();
  const n = norm(name);
  return lists.find((l) => norm(l.title) === n) ?? lists.find((l) => norm(l.title).startsWith(n));
}
