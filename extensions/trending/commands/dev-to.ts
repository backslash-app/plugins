import { Icons, list, type ListSpec, open } from "@backslash/api";
import { cached, devArticles } from "../api.ts";
import { articleItem, DEV_PERIODS, type DevArticle, type DevPeriod, tagActions } from "../lib.ts";

let summary = "";

function articles(tag: string, title?: string): ListSpec {
  return list({
    title,
    placeholder: "Filter articles by title, tag, author…",
    filter: {
      options: (Object.keys(DEV_PERIODS) as DevPeriod[]).map((value) => ({ value, title: DEV_PERIODS[value].chip })),
      default: "week",
    },
    empty: {
      title: "No articles",
      description: tag ? `Nothing tagged #${tag} for this period.` : "DEV returned nothing.",
      icon: Icons.book,
    },
    status: () => summary,
    actions: [open(tag ? `https://dev.to/t/${tag}/top/week` : "https://dev.to/top/week", "Open DEV")],
    async *items({ preferences, filter, signal }) {
      const period = (filter && filter in DEV_PERIODS ? filter : "week") as DevPeriod;
      const t = tag || String(preferences.devtoTag ?? "").trim().replace(/^#/, "").toLowerCase();
      summary = "";
      for await (const { value, fresh } of cached(`dev:${period}:${t}`, () => devArticles(period, t, signal))) {
        const list = value as DevArticle[];
        summary = `${list.length} articles${t ? ` · #${t}` : ""}${fresh ? "" : " · refreshing…"}`;
        yield list.map((a) => articleItem(a, tagActions(a, (other) => articles(other, `#${other}`))));
      }
    },
  });
}

export default articles("");
