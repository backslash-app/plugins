import { action, Icons, list } from "@backslash/api";
import { sortCountdowns } from "../lib.ts";
import { countdownForm, countdownItem, live, loadAll, pinnedId, suggestionItems, syncSubtitle } from "../countdowns.ts";

let footer = "";

export default list({
  placeholder: "Search countdowns…",
  empty: { title: "No countdown", description: "Press Ctrl+N to add one", icon: Icons.hourglass },
  status: () => footer,
  actions: [action("New Countdown", () => countdownForm(), { icon: Icons.plus, shortcut: "<Ctrl>n" })],
  items: ({ signal }) =>
    live(async () => {
      const now = new Date();
      const [all, pinned] = await Promise.all([loadAll(), pinnedId()]);
      await syncSubtitle(all, pinned ?? "");
      if (!all.length) {
        footer = "Add a date to count down to";
        return suggestionItems(now);
      }
      const sorted = sortCountdowns(all, now);
      const upcoming = sorted.filter((c) => countdownItem(c, now, false).section !== "Past").length;
      footer = `${upcoming} upcoming${all.length > upcoming ? ` · ${all.length - upcoming} past` : ""}`;
      // The pinned one comes first, in its own section.
      return [
        ...sorted.filter((c) => c.id === pinned).map((c) => ({ ...countdownItem(c, now, true), section: "Pinned" })),
        ...sorted.filter((c) => c.id !== pinned).map((c) => countdownItem(c, now, false)),
      ];
    }, signal),
});
