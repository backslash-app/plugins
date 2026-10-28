import { assert, assertEquals, assertInstanceOf, assertStringIncludes, assertThrows } from "@std/assert";
import {
  account,
  AuthError,
  authorizeUrl,
  avatarOf,
  type Board,
  boardColor,
  boardImage,
  type Card,
  cardIcon,
  cardMetadata,
  cardSection,
  colorOf,
  dueBucket,
  dueChoices,
  dueColor,
  labelColor,
  labelText,
  parseWhen,
  setupItem,
  shortDue,
  sortByDue,
  sortByList,
  trelloError,
} from "./lib.ts";

const KEY = "0123456789abcdef0123456789abcdef";

Deno.test("account: key and token", () => {
  assertThrows(() => account({}), AuthError, "Connect");
  assertThrows(() => account({ apiKey: "nope" }), AuthError, "API key");
  assertThrows(() => account({ apiKey: KEY }), AuthError, "token");
  assertEquals(account({ apiKey: ` ${KEY} `, token: " ATTA123 " }), { key: KEY, token: "ATTA123" });
  const url = new URL(authorizeUrl(KEY));
  assertEquals(url.host, "trello.com");
  assertEquals(url.searchParams.get("key"), KEY);
  assertEquals(url.searchParams.get("scope"), "read,write");
  assertEquals(url.searchParams.get("expiration"), "never");
});

Deno.test("errors", () => {
  assertInstanceOf(trelloError(401, "invalid token"), AuthError);
  assertInstanceOf(trelloError(401, "invalid key"), AuthError);
  assert(!(trelloError(401, "unauthorized card permission requested") instanceof AuthError));
  assertStringIncludes(trelloError(404, "The requested resource was not found.").message, "Not found");
  assertEquals(trelloError(500, "").message, "Trello answered 500");
});

Deno.test("setup row: with a key, Enter generates the token", () => {
  const none = setupItem(new AuthError("Connect your Trello account"), {});
  assertEquals(none.actions![0].title, "Create an API Key");
  const withKey = setupItem(new AuthError("Generate a token for your API key"), { apiKey: KEY });
  assertEquals(withKey.actions![0].title, "Generate Token");
  assertStringIncludes((withKey.actions![0] as { target: string }).target, KEY);
});

Deno.test("colors", () => {
  assertEquals(labelColor("green"), "green");
  assertEquals(labelColor("sky_dark"), "teal");
  assertEquals(labelColor("black_light"), "gray");
  assertEquals(labelColor(null), "gray");
  assertEquals(colorOf("#0079BF"), "blue");
  assertEquals(colorOf("#D29034"), "orange");
  assertEquals(colorOf("#838C91"), "gray");
  assertEquals(boardColor({ id: "b", name: "B", url: "", prefs: { backgroundColor: "#519839" } }), "green");
  assertEquals(labelText({ id: "l", name: "", color: "purple_dark" }), "purple dark");
});

Deno.test("board background: the scaled image closest to 640px from the allowed host", () => {
  const board: Board = {
    id: "b",
    name: "B",
    url: "",
    prefs: {
      backgroundImageScaled: [
        { width: 140, height: 100, url: "https://trello-backgrounds.s3.amazonaws.com/x/140x100/a.jpg" },
        { width: 640, height: 480, url: "https://trello-backgrounds.s3.amazonaws.com/x/640x480/a.jpg" },
        { width: 1920, height: 1080, url: "https://trello-backgrounds.s3.amazonaws.com/x/1920x1080/a.jpg" },
      ],
    },
  };
  assertEquals(boardImage(board), "https://trello-backgrounds.s3.amazonaws.com/x/640x480/a.jpg");
  assertEquals(
    boardImage({
      ...board,
      prefs: { backgroundImageScaled: [{ width: 640, height: 480, url: "https://images.unsplash.com/x" }] },
    }),
    undefined,
  );
  assertEquals(
    avatarOf({ id: "m", fullName: "Ada", username: "ada", avatarUrl: "https://trello-members.s3.amazonaws.com/1/abc" }),
    "https://trello-members.s3.amazonaws.com/1/abc/50.png",
  );
  assertEquals(avatarOf({ id: "m", fullName: "Ada Lovelace", username: "ada", avatarUrl: null }), "Ada Lovelace");
});

const NOW = new Date(2026, 9, 27, 14, 10, 0);

function card(over: Partial<Card>): Card {
  return {
    id: "c",
    name: "Card",
    desc: "",
    due: null,
    dueComplete: false,
    idList: "l1",
    idBoard: "b1",
    idMembers: [],
    labels: [],
    url: "https://trello.com/c/abc/1-card",
    shortUrl: "https://trello.com/c/abc",
    pos: 1,
    dateLastActivity: "2026-10-20T10:00:00.000Z",
    ...over,
  };
}

Deno.test("cards: sections, order, icon, due color", () => {
  const late = card({ id: "late", due: new Date(2026, 9, 26, 12).toISOString() });
  const soon = card({ id: "soon", due: new Date(2026, 9, 27, 18).toISOString() });
  const done = card({ id: "done", due: new Date(2026, 9, 20).toISOString(), dueComplete: true });
  const none = card({ id: "none", labels: [{ id: "x", name: "Bug", color: "red" }] });
  assertEquals(cardSection(late, NOW), "Overdue");
  assertEquals(cardSection(soon, NOW), "Today");
  assertEquals(cardSection(done, NOW), "Completed");
  assertEquals(cardSection(none, NOW), "No Due Date");
  assertEquals(sortByDue([none, done, soon, late]).map((c) => c.id), ["late", "soon", "none", "done"]);
  assertEquals(cardIcon(none).tint, "red");
  assertEquals(cardIcon(done).tint, "green");
  assertEquals(dueColor(late, NOW), "red");
  assertEquals(dueColor(soon, NOW), "orange");
  assertEquals(dueColor(none, NOW), undefined);
  const lists = [{ id: "l2", name: "Doing", pos: 2 }, { id: "l1", name: "To Do", pos: 1 }];
  const a = card({ id: "a", idList: "l2", pos: 5 });
  const b = card({ id: "b", idList: "l1", pos: 9 });
  const c = card({ id: "c", idList: "l1", pos: 3 });
  assertEquals(sortByList([a, b, c], lists).map((x) => x.id), ["c", "b", "a"]);
});

Deno.test("card metadata", () => {
  const lines = cardMetadata(
    card({
      due: new Date(2026, 9, 28, 17).toISOString(),
      labels: [{ id: "x", name: "Design", color: "purple" }],
      members: [{ id: "m", fullName: "Ada Lovelace", username: "ada", avatarUrl: null }],
      badges: { checkItems: 4, checkItemsChecked: 3, comments: 2 },
    }),
    { board: "Roadmap", list: "Doing" },
    NOW,
  );
  const by = (label: string) => lines.find((l) => l.label === label);
  assertEquals(by("Board")?.value, "Roadmap");
  assertEquals(by("Due")?.value, "tomorrow 17:00");
  assertEquals(by("Labels")?.tags, [{ text: "Design", color: "purple" }]);
  assertEquals(by("Members")?.avatar, "Ada Lovelace");
  assertEquals(by("Checklist")?.progress, 0.75);
  assertEquals(by("Comments")?.value, "2");
  assertEquals(by("Link")?.link, "https://trello.com/c/abc");
});

// A Tuesday afternoon, local time.
const T = new Date(2026, 9, 27, 14, 10, 0);
const at = (y: number, m: number, d: number, h = 0, min = 0) => new Date(y, m - 1, d, h, min);

Deno.test("parseWhen: words, weekdays, relative days, times", () => {
  assertEquals(parseWhen("", T), undefined);
  assertEquals(parseWhen("today", T), { date: at(2026, 10, 27), time: false });
  assertEquals(parseWhen("Tomorrow", T), { date: at(2026, 10, 28), time: false });
  assertEquals(parseWhen("friday", T), { date: at(2026, 10, 30), time: false });
  // Today is a Tuesday: "tue" is next week's.
  assertEquals(parseWhen("tue", T), { date: at(2026, 11, 3), time: false });
  assertEquals(parseWhen("next week", T), { date: at(2026, 11, 2), time: false });
  assertEquals(parseWhen("+3d", T), { date: at(2026, 10, 30), time: false });
  assertEquals(parseWhen("in 2 weeks", T), { date: at(2026, 11, 10), time: false });
  assertEquals(parseWhen("2026-11-03", T), { date: at(2026, 11, 3), time: false });
  assertEquals(parseWhen("3 Nov", T), { date: at(2026, 11, 3), time: false });
  assertEquals(parseWhen("jan 5", T), { date: at(2027, 1, 5), time: false });
  assertEquals(parseWhen("tomorrow 3pm", T), { date: at(2026, 10, 28, 15), time: true });
  assertEquals(parseWhen("fri at 9:30am", T), { date: at(2026, 10, 30, 9, 30), time: true });
  assertEquals(parseWhen("2026-11-03 14:30", T), { date: at(2026, 11, 3, 14, 30), time: true });
  assertEquals(parseWhen("17h", T), { date: at(2026, 10, 27, 17), time: true });
  // Already past today: tomorrow.
  assertEquals(parseWhen("9am", T), { date: at(2026, 10, 28, 9), time: true });
  assertThrows(() => parseWhen("someday", T), Error, "Can't read the date");
  assertThrows(() => parseWhen("2026-02-31", T), Error);
});

Deno.test("due buckets and short dates", () => {
  assertEquals(dueBucket(undefined, T), "No Due Date");
  assertEquals(dueBucket(at(2026, 10, 26, 18), T), "Overdue");
  assertEquals(dueBucket(at(2026, 10, 27, 9), T), "Overdue");
  assertEquals(dueBucket(at(2026, 10, 27, 0), T, false), "Today");
  assertEquals(dueBucket(at(2026, 10, 27, 18), T), "Today");
  assertEquals(dueBucket(at(2026, 10, 28, 18), T), "Tomorrow");
  assertEquals(dueBucket(at(2026, 11, 1, 18), T), "This Week");
  assertEquals(dueBucket(at(2026, 11, 20), T), "Later");
  assertEquals(shortDue(at(2026, 10, 27, 18), T), "today 18:00");
  assertEquals(shortDue(at(2026, 10, 28), T, false), "tomorrow");
  assertEquals(shortDue(at(2026, 10, 30, 9), T), "Fri 09:00");
  assertEquals(shortDue(at(2026, 11, 20), T, false), "Nov 20");
  assertEquals(shortDue(at(2027, 1, 20), T, false), "Jan 20, 2027");
  assertEquals(dueChoices(T).map((c) => c.date), ["2026-10-27", "2026-10-28", "2026-11-02", "2026-11-10", null]);
});
