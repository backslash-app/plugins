// Subscribing by feed address, shared by "Podcasts" and "Search Podcasts".

import { type Effect, field, form, type FormSpec, toast } from "@backslash/api";
import { fetchFeed, subscribe, subscriptions } from "./api.ts";
import { normalizeFeedUrl } from "./lib.ts";

export function addFeedForm(done: () => Effect, url = ""): FormSpec {
  return form({
    title: "Add Podcast by Feed URL",
    submitTitle: "Subscribe",
    fields: [
      field.text("url", "Feed address", { placeholder: "https://example.com/podcast.rss", required: true, value: url }),
    ],
    async submit(values, ctx) {
      const address = normalizeFeedUrl(String(values.url ?? ""));
      if (!address) throw new Error("Enter the address of the podcast's RSS feed");
      if ((await subscriptions()).some((s) => s.feedUrl === address)) throw new Error("Already subscribed");
      const { show, episodes } = await fetchFeed(address, ctx.signal);
      await subscribe({ ...show, feedUrl: address });
      await toast(`Subscribed to ${show.title}`, { style: "success", message: `${episodes.length} episodes` });
      return done();
    },
  });
}
