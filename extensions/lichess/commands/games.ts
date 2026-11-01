import { action, Icons, type Item, list, open, refresh, updateCommandMetadata } from "@backslash/api";
import { gameCount, myUsername, playing, type Prefs, tokenOf } from "../api.ts";
import { playingItem, recentGames } from "../items.ts";
import { type GameSummary, recordText, SITE } from "../lib.ts";

/** The games shown, by item id, for the status line. */
const shown = new Map<string, GameSummary>();

export default list({
  placeholder: "Filter by opponent, opening, result, time control…",
  empty: { title: "No games yet", description: "Your games on Lichess show up here", icon: Icons.gamepad },
  status: (items) => {
    const myTurn = items.filter((i) => i.section === "Your turn").length;
    const finished = items.flatMap((i) => shown.get(i.id ?? "") ?? []);
    return [myTurn ? `${myTurn} waiting for your move` : "", recordText(finished)].filter(Boolean).join(" · ");
  },
  async *items({ preferences, signal }) {
    const prefs = preferences as Prefs;
    const name = myUsername(prefs);
    const token = tokenOf(prefs);
    const current: Item[] = [];
    if (token) {
      const now = await playing(token, signal);
      now.sort((a, b) => Number(b.isMyTurn) - Number(a.isMyTurn) || (a.secondsLeft ?? 0) - (b.secondsLeft ?? 0));
      current.push(...now.map(playingItem));
      const mine = now.filter((p) => p.isMyTurn).length;
      await updateCommandMetadata({ subtitle: mine ? `${mine} waiting for your move` : null }).catch(() => {});
      if (current.length) yield current;
    }
    const recent = await recentGames(name, { count: gameCount(prefs), token }, signal);
    if (recent.unknown) {
      throw new Error(`No Lichess account named ${name}: check your username in Settings → Extensions → Lichess`);
    }
    shown.clear();
    for (const g of recent.games) shown.set(`game:${g.id}`, g);
    // With a token, games in progress are already listed above with their board.
    const items = recent.items.filter((i) => !token || shown.get(i.id ?? "")?.result !== "ongoing");
    yield [...current, ...items];
  },
  actions: [
    action("Reload", () => refresh(), { icon: Icons.refresh, shortcut: "<Ctrl>r" }),
    open(SITE, "Open Lichess", { icon: Icons.globe }),
  ],
});
