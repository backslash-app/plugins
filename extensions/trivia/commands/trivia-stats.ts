import { action, copy, detail, Icons, refresh } from "@backslash/api";
import { resetStats, stats } from "../api.ts";
import { percent, shareText, statsMarkdown } from "../lib.ts";

export default async () => {
  const s = await stats();
  return detail({
    title: "Trivia Score",
    markdown: statsMarkdown(s),
    stats: [
      { label: "Answered", value: s.answered },
      { label: "Right", value: s.answered ? percent(s) : "–", color: "green" },
      { label: "Streak", value: s.streak, color: "orange" },
      { label: "Best streak", value: s.best, color: "purple" },
    ],
    status: s.answered ? `${s.correct} of ${s.answered} right` : "No answers yet",
    actions: [
      copy(shareText(s), "Copy Score"),
      action("Reset Score", async () => {
        await resetStats();
        return refresh();
      }, { icon: Icons.trash, destructive: true, confirm: "Reset your score and best streak?" }),
    ],
  });
};
