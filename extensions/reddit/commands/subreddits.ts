import { action, type Context, copy, Icons, type Item, list, meta, open, refresh, toast } from "@backslash/api";
import { addSubreddit, removeSubreddit, subreddits } from "../api.ts";
import { subredditName } from "../lib.ts";
import { subredditList, subUrl } from "../views.ts";

export default (ctx: Context) => {
  const nsfw = ctx.preferences.nsfw === true;
  return list({
    placeholder: "Filter your subreddits, or type one to add it…",
    empty: { title: "No subreddits yet", description: "Type a subreddit's name to add it", icon: Icons.hash },
    status: (items) => {
      const n = items.filter((i) => i.id !== "add").length;
      return `${n} subreddit${n === 1 ? "" : "s"}`;
    },
    async search(query) {
      const subs = await subreddits(ctx.preferences);
      const q = query.trim().replace(/^\/?r\//i, "").toLowerCase();
      const shown = subs.filter((s) => s.name.toLowerCase().includes(q));
      const items: Item[] = shown.map((s) => ({
        id: s.name,
        title: `r/${s.name}`,
        subtitle: s.fromPrefs ? "From the preferences" : "Added from the launcher",
        icon: { source: Icons.hash, tint: "orange" },
        detail: {
          markdown: `**r/${s.name}**\n\nEnter shows its hot, new and top posts.${
            s.fromPrefs ? "\n\nSet in **Settings → Extensions → Reddit → Configure**." : ""
          }`,
          metadata: [meta.link("Reddit", `reddit.com/r/${s.name}`, `https://www.reddit.com/r/${s.name}/`)],
        },
        actions: [
          action("Browse Posts", () => subredditList(s.name, nsfw), { icon: Icons.comment }),
          open(subUrl(s.name), "Open in Browser"),
          copy(`https://www.reddit.com/r/${s.name}/`, "Copy Link", { section: "Copy" }),
          ...(s.fromPrefs ? [] : [
            action("Remove Subreddit", async () => {
              await removeSubreddit(s.name);
              await toast(`r/${s.name} removed`, { style: "success" });
              return refresh();
            }, {
              icon: Icons.trash,
              destructive: true,
              confirm: `Remove r/${s.name}?`,
              section: "Danger",
              shortcut: "<Ctrl>Delete",
            }),
          ]),
        ],
      }));
      const name = subredditName(query);
      if (name && !subs.some((s) => s.name.toLowerCase() === name.toLowerCase())) {
        items.unshift({
          id: "add",
          title: `Add r/${name}`,
          subtitle: "Follow it in the Reddit command",
          icon: { source: Icons.plus, tint: "green" },
          actions: [
            action(`Add r/${name}`, async () => {
              await addSubreddit(name);
              await toast(`r/${name} added`, { style: "success" });
              return refresh();
            }, { icon: Icons.plus }),
            action(`Browse r/${name}`, () => subredditList(name, nsfw), { icon: Icons.comment }),
          ],
        });
      }
      return items;
    },
  });
};
