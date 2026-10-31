import { Icons, list } from "@backslash/api";
import { history } from "../system.ts";
import { historyItems } from "../ui.ts";

let count = 0;

export default list({
  placeholder: "Filter by title, artist, album…",
  empty: { title: "No songs yet", description: "Recognize Song adds the songs it finds here", icon: Icons.music },
  status: () => `${count} songs`,
  async items() {
    const list = await history();
    count = list.length;
    return historyItems(list);
  },
});
