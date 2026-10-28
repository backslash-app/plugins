import { action, close, type Context, Icons, type Item, list, refresh } from "@backslash/api";
import { type Backend, backendOf, cachedProjects, forgetProjects, SetupError, startTimer } from "../api.ts";
import {
  clockTime,
  type Entry,
  entryLabel,
  formatClock,
  type Project,
  recentEntries,
  seconds,
  type StartRequest,
  tintOf,
} from "../lib.ts";
import { entryDetail, setupItems, stopAction } from "../views.ts";

function startItem(b: Backend, r: StartRequest, section: string, id: string): Item {
  const p = r.project;
  return {
    id,
    title: p
      ? `${r.description ? `“${r.description}” on ` : ""}${p.name}`
      : r.description
      ? `Start “${r.description}”`
      : "Start Without Description",
    subtitle: p?.client,
    icon: p ? { source: Icons.project, tint: tintOf(p.color) } : { source: Icons.play, tint: "green" },
    section,
    keywords: [p?.client ?? "", p?.activity ?? ""].filter(Boolean),
    actions: [
      action("Start Timer", async () => {
        await startTimer(b, r);
        return close(`Started ${entryLabel(r)}`);
      }, { icon: Icons.play }),
    ],
  };
}

function resumeItem(b: Backend, e: Entry, now: number): Item {
  return {
    id: `resume:${e.id}`,
    title: e.description || "(no description)",
    subtitle: e.project?.name,
    icon: { source: Icons.history, tint: tintOf(e.project?.color) },
    section: "Resume a Recent Entry",
    keywords: [...e.tags, e.project?.client ?? ""].filter(Boolean),
    accessories: [
      ...e.tags.filter((t) => t !== e.description && t !== e.project?.name).slice(0, 2).map((t) => ({ tag: t })),
      { text: new Date(e.start).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }) },
    ],
    detail: entryDetail(b, e, now),
    actions: [
      action("Continue", async () => {
        await startTimer(b, e, true);
        return close(`Started ${entryLabel(e)}`);
      }, { icon: Icons.play }),
    ],
  };
}

function runningItem(b: Backend, e: Entry, now: number): Item {
  return {
    id: `running:${e.id}`,
    title: e.description || "(no description)",
    subtitle: e.project?.name,
    icon: { source: Icons.timer, tint: "green" },
    section: "Running",
    accessories: [{ text: `since ${clockTime(e.start)}` }, { tag: formatClock(seconds(e, now)), color: "green" }],
    detail: entryDetail(b, e, now),
    actions: [stopAction(b, e)],
  };
}

function items(b: Backend, description: string, projects: Project[], recent: Entry[], running?: Entry): Item[] {
  const now = Date.now();
  const out: Item[] = [];
  if (running) out.push(runningItem(b, running, now));
  if (b.id !== "kimai") out.push(startItem(b, { description }, "Start", "start"));
  const projectSection = b.id === "timewarrior"
    ? "Start With a Tag"
    : b.id === "kimai"
    ? "Start on a Project › Activity"
    : "Start on a Project";
  out.push(...projects.map((p) => startItem(b, { description, project: p }, projectSection, `project:${p.id}`)));
  out.push(...recent.map((e) => resumeItem(b, e, now)));
  return out;
}

export default (ctx: Context<{ description?: string }>) => {
  const description = String(ctx.args.description ?? "").trim();
  return list({
    title: description ? `Start “${description}”` : "Start Time Tracking",
    placeholder: description ? "Pick a project, or Enter to start without one…" : "Filter projects and recent entries…",
    empty: { title: "No project yet", description: "Create projects in your time tracker", icon: Icons.project },
    status: (shown) =>
      shown[0]?.id === "setup"
        ? "Not connected"
        : `${shown.filter((i) => i.id?.startsWith("project:")).length} projects`,
    actions: [
      action("Reload Projects", async () => {
        try {
          await forgetProjects(await backendOf(ctx.preferences));
        } catch {
          // setup problems show in the list
        }
        return refresh();
      }, { icon: Icons.refresh, shortcut: "<Ctrl>r" }),
    ],
    async *items({ preferences, signal }) {
      let b: Backend;
      try {
        b = await backendOf(preferences);
      } catch (e) {
        if (e instanceof SetupError) {
          yield setupItems(e);
          return;
        }
        throw e;
      }
      const saved = await cachedProjects(b);
      if (saved) yield items(b, description, saved, []);
      try {
        const [projects, entries] = await Promise.all([
          b.projects(signal),
          b.entries(new Date(Date.now() - 14 * 86_400_000), signal),
        ]);
        const running = entries.find((e) => !e.stop);
        const recent = recentEntries(entries.filter((e) => e.stop)).filter((e) =>
          !description || e.description.toLowerCase().includes(description.toLowerCase())
        );
        yield items(b, description, projects, recent, running);
      } catch (e) {
        if (e instanceof SetupError) {
          yield setupItems(e);
          return;
        }
        throw e;
      }
    },
  });
};
