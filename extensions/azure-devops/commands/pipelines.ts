import { type Action, action, Icons, list, refresh, toast, updateCommandMetadata } from "@backslash/api";
import { ado, type Auth, auth, guarded, projectPath, projects } from "../api.ts";
import { type Build, buildItem, currentFailures, queueBody, runStatus, sortBuilds } from "../lib.ts";

let summary = "";

function runActions(a: Auth, b: Build): Action[] {
  const path = `/${encodeURIComponent(b.project.name)}/_apis/build/builds`;
  const label = `${b.definition.name} ${b.buildNumber}`;
  const s = runStatus(b);
  const out: Action[] = [];
  if (s === "failed" || s === "partial" || s === "canceled") {
    out.push(action("Rerun Failed Jobs", async () => {
      await ado(a, `${path}/${b.id}?retry=true`, { method: "PATCH", body: {} });
      await toast(`Retrying the failed jobs of ${label}`, { style: "success" });
      return refresh();
    }, { icon: Icons.refresh, shortcut: "<Ctrl><Shift>r", section: "Run" }));
  }
  if (s !== "running" && s !== "queued") {
    out.push(action("Run Again", async () => {
      const queued = await ado<Build>(a, path, { method: "POST", body: queueBody(b) });
      await toast(`Queued ${b.definition.name} ${queued.buildNumber}`, { style: "success" });
      return refresh();
    }, { icon: Icons.play, section: "Run" }));
  } else {
    out.push(action("Cancel", async () => {
      await ado(a, `${path}/${b.id}`, { method: "PATCH", body: { status: "cancelling" } });
      await toast(`Canceling ${label}`, { style: "success" });
      return refresh();
    }, {
      icon: Icons.stop,
      destructive: true,
      confirm: `Cancel ${label}?`,
      shortcut: "<Ctrl><Shift>x",
      section: "Run",
    }));
  }
  out.push(action("Reload", () => refresh(), { icon: Icons.refresh, shortcut: "<Ctrl>r" }));
  return out;
}

export default list({
  placeholder: "Filter runs by pipeline, project, branch, person…",
  filter: {
    options: [
      { value: "all", title: "All" },
      { value: "failed", title: "Failed" },
      { value: "running", title: "Running" },
    ],
    default: "all",
  },
  empty: { title: "No pipeline runs", description: "Nothing matches this filter.", icon: Icons.cycle },
  status: (items) => items[0]?.id === "setup" ? "Not connected" : summary,
  items: ({ preferences, signal, filter }) =>
    guarded(async () => {
      const a = auth(preferences);
      const list = await projects(a, signal);
      const lists = await Promise.all(list.map((p) =>
        ado<{ value: Build[] }>(a, `${projectPath(p)}/_apis/build/builds?$top=30&queryOrder=queueTimeDescending`, {
          signal,
        }).then((r) => r.value).catch(() => [] as Build[])
      ));
      const builds = lists.flat();
      const failing = currentFailures(builds);
      const running = builds.filter((b) =>
        runStatus(b) === "running"
      ).length;
      summary = [
        `${builds.length} runs`,
        failing.size ? `${failing.size} failing` : "",
        running ? `${running} running` : "",
      ]
        .filter(Boolean).join(" · ");
      updateCommandMetadata({
        subtitle: [failing.size ? `${failing.size} failing` : "", running ? `${running} running` : ""]
          .filter(Boolean).join(" · ") || null,
      }).catch(() => {});
      const shown = builds.filter((b) => {
        const s = runStatus(b);
        if (filter === "failed") return s === "failed" || s === "partial";
        if (filter === "running") return s === "running" || s === "queued";
        return true;
      });
      return sortBuilds(shown, failing).map((b) => buildItem(a.org, b, failing, runActions(a, b)));
    }),
});
