// Calls to Cal.com (API v2, Bearer API key, versioned by the cal-api-version
// header) and Calendly (API v2, Bearer personal access token).

import { storage } from "@backslash/api";
import {
  type Account,
  apiError,
  type Booking,
  CAL_API,
  type CalBooking,
  CALENDLY_API,
  type CalendlyEvent,
  type CalendlyEventType,
  type CalendlyInvitee,
  type CalEventType,
  type EventLink,
  fromCalBooking,
  fromCalendlyEvent,
  fromCalendlyEventType,
  fromCalEventType,
  PROVIDER_NAMES,
  upcomingOnly,
  uuidOf,
} from "./lib.ts";

async function request<T>(
  a: Account,
  path: string,
  o: { method?: string; body?: unknown; signal?: AbortSignal; version?: string } = {},
): Promise<T> {
  const timeout = AbortSignal.timeout(20_000);
  const url = `${a.provider === "cal" ? CAL_API : CALENDLY_API}${path}`;
  const headers: Record<string, string> = { Authorization: `Bearer ${a.token}`, Accept: "application/json" };
  if (o.version) headers["cal-api-version"] = o.version;
  if (o.body !== undefined) headers["Content-Type"] = "application/json";
  let res: Response;
  try {
    res = await fetch(url, {
      method: o.method ?? "GET",
      headers,
      body: o.body === undefined ? undefined : JSON.stringify(o.body),
      signal: o.signal ? AbortSignal.any([o.signal, timeout]) : timeout,
    });
  } catch (e) {
    if (o.signal?.aborted) throw e;
    throw new Error(`${PROVIDER_NAMES[a.provider]} is unreachable: ${(e as Error).message}`);
  }
  const text = await res.text();
  let json: unknown;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = undefined;
  }
  if (!res.ok) throw apiError(a.provider, res.status, json);
  return json as T;
}

/** Each account's result, or its error: one service down doesn't hide the other. */
export async function each<T>(
  list: Account[],
  load: (a: Account) => Promise<T>,
): Promise<{ ok: { account: Account; value: T }[]; errors: { account: Account; error: Error }[] }> {
  const settled = await Promise.allSettled(list.map(load));
  const ok: { account: Account; value: T }[] = [];
  const errors: { account: Account; error: Error }[] = [];
  settled.forEach((r, i) =>
    r.status === "fulfilled"
      ? ok.push({ account: list[i], value: r.value })
      : errors.push({ account: list[i], error: r.reason })
  );
  return { ok, errors };
}

/** Runs `fn` on every item, `limit` at a time. */
async function pool<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

// ---------------------------------------------------------------------------
// Who I am

interface CalendlyUser {
  uri: string;
  name: string;
  slug: string;
  scheduling_url: string;
  timezone?: string;
}

/** The Calendly user (its URI scopes every list); kept for next time. */
async function calendlyMe(a: Account, signal?: AbortSignal): Promise<CalendlyUser> {
  const key = `calendly:me:${a.token.slice(-8)}`;
  const saved = await storage.get(key).catch(() => undefined) as CalendlyUser | undefined;
  if (saved?.uri) return saved;
  const { resource: r } = await request<{ resource: CalendlyUser }>(a, "/users/me", { signal });
  const me = { uri: r.uri, name: r.name, slug: r.slug, scheduling_url: r.scheduling_url };
  await storage.set(key, me).catch(() => {});
  return me;
}

async function calUsername(a: Account, signal?: AbortSignal): Promise<string | undefined> {
  const key = `cal:username:${a.token.slice(-8)}`;
  const saved = await storage.get<string>(key).catch(() => undefined);
  if (saved) return saved;
  const r = await request<{ data?: { username?: string } }>(a, "/me", { signal }).catch(() => undefined);
  const name = r?.data?.username;
  if (name) await storage.set(key, name).catch(() => {});
  return name;
}

// ---------------------------------------------------------------------------
// Bookings

export async function bookings(a: Account, signal?: AbortSignal): Promise<Booking[]> {
  if (a.provider === "cal") {
    const params = new URLSearchParams({ status: "upcoming,unconfirmed", take: "100", sortStart: "asc" });
    const r = await request<{ data: CalBooking[] }>(a, `/bookings?${params}`, { signal, version: "2024-08-13" });
    return upcomingOnly((r.data ?? []).map(fromCalBooking));
  }
  const me = await calendlyMe(a, signal);
  const params = new URLSearchParams({
    user: me.uri,
    status: "active",
    min_start_time: new Date(Date.now() - 4 * 3_600_000).toISOString(),
    sort: "start_time:asc",
    count: "100",
  });
  const r = await request<{ collection: CalendlyEvent[] }>(a, `/scheduled_events?${params}`, { signal });
  const events = r.collection.filter((e) => e.status !== "canceled" && Date.parse(e.end_time) > Date.now());
  // Who booked is a separate call per event; the first 40 are plenty for a launcher.
  const withInvitees = await pool(events.slice(0, 40), 6, async (e) => {
    const inv = await request<{ collection: CalendlyInvitee[] }>(
      a,
      `/scheduled_events/${uuidOf(e.uri)}/invitees?count=100`,
      { signal },
    ).then((x) => x.collection, () => []);
    return fromCalendlyEvent(e, inv);
  });
  return upcomingOnly([...withInvitees, ...events.slice(40).map((e) => fromCalendlyEvent(e))]);
}

export async function cancel(a: Account, b: Booking, reason: string): Promise<void> {
  if (a.provider === "cal") {
    await request(a, `/bookings/${encodeURIComponent(b.id)}/cancel`, {
      method: "POST",
      version: "2024-08-13",
      body: { cancellationReason: reason },
    });
  } else {
    await request(a, `/scheduled_events/${encodeURIComponent(b.id)}/cancellation`, {
      method: "POST",
      body: { reason },
    });
  }
}

// ---------------------------------------------------------------------------
// Event types

export interface Links {
  /** Your page listing every public event type. */
  page?: { url: string; name: string };
  links: EventLink[];
}

export async function eventLinks(a: Account, signal?: AbortSignal): Promise<Links> {
  if (a.provider === "cal") {
    const [username, r] = await Promise.all([
      calUsername(a, signal),
      request<{ data: CalEventType[] | { eventTypeGroups?: { eventTypes: CalEventType[] }[] } }>(a, "/event-types", {
        signal,
        version: "2024-06-14",
      }),
    ]);
    // 2024-06-14 answers a list; older versions grouped them.
    const list = Array.isArray(r.data) ? r.data : (r.data.eventTypeGroups ?? []).flatMap((g) => g.eventTypes);
    return {
      page: username ? { url: `https://cal.com/${username}`, name: username } : undefined,
      links: list.map((e) => fromCalEventType(e, username)).filter((e): e is EventLink => e !== undefined),
    };
  }
  const me = await calendlyMe(a, signal);
  const params = new URLSearchParams({ user: me.uri, active: "true", count: "100", sort: "name:asc" });
  const r = await request<{ collection: CalendlyEventType[] }>(a, `/event_types?${params}`, { signal });
  return {
    page: { url: me.scheduling_url, name: me.name },
    links: r.collection.filter((e) => e.active !== false).map(fromCalendlyEventType),
  };
}

/** A Calendly link that works for one booking only. */
export async function singleUseLink(a: Account, link: EventLink): Promise<string> {
  const { resource } = await request<{ resource: { booking_url: string } }>(a, "/scheduling_links", {
    method: "POST",
    body: { max_event_count: 1, owner: link.uri, owner_type: "EventType" },
  });
  return resource.booking_url;
}
