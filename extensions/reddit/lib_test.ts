import { assertEquals } from "@std/assert";
import {
  ago,
  cleanMarkdown,
  commentsMarkdown,
  commentsOf,
  flairColor,
  fromReddit,
  type Listing,
  listingPath,
  parseSubreddits,
  pictureOf,
  postsOf,
  type RedditComment,
  type RedditPost,
  refusal,
  subredditName,
} from "./lib.ts";
import { postItem, refusedItem } from "./views.ts";
import { Refused } from "./api.ts";

const NOW = Date.parse("2026-10-28T10:00:00Z");

// Shaped like `/r/<sub>/hot.json?raw_json=1` children.
const link: RedditPost = {
  id: "1abcde",
  name: "t3_1abcde",
  title: "Linux 7.2 released ",
  subreddit: "linux",
  author: "linus_fan",
  score: 1523,
  num_comments: 214,
  created_utc: NOW / 1000 - 5 * 3600,
  permalink: "/r/linux/comments/1abcde/linux_72_released/",
  url: "https://lkml.org/lkml/2026/10/26/1",
  url_overridden_by_dest: "https://lkml.org/lkml/2026/10/26/1",
  domain: "lkml.org",
  is_self: false,
  link_flair_text: "Kernel",
  link_flair_background_color: "#0079d3",
  post_hint: "link",
  upvote_ratio: 0.97,
  preview: {
    images: [{
      source: { url: "https://external-preview.redd.it/abc.jpg?auto=webp&s=1", width: 1200, height: 630 },
      resolutions: [
        { url: "https://external-preview.redd.it/abc.jpg?width=320&s=2", width: 320, height: 168 },
        { url: "https://external-preview.redd.it/abc.jpg?width=640&s=3", width: 640, height: 336 },
        { url: "https://external-preview.redd.it/abc.jpg?width=1080&s=4", width: 1080, height: 567 },
      ],
    }],
  },
};
const image: RedditPost = {
  ...link,
  id: "2fghij",
  title: "My Hyprland setup",
  subreddit: "unixporn",
  url: "https://i.redd.it/xyz123.png",
  url_overridden_by_dest: "https://i.redd.it/xyz123.png",
  domain: "i.redd.it",
  post_hint: "image",
  preview: undefined,
};
const self: RedditPost = {
  ...link,
  id: "3klmno",
  title: "Weekly questions thread",
  is_self: true,
  domain: "self.linux",
  url: "https://www.reddit.com/r/linux/comments/3klmno/x/",
  url_overridden_by_dest: undefined,
  selftext: "Ask anything!",
  stickied: true,
  link_flair_text: null,
  preview: undefined,
};
const nsfw: RedditPost = { ...image, id: "4nsfwx", over_18: true };

Deno.test("subreddit names", () => {
  assertEquals(parseSubreddits("linux, r/programming /r/rust/ Linux;technology"), [
    "linux",
    "programming",
    "rust",
    "technology",
  ]);
  assertEquals(parseSubreddits("a, -bad-, ok_one"), ["ok_one"]);
  assertEquals(parseSubreddits(undefined), []);
  assertEquals(subredditName(" r/Rust "), "Rust");
  assertEquals(subredditName("not a sub!"), "not");
  assertEquals(listingPath(["linux", "rust"], "hot"), "/r/linux+rust/hot.json?limit=50&raw_json=1");
  assertEquals(listingPath(["linux"], "top", 25), "/r/linux/top.json?limit=25&raw_json=1&t=day");
});

Deno.test("posts", () => {
  const p = fromReddit(link);
  assertEquals(p.title, "Linux 7.2 released");
  assertEquals(p.kind, "link");
  assertEquals(p.link, "https://lkml.org/lkml/2026/10/26/1");
  assertEquals(p.permalink, "https://www.reddit.com/r/linux/comments/1abcde/linux_72_released/");
  assertEquals(p.image, "https://external-preview.redd.it/abc.jpg?width=640&s=3");
  const i = fromReddit(image);
  assertEquals(i.kind, "image");
  assertEquals(i.image, "https://i.redd.it/xyz123.png");
  const s = fromReddit(self);
  assertEquals([s.kind, s.self, s.link, s.domain, s.pinned, s.flair], [
    "text",
    true,
    undefined,
    undefined,
    true,
    undefined,
  ]);
  assertEquals(fromReddit(nsfw).image, undefined);
  assertEquals(
    pictureOf({
      ...link,
      preview: { images: [{ source: { url: "https://evil.example/x.jpg", width: 1, height: 1 } }] },
    }),
    undefined,
  );
  const listing: Listing<RedditPost> = {
    kind: "Listing",
    data: { children: [{ kind: "t3", data: link }, { kind: "t3", data: nsfw }, { kind: "t1", data: self }] },
  };
  assertEquals(postsOf(listing).map((p) => p.id), ["1abcde"]);
  assertEquals(postsOf(listing, true).map((p) => p.id), ["1abcde", "4nsfwx"]);
});

Deno.test("comments", () => {
  const listing: Listing<RedditComment> = {
    kind: "Listing",
    data: {
      children: [
        {
          kind: "t1",
          data: {
            id: "0",
            author: "AutoModerator",
            body: "Rules",
            score: 1,
            created_utc: 0,
            stickied: true,
            distinguished: "moderator",
          },
        },
        {
          kind: "t1",
          data: { id: "1", author: "gregkh", body: "Great release ", score: 900, created_utc: NOW / 1000 - 3000 },
        },
        {
          kind: "t1",
          data: { id: "2", author: "op", body: "Thanks", score: 5, created_utc: NOW / 1000, is_submitter: true },
        },
        { kind: "t1", data: { id: "3", author: "[deleted]", body: "[removed]", score: 1, created_utc: 0 } },
        { kind: "more", data: { id: "x", author: "", score: 0, created_utc: 0 } },
      ],
    },
  };
  const c = commentsOf([{}, listing]);
  assertEquals(c.map((x) => [x.author, x.body, x.op]), [["gregkh", "Great release", false], ["op", "Thanks", true]]);
  const md = commentsMarkdown(fromReddit(self), c);
  assertEquals(md.includes("**u/op** (OP) · 5 points"), true);
  assertEquals(md.includes("Ask anything!"), true);
  assertEquals(commentsMarkdown(fromReddit(link), []).endsWith("No comments yet."), true);
});

Deno.test("formatting", () => {
  assertEquals(ago(NOW - 5 * 3600_000, NOW), "5 h");
  assertEquals(ago(NOW - 30_000, NOW), "now");
  assertEquals(flairColor("#0079d3"), "blue");
  assertEquals(flairColor("#ff4500"), "orange");
  assertEquals(flairColor("#46d160"), "green");
  assertEquals(flairColor("#dadada"), "gray");
  assertEquals(flairColor(""), "gray");
  assertEquals(
    cleanMarkdown("Hi >!spoiler!< ^(small) &amp; more\n\n\n\n|a|\n|---|\n|1|"),
    "Hi [spoiler] small & more\n\n|a|\n\n|1|",
  );
  assertEquals(cleanMarkdown("word ".repeat(400), 20), "word word word word…");
});

Deno.test("refusals", () => {
  assertEquals(refusal(403, { reason: "private", message: "Forbidden", error: 403 }), {
    message: "This subreddit is private",
    blocked: false,
  });
  assertEquals(refusal(403, undefined), { message: "Reddit blocked this request from your network", blocked: true });
  assertEquals(refusal(429, undefined, "42"), { message: "Reddit is rate limiting: try again in 42 s", blocked: true });
  assertEquals(refusal(404, { reason: "banned" }).blocked, false);
  assertEquals(refusal(503, undefined), { message: "Reddit answered 503", blocked: true });
  const item = refusedItem(
    new Refused("Reddit blocked this request from your network", true),
    "https://www.reddit.com/r/linux/hot",
  );
  assertEquals(item.actions?.map((a) => a.title), ["Open in Browser", "Try Again"]);
});

Deno.test("post item", () => {
  const item = postItem(fromReddit(link), { multi: true, browse: () => ({}) as never });
  assertEquals(item.subtitle, "r/linux");
  assertEquals(item.icon, { source: "bs-link", tint: "orange" });
  assertEquals(item.detail?.image, "https://external-preview.redd.it/abc.jpg?width=640&s=3");
  assertEquals(item.accessories?.map((a) => a.tag ?? a.text).slice(0, 3), ["Kernel", "1.5K", "214"]);
  assertEquals(item.actions?.map((a) => a.title).slice(0, 4), [
    "Open Post",
    "Open Link",
    "Show Top Comments",
    "Browse r/linux",
  ]);
  const one = postItem(fromReddit(self), { multi: false });
  assertEquals(one.subtitle, "u/linus_fan");
  assertEquals(one.actions?.map((a) => a.title).slice(0, 3), ["Open Post", "Show Top Comments", "Open u/linus_fan"]);
});
