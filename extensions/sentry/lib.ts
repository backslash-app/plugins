// Sentry issues and events as launcher items and pages, and the triage actions.

import {
  type Accessory,
  type Action,
  action,
  type Color,
  type Context,
  copy,
  detail,
  type DetailSpec,
  Icons,
  type Item,
  meta,
  type Metadata,
  open,
  refresh,
  type Stat,
  submenu,
  toast,
} from "@backslash/api";
import { type Account, account, sentry } from "./api.ts";

// ---------------------------------------------------------------------------
// Shapes

export interface Issue {
  id: string;
  shortId: string;
  title: string;
  culprit?: string | null;
  permalink: string;
  level: "fatal" | "error" | "warning" | "info" | "debug" | string;
  status: "unresolved" | "resolved" | "ignored" | string;
  substatus?: string | null;
  priority?: "high" | "medium" | "low" | string | null;
  platform?: string | null;
  project: { id: string; name: string; slug: string; platform?: string | null };
  type?: string;
  metadata?: { type?: string; value?: string; filename?: string; function?: string; title?: string };
  numComments?: number;
  assignedTo?: { type: "user" | "team"; id: string; name: string; email?: string } | null;
  isUnhandled?: boolean;
  count: string | number;
  userCount: number;
  firstSeen: string;
  lastSeen: string;
}

export interface Frame {
  filename?: string | null;
  absPath?: string | null;
  module?: string | null;
  function?: string | null;
  lineNo?: number | null;
  colNo?: number | null;
  inApp?: boolean;
  context?: [number, string][];
}

export interface SentryEvent {
  id: string;
  eventID: string;
  title?: string;
  message?: string;
  dateCreated?: string;
  platform?: string;
  culprit?: string;
  tags?: { key: string; value: string }[];
  user?: { id?: string | null; email?: string | null; username?: string | null; ip_address?: string | null } | null;
  release?: { version: string; shortVersion?: string } | null;
  entries: { type: string; data: any }[];
}

// ---------------------------------------------------------------------------
// Formatting

/** "just now", "5m", "3h", "2d", "25 Oct": how recent an event is. */
export function since(iso: string | null | undefined, now = new Date()): string {
  if (!iso) return "";
  const s = Math.max(0, (now.getTime() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h`;
  if (s < 30 * 86_400) return `${Math.floor(s / 86_400)}d`;
  return new Date(iso).toLocaleDateString("en", { day: "numeric", month: "short" });
}

/** 1234 → "1.2k". */
export function compact(value: number | string): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value);
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k`;
  return String(n);
}

export function levelLook(level: string): { icon: string; tint: Color; text: string } {
  switch (level) {
    case "fatal":
      return { icon: Icons.alert, tint: "red", text: "Fatal" };
    case "error":
      return { icon: Icons.bug, tint: "red", text: "Error" };
    case "warning":
      return { icon: Icons.alert, tint: "orange", text: "Warning" };
    case "info":
      return { icon: Icons.info, tint: "blue", text: "Info" };
    case "debug":
      return { icon: Icons.code, tint: "gray", text: "Debug" };
    default:
      return { icon: Icons.bug, tint: "gray", text: level };
  }
}

/** The badges Sentry shows next to the title. */
export function substatusLook(issue: Issue): { text: string; color: Color } | undefined {
  switch (issue.substatus) {
    case "new":
      return { text: "New", color: "blue" };
    case "regressed":
      return { text: "Regressed", color: "purple" };
    case "escalating":
      return { text: "Escalating", color: "red" };
    case "archived_until_escalating":
    case "archived_until_condition_met":
    case "archived_forever":
      return { text: "Archived", color: "gray" };
    default:
      return undefined;
  }
}

const PRIORITY_COLORS: Record<string, Color> = { high: "red", medium: "orange", low: "gray" };

function statusText(issue: Issue): string {
  if (issue.status === "ignored") return "Ignored";
  if (issue.status === "resolved") return "Resolved";
  return "Unresolved";
}

// ---------------------------------------------------------------------------
// Stack traces

/** The exceptions of an event, the one that was raised last first. */
export function exceptions(event: SentryEvent): { type: string; value: string; frames: Frame[] }[] {
  const entry = event.entries.find((e) => e.type === "exception");
  const values = (entry?.data?.values ?? []) as { type?: string; value?: string; stacktrace?: { frames?: Frame[] } }[];
  return [...values].reverse().map((v) => ({
    type: v.type ?? "Error",
    value: v.value ?? "",
    frames: [...(v.stacktrace?.frames ?? [])].reverse(),
  }));
}

export function frameLine(f: Frame): string {
  const where = f.filename ?? f.absPath ?? f.module ?? "?";
  const pos = f.lineNo ? `:${f.lineNo}${f.colNo ? `:${f.colNo}` : ""}` : "";
  return `${f.function ?? "<anonymous>"} (${where}${pos})`;
}

/** The top of the stack: frames of the app first, most recent call first. */
export function topFrames(frames: Frame[], max = 8): Frame[] {
  const app = frames.filter((f) => f.inApp);
  return (app.length ? app : frames).slice(0, max);
}

/** An event as Markdown: the exception, the top frames and the code around the first one. */
export function eventMarkdown(issue: Issue, event: SentryEvent): string {
  const out: string[] = [`# ${issue.title}`];
  if (issue.culprit) out.push(`\`${issue.culprit}\``);
  const errors = exceptions(event);
  for (const [i, ex] of errors.entries()) {
    out.push(`## ${ex.type}${ex.value ? `: ${ex.value}` : ""}`);
    const frames = topFrames(ex.frames);
    if (!frames.length) continue;
    out.push(
      ["```", ...frames.map((f) => `${f.inApp ? "▸" : " "} ${frameLine(f)}`), "```"].join("\n"),
    );
    const context = i === 0 ? frames[0].context : undefined;
    if (context?.length) {
      const width = String(context[context.length - 1][0]).length;
      out.push(`**${frames[0].filename ?? frames[0].absPath ?? ""}**`);
      out.push(
        [
          "```",
          ...context.map(([n, code]) => `${n === frames[0].lineNo ? "→" : " "} ${String(n).padStart(width)}  ${code}`),
          "```",
        ].join("\n"),
      );
    }
  }
  if (!errors.length) {
    const message = event.entries.find((e) => e.type === "message")?.data?.formatted ?? event.message;
    out.push(message ? `\`\`\`\n${message}\n\`\`\`` : "_No stack trace in the latest event._");
  }
  return out.join("\n\n");
}

const TAG_LABELS: Record<string, string> = {
  environment: "Environment",
  release: "Release",
  browser: "Browser",
  os: "OS",
  "runtime": "Runtime",
  url: "URL",
  handled: "Handled",
  server_name: "Server",
  transaction: "Transaction",
};

export function eventMetadata(event: SentryEvent): Metadata[] {
  const tags = new Map((event.tags ?? []).map((t) => [t.key, t.value]));
  const lines: Metadata[] = [meta.text("Event", event.eventID.slice(0, 12), { icon: Icons.hash })];
  if (event.dateCreated) lines.push(meta.text("When", `${since(event.dateCreated)} ago`, { icon: Icons.clock }));
  for (const [key, label] of Object.entries(TAG_LABELS)) {
    const value = tags.get(key);
    if (!value) continue;
    if (key === "url" && /^https?:/.test(value)) lines.push(meta.link(label, value.replace(/^https?:\/\//, ""), value));
    else if (key === "handled") {
      lines.push(meta.text(label, value === "yes" ? "Yes" : "No", { color: value === "yes" ? undefined : "red" }));
    } else lines.push(meta.text(label, value));
  }
  const user = event.user;
  const who = user?.email ?? user?.username ?? user?.id ?? user?.ip_address;
  if (who) lines.push(meta.text("User", who, { icon: Icons.person }));
  return lines;
}

// ---------------------------------------------------------------------------
// Items and actions

export function issueStats(issue: Issue): Stat[] {
  return [
    { label: "events", value: compact(issue.count) },
    { label: "users", value: compact(issue.userCount) },
    { label: "first seen", value: since(issue.firstSeen) },
    { label: "last seen", value: since(issue.lastSeen) },
  ];
}

export function issueMetadata(issue: Issue): Metadata[] {
  const level = levelLook(issue.level);
  const lines: Metadata[] = [
    meta.text("Level", level.text, { icon: level.icon, color: level.tint }),
    meta.text("Status", statusText(issue), {
      icon: issue.status === "resolved" ? Icons.done : issue.status === "ignored" ? Icons.eyeOff : Icons.todo,
    }),
  ];
  const sub = substatusLook(issue);
  if (sub) lines.push(meta.tags("State", [sub]));
  if (issue.priority) {
    lines.push(meta.text("Priority", issue.priority.replace(/^./, (c) => c.toUpperCase()), {
      color: PRIORITY_COLORS[issue.priority],
    }));
  }
  lines.push(
    issue.assignedTo
      ? meta.person("Assignee", issue.assignedTo.type === "team" ? `#${issue.assignedTo.name}` : issue.assignedTo.name)
      : meta.text("Assignee", "Unassigned", { icon: Icons.person }),
  );
  if (issue.isUnhandled) lines.push(meta.text("Handled", "No", { icon: Icons.alert, color: "red" }));
  lines.push(meta.separator());
  lines.push(meta.text("Project", issue.project.slug, { icon: Icons.project }));
  if (issue.culprit) lines.push(meta.text("Culprit", issue.culprit, { icon: Icons.code }));
  lines.push(meta.text("Short ID", issue.shortId));
  lines.push(
    meta.text(
      "First seen",
      new Date(issue.firstSeen).toLocaleString("en", { dateStyle: "medium", timeStyle: "short" }),
    ),
  );
  lines.push(meta.text("Last seen", `${since(issue.lastSeen)} ago`));
  return lines;
}

/** `PUT /organizations/{org}/issues/?id=…`, the bulk update, for one issue. */
export async function updateIssue(a: Account, issue: Issue, body: Record<string, unknown>, message: string) {
  await sentry(a, `/organizations/${a.org}/issues/?id=${encodeURIComponent(issue.id)}`, { method: "PUT", body });
  await toast(`${issue.shortId}: ${message}`, { style: "success" });
  return refresh();
}

interface Member {
  id: string;
  name?: string;
  email?: string;
  user?: { id: string; name?: string; email?: string } | null;
}

export const IGNORE_OPTIONS: { title: string; details: Record<string, number> }[] = [
  { title: "Forever", details: {} },
  { title: "For 1 Hour", details: { ignoreDuration: 60 } },
  { title: "For 24 Hours", details: { ignoreDuration: 1440 } },
  { title: "For a Week", details: { ignoreDuration: 10080 } },
  { title: "Until 100 More Events", details: { ignoreCount: 100 } },
  { title: "Until 10 More Users", details: { ignoreUserCount: 10 } },
];

export function issueActions(issue: Issue, ctx: Context, page = false): Action[] {
  const a = account(ctx.preferences);
  const unresolved = issue.status === "unresolved";
  const actions: Action[] = [
    open(issue.permalink, "Open in Sentry"),
    ...(page ? [] : [action("Show Latest Event", () => eventPage(issue, ctx), { icon: Icons.bug })]),
  ];
  if (unresolved) {
    actions.push(
      action("Resolve", () => updateIssue(a, issue, { status: "resolved" }, "resolved"), {
        icon: Icons.done,
        shortcut: "<Ctrl>r",
        section: "Triage",
      }),
      action(
        "Resolve in Next Release",
        () => updateIssue(a, issue, { status: "resolved", statusDetails: { inNextRelease: true } }, "resolved"),
        { icon: Icons.done, section: "Triage" },
      ),
      submenu(
        "Ignore",
        IGNORE_OPTIONS.map((o) =>
          action(
            o.title,
            () =>
              updateIssue(
                a,
                issue,
                { status: "ignored", statusDetails: o.details },
                `ignored ${o.title.toLowerCase()}`,
              ),
            { icon: Icons.eyeOff },
          )
        ),
        { icon: Icons.eyeOff, shortcut: "<Ctrl>i", section: "Triage" },
      ),
    );
  } else {
    actions.push(action("Unresolve", () => updateIssue(a, issue, { status: "unresolved" }, "unresolved"), {
      icon: Icons.todo,
      section: "Triage",
    }));
  }
  actions.push(
    submenu("Assign To", async () => {
      const [me, members] = await Promise.all([
        sentry<Member>(a, `/organizations/${a.org}/members/me/`).catch(() => undefined),
        sentry<Member[]>(a, `/organizations/${a.org}/users/?project=${issue.project.id}`),
      ]);
      const myId = me?.user?.id;
      const people = members
        .map((m) => ({ id: m.user?.id ?? m.id, name: m.user?.name || m.name || m.email || m.user?.email || "?" }))
        .sort((x, y) => (x.id === myId ? -1 : y.id === myId ? 1 : x.name.localeCompare(y.name)));
      return [
        ...people.map((p) =>
          action(
            p.id === myId ? `${p.name} (me)` : p.name,
            () => updateIssue(a, issue, { assignedTo: `user:${p.id}` }, `assigned to ${p.name}`),
            { icon: Icons.person },
          )
        ),
        ...(issue.assignedTo
          ? [action("Unassign", () => updateIssue(a, issue, { assignedTo: "" }, "unassigned"), { icon: Icons.cross })]
          : []),
      ];
    }, { icon: Icons.person, shortcut: "<Ctrl><Shift>a", section: "Triage" }),
    action("Assign to Me", async () => {
      const me = await sentry<Member>(a, `/organizations/${a.org}/members/me/`);
      return updateIssue(a, issue, { assignedTo: `user:${me.user?.id ?? me.id}` }, "assigned to you");
    }, { icon: Icons.person, section: "Triage" }),
    copy(issue.shortId, "Copy Short ID", { shortcut: "<Ctrl>period", section: "Copy" }),
    copy(issue.permalink, "Copy URL", { shortcut: "<Ctrl><Shift>c", section: "Copy" }),
    copy(`[${issue.shortId}: ${issue.title}](${issue.permalink})`, "Copy as Markdown Link", { section: "Copy" }),
  );
  return actions;
}

/** The latest event of an issue: stack trace and tags. */
export async function eventPage(issue: Issue, ctx: Context): Promise<DetailSpec> {
  const a = account(ctx.preferences);
  const event = await sentry<SentryEvent>(a, `/organizations/${a.org}/issues/${issue.id}/events/latest/`);
  return detail({
    title: issue.shortId,
    markdown: eventMarkdown(issue, event),
    stats: issueStats(issue),
    metadata: [...eventMetadata(event), meta.separator(), ...issueMetadata(issue)],
    status: `${issue.project.slug} · latest event ${since(event.dateCreated ?? issue.lastSeen)} ago`,
    actions: [
      ...issueActions(issue, ctx, true),
      copy(event.eventID, "Copy Event ID", { section: "Copy" }),
    ],
  });
}

export function issueItem(issue: Issue, ctx: Context): Item {
  const level = levelLook(issue.level);
  const sub = substatusLook(issue);
  const accessories: Accessory[] = [];
  if (sub) accessories.push({ tag: sub.text, color: sub.color });
  if (issue.isUnhandled) accessories.push({ tag: "Unhandled", color: "red" });
  accessories.push(
    { icon: Icons.activity, text: compact(issue.count), tooltip: `${issue.count} events` },
    { icon: Icons.person, text: compact(issue.userCount), tooltip: `${issue.userCount} users` },
  );
  if (issue.assignedTo) {
    accessories.push({ avatar: issue.assignedTo.name, tooltip: `Assigned to ${issue.assignedTo.name}` });
  }
  accessories.push({ text: since(issue.lastSeen), tooltip: "Last seen" });
  return {
    id: issue.id,
    title: issue.title,
    subtitle: issue.culprit || issue.shortId,
    icon: { source: level.icon, tint: level.tint },
    section: issue.project.slug,
    keywords: [issue.shortId, issue.project.slug, issue.level, issue.metadata?.type ?? "", issue.assignedTo?.name ?? ""]
      .filter(Boolean),
    accessories,
    detail: {
      stats: issueStats(issue),
      markdown: issue.metadata?.value ? `**${issue.metadata.type ?? "Error"}**\n\n${issue.metadata.value}` : undefined,
      metadata: issueMetadata(issue),
    },
    actions: issueActions(issue, ctx),
  };
}
