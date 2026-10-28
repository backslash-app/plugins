import { assertEquals } from "@std/assert";
import {
  age,
  directRooms,
  errorText,
  localpart,
  matrixToUrl,
  messageText,
  normalizeHomeserver,
  roomName,
  roomsOf,
  sortRooms,
  stripReplyFallback,
  SYNC_FILTER,
  type SyncResponse,
  textMessage,
  txnId,
  webClientUrl,
  wellKnownBase,
} from "./lib.ts";

const ME = "@ada:matrix.org";

const SYNC: SyncResponse = {
  next_batch: "s72595_4483_1934",
  account_data: { events: [{ type: "m.direct", content: { "@bob:example.org": ["!dm:example.org"] } }] },
  rooms: {
    join: {
      "!team:matrix.org": {
        summary: { "m.joined_member_count": 12 },
        state: {
          events: [
            { type: "m.room.name", state_key: "", content: { name: "Team Backslash" } },
            { type: "m.room.canonical_alias", state_key: "", content: { alias: "#backslash:matrix.org" } },
            { type: "m.room.topic", state_key: "", content: { topic: "Launcher talk" } },
            {
              type: "m.room.member",
              state_key: "@carol:matrix.org",
              content: { displayname: "Carol", membership: "join" },
            },
          ],
        },
        timeline: {
          events: [{
            type: "m.room.message",
            event_id: "$e1",
            sender: "@carol:matrix.org",
            origin_server_ts: 1_793_000_000_000,
            content: { msgtype: "m.text", body: "> <@bob:example.org> ship it?\n\nShipping now" },
          }],
        },
        unread_notifications: { notification_count: 3, highlight_count: 1 },
      },
      "!dm:example.org": {
        summary: { "m.heroes": ["@bob:example.org"], "m.joined_member_count": 2 },
        state: {
          events: [
            { type: "m.room.encryption", state_key: "", content: { algorithm: "m.megolm.v1.aes-sha2" } },
            {
              type: "m.room.member",
              state_key: "@bob:example.org",
              content: { displayname: "Bob", membership: "join" },
            },
          ],
        },
        timeline: {
          events: [{
            type: "m.room.encrypted",
            event_id: "$e2",
            sender: "@bob:example.org",
            origin_server_ts: 1_793_000_100_000,
            content: { algorithm: "m.megolm.v1.aes-sha2", ciphertext: "AwgAEn..." },
          }],
        },
        unread_notifications: { notification_count: 0, highlight_count: 0 },
      },
      "!quiet:example.org": {
        summary: { "m.heroes": ["@dan:example.org", "@eve:example.org"], "m.joined_member_count": 5 },
        state: { events: [] },
        timeline: {
          events: [{
            type: "m.room.message",
            event_id: "$e3",
            sender: ME,
            origin_server_ts: 1_792_000_000_000,
            content: { msgtype: "m.image", body: "IMG_2026.jpg" },
          }],
        },
      },
    },
    invite: {
      "!new:example.org": {
        invite_state: {
          events: [
            { type: "m.room.name", state_key: "", sender: "@bob:example.org", content: { name: "Release party" } },
            { type: "m.room.member", state_key: "@bob:example.org", content: { displayname: "Bob" } },
            { type: "m.room.member", state_key: ME, sender: "@bob:example.org", content: { membership: "invite" } },
          ],
        },
      },
    },
  },
};

Deno.test("rooms of a sync answer", () => {
  const rooms = roomsOf(SYNC, ME);
  const team = rooms.find((r) => r.id === "!team:matrix.org")!;
  assertEquals(team.name, "Team Backslash");
  assertEquals(team.alias, "#backslash:matrix.org");
  assertEquals(team.topic, "Launcher talk");
  assertEquals([team.unread, team.highlights, team.members], [3, 1, 12]);
  assertEquals(team.last?.text, "Shipping now");
  assertEquals(team.last?.senderName, "Carol");
  const dm = rooms.find((r) => r.id === "!dm:example.org")!;
  assertEquals([dm.name, dm.direct, dm.encrypted], ["Bob", true, true]);
  assertEquals(dm.last?.text, "Encrypted message");
  assertEquals(dm.last?.encrypted, true);
  const quiet = rooms.find((r) => r.id === "!quiet:example.org")!;
  assertEquals(quiet.name, "dan, eve and 2 others");
  assertEquals(quiet.last?.senderName, "You");
  assertEquals(quiet.last?.text, "sent an image");
  const invite = rooms.find((r) => r.invite)!;
  assertEquals([invite.name, invite.inviter], ["Release party", "Bob"]);
  assertEquals(sortRooms(rooms).map((r) => r.id), [
    "!new:example.org",
    "!team:matrix.org",
    "!dm:example.org",
    "!quiet:example.org",
  ]);
  assertEquals(directRooms(SYNC).has("!dm:example.org"), true);
});

Deno.test("room names without a name", () => {
  assertEquals(roomName([]), "Empty Room");
  assertEquals(roomName([{ type: "m.room.canonical_alias", state_key: "", content: { alias: "#a:b" } }]), "#a:b");
  assertEquals(roomName([], ["@x:y", "@z:y"], 3), "x and z");
  assertEquals(localpart("@ada:matrix.org"), "ada");
});

Deno.test("message lines", () => {
  const ev = (content: Record<string, unknown>, type = "m.room.message") => ({ type, content });
  assertEquals(messageText(ev({ msgtype: "m.text", body: "hello\nworld" })), "hello world");
  assertEquals(messageText(ev({ msgtype: "m.emote", body: "waves" }), "Ada"), "* Ada waves");
  assertEquals(messageText(ev({ msgtype: "m.file", body: "report.pdf" })), "sent a file: report.pdf");
  assertEquals(
    messageText(ev({ msgtype: "m.audio", body: "x", "org.matrix.msc3245.voice": {} })),
    "sent a voice message",
  );
  assertEquals(messageText(ev({})), "Message deleted");
  assertEquals(messageText(ev({ ciphertext: "x" }, "m.room.encrypted")), "Encrypted message");
  assertEquals(stripReplyFallback("> <@a:b> question\n> more\n\nanswer"), "answer");
  assertEquals(stripReplyFallback("plain"), "plain");
});

Deno.test("addresses, links and bodies", () => {
  assertEquals(normalizeHomeserver("matrix.org"), "https://matrix.org");
  assertEquals(normalizeHomeserver("https://chat.example.com/_matrix/client/"), "https://chat.example.com");
  assertEquals(
    wellKnownBase({ "m.homeserver": { base_url: "https://matrix-client.matrix.org/" } }),
    "https://matrix-client.matrix.org",
  );
  assertEquals(wellKnownBase({}), undefined);
  const room = roomsOf(SYNC, ME).find((r) => r.id === "!team:matrix.org")!;
  assertEquals(matrixToUrl(room), "https://matrix.to/#/%23backslash%3Amatrix.org");
  assertEquals(
    webClientUrl(room, "https://app.element.io/"),
    "https://app.element.io/#/room/%23backslash%3Amatrix.org",
  );
  assertEquals(textMessage("hi", "$e1"), {
    msgtype: "m.text",
    body: "hi",
    "m.relates_to": { "m.in_reply_to": { event_id: "$e1" } },
  });
  assertEquals(textMessage("hi"), { msgtype: "m.text", body: "hi" });
  assertEquals(txnId(1) === txnId(1), false);
  assertEquals(SYNC_FILTER.room.timeline.limit, 1);
  assertEquals(
    errorText(401, { errcode: "M_UNKNOWN_TOKEN", error: "Invalid token" }).startsWith("The homeserver refused"),
    true,
  );
  assertEquals(errorText(500, undefined), "The homeserver answered 500");
  const now = Date.parse("2026-10-28T12:00:00Z");
  assertEquals(age(now - 30_000, now), "now");
  assertEquals(age(now - 5 * 60_000, now), "5m");
  assertEquals(age(now - 3 * 3600_000, now), "3h");
  assertEquals(age(now - 2 * 86_400_000, now), "2d");
});
