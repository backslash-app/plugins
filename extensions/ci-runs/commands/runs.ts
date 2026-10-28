import {
  type Action,
  action,
  type Context,
  copy,
  Icons,
  type Item,
  list,
  meta,
  open,
  refresh,
  toast,
  updateCommandMetadata,
} from "@backslash/api";
import { type Account, accounts, cancel, loadRuns, type Prefs, rerun, SetupError, TOKEN_PAGES } from "../api.ts";
import {
  age,
  currentFailures,
  duration,
  filterRuns,
  formatDate,
  formatDuration,
  group,
  type Provider,
  PROVIDER_NAMES,
  PROVIDERS,
  type Run,
  type RunFilter,
  shortSha,
  sortRuns,
  STATUS_COLORS,
  STATUS_LABELS,
} from "../lib.ts";

const STATUS_ICONS = {
  failed: Icons.canceled,
  running: Icons.inProgress,
  queued: Icons.todo,
  blocked: Icons.pause,
  success: Icons.done,
  canceled: Icons.canceled,
  skipped: Icons.backlog,
};

function runActions(a: Account, r: Run): Action[] {
  const label = `${r.project}${r.number ? ` #${r.number}` : ""}`;
  const out: Action[] = [];
  if (r.canRerun) {
    if (r.provider === "circleci" && r.ref.failed) {
      out.push(action("Rerun Failed Jobs", async () => {
        await rerun(a, r, true);
        await toast(`Rerunning the failed jobs of ${label}`, { style: "success" });
        return refresh();
      }, { icon: Icons.refresh, shortcut: "<Ctrl><Shift>r", section: "Run" }));
    }
    out.push(action(r.provider === "circleci" && r.ref.failed ? "Rerun Workflows" : "Rerun", async () => {
      await rerun(a, r, false);
      await toast(`Rerunning ${label}`, { style: "success", message: PROVIDER_NAMES[r.provider] });
      return refresh();
    }, {
      icon: Icons.refresh,
      shortcut: r.provider === "circleci" && r.ref.failed ? undefined : "<Ctrl><Shift>r",
      section: "Run",
    }));
  }
  if (r.canCancel) {
    out.push(action("Cancel", async () => {
      await cancel(a, r);
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
  return out;
}

function item(a: Account, r: Run, failing: Set<Run>): Item {
  const color = STATUS_COLORS[r.status];
  const took = duration(r);
  const ref = r.tag ? `tag ${r.tag}` : r.branch;
  const stale = r.status === "failed" && !failing.has(r);
  return {
    id: `${r.provider}/${r.id}`,
    title: r.project,
    subtitle: r.message,
    icon: { source: STATUS_ICONS[r.status], tint: color },
    section: group(r, failing),
    keywords: [PROVIDER_NAMES[r.provider], r.branch ?? "", r.tag ?? "", r.commit ?? "", r.author ?? "", r.rawStatus],
    accessories: [
      ...(ref ? [{ icon: Icons.branch, text: ref, tooltip: "Branch" }] : []),
      ...(took !== undefined ? [{ icon: Icons.timer, text: formatDuration(took), tooltip: "Duration" }] : []),
      ...(r.created ? [{ text: age(r.created), tooltip: formatDate(r.created) }] : []),
      ...(r.author ? [{ avatar: r.avatar ?? r.author, tooltip: r.author }] : []),
      { tag: PROVIDER_NAMES[r.provider], color: "gray" as const },
      { tag: stale ? "Failed (fixed since)" : STATUS_LABELS[r.status], color: stale ? "gray" as const : color },
    ],
    detail: {
      stats: [
        { label: "status", value: STATUS_LABELS[r.status], color },
        { label: "duration", value: took !== undefined ? formatDuration(took) : "—" },
        { label: "run", value: r.number ? `#${r.number}` : "—" },
      ],
      markdown: r.parts.length > 1 || (r.parts.length === 1 && r.parts[0].status !== r.status)
        ? r.parts.map((p) => `- **${p.name}**: ${p.rawStatus.replace(/_/g, " ")}`).join("\n")
        : undefined,
      metadata: [
        meta.text("Provider", PROVIDER_NAMES[r.provider], { icon: Icons.cycle }),
        meta.text("Status", r.rawStatus.replace(/_/g, " ").toLowerCase(), { icon: STATUS_ICONS[r.status], color }),
        ...(r.branch ? [meta.text("Branch", r.branch, { icon: Icons.branch })] : []),
        ...(r.tag ? [meta.text("Tag", r.tag, { icon: Icons.tag })] : []),
        ...(r.commit ? [meta.text("Commit", shortSha(r.commit), { icon: Icons.commit })] : []),
        ...(r.message ? [meta.text("Message", r.message)] : []),
        ...(r.author ? [meta.person("Author", r.author, r.avatar)] : []),
        ...(r.event ? [meta.text("Trigger", r.event.replace(/_/g, " "), { icon: Icons.bolt })] : []),
        meta.separator(),
        ...(r.created ? [meta.text("Created", formatDate(r.created), { icon: Icons.calendar })] : []),
        ...(r.started && r.started !== r.created
          ? [meta.text("Started", formatDate(r.started), { icon: Icons.play })]
          : []),
        ...(r.finished ? [meta.text("Finished", formatDate(r.finished), { icon: Icons.clock })] : []),
        ...(r.provider === "jenkins" && r.status === "running" && Number(r.ref.estimate) > 0 && took !== undefined
          ? [meta.progress("Progress", took / Number(r.ref.estimate), `~${formatDuration(Number(r.ref.estimate))}`)]
          : []),
      ],
    },
    actions: [
      open(r.url, `Open in ${PROVIDER_NAMES[r.provider]}`, { icon: Icons.external }),
      ...runActions(a, r),
      copy(r.url, "Copy URL", { shortcut: "<Ctrl><Shift>c", section: "Copy" }),
      ...(r.commit ? [copy(r.commit, "Copy Commit SHA", { icon: Icons.commit, section: "Copy" })] : []),
      ...(r.branch
        ? [copy(r.branch, "Copy Branch", { icon: Icons.branch, shortcut: "<Ctrl>period", section: "Copy" })]
        : []),
      action("Reload", () => refresh(), { icon: Icons.refresh, shortcut: "<Ctrl>r" }),
    ],
  };
}

function errorItem(provider: Provider, err: unknown): Item {
  const setup = err instanceof SetupError;
  const message = err instanceof Error ? err.message : String(err);
  return {
    id: `error:${provider}`,
    title: message,
    subtitle: setup ? "Settings → Extensions → CI Pipelines" : PROVIDER_NAMES[provider],
    icon: { source: setup ? Icons.key : Icons.alert, tint: "orange" },
    section: "Problems",
    detail: { markdown: `**${PROVIDER_NAMES[provider]}**: ${message}` },
    actions: [
      action("Retry", () => refresh(), { icon: Icons.refresh, shortcut: "<Ctrl>r" }),
      open(TOKEN_PAGES[provider], setup ? "Open Token Help" : "Open API Documentation", { icon: Icons.key }),
      copy(message, "Copy Error", { section: "Copy" }),
    ],
  };
}

function setupItem(): Item {
  return {
    id: "setup",
    title: "Connect a CI system",
    subtitle: "Add a CircleCI, Buildkite, Woodpecker or Jenkins token in Settings",
    icon: { source: Icons.key, tint: "orange" },
    detail: {
      markdown: [
        "## Connect your CI",
        "",
        "In **Settings → Extensions → CI Pipelines**, fill the ones you use:",
        "",
        "- **CircleCI**: a personal API token (and optionally the organization slugs, `gh/acme`)",
        "- **Buildkite**: an API access token with `read_builds` (and `write_builds` to rerun or cancel)",
        "- **Woodpecker**: your server's address and a personal access token",
        "- **Jenkins**: the address, your user ID and an API token",
      ].join("\n"),
    },
    actions: PROVIDERS.map((p) => open(TOKEN_PAGES[p], `Open ${PROVIDER_NAMES[p]} Token Help`, { icon: Icons.key })),
  };
}

let summary = "";

export default (ctx: Context) => {
  const configured = accounts(ctx.preferences as Prefs);
  const providers = [...new Set(configured.map((a) => a.provider))];
  return list({
    placeholder: "Filter runs by project, branch, commit, author…",
    filter: {
      options: [
        { value: "all", title: "All" },
        { value: "failed", title: "Failed" },
        { value: "running", title: "Running" },
        ...(providers.length > 1 ? providers.map((p) => ({ value: p, title: PROVIDER_NAMES[p] })) : []),
      ],
      default: "all",
    },
    empty: { title: "No runs", description: "Nothing matches this filter", icon: Icons.cycle },
    status: () => summary,
    async *items({ preferences, filter, signal }) {
      summary = "";
      const all = accounts(preferences as Prefs);
      if (!all.length) {
        yield [setupItem()];
        return;
      }
      const f = (filter ?? "all") as RunFilter;
      const picked = all.filter((a) => a.provider === f);
      const shown = (PROVIDERS as string[]).includes(f) && picked.length ? picked : all;
      const runs: { a: Account; r: Run }[] = [];
      const errors: Item[] = [];
      const render = () => {
        const visible = filterRuns(runs.map((x) => x.r), f);
        const byRun = new Map(runs.map((x) => [x.r, x.a]));
        const failing = currentFailures(runs.map((x) => x.r));
        return [...errors, ...sortRuns(visible).map((r) => item(byRun.get(r)!, r, failing))];
      };
      const pending = new Map<Provider, Promise<Provider>>();
      for (const a of shown) {
        if (a instanceof SetupError) {
          errors.push(errorItem(a.provider, a));
          continue;
        }
        pending.set(
          a.provider,
          loadRuns(a, signal).then(
            (found) => void runs.push(...found.map((r) => ({ a, r }))),
            (err) => {
              if (signal.aborted) throw err;
              errors.push(errorItem(a.provider, err));
            },
          ).then(() => a.provider),
        );
      }
      if (!pending.size) yield render();
      while (pending.size) {
        pending.delete(await Promise.race(pending.values()));
        const failing = currentFailures(runs.map((x) => x.r)).size;
        const running = runs.filter((x) => x.r.status === "running" || x.r.status === "queued").length;
        summary = [
          `${runs.length} run${runs.length === 1 ? "" : "s"}`,
          failing ? `${failing} failing` : "",
          running ? `${running} running` : "",
          pending.size ? "loading…" : "",
        ].filter(Boolean).join(" · ");
        yield render();
      }
      if (shown === all) {
        const failing = currentFailures(runs.map((x) => x.r)).size;
        const running = runs.filter((x) => x.r.status === "running").length;
        await updateCommandMetadata({
          subtitle: [failing ? `${failing} failing` : "", running ? `${running} running` : ""].filter(Boolean).join(
            " · ",
          ) || null,
        }).catch(() => {});
      }
    },
  });
};
