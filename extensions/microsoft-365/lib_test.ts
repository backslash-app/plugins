import { assertEquals, assertInstanceOf, assertMatch, assertThrows } from "@std/assert";
import {
  AuthError,
  calendarSubtitle,
  type CalEvent,
  dayDiff,
  dayRange,
  drivePath,
  dueBucket,
  dueOf,
  eventRelative,
  eventSection,
  fileKind,
  findList,
  flatten,
  formatSize,
  graphDue,
  graphError,
  graphTime,
  joinLink,
  mailSection,
  type Message,
  parseQuickAdd,
  provider,
  searchPath,
  senderOf,
  shortDue,
  sortLists,
  sortMail,
  sortTasks,
  taskNotes,
  type TodoTask,
  unreadPath,
} from "./lib.ts";

const ID = "1b2c3d4e-0000-4abc-8def-1234567890ab";

Deno.test("provider: the user's Entra app, common tenant, Graph scopes", () => {
  assertThrows(() => provider({}), AuthError, "Connect");
  assertThrows(() => provider({ clientId: "abc" }), AuthError, "GUID");
  assertThrows(() => provider({ clientId: ID, tenant: "a/b" }), AuthError, "tenant");
  const p = provider({ clientId: ` ${ID} ` });
  assertEquals(p.clientId, ID);
  assertEquals(p.authorizeUrl, "https://login.microsoftonline.com/common/oauth2/v2.0/authorize");
  assertEquals(p.tokenUrl, "https://login.microsoftonline.com/common/oauth2/v2.0/token");
  assertEquals(p.clientSecret, undefined);
  assertEquals(p.scopes?.includes("offline_access"), true);
  assertEquals(p.scopes?.includes("Mail.ReadWrite"), true);
  assertEquals(
    provider({ clientId: ID, tenant: "contoso.onmicrosoft.com" }).tokenUrl.split("/")[3],
    "contoso.onmicrosoft.com",
  );
});

Deno.test("graphError: sign-out, throttling, Graph's message", () => {
  assertInstanceOf(graphError(401, ""), AuthError);
  assertMatch(graphError(429, "", "12").message, /12 s/);
  assertEquals(
    graphError(400, JSON.stringify({ error: { code: "BadRequest", message: "Invalid filter clause" } })).message,
    "Microsoft Graph answered 400: Invalid filter clause",
  );
  assertMatch(
    graphError(404, JSON.stringify({ error: { code: "MailboxNotEnabledForRESTAPI", message: "x" } })).message,
    /mailbox/,
  );
});

const mail = (id: string, at: string, cls: "focused" | "other", extra: Partial<Message> = {}): Message => ({
  id,
  subject: id,
  receivedDateTime: at,
  inferenceClassification: cls,
  from: { emailAddress: { name: "Ada Lovelace", address: "ada@example.com" } },
  ...extra,
});

Deno.test("mail: unread query puts the orderby property first in the filter", () => {
  const q = new URL(`https://x${unreadPath(10)}`).searchParams;
  assertEquals(q.get("$filter"), "receivedDateTime ge 1900-01-01T00:00:00Z and isRead eq false");
  assertEquals(q.get("$orderby"), "receivedDateTime desc");
  assertEquals(q.get("$top"), "10");
});

Deno.test("mail: Focused first, each newest first", () => {
  const sorted = sortMail([
    mail("o-new", "2026-10-28T10:00:00Z", "other"),
    mail("f-old", "2026-10-27T10:00:00Z", "focused"),
    mail("f-new", "2026-10-28T09:00:00Z", "focused"),
  ]);
  assertEquals(sorted.map((m) => m.id), ["f-new", "f-old", "o-new"]);
  assertEquals(mailSection(sorted[2]), "Other");
  assertEquals(senderOf(sorted[0]), { name: "Ada Lovelace", address: "ada@example.com" });
  assertEquals(senderOf({ ...sorted[0], from: undefined }).name, "Unknown sender");
});

const NOW = new Date(2026, 9, 28, 9, 30); // Wednesday 28 October 2026

const task = (id: string, due?: string, extra: Partial<TodoTask> = {}): TodoTask => ({
  id,
  title: id,
  status: "notStarted",
  importance: "normal",
  dueDateTime: due ? { dateTime: `${due}T00:00:00.0000000`, timeZone: "UTC" } : null,
  ...extra,
});

Deno.test("to do: due dates are calendar days, whatever the zone", () => {
  assertEquals(dueOf(task("a", "2026-10-28")), new Date(2026, 9, 28));
  assertEquals(dueOf(task("a")), undefined);
  assertEquals(graphDue(new Date(2026, 0, 5)), { dateTime: "2026-01-05T00:00:00", timeZone: "UTC" });
  assertEquals(dueBucket(new Date(2026, 9, 27), NOW), "Overdue");
  assertEquals(dueBucket(new Date(2026, 9, 28), NOW), "Today");
  assertEquals(dueBucket(new Date(2026, 9, 29), NOW), "Tomorrow");
  assertEquals(dueBucket(new Date(2026, 10, 2), NOW), "This Week");
  assertEquals(dueBucket(new Date(2026, 10, 20), NOW), "Later");
  assertEquals(dueBucket(undefined, NOW), "No Due Date");
  assertEquals(shortDue(new Date(2026, 9, 30), NOW), "Fri");
  assertEquals(shortDue(new Date(2026, 9, 25), NOW), "3 days ago");
  assertEquals(shortDue(new Date(2027, 0, 3), NOW), "3 Jan 2027");
});

Deno.test("to do: sorted by due date, important first, undated last", () => {
  const sorted = sortTasks([
    task("undated"),
    task("later", "2026-11-03"),
    task("today", "2026-10-28"),
    task("today-high", "2026-10-28", { importance: "high" }),
  ]);
  assertEquals(sorted.map((t) => t.id), ["today-high", "today", "later", "undated"]);
});

Deno.test("to do: lists, default first and flagged email last", () => {
  const lists = sortLists([
    { id: "f", displayName: "Flagged email", wellknownListName: "flaggedEmails" },
    { id: "w", displayName: "Work" },
    { id: "t", displayName: "Tasks", wellknownListName: "defaultList" },
    { id: "c", displayName: "Courses" },
  ]);
  assertEquals(lists.map((l) => l.id), ["t", "c", "w", "f"]);
  assertEquals(findList(lists, "work")?.id, "w");
  assertEquals(findList(lists, "cour")?.id, "c");
  assertEquals(findList(lists, "nope"), undefined);
});

Deno.test("to do: HTML notes from Outlook become text", () => {
  assertEquals(
    taskNotes(task("a", undefined, {
      body: { contentType: "html", content: "<html><body><p>Bring the &amp; slides</p><p>Room 4</p></body></html>" },
    })),
    "Bring the & slides\nRoom 4",
  );
  assertEquals(taskNotes(task("a", undefined, { body: { contentType: "text", content: " plain " } })), "plain");
});

Deno.test("quick add: dates, importance and list", () => {
  const q = parseQuickAdd("Call Bob tomorrow !high #Work", NOW);
  assertEquals(q, { title: "Call Bob", due: new Date(2026, 9, 29), importance: "high", list: "Work" });
  assertEquals(parseQuickAdd("Rapport demain", NOW).due, new Date(2026, 9, 29));
  assertEquals(parseQuickAdd("Pay rent friday", NOW), { title: "Pay rent", due: new Date(2026, 9, 30) });
  assertEquals(parseQuickAdd("Standup wednesday", NOW).due, new Date(2026, 10, 4)); // the next one, not today
  assertEquals(parseQuickAdd("Review in 3 days", NOW).due, new Date(2026, 9, 31));
  assertEquals(parseQuickAdd("Taxes 2026-11-15 !", NOW), {
    title: "Taxes",
    due: new Date(2026, 10, 15),
    importance: "high",
  });
  assertEquals(parseQuickAdd("Birthday 2/1", NOW).due, new Date(2027, 0, 2));
  assertEquals(parseQuickAdd('Plan next week #"Side projects"', NOW), {
    title: "Plan",
    due: new Date(2026, 10, 2),
    list: "Side projects",
  });
  assertEquals(parseQuickAdd("Read about sunday markets", NOW).title, "Read about markets");
  assertEquals(parseQuickAdd("Buy milk", NOW), { title: "Buy milk" });
});

Deno.test("onedrive: search path escapes quotes, paths and sizes read well", () => {
  assertEquals(searchPath("Bob's plan").split("?")[0], "/me/drive/root/search(q='Bob''s%20plan')");
  assertEquals(
    drivePath({ id: "1", name: "a", webUrl: "", parentReference: { path: "/drive/root:/Documents/Q3%20Reports" } }),
    "Documents/Q3 Reports",
  );
  assertEquals(drivePath({ id: "1", name: "a", webUrl: "", parentReference: { path: "/drive/root:" } }), "OneDrive");
  assertEquals(
    drivePath({ id: "1", name: "a", webUrl: "", parentReference: { path: "/drives/b!x/root:/Shared" } }),
    "Shared",
  );
  assertEquals(drivePath({ id: "1", name: "a", webUrl: "" }), "OneDrive");
  assertEquals(formatSize(undefined), "—");
  assertEquals(formatSize(512), "512 B");
  assertEquals(formatSize(1536), "1.5 KB");
  assertEquals(formatSize(250 * 1024 * 1024), "250 MB");
});

Deno.test("onedrive: kinds by extension, MIME type, folder", () => {
  assertEquals(fileKind({ name: "Budget.xlsx", file: {} }).label, "Spreadsheet");
  assertEquals(fileKind({ name: "Deck.PPTX", file: {} }).label, "Presentation");
  assertEquals(fileKind({ name: "scan", file: { mimeType: "image/jpeg" } }).label, "Image");
  assertEquals(fileKind({ name: "Docs", folder: {} }).label, "Folder");
  assertEquals(fileKind({ name: "Notes", package: { type: "oneNote" } }).label, "OneNote notebook");
  assertEquals(fileKind({ name: "data.bin", file: {} }).label, "BIN file");
});

Deno.test("onedrive: shared recent items use the remote item's details", () => {
  const item = flatten({
    id: "local",
    name: "Plan.docx",
    webUrl: "https://contoso-my.sharepoint.com/plan",
    remoteItem: {
      id: "remote",
      name: "Plan.docx",
      webUrl: "https://contoso-my.sharepoint.com/plan",
      size: 2048,
      file: { mimeType: "application/msword" },
      parentReference: { path: "/drives/b!1/root:/Team" },
      shared: { owner: { user: { displayName: "Grace Hopper" } } },
    },
  });
  assertEquals([item.id, item.size, drivePath(item), item.shared?.owner?.user?.displayName], [
    "local",
    2048,
    "Team",
    "Grace Hopper",
  ]);
});

const event = (subject: string, start: string, end: string, extra: Partial<CalEvent> = {}): CalEvent => ({
  id: subject,
  subject,
  start: { dateTime: start, timeZone: "UTC" },
  end: { dateTime: end, timeZone: "UTC" },
  ...extra,
});

Deno.test("calendar: UTC times without a suffix, the local day's range", () => {
  assertEquals(graphTime({ dateTime: "2026-10-28T09:00:00.0000000" }).toISOString(), "2026-10-28T09:00:00.000Z");
  const { start, end } = dayRange(NOW);
  assertEquals(new Date(start).getTime(), new Date(2026, 9, 28).getTime());
  assertEquals(dayDiff(new Date(start), new Date(end)), -1);
});

Deno.test("calendar: sections, relative times and the subtitle", () => {
  const now = new Date("2026-10-28T10:15:00Z");
  const standup = event("Standup", "2026-10-28T10:00:00.0000000", "2026-10-28T10:30:00.0000000");
  const review = event("Design review", "2026-10-28T13:00:00.0000000", "2026-10-28T14:00:00.0000000");
  const early = event("Breakfast", "2026-10-28T07:00:00.0000000", "2026-10-28T08:00:00.0000000");
  assertEquals(eventSection(standup, now), "Now");
  assertEquals(eventSection(review, now), "Upcoming");
  assertEquals(eventSection(early, now), "Earlier");
  assertEquals(eventSection({ ...review, isAllDay: true }, now), "All Day");
  assertEquals(eventRelative(standup, now), "ends in 15 min");
  assertEquals(eventRelative(review, now), "in 2 h 45");
  assertEquals(calendarSubtitle([early, standup, review], now), "Standup now");
  assertMatch(calendarSubtitle([early, review], now)!, /^Next: Design review at /);
  assertEquals(calendarSubtitle([], now), null);
});

Deno.test("calendar: Teams' join link first, else one in the location or the text", () => {
  const base = event("Sync", "2026-10-28T10:00:00", "2026-10-28T10:30:00");
  assertEquals(
    joinLink({ ...base, onlineMeeting: { joinUrl: "https://teams.microsoft.com/l/meetup-join/19%3ameeting_x" } }),
    { url: "https://teams.microsoft.com/l/meetup-join/19%3ameeting_x", service: "Microsoft Teams" },
  );
  assertEquals(
    joinLink({ ...base, location: { displayName: "https://us02web.zoom.us/j/123456789?pwd=abc" } })?.service,
    "Zoom",
  );
  assertEquals(
    joinLink({ ...base, bodyPreview: "Join: https://meet.google.com/abc-defg-hij" })?.url,
    "https://meet.google.com/abc-defg-hij",
  );
  assertEquals(joinLink({ ...base, location: { displayName: "Room 4" } }), undefined);
});
