import { action, Icons, list, refresh, submenu, toast, updateCommandMetadata } from "@backslash/api";
import { countStatus, gql, guarded, token } from "../api.ts";
import {
  assignedTo,
  isOpenTicket,
  type Page,
  sortTickets,
  STATUS_CHOICES,
  STATUS_MUTATION,
  SUBSCRIPTIONS_QUERY,
  type Ticket,
  ticketItem,
  TICKETS_QUERY,
  type TrackedTicket,
  type Tracker,
  TRACKERS_QUERY,
  username,
} from "../lib.ts";

/** Pages of tickets read per tracker (newest first). */
const PAGES = 2;

async function trackerTickets(t: string, tracker: Tracker, signal: AbortSignal): Promise<TrackedTicket[]> {
  const out: TrackedTicket[] = [];
  let cursor: string | null | undefined = null;
  for (let i = 0; i < PAGES; i++) {
    const data: { user: { tracker: { tickets: Page<Ticket> } | null } | null } = await gql(
      t,
      "todo",
      TICKETS_QUERY,
      { owner: username(tracker.owner), tracker: tracker.name, cursor },
      signal,
    );
    const page = data.user?.tracker?.tickets;
    if (!page) break;
    out.push(...page.results.map((x) => ({ ...x, tracker })));
    cursor = page.cursor;
    if (!cursor) break;
  }
  return out;
}

function statusMenu(t: string, ticket: TrackedTicket) {
  return submenu(
    "Change Status",
    STATUS_CHOICES.filter((c) =>
      c.status === "REPORTED" ? ticket.status === "RESOLVED" : c.status === "RESOLVED" || c.status !== ticket.status
    ).map((c) =>
      action(c.title, async () => {
        await gql(t, "todo", STATUS_MUTATION, {
          tracker: ticket.tracker.id,
          ticket: ticket.id,
          input: { status: c.status, ...(c.resolution ? { resolution: c.resolution } : {}) },
        });
        await toast(`#${ticket.id} → ${c.title}`, { style: "success" });
        return refresh();
      }, { icon: Icons.arrowRight })
    ),
    { icon: Icons.inProgress, shortcut: "<Ctrl>s" },
  );
}

export default list({
  placeholder: "Filter tickets by subject, tracker, label…",
  filter: {
    options: [
      { value: "assigned", title: "Assigned to me" },
      { value: "trackers", title: "My trackers" },
    ],
  },
  empty: { title: "No open tickets", description: "Resolved tickets are left out.", icon: Icons.issue },
  status: (items) => countStatus(items, "ticket"),
  items: ({ preferences, signal, filter }) =>
    guarded(async () => {
      const t = token(preferences);
      const [mine, subs] = await Promise.all([
        gql<{ me: { canonicalName: string; trackers: Page<Tracker> } }>(t, "todo", TRACKERS_QUERY, {}, signal),
        filter === "trackers"
          ? Promise.resolve(undefined)
          : gql<{ subscriptions: Page<{ tracker?: Tracker }> }>(t, "todo", SUBSCRIPTIONS_QUERY, {}, signal)
            .catch(() => undefined),
      ]);
      const me = mine.me.canonicalName;
      const trackers = new Map(mine.me.trackers.results.map((tr) => [tr.id, tr]));
      for (const s of subs?.subscriptions.results ?? []) if (s.tracker) trackers.set(s.tracker.id, s.tracker);
      const lists = await Promise.all(
        [...trackers.values()].slice(0, 25).map((tr) =>
          trackerTickets(t, tr, signal).catch(() => [] as TrackedTicket[])
        ),
      );
      const open = lists.flat().filter(isOpenTicket);
      const assigned = open.filter((x) => assignedTo(x, me));
      updateCommandMetadata({ subtitle: assigned.length ? `${assigned.length} assigned` : null }).catch(() => {});
      const shown = filter === "trackers" ? open.filter((x) => x.tracker.owner.canonicalName === me) : assigned;
      return sortTickets(shown).map((x) => ticketItem(x, me, [statusMenu(t, x)]));
    }),
});
