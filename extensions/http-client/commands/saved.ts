import { action, Icons, list } from "@backslash/api";
import { clearHistory, historyItem, live, loadHistory, loadSaved, requestForm, savedItem } from "../views.ts";

export default list({
  placeholder: "Filter saved requests and history…",
  empty: {
    title: "No saved requests",
    description: "Press Ctrl+N to save one, or send a request from the Send HTTP Request command.",
    icon: Icons.bookmark,
  },
  actions: [
    action("New Saved Request…", () => requestForm({ after: "pop" }), { icon: Icons.plus, shortcut: "<Ctrl>n" }),
    action("Clear History", async () => {
      await clearHistory();
    }, { icon: Icons.trash, destructive: true, confirm: "Forget every request in the history?", section: "Danger" }),
  ],
  status: (items) => {
    const saved = items.filter((i) => i.section === "Saved").length;
    return `${saved} saved · ${items.length - saved} in history`;
  },
  // Reloads after a save, an edit or a deletion made from this list.
  items: ({ signal }) =>
    live(async () => {
      const [saved, history] = await Promise.all([loadSaved(), loadHistory()]);
      return [...saved.map((s) => savedItem(s, "pop")), ...history.map((h) => historyItem(h, "pop"))];
    }, signal),
});
