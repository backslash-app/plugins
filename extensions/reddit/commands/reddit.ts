import { type Context, Icons, list, updateCommandMetadata } from "@backslash/api";
import { listing, subreddits } from "../api.ts";
import type { Sort } from "../lib.ts";
import { loadPosts, postItem, SORTS, subredditList, subUrl } from "../views.ts";

let note = "";
let names: string[] = [];

export default (ctx: Context) => {
  const nsfw = ctx.preferences.nsfw === true;
  return list({
    placeholder: "Filter posts by title, subreddit, author or flair…",
    filter: { options: SORTS },
    empty: {
      title: "No subreddits",
      description: "Add some in the preferences, or with the Reddit Subreddits command",
      icon: Icons.comment,
    },
    status: (items) =>
      note ||
      `${items.length} posts · ${
        names.length > 3 ? `${names.length} subreddits` : names.map((n) => `r/${n}`).join(", ")
      }`,
    items: async ({ filter, signal }) => {
      const sort = (SORTS.some((s) => s.value === filter) ? filter : "hot") as Sort;
      names = (await subreddits(ctx.preferences)).map((s) => s.name);
      if (!names.length) return [];
      const items = await loadPosts(
        () => listing(names, sort, nsfw, signal),
        subUrl(names.join("+"), sort),
        (p) => postItem(p, { multi: names.length > 1, browse: (sub) => subredditList(sub, nsfw) }),
        (t) => (note = t),
      );
      const top = items.find((i) => i.id !== "refused");
      if (sort === "hot" && top) updateCommandMetadata({ subtitle: top.title.slice(0, 60) }).catch(() => {});
      return items;
    },
  });
};
