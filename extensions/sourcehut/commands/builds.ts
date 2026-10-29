import { type Action, action, Icons, list, refresh, toast, updateCommandMetadata } from "@backslash/api";
import { countStatus, gql, guarded, paged, token } from "../api.ts";
import {
  CANCEL_MUTATION,
  currentFailures,
  isActive,
  isFailed,
  type Job,
  JOB_MANIFEST_QUERY,
  jobItem,
  JOBS_QUERY,
  type Page,
  sortJobs,
  SUBMIT_MUTATION,
} from "../lib.ts";

function jobActions(t: string, j: Job): Action[] {
  const out: Action[] = [];
  if (!isActive(j)) {
    out.push(action("Resubmit", async (ctx) => {
      const { job } = await gql<{ job: { manifest: string; note?: string; tags: string[]; visibility?: string } }>(
        t,
        "builds",
        JOB_MANIFEST_QUERY,
        { id: j.id },
        ctx.signal,
      );
      const { submit } = await gql<{ submit: { id: number } }>(t, "builds", SUBMIT_MUTATION, {
        manifest: job.manifest,
        tags: job.tags,
        note: job.note ?? null,
        visibility: job.visibility ?? null,
      });
      await toast(`Submitted job #${submit.id}`, { style: "success", message: `Again from #${j.id}` });
      return refresh();
    }, { icon: Icons.refresh, shortcut: "<Ctrl><Shift>r", section: "Job" }));
  } else {
    out.push(action("Cancel Job", async () => {
      await gql(t, "builds", CANCEL_MUTATION, { id: j.id });
      await toast(`Cancelled job #${j.id}`, { style: "success" });
      return refresh();
    }, {
      icon: Icons.stop,
      destructive: true,
      confirm: `Cancel job #${j.id}?`,
      shortcut: "<Ctrl><Shift>x",
      section: "Job",
    }));
  }
  out.push(action("Reload", () => refresh(), { icon: Icons.refresh, shortcut: "<Ctrl>r" }));
  return out;
}

export default list({
  placeholder: "Filter jobs by note, tag, image…",
  filter: {
    options: [
      { value: "all", title: "All" },
      { value: "failed", title: "Failed" },
      { value: "running", title: "Running" },
    ],
    default: "all",
  },
  empty: {
    title: "No builds",
    description: "Push to a git.sr.ht repository with a .build.yml to start one.",
    icon: Icons.cycle,
  },
  status: (items) => countStatus(items, "job"),
  items: ({ preferences, signal, filter }) =>
    guarded(async () => {
      const t = token(preferences);
      const jobs = await paged<Job, { jobs: Page<Job> }>(t, "builds", JOBS_QUERY, (d) => d.jobs, 2, {}, signal);
      const failing = currentFailures(jobs);
      const running = jobs.filter(isActive).length;
      updateCommandMetadata({
        subtitle: [failing.size ? `${failing.size} failing` : "", running ? `${running} running` : ""]
          .filter(Boolean).join(" · ") || null,
      }).catch(() => {});
      const shown = jobs.filter((j) => filter === "failed" ? isFailed(j) : filter === "running" ? isActive(j) : true);
      return sortJobs(shown, failing).map((j) => jobItem(j, failing, jobActions(t, j)));
    }),
});
