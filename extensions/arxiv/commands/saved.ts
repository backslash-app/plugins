import { Icons, list } from "@backslash/api";
import { saved } from "../api.ts";
import { paperItem } from "../views.ts";

export default list({
  placeholder: "Filter saved papers…",
  empty: {
    title: "No saved paper",
    description: "Press Ctrl+S on a paper in Search arXiv or New on arXiv to keep it here",
    icon: Icons.bookmark,
  },
  status: (items) => `${items.length} saved paper${items.length === 1 ? "" : "s"}`,
  async items() {
    const papers = await saved();
    const c = { saved: new Set(papers.map((p) => p.id)) };
    return papers.map((p) => paperItem(p, c));
  },
});
