import { Icons, type Item, list, updateCommandMetadata } from "@backslash/api";
import { overview } from "../api.ts";
import { AuthError, keyOf, moneyList, setupItem, sortFriends, sortGroups, totals } from "../lib.ts";
import { friendItem, groupItem, totalItem } from "../views.ts";

let status = "";

export default list({
  placeholder: "Filter friends and groups…",
  filter: {
    options: [
      { value: "unsettled", title: "Unsettled" },
      { value: "friends", title: "Friends" },
      { value: "groups", title: "Groups" },
    ],
  },
  status: () => status,
  empty: {
    title: "All settled up",
    description: "Nobody owes you and you owe nobody. Tab shows every friend and group.",
    icon: Icons.coin,
  },
  async items({ preferences, signal, filter, launchType }) {
    let key: string;
    try {
      key = keyOf(preferences);
    } catch (e) {
      if (e instanceof AuthError) return [setupItem(e)];
      throw e;
    }
    let o;
    try {
      o = await overview(key, signal);
    } catch (e) {
      if (e instanceof AuthError) return [setupItem(e)];
      throw e;
    }
    const t = totals(o.friends);
    status = [t.owed.length ? `owed ${moneyList(t.owed)}` : "", t.owe.length ? `you owe ${moneyList(t.owe)}` : ""]
      .filter(Boolean).join(" · ") || "All settled up";
    if (launchType !== "background") {
      await updateCommandMetadata({ subtitle: status === "All settled up" ? null : status }).catch(() => {});
    }
    const friends = sortFriends(o.friends);
    const groups = sortGroups(o.groups);
    const items: Item[] = [];
    if (filter !== "groups") {
      if (filter !== "friends") items.push(totalItem(t));
      items.push(
        ...friends.filter((f) => filter === "friends" || f.direction !== "settled").map((f) => friendItem(key, f)),
      );
    }
    if (filter !== "friends") {
      items.push(
        ...groups.filter((g) => filter === "groups" || g.direction !== "settled").map((g) => groupItem(key, g)),
      );
    }
    return filter === "unsettled" || !filter ? (items.length > 1 ? items : []) : items;
  },
});
