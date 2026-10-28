// PagerDuty responses as plain data. Pure, tested in lib_test.ts.

import type { Color } from "@backslash/api";

export const apiHost = (region: unknown) =>
  String(region ?? "").trim().toLowerCase() === "eu" ? "api.eu.pagerduty.com" : "api.pagerduty.com";
export const appHost = (region: unknown) =>
  String(region ?? "").trim().toLowerCase() === "eu" ? "app.eu.pagerduty.com" : "app.pagerduty.com";

// ---------------------------------------------------------------------------
// Incidents

export interface Ref {
  id: string;
  summary: string;
  html_url?: string;
}

export interface Incident {
  id: string;
  incident_number: number;
  title: string;
  status: "triggered" | "acknowledged" | "resolved";
  urgency: "high" | "low";
  created_at: string;
  last_status_change_at?: string;
  html_url: string;
  incident_key?: string;
  service: Ref;
  escalation_policy?: Ref;
  assignments: { at: string; assignee: Ref }[];
  acknowledgements?: { at: string; acknowledger: Ref }[];
  priority?: { summary: string; color?: string } | null;
  teams?: Ref[];
}

/** Query string of `/incidents` for the open ones, yours or everyone's. */
export function incidentsQuery(userId?: string): string {
  const p = new URLSearchParams();
  p.append("statuses[]", "triggered");
  p.append("statuses[]", "acknowledged");
  if (userId) p.append("user_ids[]", userId);
  p.set("sort_by", "created_at:desc");
  p.set("limit", "100");
  p.set("total", "true");
  return p.toString();
}

/** Triggered before acknowledged, high urgency first, newest first. */
export function sortIncidents(incidents: Incident[]): Incident[] {
  return [...incidents].sort((a, b) =>
    Number(a.status !== "triggered") - Number(b.status !== "triggered") ||
    Number(a.urgency !== "high") - Number(b.urgency !== "high") ||
    Date.parse(b.created_at) - Date.parse(a.created_at)
  );
}

export const STATUS: Record<string, { title: string; color: Color }> = {
  triggered: { title: "Triggered", color: "red" },
  acknowledged: { title: "Acknowledged", color: "orange" },
  resolved: { title: "Resolved", color: "green" },
};

/** PagerDuty's priority colors are hex; the launcher takes them as they are. */
export function priorityColor(hex?: string): Color | undefined {
  if (!hex) return undefined;
  const h = hex.replace(/^#/, "").toLowerCase();
  if (!/^[0-9a-f]{6}$/.test(h)) return undefined;
  return `#${h}` as Color;
}

export const assignees = (i: Incident) => i.assignments.map((a) => a.assignee);

export const isAssignedTo = (i: Incident, userId: string) => i.assignments.some((a) => a.assignee.id === userId);

/** PUT /incidents/{id} bodies. */
export const statusBody = (status: "acknowledged" | "resolved") => ({
  incident: { type: "incident_reference", status },
});
export const reassignToUser = (userId: string) => ({
  incident: { type: "incident_reference", assignments: [{ assignee: { id: userId, type: "user_reference" } }] },
});
export const reassignToPolicy = (policyId: string) => ({
  incident: { type: "incident_reference", escalation_policy: { id: policyId, type: "escalation_policy_reference" } },
});
export const noteBody = (content: string) => ({ note: { content } });

// ---------------------------------------------------------------------------
// Timeline

export interface LogEntry {
  id: string;
  type: string;
  summary: string;
  created_at: string;
  agent?: Ref & { type?: string };
  channel?: { type?: string; summary?: string; details?: unknown; notes?: string };
  note?: string;
}

const ENTRY_LABELS: Record<string, string> = {
  trigger_log_entry: "Triggered",
  acknowledge_log_entry: "Acknowledged",
  resolve_log_entry: "Resolved",
  assign_log_entry: "Assigned",
  reassign_log_entry: "Reassigned",
  escalate_log_entry: "Escalated",
  notify_log_entry: "Notified",
  annotate_log_entry: "Note",
  snooze_log_entry: "Snoozed",
  unacknowledge_log_entry: "Unacknowledged",
  priority_change_log_entry: "Priority changed",
  urgency_change_log_entry: "Urgency changed",
  exhaust_escalation_path_log_entry: "Escalation exhausted",
  repeat_escalation_path_log_entry: "Escalation repeated",
};

export const entryLabel = (type: string) =>
  ENTRY_LABELS[type] ?? type.replace(/_log_entry$/, "").replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

/** The timeline as markdown lines, oldest first; notes quoted. */
export function timelineMarkdown(entries: LogEntry[], timeZone?: string): string {
  const fmt = (iso: string) =>
    new Date(iso).toLocaleString("en-GB", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      ...(timeZone ? { timeZone } : {}),
    });
  return [...entries]
    .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at))
    .map((e) => {
      const line = `- **${fmt(e.created_at)}** · ${entryLabel(e.type)} · ${e.summary.replace(/\s+/g, " ").trim()}`;
      const note = e.type === "annotate_log_entry" ? e.channel?.summary ?? e.note : undefined;
      return note && !e.summary.includes(note) ? `${line}\n  > ${note}` : line;
    })
    .join("\n");
}

// ---------------------------------------------------------------------------
// On call

export interface OnCall {
  user: Ref & { email?: string; avatar_url?: string; name?: string };
  schedule: Ref | null;
  escalation_policy: Ref;
  escalation_level: number;
  start: string | null;
  end: string | null;
}

export interface OnCallRow {
  key: string;
  userId: string;
  name: string;
  email?: string;
  avatar?: string;
  group: string;
  scheduleId?: string;
  scheduleUrl?: string;
  policy: Ref;
  level: number;
  start?: Date;
  end?: Date;
}

/** One row per person and schedule (or escalation policy when on call directly), lowest level first. */
export function onCallRows(oncalls: OnCall[]): OnCallRow[] {
  const rows = new Map<string, OnCallRow>();
  for (const o of oncalls) {
    const group = o.schedule?.summary ?? `${o.escalation_policy.summary} (direct)`;
    const key = `${group}|${o.user.id}`;
    const existing = rows.get(key);
    if (existing && existing.level <= o.escalation_level) continue;
    rows.set(key, {
      key,
      userId: o.user.id,
      name: o.user.name ?? o.user.summary,
      email: o.user.email,
      avatar: o.user.avatar_url,
      group,
      scheduleId: o.schedule?.id,
      scheduleUrl: o.schedule?.html_url,
      policy: o.escalation_policy,
      level: o.escalation_level,
      start: o.start ? new Date(o.start) : undefined,
      end: o.end ? new Date(o.end) : undefined,
    });
  }
  return [...rows.values()].sort((a, b) =>
    Number(!a.scheduleId) - Number(!b.scheduleId) || a.group.localeCompare(b.group) || a.level - b.level ||
    a.name.localeCompare(b.name)
  );
}

// ---------------------------------------------------------------------------
// Time

/** "45 s", "12 min", "3 h", "2 d". */
export function short(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} s`;
  if (s < 3600) return `${Math.floor(s / 60)} min`;
  if (s < 86400) return `${Math.floor(s / 3600)} h`;
  return `${Math.floor(s / 86400)} d`;
}

export const age = (iso: string, now = Date.now()) => short(now - Date.parse(iso));
