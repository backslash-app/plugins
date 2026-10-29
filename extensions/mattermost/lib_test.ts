import { assertEquals } from "@std/assert";
import {
  age,
  type Channel,
  chooseBackend,
  dmKey,
  dndEnd,
  emojiCode,
  emojiName,
  errorText,
  type MmChannel,
  mmChannel,
  mmCustomStatus,
  mmCustomStatusBody,
  mmExpiry,
  mmMessages,
  type MmUser,
  normalizeUrl,
  oneLine,
  otherUserId,
  sectionOf,
  sortChannels,
  unreadSummary,
  untilText,
  ZULIP_PRESETS,
  zulipChannels,
  zulipHash,
  type ZulipMessage,
  zulipNarrow,
  zulipStreamUrl,
} from "./lib.ts";

const BASE = "https://chat.example.com";

Deno.test("backend and server address", () => {
  assertEquals(chooseBackend({ url: "https://team.zulipchat.com" }), "zulip");
  assertEquals(chooseBackend({ url: "chat.example.com", email: "me@example.com" }), "zulip");
  assertEquals(chooseBackend({ url: "chat.example.com" }), "mattermost");
  assertEquals(chooseBackend({ backend: "Mattermost", email: "x" }), "mattermost");
  assertEquals(chooseBackend({}), undefined);
  assertEquals(chooseBackend({ backend: "slack" }), undefined);
  assertEquals(normalizeUrl("chat.example.com/team/channels/town-square"), "https://chat.example.com");
  assertEquals(normalizeUrl("mattermost.lan:8065/api/v4"), "http://mattermost.lan:8065");
  assertEquals(normalizeUrl("http://192.168.1.5:8065/"), "http://192.168.1.5:8065");
  assertEquals(normalizeUrl(""), "");
});

Deno.test("Mattermost channels, direct messages and posts", () => {
  const team = { id: "t1", name: "acme", display_name: "Acme" };
  const users = new Map<string, MmUser>([
    ["me", { id: "me", username: "ada" }],
    ["u2", { id: "u2", username: "bob", first_name: "Bob", last_name: "Stone" }],
  ]);
  const base: MmChannel = {
    id: "c1",
    team_id: "t1",
    type: "O",
    name: "town-square",
    display_name: "Town Square",
    purpose: " Everyone ",
    last_post_at: 1000,
    total_msg_count: 12,
  };
  const c = mmChannel(
    base,
    { channel_id: "c1", msg_count: 9, mention_count: 1, last_viewed_at: 900 },
    team,
    users,
    "me",
    BASE,
  );
  assertEquals(c.unread, 3);
  assertEquals(c.mentions, 1);
  assertEquals(c.topic, "Everyone");
  assertEquals(c.url, `${BASE}/acme/channels/town-square`);
  assertEquals(c.team?.displayName, "Acme");
  assertEquals(c.lastViewed, 900);
  assertEquals(mmChannel(base, undefined, team, users, "me", BASE).unread, 0, "not a member: nothing unread");
  const dm = mmChannel(
    { ...base, id: "d1", type: "D", name: "u2__me", display_name: "" },
    { channel_id: "d1", msg_count: 4, mention_count: 0, notify_props: { mark_unread: "mention" } },
    team,
    users,
    "me",
    BASE,
  );
  assertEquals(dm.name, "Bob Stone");
  assertEquals(dm.kind, "direct");
  assertEquals(dm.url, `${BASE}/acme/messages/@bob`);
  assertEquals(dm.team, undefined);
  assertEquals(dm.muted, true);
  assertEquals(otherUserId("me__me", "me"), "me");
  assertEquals(otherUserId("town-square", "me"), undefined);

  const posts = mmMessages(
    {
      order: ["p3", "p2", "p1"],
      posts: {
        p1: { id: "p1", user_id: "u2", channel_id: "c1", message: "hello", create_at: 800 },
        p2: {
          id: "p2",
          user_id: "u2",
          channel_id: "c1",
          message: "joined",
          create_at: 850,
          type: "system_join_channel",
        },
        p3: { id: "p3", user_id: "me", channel_id: "c1", message: "hi **Bob**", create_at: 950, root_id: "p1" },
      },
    },
    users,
    "me",
    700,
    (id) => `${BASE}/acme/pl/${id}`,
  );
  assertEquals(posts.map((p) => [p.id, p.author, p.unread, p.rootId]), [
    ["p3", "You", false, "p1"],
    ["p1", "Bob Stone", true, undefined],
  ]);
  assertEquals(posts[1].url, `${BASE}/acme/pl/p1`);
});

Deno.test("Zulip streams, direct messages and unread counts", () => {
  const me = 1;
  const msg = (id: number, extra: Partial<ZulipMessage>): ZulipMessage => ({
    id,
    sender_id: 2,
    sender_full_name: "Bob",
    content: "hi",
    timestamp: id * 100,
    flags: [],
    type: "stream",
    stream_id: 10,
    subject: "deploys",
    display_recipient: "ops team",
    ...extra,
  });
  const dmTo = [{ id: 1, full_name: "Ada" }, { id: 2, full_name: "Bob" }];
  const recent = [
    msg(1, { flags: ["read"] }),
    msg(2, { flags: ["read"], type: "private", display_recipient: dmTo, stream_id: undefined, subject: "" }),
  ];
  const unread = [
    msg(3, { flags: ["mentioned"] }),
    msg(4, {}),
    msg(5, { type: "private", display_recipient: dmTo, stream_id: undefined, subject: "" }),
    msg(6, { sender_id: me, sender_full_name: "Ada" }),
  ];
  const channels = zulipChannels(
    [{ stream_id: 10, name: "ops team", description: "On call" }, { stream_id: 11, name: "random", is_muted: true }],
    recent,
    unread,
    me,
    "https://team.zulipchat.com",
  );
  const ops = channels.find((c) => c.id === "stream:10")!;
  assertEquals([ops.unread, ops.mentions, ops.unreadIds], [2, 1, [3, 4]]);
  assertEquals(ops.lastTopic, "deploys");
  assertEquals(ops.last?.author, "You");
  assertEquals(ops.url, "https://team.zulipchat.com/#narrow/stream/10-ops.20team");
  const dm = channels.find((c) => c.id === "dm:2")!;
  assertEquals([dm.name, dm.kind, dm.unread, dm.mentions, dm.userIds], ["Bob", "direct", 1, 1, [2]]);
  assertEquals(channels.find((c) => c.id === "stream:11")?.muted, true);
  assertEquals(dmKey(msg(9, {}), me), undefined);
  assertEquals(zulipNarrow(ops), '[{"operator":"stream","operand":10}]');
  assertEquals(zulipNarrow(dm), '[{"operator":"pm-with","operand":[2]}]');
  assertEquals(zulipHash("a.b c/é"), "a.2Eb.20c.2F.C3.A9");
  assertEquals(
    zulipStreamUrl("https://z.lan", 3, "dev", "CI fail"),
    "https://z.lan/#narrow/stream/3-dev/topic/CI.20fail",
  );
});

Deno.test("sorting, sections, summaries", () => {
  const ch = (id: string, extra: Partial<Channel>): Channel => ({
    id,
    name: id,
    kind: "channel",
    unread: 0,
    mentions: 0,
    lastAt: 0,
    muted: false,
    url: "",
    ...extra,
  });
  const list = [
    ch("quiet", { lastAt: 50 }),
    ch("muted", { unread: 9, muted: true, lastAt: 90 }),
    ch("busy", { unread: 3, lastAt: 10 }),
    ch("ping", { mentions: 1, unread: 1 }),
    ch("bob", { kind: "direct", lastAt: 60 }),
  ];
  assertEquals(sortChannels(list).map((c) => c.id), ["ping", "busy", "bob", "quiet", "muted"]);
  assertEquals(list.map(sectionOf), ["Channels", "Channels", "Unread", "Mentions", "Direct Messages"]);
  assertEquals(unreadSummary(list), "4 unread in 2 conversations · 1 mention");
  assertEquals(unreadSummary([ch("a", {})]), "1 conversation · all read");
  assertEquals(oneLine("**Deploy** done\n```\nlog\n```\n> ok"), "Deploy done [code] ok");
  const now = Date.parse("2026-10-29T12:00:00Z");
  assertEquals(age(now - 5 * 60_000, now), "5m");
  assertEquals(age(now - 3 * 86_400_000, now), "3d");
  assertEquals(age(0, now), "");
});

Deno.test("status: presets, expiry, emoji", () => {
  const now = new Date(2026, 9, 29, 10, 0); // a Thursday
  assertEquals(mmExpiry("one_hour", now), new Date(2026, 9, 29, 11, 0));
  assertEquals(mmExpiry("today", now), new Date(2026, 9, 29, 23, 59, 59, 999));
  assertEquals(mmExpiry("this_week", now), new Date(2026, 10, 1, 23, 59, 59, 999));
  assertEquals(mmExpiry("", now), undefined);
  assertEquals(mmCustomStatusBody("In a meeting", "calendar", "thirty_minutes", now), {
    text: "In a meeting",
    emoji: "calendar",
    duration: "thirty_minutes",
    expires_at: new Date(2026, 9, 29, 10, 30).toISOString(),
  });
  assertEquals(mmCustomStatusBody("Here", "wave", "", now), { text: "Here", emoji: "wave" });
  assertEquals(mmCustomStatus({ customStatus: '{"emoji":"house","text":"WFH","expires_at":"0001-01-01T00:00:00Z"}' }), {
    text: "WFH",
    emoji: "house",
    expires: undefined,
  });
  assertEquals(
    mmCustomStatus({ customStatus: '{"emoji":"x","text":"old","expires_at":"2000-01-01T00:00:00Z"}' }),
    undefined,
  );
  assertEquals(mmCustomStatus({ customStatus: "not json" }), undefined);
  assertEquals(emojiName(" :Palm Tree: "), "palm_tree");
  for (const p of ZULIP_PRESETS) assertEquals(emojiCode(p.glyph), p.code, p.title);
  assertEquals(dndEnd("30 minutes", now), Math.floor(now.getTime() / 1000) + 1800);
  assertEquals(dndEnd("until tomorrow", now), Math.floor(new Date(2026, 9, 30, 9).getTime() / 1000));
  assertEquals(dndEnd("Don't clear", now), 0);
  assertEquals(untilText(new Date(2026, 9, 29, 15, 30).getTime(), now), "until 15:30");
  assertEquals(
    errorText("Zulip", 400, { result: "error", msg: "Invalid emoji name" }),
    "Zulip answered 400: Invalid emoji name",
  );
});
