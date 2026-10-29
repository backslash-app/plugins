import { type Context, Icons, type Item, list, updateCommandMetadata } from "@backslash/api";
import { claimed as loadClaimed, epic, giveaways } from "../api.ts";
import { type FreeGame, type Giveaway, withoutEpic } from "../lib.ts";
import { epicItem, giveawayItem } from "../views.ts";

let footer = "";

const failure = (id: string, service: string, e: unknown): Item => ({
  id,
  title: `${service} couldn't be reached`,
  subtitle: (e as Error).message,
  icon: { source: Icons.alert, tint: "red" },
  section: "Problems",
});

export default (ctx: Context) => {
  const platform = String(ctx.preferences.platform ?? "pc").trim().toLowerCase() || "pc";
  return list({
    placeholder: "Filter free games…",
    filter: {
      options: [
        { value: "all", title: "All" },
        { value: "epic", title: "Epic Games Store" },
        { value: "giveaways", title: "Giveaways" },
      ],
    },
    empty: { title: "No free game right now", description: "Check again in a few days", icon: Icons.gamepad },
    status: () => footer,
    async *items({ signal, filter }) {
      const view = filter ?? "all";
      const claimedIds = new Set(await loadClaimed());
      const problems: Item[] = [];
      let free: { now: FreeGame[]; upcoming: FreeGame[] } = { now: [], upcoming: [] };
      let gifts: Giveaway[] = [];
      const [e, g] = await Promise.allSettled([
        view === "giveaways" ? Promise.resolve(free) : epic(signal),
        view === "epic" ? Promise.resolve(gifts) : giveaways(platform, signal),
      ]);
      if (signal.aborted) return;
      if (e.status === "fulfilled") free = e.value;
      else problems.push(failure("epic-error", "The Epic Games Store", e.reason));
      if (g.status === "fulfilled") gifts = withoutEpic(g.value, [...free.now, ...free.upcoming]);
      else problems.push(failure("gp-error", "GamerPower", g.reason));

      const now = Date.now();
      const epicNow = free.now.map((x) => epicItem(x, { claimed: claimedIds.has(x.id) }, now));
      const epicNext = free.upcoming.map((x) => epicItem(x, { upcoming: true, claimed: false }, now));
      const gp = gifts.map((x) => giveawayItem(x, { claimed: claimedIds.has(`gp:${x.id}`) }, now));
      // Claimed ones go last.
      const items = [...epicNow, ...epicNext, ...gp];
      const open = items.filter((i) => i.section !== "Claimed");
      const done = items.filter((i) => i.section === "Claimed");
      const unclaimed = free.now.filter((x) => !claimedIds.has(x.id)).length;
      if (view === "all") {
        updateCommandMetadata({ subtitle: unclaimed ? `${unclaimed} free on Epic to claim` : null }).catch(() => {});
      }
      footer = [
        view !== "giveaways" ? `${free.now.length} free on Epic` : "",
        view !== "epic" ? `${gifts.length} giveaway${gifts.length === 1 ? "" : "s"} (${platform})` : "",
      ].filter(Boolean).join(" · ");
      yield [...problems, ...open, ...done];
    },
  });
};
