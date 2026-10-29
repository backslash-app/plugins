// Mattermost (API v4, personal access token) and Zulip (API v1, email + API key) behind one interface.

import {
  BACKENDS,
  type Channel,
  chooseBackend,
  type CurrentStatus,
  errorText,
  type Message,
  MM_PRESETS,
  type MmChannel,
  mmChannel,
  mmCustomStatus,
  mmCustomStatusBody,
  type MmDuration,
  type MmMember,
  mmMessages,
  type MmPost,
  type MmTeam,
  type MmUser,
  normalizeUrl,
  otherUserId,
  type Preset,
  SetupError,
  ZULIP_PRESETS,
  zulipChannels,
  type ZulipMessage,
  zulipMessage,
  zulipNarrow,
  type ZulipSubscription,
} from "./lib.ts";

export { SetupError };

export interface Chat {
  id: "mattermost" | "zulip";
  name: string;
  base: string;
  presets: Preset[];
  channels(signal?: AbortSignal): Promise<Channel[]>;
  messages(c: Channel, signal?: AbortSignal): Promise<Message[]>;
  /** A reply goes to the thread (Mattermost) or the topic (Zulip) of `replyTo`. */
  send(c: Channel, text: string, o?: { replyTo?: Message; topic?: string }): Promise<void>;
  markRead(c: Channel): Promise<void>;
  status(signal?: AbortSignal): Promise<CurrentStatus>;
  /** Mattermost only: online, away, dnd (until `dndEnd`, unix seconds), offline. */
  setAvailability?(status: string, dndEnd?: number): Promise<void>;
  setCustom(text: string, emoji: Preset | string, duration?: MmDuration): Promise<void>;
  clearCustom(): Promise<void>;
}

type Init = { method?: string; json?: unknown; form?: Record<string, string>; signal?: AbortSignal };

function caller(service: string, api: string, auth: string) {
  return async <T>(path: string, o: Init = {}): Promise<T> => {
    const timeout = AbortSignal.timeout(20_000);
    let res: Response;
    try {
      res = await fetch(`${api}${path}`, {
        method: o.method ?? (o.json !== undefined || o.form ? "POST" : "GET"),
        signal: o.signal ? AbortSignal.any([o.signal, timeout]) : timeout,
        headers: {
          Authorization: auth,
          Accept: "application/json",
          ...(o.json !== undefined ? { "Content-Type": "application/json" } : {}),
          ...(o.form ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
        },
        body: o.json !== undefined ? JSON.stringify(o.json) : o.form ? new URLSearchParams(o.form) : undefined,
      });
    } catch (e) {
      if (o.signal?.aborted) throw e;
      throw new Error(`${service} is unreachable at ${new URL(api).host}: ${(e as Error).message}`);
    }
    const text = await res.text().catch(() => "");
    let body: unknown;
    try {
      body = text ? JSON.parse(text) : undefined;
    } catch {
      if (res.ok) {
        throw new Error(`${service} didn't answer with JSON at ${new URL(api).origin}: is the address right?`);
      }
    }
    if (res.status === 401) {
      throw new SetupError(`${service} refused the token: check it in Settings → Extensions → Mattermost & Zulip`);
    }
    if (!res.ok || (body as { result?: string } | undefined)?.result === "error") {
      throw new Error(errorText(service, res.ok ? 400 : res.status, body));
    }
    return body as T;
  };
}

function credentials(prefs: Record<string, unknown>, service: string) {
  const base = normalizeUrl(prefs.url);
  if (!base) throw new SetupError(`Add the address of your ${service} server`);
  const token = String(prefs.token ?? "").trim().replace(/^Bearer\s+/i, "");
  if (!token) throw new SetupError(service === "Zulip" ? "Add your Zulip API key" : "Add a Mattermost access token");
  return { base, token };
}

// ---------------------------------------------------------------------------

function mattermost(prefs: Record<string, unknown>): Chat {
  const { base, token } = credentials(prefs, "Mattermost");
  const call = caller("Mattermost", `${base}/api/v4`, `Bearer ${token}`);
  let me: Promise<MmUser & { props?: Record<string, unknown> }> | undefined;
  const whoami = (signal?: AbortSignal) =>
    me ??= call<MmUser & { props?: Record<string, unknown> }>("/users/me", { signal }).catch((e) => {
      me = undefined;
      throw e;
    });
  const users = new Map<string, MmUser>();
  const loadUsers = async (ids: string[], signal?: AbortSignal) => {
    const missing = [...new Set(ids)].filter((id) => id && !users.has(id));
    if (!missing.length) return;
    for (const u of await call<MmUser[]>("/users/ids", { json: missing, signal })) users.set(u.id, u);
  };
  let firstTeam = "";
  return {
    id: "mattermost",
    name: BACKENDS.mattermost,
    base,
    presets: MM_PRESETS,
    async channels(signal) {
      const [user, teams] = await Promise.all([whoami(signal), call<MmTeam[]>("/users/me/teams", { signal })]);
      const active = teams.filter((t) => !t.delete_at);
      if (!active.length) return [];
      firstTeam = active[0].name;
      const perTeam = await Promise.all(active.map(async (t) => {
        const [channels, members] = await Promise.all([
          call<MmChannel[]>(`/users/me/teams/${t.id}/channels`, { signal }),
          call<MmMember[]>(`/users/me/teams/${t.id}/channels/members`, { signal }),
        ]);
        return { team: t, channels, members: new Map(members.map((m) => [m.channel_id, m])) };
      }));
      // Direct and group messages come with every team: keep them once, under the first.
      const seen = new Set<string>();
      const all: { team: MmTeam; channel: MmChannel; member?: MmMember }[] = [];
      for (const { team, channels, members } of perTeam) {
        for (const c of channels) {
          if (c.delete_at || seen.has(c.id)) continue;
          seen.add(c.id);
          all.push({ team, channel: c, member: members.get(c.id) });
        }
      }
      await loadUsers(
        all.filter((x) => x.channel.type === "D").map((x) => otherUserId(x.channel.name, user.id) ?? ""),
        signal,
      ).catch(() => {});
      return all.map((x) => mmChannel(x.channel, x.member, x.team, users, user.id, base));
    },
    async messages(c, signal) {
      const [user, r] = await Promise.all([
        whoami(signal),
        call<{ order: string[]; posts: Record<string, MmPost> }>(`/channels/${c.id}/posts?per_page=30`, { signal }),
      ]);
      await loadUsers(Object.values(r.posts).map((p) => p.user_id), signal).catch(() => {});
      const team = c.team?.name ?? firstTeam;
      return mmMessages(r, users, user.id, c.lastViewed ?? 0, (id) => `${base}/${team}/pl/${id}`);
    },
    async send(c, text, o = {}) {
      await call("/posts", {
        json: { channel_id: c.id, message: text, ...(o.replyTo ? { root_id: o.replyTo.rootId ?? o.replyTo.id } : {}) },
      });
    },
    async markRead(c) {
      await call("/channels/members/me/view", { json: { channel_id: c.id } });
    },
    async status(signal) {
      const [user, s] = await Promise.all([
        call<MmUser & { props?: Record<string, unknown> }>("/users/me", { signal }),
        call<{ status: string; dnd_end_time?: number }>("/users/me/status", { signal }),
      ]);
      return { availability: s.status, dndEnd: s.dnd_end_time || undefined, custom: mmCustomStatus(user.props) };
    },
    async setAvailability(status, dndEnd) {
      const user = await whoami();
      await call("/users/me/status", {
        method: "PUT",
        json: { user_id: user.id, status, ...(status === "dnd" && dndEnd ? { dnd_end_time: dndEnd } : {}) },
      });
    },
    async setCustom(text, emoji, duration = "") {
      const name = typeof emoji === "string" ? emoji : emoji.emoji;
      await call("/users/me/status/custom", { method: "PUT", json: mmCustomStatusBody(text, name, duration) });
    },
    async clearCustom() {
      await call("/users/me/status/custom", { method: "DELETE" });
    },
  };
}

// ---------------------------------------------------------------------------

function zulip(prefs: Record<string, unknown>): Chat {
  const { base, token } = credentials(prefs, "Zulip");
  const email = String(prefs.email ?? "").trim();
  if (!email) throw new SetupError("Add the email of your Zulip account (the one of the API key)");
  const call = caller("Zulip", `${base}/api/v1`, basic(email, token));
  let me: Promise<number> | undefined;
  const whoami = (signal?: AbortSignal) =>
    me ??= call<{ user_id: number }>("/users/me", { signal }).then((u) => u.user_id).catch((e) => {
      me = undefined;
      throw e;
    });
  const messages = (narrow: string, before: number, signal?: AbortSignal) =>
    call<{ messages: ZulipMessage[] }>(
      `/messages?${new URLSearchParams({
        anchor: "newest",
        num_before: String(before),
        num_after: "0",
        narrow,
        apply_markdown: "false",
      })}`,
      { signal },
    ).then((r) => r.messages ?? []);
  return {
    id: "zulip",
    name: BACKENDS.zulip,
    base,
    presets: ZULIP_PRESETS,
    async channels(signal) {
      const [id, subs, recent, unread] = await Promise.all([
        whoami(signal),
        call<{ subscriptions: ZulipSubscription[] }>("/users/me/subscriptions", { signal }).then((r) =>
          r.subscriptions ?? []
        ),
        messages("[]", 300, signal),
        messages(JSON.stringify([{ operator: "is", operand: "unread" }]), 1000, signal),
      ]);
      return zulipChannels(subs, recent, unread, id, base);
    },
    async messages(c, signal) {
      const [id, list] = await Promise.all([whoami(signal), messages(zulipNarrow(c), 30, signal)]);
      return list.map((m) => zulipMessage(m, id, base)).reverse();
    },
    async send(c, text, o = {}) {
      if (c.kind === "stream") {
        const topic = o.topic?.trim() || o.replyTo?.topic || c.lastTopic || "general chat";
        await call("/messages", {
          form: { type: "stream", to: c.id.slice("stream:".length), topic, content: text },
        });
      } else {
        await call("/messages", { form: { type: "private", to: JSON.stringify(c.userIds ?? []), content: text } });
      }
    },
    async markRead(c) {
      let ids = c.unreadIds ?? [];
      if (!ids.length) {
        // Opened from the list: ask which are unread now.
        const list = await messages(
          JSON.stringify([...JSON.parse(zulipNarrow(c)), { operator: "is", operand: "unread" }]),
          1000,
        );
        ids = list.map((m) => m.id);
      }
      if (!ids.length) return;
      await call("/messages/flags", { form: { messages: JSON.stringify(ids), op: "add", flag: "read" } });
    },
    // Zulip shows the status of others in its interface; reading your own needs a newer server.
    status: () => Promise.resolve({}),
    async setCustom(text, emoji) {
      const preset = typeof emoji === "string" ? undefined : emoji;
      const name = preset?.emoji ?? (typeof emoji === "string" ? emoji : "");
      await call("/users/me/status", {
        form: {
          status_text: text.slice(0, 60),
          emoji_name: name,
          ...(preset?.code ? { emoji_code: preset.code, reaction_type: "unicode_emoji" } : {}),
        },
      });
    },
    async clearCustom() {
      await call("/users/me/status", { form: { status_text: "", emoji_name: "" } });
    },
  };
}

function basic(user: string, password: string): string {
  const bytes = new TextEncoder().encode(`${user}:${password}`);
  return `Basic ${btoa(String.fromCharCode(...bytes))}`;
}

// ---------------------------------------------------------------------------

export function chatOf(prefs: Record<string, unknown>): Chat {
  const id = chooseBackend(prefs);
  if (!id) {
    const asked = String(prefs.backend ?? "").trim();
    if (asked && asked.toLowerCase() !== "auto") {
      throw new SetupError(`Unknown service “${asked}”: use mattermost or zulip`);
    }
    throw new SetupError("Connect Mattermost or Zulip");
  }
  return id === "mattermost" ? mattermost(prefs) : zulip(prefs);
}
