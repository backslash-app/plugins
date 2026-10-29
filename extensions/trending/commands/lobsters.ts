import { Icons, list, open } from "@backslash/api";
import { cached, lobsters } from "../api.ts";
import { LOBSTERS_FEEDS, type LobstersFeed, type LobstersStory, storyItem } from "../lib.ts";

let summary = "";

export default list({
  placeholder: "Filter stories by title, tag, site, submitter…",
  filter: {
    options: (Object.keys(LOBSTERS_FEEDS) as LobstersFeed[]).map((value) => ({ value, title: LOBSTERS_FEEDS[value] })),
    default: "hottest",
  },
  empty: { title: "No stories", description: "Lobsters returned nothing.", icon: Icons.arrowUp },
  status: () => summary,
  actions: [open("https://lobste.rs", "Open Lobsters")],
  async *items({ filter, signal }) {
    const feed = (filter && filter in LOBSTERS_FEEDS ? filter : "hottest") as LobstersFeed;
    summary = "";
    for await (const { value, fresh } of cached(`lobsters:${feed}`, () => lobsters(feed, signal))) {
      const stories = value as LobstersStory[];
      summary = `${stories.length} ${LOBSTERS_FEEDS[feed].toLowerCase()} stories${fresh ? "" : " · refreshing…"}`;
      yield stories.map((s, i) => storyItem(s, i + 1));
    }
  },
});
