import {
  type Action,
  action,
  clipboard,
  close,
  type Context,
  copy,
  detail,
  Icons,
  type Item,
  list,
  type ListSpec,
  open,
  refresh,
  toast,
  updateCommandMetadata,
} from "@backslash/api";
import { AuthError, github, jobLog, setupItems, token } from "../api.ts";
import {
  arrange,
  isActive,
  isFailed,
  type Job,
  jobItem,
  jobToShow,
  logMarkdown,
  logTail,
  parseRepositories,
  recentRepos,
  type Repo,
  type Run,
  runItem,
  summary,
  workflowUrl,
} from "../lib.ts";

interface Prefs {
  repositories?: string;
  recent?: boolean;
  token?: string;
}

class SetupError extends Error {}

let shown = { total: 0, line: "" };

// --- Loading --------------------------------------------------------------------------

async function repositories(t: string, prefs: Prefs, signal: AbortSignal): Promise<string[]> {
  const names = parseRepositories(prefs.repositories);
  if (prefs.recent !== false) {
    const mine = await github<Repo[]>(
      t,
      "/user/repos?sort=pushed&per_page=40&affiliation=owner,collaborator,organization_member",
      { signal },
    );
    for (const name of recentRepos(mine)) {
      if (!names.some((n) => n.toLowerCase() === name.toLowerCase())) names.push(name);
    }
  }
  if (!names.length) {
    throw new SetupError(
      prefs.recent === false ? "Add repositories to watch" : "You haven't pushed to any repository in 30 days",
    );
  }
  return names;
}

async function loadRuns(t: string, prefs: Prefs, signal: AbortSignal) {
  const names = await repositories(t, prefs, signal);
  const results = await Promise.allSettled(
    names.map((name) => github<{ workflow_runs: Run[] }>(t, `/repos/${name}/actions/runs?per_page=30`, { signal })),
  );
  const runs: Run[] = [];
  const problems: { repo: string; error: string }[] = [];
  results.forEach((res, i) => {
    if (res.status === "fulfilled") runs.push(...(res.value?.workflow_runs ?? []));
    else if (res.reason instanceof AuthError) throw res.reason;
    else {
      problems.push({
        repo: names[i],
        error: /404/.test(String(res.reason)) ? "Not found, or no access" : String(res.reason?.message ?? res.reason),
      });
    }
  });
  return { runs, problems, repos: names };
}

const logs = new Map<string, Promise<string>>();

function cachedLog(t: string, repo: string, job: Job): Promise<string> {
  const key = `${repo}/${job.id}/${job.status}`;
  if (!logs.has(key)) {
    const p = jobLog(t, repo, job.id);
    p.catch(() => logs.delete(key));
    logs.set(key, p);
  }
  return logs.get(key)!;
}

const jobsOf = (t: string, run: Run, signal?: AbortSignal) =>
  github<{ jobs: Job[] }>(t, `/repos/${run.repository.full_name}/actions/runs/${run.id}/jobs?per_page=100`, { signal })
    .then((r) => r?.jobs ?? []);

// --- Views ----------------------------------------------------------------------------

function logView(t: string, run: Run, job: Job) {
  const repo = run.repository.full_name;
  return detail({
    title: job.name,
    markdown: async () => logMarkdown(job, await cachedLog(t, repo, job)),
    status: `${repo} · ${run.display_title}`,
    actions: [
      open(job.html_url, "Open Job in Browser"),
      action("Copy Log Tail", async () => {
        const { tail } = logTail(await cachedLog(t, repo, job), 200);
        await clipboard.write(tail.join("\n"));
        return close("Log copied");
      }, { icon: Icons.copy, shortcut: "<Ctrl><Shift>c", section: "Copy" }),
      copy(job.html_url, "Copy Job URL", { section: "Copy" }),
    ],
  });
}

async function failedLog(t: string, run: Run) {
  const job = jobToShow(await jobsOf(t, run));
  if (!job) throw new Error("This run has no jobs");
  return logView(t, run, job);
}

function jobsView(t: string, run: Run): ListSpec {
  const repo = run.repository.full_name;
  return list({
    title: `${run.display_title} · #${run.run_number}`,
    placeholder: "Filter jobs and steps…",
    empty: { title: "No jobs yet", description: "The run hasn't started any job.", icon: Icons.layers },
    status: (items) => `${items.length} job${items.length === 1 ? "" : "s"} · ${repo}`,
    actions: [open(run.html_url, "Open Run in Browser")],
    async items({ signal }) {
      const jobs = await jobsOf(t, run, signal);
      // Failed first, then running, then the rest, each in GitHub's order.
      const rank = (j: Job) => (isFailed(j) ? 0 : isActive(j) ? 1 : 2);
      return [...jobs].sort((a, b) => rank(a) - rank(b)).map((job) =>
        jobItem(job, [
          ...(isFailed(job) ? [action("View Log", () => logView(t, run, job), { icon: Icons.text })] : []),
          open(job.html_url, "Open Job in Browser"),
          ...(isFailed(job) ? [] : [action("View Log", () => logView(t, run, job), { icon: Icons.text })]),
          ...(job.status === "completed"
            ? [action("Re-run Job", async () => {
              await github(t, `/repos/${repo}/actions/jobs/${job.id}/rerun`, { method: "POST" });
              await toast(`Re-running “${job.name}”`, { style: "success" });
              return refresh();
            }, { icon: Icons.refresh, shortcut: "<Ctrl>r", section: "Job" })]
            : []),
          copy(job.html_url, "Copy Job URL", { shortcut: "<Ctrl><Shift>c", section: "Copy" }),
        ])
      );
    },
  });
}

function runActions(t: string, run: Run): Action[] {
  const repo = run.repository.full_name;
  const post = (path: string, done: string) => async () => {
    await github(t, `/repos/${repo}/actions/runs/${run.id}/${path}`, { method: "POST" });
    await toast(done, { style: "success" });
    return refresh();
  };
  const failed = isFailed(run);
  const wf = workflowUrl(run);
  return [
    open(run.html_url, "Open in Browser"),
    ...(failed
      ? [action("View Failed Job Log", () => failedLog(t, run), { icon: Icons.text, shortcut: "<Ctrl>l" })]
      : []),
    action("Show Jobs", () => jobsView(t, run), { icon: Icons.layers, shortcut: "<Ctrl>j" }),
    ...(failed
      ? [action("Re-run Failed Jobs", post("rerun-failed-jobs", "Re-running the failed jobs"), {
        icon: Icons.refresh,
        shortcut: "<Ctrl>r",
        section: "Run",
      })]
      : []),
    ...(run.status === "completed"
      ? [action("Re-run All Jobs", post("rerun", "Re-running all jobs"), {
        icon: Icons.refresh,
        shortcut: failed ? "<Ctrl><Shift>r" : "<Ctrl>r",
        section: "Run",
      })]
      : []),
    ...(wf ? [open(wf, "Open Workflow Runs", { icon: Icons.activity, section: "Run" })] : []),
    open(`${run.repository.html_url}/actions`, "Open Repository Actions", { icon: Icons.repository, section: "Run" }),
    copy(run.html_url, "Copy Run URL", { shortcut: "<Ctrl><Shift>c", section: "Copy" }),
    copy(run.head_sha, "Copy Commit SHA", { icon: Icons.commit, section: "Copy" }),
    ...(run.head_branch ? [copy(run.head_branch, "Copy Branch Name", { icon: Icons.branch, section: "Copy" })] : []),
    ...(isActive(run)
      ? [action("Cancel Run", post("cancel", "Cancelling the run"), {
        icon: Icons.stop,
        destructive: true,
        confirm: `Cancel run #${run.run_number} of ${run.name ?? "this workflow"}?`,
        shortcut: "<Ctrl><Shift>x",
        section: "Danger",
      })]
      : []),
  ];
}

function problemItem(p: { repo: string; error: string }): Item {
  return {
    id: `problem:${p.repo}`,
    title: p.repo,
    subtitle: p.error,
    icon: { source: Icons.alert, tint: "orange" },
    section: "Not Loaded",
    detail: {
      markdown:
        `**${p.repo}** couldn't be loaded: ${p.error}.\n\nCheck the name in **Settings → Extensions → GitHub Actions**, and that your token can read this repository.`,
    },
    actions: [open(`https://github.com/${p.repo}`, "Open on GitHub")],
  };
}

function setupRow(message: string): Item[] {
  return [{
    id: "setup",
    title: message,
    subtitle: "Settings → Extensions → GitHub Actions",
    icon: { source: Icons.settings, tint: "orange" },
    detail: {
      markdown: [
        "## Choose repositories",
        "",
        "In **Settings → Extensions → GitHub Actions → Configure**:",
        "",
        "- **Repositories**: `owner/name` separated by commas, e.g. `backslash-app/backslash, octocat/hello-world`.",
        "- **Include repositories you pushed to recently**: adds those you pushed to in the last 30 days.",
      ].join("\n"),
    },
    actions: [open("https://github.com/settings/repositories", "Open Your Repositories")],
  }];
}

export default (_ctx: Context) =>
  list({
    placeholder: "Filter runs by commit, repository, workflow, branch, actor…",
    filter: {
      options: [
        { value: "failing", title: "Failing" },
        { value: "running", title: "In progress" },
        { value: "all", title: "All" },
      ],
      default: "all",
    },
    empty: { title: "Nothing here", description: "No workflow run matches this view.", icon: Icons.activity },
    status: (items) =>
      items[0]?.id === "setup" ? "Not set up" : [shown.line, `${shown.total} runs`].filter(Boolean).join(" · "),
    async items({ preferences, signal, filter }) {
      const prefs = preferences as Prefs;
      try {
        const t = await token(preferences);
        const { runs, problems } = await loadRuns(t, prefs, signal);
        const line = summary(runs);
        shown = { total: runs.length, line };
        updateCommandMetadata({ subtitle: line || null }).catch(() => {});
        const now = new Date();
        return [
          ...arrange(runs, filter ?? "all").map(({ run, section }) => runItem(run, section, runActions(t, run), now)),
          ...problems.map(problemItem),
        ];
      } catch (e) {
        if (e instanceof AuthError) return setupItems(e);
        if (e instanceof SetupError) return setupRow(e.message);
        throw e;
      }
    },
  });
