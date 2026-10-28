import { assertEquals, assertInstanceOf, assertMatch, assertThrows } from "@std/assert";
import {
  AuthError,
  avatarOf,
  type DriveFile,
  driveMetadata,
  driveQuery,
  dueBucket,
  dueOf,
  fileKind,
  fileUrl,
  findList,
  formatSize,
  googleDue,
  googleError,
  ownerName,
  parseQuickAdd,
  provider,
  quote,
  shortAgo,
  sortTasks,
  type Task,
  withSubtasks,
} from "./lib.ts";

const CLIENT = "1234-abc.apps.googleusercontent.com";

Deno.test("provider: the user's Desktop client, its secret, offline access", () => {
  assertThrows(() => provider({}), AuthError, "Connect");
  assertThrows(() => provider({ clientId: "abc" }), AuthError, "apps.googleusercontent.com");
  assertThrows(() => provider({ clientId: CLIENT }), AuthError, "client secret");
  const p = provider({ clientId: ` ${CLIENT} `, clientSecret: " GOCSPX-x " });
  assertEquals([p.clientId, p.clientSecret], [CLIENT, "GOCSPX-x"]);
  assertEquals(p.tokenUrl, "https://oauth2.googleapis.com/token");
  assertEquals(p.scopes, ["https://www.googleapis.com/auth/drive.readonly", "https://www.googleapis.com/auth/tasks"]);
  assertEquals(p.params?.access_type, "offline");
  assertEquals(p.redirectPort, undefined);
});

Deno.test("googleError: sign-out, disabled API, rate limits", () => {
  assertInstanceOf(googleError(401, ""), AuthError);
  const disabled = JSON.stringify({
    error: {
      code: 403,
      message:
        "Google Tasks API has not been used in project 123 before or it is disabled. Enable it by visiting https://console.developers.google.com/apis/api/tasks.googleapis.com/overview?project=123",
      errors: [{ reason: "accessNotConfigured" }],
      status: "PERMISSION_DENIED",
    },
  });
  assertEquals(
    googleError(403, disabled).message,
    "Enable the Google Tasks API in your Google Cloud project, then try again",
  );
  const scopes = JSON.stringify({
    error: {
      code: 403,
      message: "Request had insufficient authentication scopes.",
      errors: [{ reason: "insufficientPermissions" }],
    },
  });
  assertInstanceOf(googleError(403, scopes), AuthError);
  assertMatch(
    googleError(403, JSON.stringify({ error: { errors: [{ reason: "userRateLimitExceeded" }] } })).message,
    /rate/,
  );
  assertEquals(
    googleError(400, JSON.stringify({ error: { message: "Invalid Value" } })).message,
    "Google answered 400: Invalid Value",
  );
});

Deno.test("drive: queries per view, escaped search, no orderBy with full text", () => {
  assertEquals(quote("Bob's \\ plan"), "'Bob\\'s \\\\ plan'");
  const recent = driveQuery("recent", "");
  assertEquals(recent.q, "trashed = false");
  assertEquals(recent.orderBy, "viewedByMeTime desc");
  assertEquals(driveQuery("starred", "").q, "trashed = false and starred = true");
  assertEquals(driveQuery("shared", "").orderBy, "sharedWithMeTime desc");
  const search = driveQuery("shared", "budget");
  assertEquals(
    search.q,
    "trashed = false and sharedWithMe = true and (name contains 'budget' or fullText contains 'budget')",
  );
  assertEquals(search.orderBy, undefined);
  const folder = driveQuery("starred", "", "F1");
  assertEquals([folder.q, folder.orderBy], ["trashed = false and 'F1' in parents", "folder,name_natural"]);
  assertMatch(recent.fields, /^files\(.*owners\(displayName,emailAddress,photoLink,me\)/);
});

Deno.test("drive: kinds, sizes and links", () => {
  assertEquals(fileKind("application/vnd.google-apps.spreadsheet").label, "Google Sheets");
  assertEquals(
    fileKind("application/vnd.openxmlformats-officedocument.wordprocessingml.document").label,
    "Word document",
  );
  assertEquals(fileKind("image/png").label, "Image");
  assertEquals(fileKind("application/x-zip-compressed").label, "Archive");
  assertEquals(fileKind("application/octet-stream").label, "OCTET-STREAM file");
  assertEquals(formatSize(undefined), "—");
  assertEquals(formatSize("2048"), "2.0 KB");
  assertEquals(formatSize("5368709120"), "5.0 GB");
  assertEquals(
    fileUrl({ id: "x", name: "a", mimeType: "application/vnd.google-apps.folder" }),
    "https://drive.google.com/drive/folders/x",
  );
  assertEquals(
    fileUrl({
      id: "x",
      name: "a",
      mimeType: "image/png",
      webViewLink: "https://drive.google.com/file/d/x/view?usp=drivesdk",
    }),
    "https://drive.google.com/file/d/x/view?usp=drivesdk",
  );
});

const file: DriveFile = {
  id: "1",
  name: "Roadmap",
  mimeType: "application/vnd.google-apps.document",
  modifiedTime: "2026-10-28T08:00:00Z",
  shared: true,
  starred: true,
  ownedByMe: false,
  sharedWithMeTime: "2026-10-20T08:00:00Z",
  owners: [{
    displayName: "Grace Hopper",
    emailAddress: "grace@example.com",
    photoLink: "https://lh3.googleusercontent.com/a/abc=s64",
  }],
};

Deno.test("drive: owners, avatars from Google's photo host only", () => {
  assertEquals(ownerName(file), "Grace Hopper");
  assertEquals(ownerName({ ...file, owners: [{ me: true, displayName: "Me" }] }), "me");
  assertEquals(ownerName({ ...file, owners: undefined, driveId: "0A" }), "Shared drive");
  assertEquals(avatarOf(file.owners![0]), "https://lh3.googleusercontent.com/a/abc=s64");
  assertEquals(avatarOf({ displayName: "Ada", photoLink: "https://evil.example/x.png" }), "Ada");
  const lines = driveMetadata(file, new Date("2026-10-28T10:00:00Z"));
  assertEquals(lines.find((l) => l.label === "Owner")?.avatar, "https://lh3.googleusercontent.com/a/abc=s64");
  assertEquals(lines.find((l) => l.label === "Labels")?.tags?.map((t) => t.text), [
    "Starred",
    "Shared",
    "Shared with me",
  ]);
  assertEquals(lines.some((l) => l.label === "Size"), true);
});

Deno.test("shortAgo", () => {
  const now = new Date(2026, 9, 28, 12, 0);
  assertEquals(shortAgo(new Date(2026, 9, 28, 11, 59, 30), now), "now");
  assertEquals(shortAgo(new Date(2026, 9, 28, 11, 15), now), "45 min");
  assertEquals(shortAgo(new Date(2026, 9, 28, 8, 0), now), "4 h");
  assertEquals(shortAgo(new Date(2026, 9, 27, 8, 0), now), "yesterday");
  assertEquals(shortAgo(new Date(2025, 0, 2), now), "2 Jan 2025");
});

const NOW = new Date(2026, 9, 28, 9, 30); // Wednesday

const task = (id: string, due?: string, extra: Partial<Task> = {}): Task => ({
  id,
  title: id,
  status: "needsAction",
  ...(due ? { due: `${due}T00:00:00.000Z` } : {}),
  ...extra,
});

Deno.test("tasks: due dates are calendar days", () => {
  assertEquals(dueOf(task("a", "2026-10-28")), new Date(2026, 9, 28));
  assertEquals(googleDue(new Date(2026, 10, 3)), "2026-11-03T00:00:00.000Z");
  assertEquals(dueBucket(dueOf(task("a", "2026-10-27")), NOW), "Overdue");
  assertEquals(dueBucket(dueOf(task("a", "2026-10-28")), NOW), "Today");
  assertEquals(dueBucket(undefined, NOW), "No Due Date");
});

Deno.test("tasks: by due date then position; subtasks under their parent", () => {
  const sorted = sortTasks([
    task("b", undefined, { position: "00000000000000000002" }),
    task("a", undefined, { position: "00000000000000000001" }),
    task("due", "2026-10-29"),
  ]);
  assertEquals(sorted.map((t) => t.id), ["due", "a", "b"]);
  const nested = withSubtasks([
    task("p"),
    task("q"),
    task("c", undefined, { parent: "p" }),
    task("orphan", undefined, { parent: "gone" }),
  ]);
  assertEquals(nested.map((n) => `${n.task.id}:${n.depth}`), ["p:0", "c:1", "q:0", "orphan:0"]);
});

Deno.test("quick add: dates and list", () => {
  assertEquals(parseQuickAdd("Send invoice friday #Work", NOW), {
    title: "Send invoice",
    due: new Date(2026, 9, 30),
    list: "Work",
  });
  assertEquals(parseQuickAdd("Appeler maman demain", NOW), { title: "Appeler maman", due: new Date(2026, 9, 29) });
  assertEquals(parseQuickAdd("Renew passport in 2 weeks", NOW).due, new Date(2026, 10, 11));
  assertEquals(parseQuickAdd("Buy milk", NOW), { title: "Buy milk" });
  const lists = [{ id: "1", title: "My Tasks" }, { id: "2", title: "École" }];
  assertEquals(findList(lists, "ecole")?.id, "2");
  assertEquals(findList(lists, "my")?.id, "1");
});
