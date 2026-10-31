import {
  type Action,
  action,
  copy,
  detail,
  type DetailSpec,
  Icons,
  type Item,
  list,
  type ListSpec,
  meta,
  open,
  refresh,
  submenu,
  toast,
  updateCommandMetadata,
} from "@backslash/api";
import {
  allocLogs,
  evaluateJob,
  forcePeriodic,
  jobAllocations,
  nomadAllocations,
  nomadAllocUrl,
  nomadConfig,
  nomadJobs,
  nomadJobUrl,
  restartAlloc,
  type Service,
  SetupError,
  setupItem,
  startJob,
  stopAlloc,
  stopJob,
} from "../api.ts";
import {
  age,
  allocColor,
  allocMarkdown,
  allocShortName,
  type AllocStub,
  isFailedAlloc,
  JOB_HEALTH,
  jobCount,
  jobKind,
  type JobStub,
  type JobView,
  jobViews,
  mainTask,
  restartsOf,
  sortAllocs,
  tail,
} from "../lib.ts";

const fence = (text: string) => `\`\`\`\n${text.replace(/```/g, "ʼʼʼ") || "(empty)"}\n\`\`\``;

const isFailedClient = (a: AllocStub) => a.ClientStatus === "failed" || a.ClientStatus === "lost";

const errorText = (e: unknown) => e instanceof Error ? e.message : String(e);

/** Runs a change, tells how it went, and reloads. */
function change(title: string, run: () => Promise<unknown>, done: string, o: Parameters<typeof action>[2] = {}) {
  return action(title, async () => {
    try {
      await run();
    } catch (e) {
      await toast(`${title} failed`, { style: "failure", message: errorText(e) });
      return;
    }
    await toast(done, { style: "success" });
    return refresh();
  }, o);
}

// ---------------------------------------------------------------------------
// Logs

async function logsView(s: Service, a: AllocStub, task: string, type: "stdout" | "stderr"): Promise<DetailSpec> {
  const text = await allocLogs(s, a, task, type).then((t) => tail(t)).catch((e) =>
    `Can't read the logs: ${errorText(e)}`
  );
  const other = type === "stderr" ? "stdout" : "stderr";
  return detail({
    title: `${allocShortName(a)} · ${task} · ${type}`,
    markdown: fence(text),
    metadata: [
      meta.text("Allocation", a.ID.slice(0, 8), { icon: Icons.box, color: allocColor(a) }),
      meta.text("Task", task),
      meta.text("Stream", type),
      ...(a.NodeName ? [meta.text("Node", a.NodeName, { icon: Icons.server })] : []),
    ],
    status: `${type} of ${task}, last 200 lines`,
    actions: [
      action(`Show ${other}`, () => logsView(s, a, task, other), { icon: Icons.text }),
      action("Reload", () => logsView(s, a, task, type), { icon: Icons.refresh, shortcut: "<Ctrl>r" }),
      copy(text, "Copy Logs", { shortcut: "<Ctrl><Shift>c" }),
      open(nomadAllocUrl(s, a, task), "Open Logs in Nomad", { shortcut: "<Ctrl>o" }),
    ],
  });
}

// ---------------------------------------------------------------------------
// Allocations

function allocItem(s: Service, a: AllocStub): Item {
  const color = allocColor(a);
  const tasks = Object.keys(a.TaskStates ?? {});
  const main = mainTask(a);
  const restarts = restartsOf(a);
  const current = a.DesiredStatus === "run";
  const failedTask = Object.values(a.TaskStates ?? {}).some((t) => t.Failed);
  const actions: Action[] = [
    ...(main
      ? [
        action("Show Logs", () => logsView(s, a, main, failedTask || restarts ? "stderr" : "stdout"), {
          icon: Icons.text,
        }),
      ]
      : []),
    open(nomadAllocUrl(s, a), "Open in Nomad"),
    ...(tasks.length > 1
      ? [submenu(
        "Logs of Task",
        tasks.flatMap((t) => [
          action(`${t} · stderr`, () => logsView(s, a, t, "stderr"), { icon: Icons.text }),
          action(`${t} · stdout`, () => logsView(s, a, t, "stdout"), { icon: Icons.text }),
        ]),
        { icon: Icons.text, shortcut: "<Ctrl>l" },
      )]
      : main
      ? [action("Show stdout", () => logsView(s, a, main, "stdout"), { icon: Icons.text, shortcut: "<Ctrl>l" })]
      : []),
    ...(current && a.ClientStatus === "running"
      ? [
        change("Restart Allocation", () => restartAlloc(s, a), `${allocShortName(a)} restarting`, {
          icon: Icons.refresh,
          shortcut: "<Ctrl>r",
          section: "Allocation",
          confirm: `Restart every task of ${allocShortName(a)} in place?`,
        }),
      ]
      : []),
    ...(current
      ? [
        change("Stop & Reschedule", () => stopAlloc(s, a), `${allocShortName(a)} stopped: a new one is placed`, {
          icon: Icons.stop,
          destructive: true,
          confirm: `Stop ${allocShortName(a)}? Nomad places a replacement, maybe on another node.`,
          section: "Allocation",
        }),
      ]
      : []),
    copy(a.ID, "Copy Allocation ID", { shortcut: "<Ctrl>period", section: "Copy" }),
    ...(main
      ? [copy(`nomad alloc logs -f -stderr ${a.ID.slice(0, 8)} ${main}`, "Copy Logs Command", {
        icon: Icons.terminal,
        section: "Copy",
      })]
      : []),
  ];
  return {
    id: a.ID,
    title: allocShortName(a),
    subtitle: a.NodeName,
    icon: { source: isFailedAlloc(a) ? Icons.alert : Icons.box, tint: color },
    section: current ? "Current" : "Previous",
    keywords: [a.ID, a.NodeName ?? "", a.ClientStatus, ...tasks],
    accessories: [
      ...(restarts
        ? [{ icon: { source: Icons.refresh, tint: "orange" as const }, text: String(restarts), tooltip: "Restarts" }]
        : []),
      ...(a.JobVersion !== undefined ? [{ text: `v${a.JobVersion}`, tooltip: "Job version" }] : []),
      {
        tag: a.DeploymentStatus?.Healthy === false && !isFailedClient(a) ? "unhealthy" : a.ClientStatus,
        color,
      },
      { text: age((a.CreateTime ?? 0) / 1e6), tooltip: "Age" },
    ],
    detail: {
      markdown: allocMarkdown(a),
      metadata: [
        meta.text("Status", a.ClientStatus, { icon: Icons.dot, color }),
        meta.text("Desired", a.DesiredStatus + (a.DesiredDescription ? ` · ${a.DesiredDescription}` : "")),
        ...(a.NodeName ? [meta.text("Node", a.NodeName, { icon: Icons.server })] : []),
        meta.tags("Tasks", tasks),
        meta.text("ID", a.ID.slice(0, 8)),
      ],
    },
    actions,
  };
}

function allocationsView(s: Service, job: JobStub): ListSpec {
  return list({
    title: job.Name,
    placeholder: `Filter allocations of ${job.Name}…`,
    empty: { title: "No allocations", description: "Nomad hasn't placed this job anywhere", icon: Icons.box },
    status: (items) => `${job.Name} · ${items.length} allocation${items.length === 1 ? "" : "s"}`,
    actions: [action("Reload", () => refresh(), { icon: Icons.refresh, shortcut: "<Ctrl><Shift>r" })],
    async items({ signal }) {
      const allocs = await jobAllocations(s, job, signal);
      // A periodic job's runs are its children's allocations.
      const children = job.Periodic || job.ParameterizedJob
        ? (await nomadAllocations(s, signal)).filter((a) => a.JobID.startsWith(`${job.ID}/`))
        : [];
      return sortAllocs([...allocs, ...children]).slice(0, 100).map((a) => allocItem(s, a));
    },
  });
}

// ---------------------------------------------------------------------------
// Jobs

function jobItem(s: Service, v: JobView): Item {
  const { job } = v;
  const h = JOB_HEALTH[v.health];
  const count = jobCount(v);
  const ns = job.Namespace ?? "default";
  const name = job.Name || job.ID;
  const actions: Action[] = [
    action("Show Allocations", () => allocationsView(s, job), { icon: Icons.box }),
    open(nomadJobUrl(s, job), "Open in Nomad"),
    ...(job.Periodic && !job.Stop
      ? [change("Run Now", () => forcePeriodic(s, job), `${name} launched`, {
        icon: Icons.play,
        shortcut: "<Ctrl>p",
        section: "Job",
      })]
      : []),
    ...(!job.Stop && !job.Periodic && !job.ParameterizedJob && (job.Status !== "dead" || job.Type === "service")
      ? [
        change("Force Evaluation", () => evaluateJob(s, job), `${name} evaluated: failed allocations are rescheduled`, {
          icon: Icons.refresh,
          shortcut: "<Ctrl>e",
          section: "Job",
        }),
      ]
      : []),
    ...(job.Status === "dead" && !job.Stop && job.Type !== "service" ? [] : [
      job.Stop
        ? change("Start Job", () => startJob(s, job), `${name} started`, {
          icon: Icons.play,
          shortcut: "<Ctrl>s",
          section: "Job",
        })
        : change("Stop Job", () => stopJob(s, job), `${name} stopped`, {
          icon: Icons.stop,
          shortcut: "<Ctrl>s",
          destructive: true,
          confirm: `Stop ${name}${ns === "default" ? "" : ` in ${ns}`}? Its allocations are stopped.`,
          section: "Job",
        }),
    ]),
    copy(job.ID, "Copy Job ID", { shortcut: "<Ctrl>period", section: "Copy" }),
    copy(`nomad job status${ns === "default" ? "" : ` -namespace=${ns}`} ${job.ID}`, "Copy Status Command", {
      icon: Icons.terminal,
      section: "Copy",
    }),
  ];
  const groups = Object.entries(job.JobSummary?.Summary ?? {});
  return {
    id: `${ns}/${job.ID}`,
    title: name,
    subtitle: ns === "default" ? jobKind(job) : `${ns} · ${jobKind(job)}`,
    icon: { source: v.health === "failing" ? Icons.alert : Icons.server, tint: h.color },
    section: h.section,
    keywords: [job.ID, ns, job.Type, v.health, ...(job.Datacenters ?? [])],
    accessories: [
      ...(v.restarts
        ? [{ icon: { source: Icons.refresh, tint: "orange" as const }, text: String(v.restarts), tooltip: "Restarts" }]
        : []),
      ...(v.failed ? [{ text: `${v.failed} failed`, color: "red" as const }] : []),
      ...(count ? [{ text: count, tooltip: "Running / wanted" }] : []),
      { tag: h.title, color: h.color },
      ...(job.SubmitTime ? [{ text: age(job.SubmitTime / 1e6), tooltip: "Submitted" }] : []),
    ],
    detail: {
      stats: [
        { label: "status", value: h.title, color: h.color },
        ...(count ? [{ label: job.Periodic || job.ParameterizedJob ? "runs" : "running", value: count }] : []),
        ...(v.failed ? [{ label: "failed", value: v.failed, color: "red" as const }] : []),
        ...(v.queued ? [{ label: "queued", value: v.queued, color: "yellow" as const }] : []),
      ],
      markdown: groups.length
        ? [
          "| Group | Running | Starting | Queued | Failed | Lost | Complete |",
          "| --- | --- | --- | --- | --- | --- | --- |",
          ...groups.map(([g, c]) =>
            `| ${g} | ${c.Running ?? 0} | ${c.Starting ?? 0} | ${c.Queued ?? 0} | ${c.Failed ?? 0} | ${c.Lost ?? 0} | ${
              c.Complete ?? 0
            } |`
          ),
          "",
          "_Failed, lost and complete count every allocation since the job was submitted._",
        ].join("\n")
        : undefined,
      metadata: [
        meta.text("Status", job.Status + (job.StatusDescription ? ` · ${job.StatusDescription}` : ""), {
          icon: Icons.dot,
          color: h.color,
        }),
        meta.text("Type", jobKind(job)),
        meta.text("Namespace", ns, { icon: Icons.layers }),
        ...(job.Datacenters?.length ? [meta.tags("Datacenters", job.Datacenters)] : []),
        ...(job.Version !== undefined ? [meta.text("Version", String(job.Version), { icon: Icons.tag })] : []),
        ...(job.Priority !== undefined ? [meta.text("Priority", String(job.Priority))] : []),
        ...(job.SubmitTime
          ? [meta.text("Submitted", new Date(job.SubmitTime / 1e6).toLocaleString("en-GB"), { icon: Icons.clock })]
          : []),
      ],
    },
    actions,
  };
}

let summary = "";

export default list({
  placeholder: "Filter jobs by name, namespace, type…",
  filter: {
    options: [
      { value: "all", title: "All" },
      { value: "problems", title: "Failing" },
      { value: "service", title: "Services" },
      { value: "batch", title: "Batch" },
    ],
    default: "all",
  },
  empty: {
    title: "No jobs here",
    description: "Nothing matches, or nothing runs in this namespace",
    icon: Icons.server,
  },
  status: () => summary,
  actions: [action("Reload", () => refresh(), { icon: Icons.refresh, shortcut: "<Ctrl><Shift>r" })],
  async items({ preferences, filter, signal }) {
    summary = "";
    let s: Service;
    try {
      s = nomadConfig(preferences);
      const [jobs, allocs] = await Promise.all([nomadJobs(s, signal), nomadAllocations(s, signal)]);
      let views = jobViews(jobs, allocs);
      const failing = views.filter((v) => v.health === "failing" || v.health === "degraded").length;
      updateCommandMetadata({ subtitle: failing ? `${failing} failing` : null }).catch(() => {});
      if (filter === "problems") {
        views = views.filter((v) => v.health === "failing" || v.health === "degraded" || v.health === "pending");
      } else if (filter === "service") views = views.filter((v) => v.job.Type === "service" || v.job.Type === "system");
      else if (filter === "batch") views = views.filter((v) => v.job.Type === "batch" || v.job.Type === "sysbatch");
      summary = [
        new URL(s.url).host,
        `${views.length} job${views.length === 1 ? "" : "s"}`,
        failing ? `${failing} failing` : "none failing",
      ].join(" · ");
      return views.map((v) => jobItem(s, v));
    } catch (e) {
      if (e instanceof SetupError) return [setupItem(e, "Nomad")];
      throw e;
    }
  },
});
