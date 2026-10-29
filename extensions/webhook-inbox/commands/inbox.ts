import { type Context, Icons, type Item, list, updateCommandMetadata } from "@backslash/api";
import { current, GoneError, inboxes, type Prefs, replaySettings, requests } from "../api.ts";
import { createItem, hookItem, pause, urlItem } from "../views.ts";

const POLL = 3000;

let summary = "";

// The current webhook URL and the requests sent to it, refreshed every few seconds while open.
export default (ctx: Context) => {
  const prefs = ctx.preferences as Prefs;
  return list({
    placeholder: "Filter requests by method, path, sender, content type…",
    empty: { title: "No requests yet", description: "Send one to the webhook URL", icon: Icons.inbox },
    status: () => summary,
    async *items({ signal }) {
      summary = "";
      let failures = 0;
      let lastTotal = -1;
      while (!signal.aborted) {
        const inbox = await current();
        if (!inbox) {
          summary = "Create a URL to start";
          yield [createItem(prefs)];
          await pause(60_000, signal);
          continue;
        }
        let items: Item[];
        try {
          const [page, all, saved] = await Promise.all([
            requests(prefs, inbox.uuid, signal),
            inboxes(),
            replaySettings(),
          ]);
          failures = 0;
          items = [
            urlItem(prefs, inbox, all, page.total),
            ...page.data.map((h) => hookItem(prefs, h, inbox, all, saved)),
          ];
          summary = `${page.total} request${page.total === 1 ? "" : "s"}${
            page.total > page.data.length ? ` (newest ${page.data.length} shown)` : ""
          } · live`;
          if (page.total !== lastTotal) {
            lastTotal = page.total;
            await updateCommandMetadata({ subtitle: page.total ? `${page.total} requests` : null }).catch(() => {});
          }
        } catch (e) {
          if (signal.aborted) return;
          if (e instanceof GoneError) {
            summary = "Expired";
            yield [createItem(prefs, inbox)];
            await pause(60_000, signal);
            continue;
          }
          // A hiccup while polling keeps the last list; three in a row show the error.
          if (++failures < 3) {
            await pause(POLL, signal);
            continue;
          }
          throw e;
        }
        yield items;
        await pause(POLL, signal);
      }
    },
  });
};
