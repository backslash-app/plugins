import { action, Icons, list, open, refresh } from "@backslash/api";
import { plays, type Prefs, tokenOf, usernameOf } from "../api.ts";
import { openSite, playItem, tokenRow } from "../items.ts";
import { playsPage, playStats } from "../lib.ts";

let fresh = false;
let summary = "";

export default list({
  placeholder: "Filter plays by game, player or place…",
  empty: { title: "No plays logged", description: "Plays you log on BoardGameGeek show up here", icon: Icons.dice },
  status: () => summary,
  async items({ preferences, signal }) {
    const prefs = preferences as Prefs;
    try {
      const token = tokenOf(prefs);
      const username = usernameOf(prefs);
      const wasFresh = fresh;
      fresh = false;
      const result = await plays(username, token, signal, wasFresh);
      const s = playStats(result.plays, username);
      summary = [
        `${result.total} plays logged`,
        s.withMe ? `won ${s.wins} of the last ${s.withMe}` : "",
        s.mostPlayed ? `most played lately: ${s.mostPlayed.game}` : "",
      ].filter(Boolean).join(" · ");
      return result.plays.map((p) =>
        playItem(p, username, {
          actions: [
            action("Reload", () => {
              fresh = true;
              return refresh();
            }, { icon: Icons.refresh, shortcut: "<Ctrl>r" }),
            open(playsPage(username), "Open My Plays", { icon: Icons.external, shortcut: "<Ctrl>o" }),
          ],
        })
      );
    } catch (e) {
      summary = "";
      return tokenRow(e);
    }
  },
  actions: [openSite()],
});
