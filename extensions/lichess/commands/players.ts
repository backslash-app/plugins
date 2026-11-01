import { Icons, type Item, list, open } from "@backslash/api";
import { autocomplete, gameCount, type Prefs, tokenOf, user } from "../api.ts";
import { profileItems } from "../items.ts";
import { cleanUsername, displayName, profileUrl, SITE } from "../lib.ts";

const hint = (title: string, subtitle: string): Item => ({
  id: "hint",
  title,
  subtitle,
  icon: { source: Icons.search, tint: "gray" },
  actions: [open(SITE, "Open Lichess")],
});

export default list({
  placeholder: "A Lichess username, e.g. DrNykterstein",
  empty: { title: "No player by that name", icon: Icons.person },
  status: (items) => items.find((i) => i.id?.startsWith("user:"))?.title ?? "",
  async search(query, { preferences, signal }) {
    const prefs = preferences as Prefs;
    const o = { count: gameCount(prefs), token: tokenOf(prefs) };
    const typed = cleanUsername(query);
    if (!query.trim()) {
      const mine = cleanUsername(String(prefs.username ?? ""));
      if (!mine) {
        return [hint("Type a username", "Set yours in Settings → Extensions → Lichess to see it here")];
      }
      const me = await user(mine, signal);
      return me ? profileItems(me, o) : [hint(`No Lichess account named ${mine}`, "Check your username")];
    }
    if (!typed) return [hint("Not a Lichess username", "Letters, digits, - and _ only")];
    const [found, suggestions] = await Promise.all([
      user(typed, signal),
      autocomplete(typed, signal).catch(() => []),
    ]);
    const others = suggestions
      .filter((s) => s.id !== found?.id)
      .map((s): Item => ({
        id: `suggestion:${s.id}`,
        title: displayName(s.name, s.title),
        icon: { source: Icons.person, tint: s.patron ? "yellow" : "gray" },
        section: "Other players",
        accessories: s.online ? [{ tag: "Online", color: "green" }] : [],
        actions: [open(profileUrl(s.name), "Open Profile")],
      }));
    return [...(found ? profileItems(found, o) : []), ...others];
  },
});
