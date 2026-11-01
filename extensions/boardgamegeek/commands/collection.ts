import { action, Icons, list, open, refresh } from "@backslash/api";
import { collection, type Prefs, tokenOf, usernameOf } from "../api.ts";
import { collectionItem, openSite, tokenRow } from "../items.ts";
import { type CollectionFilter, collectionPage } from "../lib.ts";

const FILTERS: { value: CollectionFilter; title: string }[] = [
  { value: "owned", title: "Owned" },
  { value: "wishlist", title: "Wishlist" },
  { value: "wanttoplay", title: "Want to Play" },
  { value: "rated", title: "Rated" },
];

let fresh = false;
let summary = "";

export default list({
  placeholder: "Filter your collection…",
  filter: { options: FILTERS, default: "owned" },
  empty: { title: "Nothing here", description: "Games you add on BoardGameGeek show up here", icon: Icons.dice },
  status: () => summary,
  async *items({ preferences, signal, filter }) {
    const prefs = preferences as Prefs;
    let token: string;
    try {
      token = tokenOf(prefs);
    } catch (e) {
      yield tokenRow(e);
      return;
    }
    const username = usernameOf(prefs);
    const kind = (FILTERS.find((f) => f.value === filter)?.value ?? "owned") as CollectionFilter;
    const wasFresh = fresh;
    fresh = false;
    try {
      for await (const result of collection(username, kind, token, { signal, fresh: wasFresh })) {
        if (result === "queued") {
          summary = "";
          yield [{
            id: "queued",
            title: "BoardGameGeek is preparing your collection…",
            subtitle: "It does this the first time in a while: it takes a few seconds",
            icon: { source: Icons.hourglass, tint: "blue" },
          }];
          continue;
        }
        const plays = result.reduce((n, c) => n + c.plays, 0);
        summary = `${result.length} game${result.length === 1 ? "" : "s"} · ${plays} play${plays === 1 ? "" : "s"}`;
        yield result.sort((a, b) => a.name.localeCompare(b.name)).map((c) =>
          collectionItem(c, {
            actions: [
              action("Reload", () => {
                fresh = true;
                return refresh();
              }, { icon: Icons.refresh, shortcut: "<Ctrl>r" }),
              open(collectionPage(username), "Open My Collection", { icon: Icons.external, shortcut: "<Ctrl>o" }),
            ],
          })
        );
      }
    } catch (e) {
      summary = "";
      yield tokenRow(e);
    }
  },
  actions: [openSite()],
});
