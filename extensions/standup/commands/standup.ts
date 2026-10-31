import {
  action,
  type Context,
  copy,
  Icons,
  type Item,
  list,
  open,
  paste,
  refresh,
  storage,
  updateCommandMetadata,
} from "@backslash/api";
import {
  buildDraft,
  type Commit,
  type Issue,
  type PullRequest,
  type Range,
  renderDraft,
  shortDate,
  summary,
} from "../lib.ts";
import { ALLOWED, commits, config, linearIssues, pullRequests, repoName, windowFor } from "../sources.ts";

let footer = "";

const idOf = {
  commit: (c: Commit) => `commit:${c.hash}`,
  pr: (p: PullRequest) => `pr:${p.url}`,
  issue: (i: Issue) => `issue:${i.identifier}`,
};

async function setExcluded(id: string, out: boolean) {
  const list = (await storage.get<string[]>("excluded")) ?? [];
  const next = out ? [...list.filter((x) => x !== id), id].slice(-300) : list.filter((x) => x !== id);
  await storage.set("excluded", next);
}

const toggleAction = (id: string, excluded: boolean) =>
  action(excluded ? "Put Back in Stand-up" : "Leave Out of Stand-up", async () => {
    await setExcluded(id, !excluded);
    return refresh();
  }, { icon: excluded ? Icons.eye : Icons.eyeOff, shortcut: "<Ctrl>l" });

const time = (d: Date) => d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });

export default (ctx: Context) => {
  const cfg = config(ctx);
  return list({
    placeholder: "Filter what goes into your stand-up…",
    filter: {
      options: [
        { value: "last", title: "Since Last Working Day" },
        { value: "today", title: "Today" },
        { value: "week", title: "This Week" },
      ],
    },
    empty: { title: "Nothing found", icon: Icons.history },
    status: () => footer,
    async *items({ filter, signal }): AsyncGenerator<Item[]> {
      const w = windowFor(cfg, (filter ?? "last") as Range);
      const excluded = new Set((await storage.get<string[]>("excluded")) ?? []);
      let found: Commit[] = [], repos = 0, prs: PullRequest[] = [], issues: Issue[] = [];
      const errors: { source: string; message: string }[] = [];
      let pending = Number(!!cfg.github) + Number(!!cfg.linear);

      const render = (): Item[] => {
        const kept = {
          commits: found.filter((c) => !excluded.has(idOf.commit(c))),
          prs: prs.filter((p) => !excluded.has(idOf.pr(p))),
          issues: issues.filter((i) => !excluded.has(idOf.issue(i))),
        };
        const draft = buildDraft(w, kept, { tidy: cfg.tidy });
        const md = renderDraft(draft, "markdown", { blockers: cfg.blockers });
        const slack = renderDraft(draft, "slack", { blockers: cfg.blockers });
        const line = summary(kept);
        footer = `${line} · since ${shortDate(w.since)}${pending ? " · loading GitHub and Linear…" : ""}`;
        if (filter === "last" || !filter) updateCommandMetadata({ subtitle: line }).catch(() => {});
        const items: Item[] = [{
          id: "draft",
          title: `Stand-up · ${w.label}`,
          subtitle: line,
          icon: { source: Icons.comment, tint: "blue" },
          section: "Draft",
          detail: { markdown: md },
          actions: [
            copy(md, "Copy as Markdown"),
            copy(slack, "Copy for Slack"),
            paste(md, "Paste as Markdown", { section: "Paste" }),
            paste(slack, "Paste for Slack", { shortcut: "<Ctrl><Shift>v", section: "Paste" }),
          ],
        }];
        if (!repos && !cfg.github && !cfg.linear) {
          items.push({
            id: "setup",
            title: "No git repository found",
            subtitle: "Settings → Extensions → Stand-up",
            icon: { source: Icons.alert, tint: "orange" },
            section: "Sources",
            detail: {
              markdown: [
                "## Where does your work happen?",
                "",
                "Set **Repository folders** to your repositories or the folders that hold them (two levels deep).",
                "These folders can be searched:",
                "",
                ...ALLOWED.map((a) => `- \`${a}\``),
                "",
                "Add a **GitHub token** (read access to pull requests) and a **Linear API key** to include merged",
                "pull requests, reviews and the issues you closed.",
              ].join("\n"),
            },
            actions: [open("https://github.com/settings/tokens?type=beta", "Create a GitHub Token")],
          });
        }
        for (const e of errors) {
          items.push({
            id: `error:${e.source}`,
            title: e.message,
            subtitle: e.source,
            icon: { source: Icons.alert, tint: "red" },
            section: "Sources",
            actions: [action("Retry", () => refresh(), { icon: Icons.refresh })],
          });
        }
        for (const i of issues) {
          const out = excluded.has(idOf.issue(i));
          items.push({
            id: idOf.issue(i),
            title: `${i.identifier} ${i.title}`,
            subtitle: i.kind === "completed" ? "Done" : i.state,
            icon: out
              ? { source: Icons.eyeOff, tint: "gray" }
              : i.kind === "completed"
              ? { source: Icons.done, tint: "green" }
              : { source: Icons.inProgress, tint: "yellow" },
            section: "Linear",
            accessories: out ? [{ tag: "left out" }] : [],
            actions: [open(i.url, "Open in Linear"), toggleAction(idOf.issue(i), out), copy(i.url, "Copy Link")],
          });
        }
        for (const p of prs) {
          const out = excluded.has(idOf.pr(p));
          items.push({
            id: idOf.pr(p),
            title: p.title,
            subtitle: `${p.repo} #${p.number}`,
            icon: out
              ? { source: Icons.eyeOff, tint: "gray" }
              : p.state === "merged"
              ? { source: Icons.merged, tint: "purple" }
              : p.state === "reviewed"
              ? { source: Icons.eye, tint: "blue" }
              : { source: p.draft ? Icons.pullRequestDraft : Icons.pullRequest, tint: "green" },
            section: "Pull Requests",
            accessories: [{ tag: out ? "left out" : p.state === "open" ? (p.draft ? "draft" : "in review") : p.state }],
            actions: [open(p.url, "Open Pull Request"), toggleAction(idOf.pr(p), out), copy(p.url, "Copy Link")],
          });
        }
        for (const c of [...found].reverse()) {
          const out = excluded.has(idOf.commit(c));
          items.push({
            id: idOf.commit(c),
            title: c.subject,
            subtitle: repoName(c.repo),
            icon: out ? { source: Icons.eyeOff, tint: "gray" } : { source: Icons.commit, tint: "blue" },
            section: "Commits",
            keywords: [repoName(c.repo), c.short],
            accessories: [
              ...(out ? [{ tag: "left out" }] : []),
              { text: c.short, tooltip: c.refs || undefined },
              {
                text: `${c.date.toDateString() === new Date().toDateString() ? "" : `${shortDate(c.date)} `}${
                  time(c.date)
                }`,
              },
            ],
            actions: [
              toggleAction(idOf.commit(c), out),
              copy(c.hash, "Copy Commit Hash"),
              open(c.repo, "Open Repository Folder"),
            ],
          });
        }
        return items;
      };

      const git = await commits(cfg, w, signal).catch((e) => {
        errors.push({ source: "git", message: (e as Error).message });
        return { commits: [], repos: 0 };
      });
      found = git.commits;
      repos = git.repos;
      yield render();
      if (!pending) return;

      const tasks: Promise<void>[] = [];
      const updates: (() => void)[] = [];
      let wake = () => {};
      const settle = (fn: () => void) => {
        updates.push(fn);
        pending--;
        wake();
      };
      if (cfg.github) {
        tasks.push(
          pullRequests(cfg.github, w, signal).then(
            (r) => settle(() => prs = r),
            (e) => settle(() => errors.push({ source: "GitHub", message: (e as Error).message })),
          ),
        );
      }
      if (cfg.linear) {
        tasks.push(
          linearIssues(cfg.linear, w, signal).then(
            (r) => settle(() => issues = r),
            (e) => settle(() => errors.push({ source: "Linear", message: (e as Error).message })),
          ),
        );
      }
      while (updates.length || pending > 0) {
        if (!updates.length) await new Promise<void>((r) => wake = r);
        while (updates.length) updates.shift()!();
        if (signal.aborted) return;
        yield render();
      }
      await Promise.all(tasks);
    },
  });
};
