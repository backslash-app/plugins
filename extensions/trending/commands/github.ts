import { Icons, type Item, list, open } from "@backslash/api";
import { cached, githubTrending } from "../api.ts";
import {
  mergeTrending,
  parseLanguages,
  repoItem,
  type Since,
  SINCE_LABELS,
  type TrendingRepo,
  trendingUrl,
} from "../lib.ts";

let summary = "";

export default list({
  placeholder: "Filter trending repositories by name, description, language…",
  filter: {
    options: (Object.keys(SINCE_LABELS) as Since[]).map((value) => ({ value, title: SINCE_LABELS[value].chip })),
    default: "daily",
  },
  empty: {
    title: "Nothing trending",
    description: "GitHub has no trending repository for these languages right now.",
    icon: Icons.star,
  },
  status: () => summary,
  actions: [open("https://github.com/trending", "Open GitHub Trending")],
  async *items({ preferences, filter, signal }) {
    const since = (filter && filter in SINCE_LABELS ? filter : "daily") as Since;
    const languages = parseLanguages(preferences.languages);
    const wanted = languages.length ? languages : [""];
    summary = "";
    const key = `github:${since}:${wanted.join(",")}`;
    for await (
      const { value, fresh } of cached(key, () => Promise.all(wanted.map((l) => githubTrending(since, l, signal))))
    ) {
      const lists = value as TrendingRepo[][];
      let items: Item[];
      if (wanted.length > 1) {
        // One section per language, in the order of the preference.
        items = lists.flatMap((repos, i) =>
          repos.map((r) => ({ ...repoItem(r, since, repos[0]?.language ?? wanted[i]), id: `${wanted[i]}:${r.url}` }))
        );
      } else {
        items = mergeTrending(lists).map((r) => repoItem(r, since));
      }
      const total = mergeTrending(lists).length;
      summary = `${total} repositories ${SINCE_LABELS[since].period}${fresh ? "" : " · refreshing…"}`;
      yield [
        ...items,
        ...(items.length ? [] : [{
          id: "open",
          title: "Open GitHub Trending",
          icon: Icons.external,
          actions: [open(trendingUrl(since, wanted[0]), "Open in Browser")],
        }]),
      ];
    }
  },
});
