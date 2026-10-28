// Adding and removing feeds, shared by "RSS Feeds" and "Add RSS Feed".

import { type Effect, field, form, type FormSpec, toast } from "@backslash/api";
import { findFeed, type SavedFeed, savedFeeds, setFeeds } from "./api.ts";
import { feedList } from "./lib.ts";

// Views of this extension run in one process: adding a feed from a form
// reloads the list still open below it.
const changes = new EventTarget();

export const notifyChanged = () => changes.dispatchEvent(new Event("change"));

/** Yields `load()`, then again after each change, until `signal` aborts. */
export async function* live<T>(load: () => AsyncIterable<T>, signal: AbortSignal): AsyncGenerator<T> {
  while (!signal.aborted) {
    for await (const value of load()) yield value;
    await new Promise<void>((resolve) => {
      const done = () => {
        changes.removeEventListener("change", done);
        signal.removeEventListener("abort", done);
        resolve();
      };
      changes.addEventListener("change", done);
      signal.addEventListener("abort", done);
    });
  }
}

/** Feeds from the preference, then those added from the launcher. */
export async function allFeeds(pref: unknown): Promise<(SavedFeed & { fromPreferences: boolean })[]> {
  const saved = await savedFeeds();
  const fromPrefs = feedList(pref).filter((u) => !saved.some((s) => s.url === u));
  return [
    ...fromPrefs.map((url) => ({ url, fromPreferences: true })),
    ...saved.map((s) => ({ ...s, fromPreferences: false })),
  ];
}

export async function removeFeed(url: string): Promise<void> {
  await setFeeds((await savedFeeds()).filter((f) => f.url !== url));
  notifyChanged();
}

export function addFeedForm(done: (title: string) => Effect): FormSpec {
  return form({
    title: "Add RSS Feed",
    submitTitle: "Add Feed",
    fields: [
      field.text("url", "Address", { placeholder: "https://example.com/feed.xml or a website", required: true }),
      field.text("title", "Name", { placeholder: "Optional: the feed's own title by default" }),
    ],
    async submit(values, ctx) {
      let raw = String(values.url ?? "").trim();
      if (!raw) throw new Error("Enter the address of a feed");
      if (!/^https?:\/\//i.test(raw)) raw = `https://${raw}`;
      const { url, feed } = await findFeed(raw, ctx.signal);
      const feeds = await savedFeeds();
      if (feeds.some((f) => f.url === url) || feedList(ctx.preferences.feeds).includes(url)) {
        throw new Error(`Already subscribed to ${feed.title}`);
      }
      const title = String(values.title ?? "").trim() || feed.title;
      await setFeeds([...feeds, { url, title }]);
      notifyChanged();
      await toast(`Subscribed to ${title}`, { style: "success", message: `${feed.items.length} articles` });
      return done(title);
    },
  });
}
