import { assert, assertEquals, assertInstanceOf, assertStringIncludes, assertThrows } from "@std/assert";
import {
  AuthError,
  cleanText,
  clock,
  type Conversation,
  conversationTitle,
  emojiCode,
  emojiOf,
  encodeParams,
  expiryFor,
  firstLine,
  groupName,
  isUseful,
  kindOf,
  setupItem,
  shortDate,
  slackError,
  snoozeMinutes,
  sortConversations,
  statusSubtitle,
  tsDate,
  type User,
  userToken,
  webUrl,
} from "./lib.ts";

// A Tuesday afternoon, local time.
const NOW = new Date(2026, 9, 27, 14, 10, 0);
const unix = (d: Date) => Math.floor(d.getTime() / 1000);

Deno.test("user token: missing, bot token, user token", () => {
  assertThrows(() => userToken({}), AuthError, "Connect");
  assertThrows(() => userToken({ token: "xoxb-1-2-3" }), AuthError, "User OAuth Token");
  assertThrows(() => userToken({ token: "hello" }), AuthError, "xoxp-");
  assertEquals(userToken({ token: "  xoxp-123-456-abc \n" }), "xoxp-123-456-abc");
});

Deno.test("Slack errors", () => {
  assertInstanceOf(slackError({ error: "invalid_auth" }), AuthError);
  assertInstanceOf(slackError({ error: "token_revoked" }), AuthError);
  const scope = slackError({ error: "missing_scope", needed: "dnd:write" });
  assert(!(scope instanceof AuthError));
  assertStringIncludes(scope.message, "dnd:write");
  assertEquals(slackError({ error: "channel_not_found" }).message, "Slack: channel not found");
});

Deno.test("parameters are form-encoded, the profile as JSON", () => {
  const body = encodeParams({
    profile: { status_text: "Lunch & co", status_emoji: ":sandwich:", status_expiration: 0 },
    cursor: undefined,
    limit: 200,
  });
  assertEquals(body.get("limit"), "200");
  assertEquals(body.has("cursor"), false);
  assertEquals(JSON.parse(body.get("profile")!).status_text, "Lunch & co");
});

Deno.test("emoji shortcodes", () => {
  assertEquals(emojiOf(":palm_tree:"), "🌴");
  assertEquals(emojiOf("spiral_calendar_pad"), "🗓️");
  assertEquals(emojiOf(":partyparrot:"), ":partyparrot:");
  assertEquals(emojiOf(""), "");
  assertEquals(emojiCode("palm_tree"), ":palm_tree:");
  assertEquals(emojiCode(":Headphones:"), ":headphones:");
  assertEquals(emojiCode("🌴"), ":palm_tree:");
  assertEquals(emojiCode("🗓"), ":spiral_calendar_pad:");
  assertEquals(emojiCode(""), "");
});

Deno.test("status expiry", () => {
  assertEquals(expiryFor("30m", NOW), unix(NOW) + 1800);
  assertEquals(expiryFor("2h", NOW), unix(NOW) + 7200);
  assertEquals(expiryFor("never", NOW), 0);
  assertEquals(expiryFor("today", NOW), unix(new Date(2026, 9, 27, 23, 59, 59)));
  // Tuesday → Sunday night.
  assertEquals(expiryFor("week", NOW), unix(new Date(2026, 10, 1, 23, 59, 59)));
  const sunday = new Date(2026, 10, 1, 10, 0, 0);
  assertEquals(expiryFor("week", sunday), unix(new Date(2026, 10, 1, 23, 59, 59)));
});

Deno.test("snooze durations", () => {
  assertEquals(snoozeMinutes("30 minutes", NOW), 30);
  assertEquals(snoozeMinutes("1 hour", NOW), 60);
  assertEquals(snoozeMinutes("2 hours", NOW), 120);
  // 14:10 → 9:00 tomorrow.
  assertEquals(snoozeMinutes("until tomorrow", NOW), 18 * 60 + 50);
  assertEquals(snoozeMinutes("45", NOW), 45);
  assertThrows(() => snoozeMinutes("forever", NOW), Error, "Unknown duration");
});

Deno.test("clock and subtitle", () => {
  assertEquals(clock(unix(new Date(2026, 9, 27, 15, 30)), NOW), "15:30");
  assertEquals(clock(unix(new Date(2026, 9, 28, 9, 0)), NOW), "tomorrow 09:00");
  assertEquals(clock(unix(new Date(2026, 9, 30, 18, 0)), NOW), "Fri 18:00");
  assertEquals(
    statusSubtitle({
      text: "In a meeting",
      emoji: ":spiral_calendar_pad:",
      expiration: unix(new Date(2026, 9, 27, 15, 0)),
    }, NOW),
    "🗓️ In a meeting · until 15:00",
  );
  assertEquals(statusSubtitle({ text: "Vacationing", emoji: ":palm_tree:", expiration: 0 }, NOW), "🌴 Vacationing");
  assertEquals(statusSubtitle({ text: "", emoji: "", expiration: 0 }, NOW), null);
});

Deno.test("mrkdwn cleanup", () => {
  const raw = "Hey <@U024BE7LH|ada>, see <#C1234|design> and <https://example.com/spec|the spec> &amp; <!here>";
  assertEquals(cleanText(raw), "Hey @ada, see #design and the spec & @here");
  assertEquals(
    cleanText("<https://example.com/spec|the spec>", { links: true }),
    "[the spec](https://example.com/spec)",
  );
  assertEquals(cleanText("<@U1>", { users: new Map([["U1", "grace"]]) }), "@grace");
  assertEquals(cleanText("<mailto:ada@example.com|ada@example.com> 1 &lt; 2"), "ada@example.com 1 < 2");
  assertEquals(cleanText("<!subteam^S123|@oncall> ping"), "@oncall ping");
  assertEquals(firstLine("\n\n  First line  \nsecond"), "First line");
  assertEquals(firstLine("x".repeat(200), 10), "xxxxxxxxxx…");
});

Deno.test("dates of messages", () => {
  assertEquals(tsDate("1730123456.000200").getTime(), 1730123456000);
  assertEquals(shortDate(new Date(2026, 9, 27, 9, 5), NOW), "09:05");
  assertEquals(shortDate(new Date(2026, 9, 26, 23, 0), NOW), "yesterday");
  assertEquals(shortDate(new Date(2026, 9, 24, 12, 0), NOW), "3d");
  assertStringIncludes(shortDate(new Date(2026, 8, 2), NOW), "Sep 2");
  assertStringIncludes(shortDate(new Date(2024, 2, 2), NOW), "2024");
});

const users = new Map<string, User>([
  ["U1", { id: "U1", name: "ada", profile: { display_name: "", real_name: "Ada Lovelace" } }],
  ["U2", { id: "U2", name: "old", deleted: true, profile: { real_name: "Old Account" } }],
]);

const convos: Conversation[] = [
  { id: "D1", is_im: true, user: "U1" },
  { id: "C2", name: "random", is_channel: true },
  { id: "G1", name: "mpdm-ada--grace--linus-1", is_mpim: true, is_private: true },
  { id: "C1", name: "general", is_channel: true, is_general: true },
  { id: "C3", name: "secret-project", is_channel: true, is_private: true },
  { id: "D2", is_im: true, user: "U2" },
  { id: "D3", is_im: true, user: "USLACKBOT" },
];

Deno.test("conversations: kinds, titles, order", () => {
  assertEquals(kindOf(convos[0]), "dm");
  assertEquals(kindOf(convos[2]), "group");
  assertEquals(kindOf(convos[4]), "private");
  assertEquals(conversationTitle(convos[0], users), "Ada Lovelace");
  assertEquals(conversationTitle(convos[1], users), "#random");
  assertEquals(groupName("mpdm-ada--grace--linus-1"), "ada, grace, linus");
  assertEquals(groupName("mpdm-steven--ada-1", "steven"), "ada");
  const useful = convos.filter((c) => isUseful(c, users));
  assertEquals(useful.map((c) => c.id), ["D1", "C2", "G1", "C1", "C3"]);
  assertEquals(sortConversations(useful, users).map((c) => c.id), ["C1", "C2", "C3", "G1", "D1"]);
  assertEquals(webUrl("https://acme.slack.com/", "C1"), "https://acme.slack.com/archives/C1");
  assertEquals(webUrl("https://acme.slack.com", "C1"), "https://acme.slack.com/archives/C1");
});

Deno.test("setup row explains the scopes and links to the apps page", () => {
  const item = setupItem(new AuthError("Connect your Slack account"));
  assertEquals(item.id, "setup");
  assertStringIncludes(item.detail!.markdown!, "search:read");
  assertStringIncludes(item.detail!.markdown!, "xoxp-");
});
