import { action, copy, detail, Icons, type Item, list } from "@backslash/api";
import { cleanReport, parseReports, reportArgs, sortReports } from "../lib.ts";
import { SetupError, setupItem, task } from "../tw.ts";

function reportView(name: string) {
  return async () => {
    const text = cleanReport(await task(reportArgs(name)));
    return detail({
      title: `task ${name}`,
      markdown: text ? "```\n" + text + "\n```" : "_This report is empty._",
      actions: [copy(text, "Copy Report"), copy(`task ${name}`, "Copy Command")],
    });
  };
}

export default list({
  placeholder: "Filter Taskwarrior reports…",
  empty: { title: "No report found", icon: Icons.chartUp },
  status: (items) => `${items.length} reports`,
  async items({ signal }): Promise<Item[]> {
    try {
      const reports = sortReports(parseReports(await task(["rc.color=off", "rc.hooks=off", "reports"], signal)));
      return reports.map((r) => ({
        id: r.name,
        title: r.name,
        subtitle: r.description,
        icon: { source: Icons.chartUp, tint: "purple" },
        detail: { markdown: `### task ${r.name}\n\n${r.description}\n\nPress Enter to run it.` },
        actions: [
          action("Show Report", reportView(r.name), { icon: Icons.eye }),
          copy(`task ${r.name}`, "Copy Command"),
        ],
      }));
    } catch (e) {
      if (e instanceof SetupError) return [setupItem(e)];
      throw e;
    }
  },
});
