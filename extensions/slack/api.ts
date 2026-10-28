// Calls to the Slack Web API with the user's token, and what the views share.

import { type Context, toast } from "@backslash/api";
import {
  type Conversation,
  type Duration,
  encodeParams,
  expiryFor,
  slackError,
  type Status,
  type User,
  userToken,
} from "./lib.ts";

export const API = "https://slack.com/api";

export async function slack<T>(
  token: string,
  method: string,
  params: Record<string, unknown> = {},
  signal?: AbortSignal,
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API}/${method}`, {
      method: "POST",
      signal,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: encodeParams(params),
    });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw new Error(`Slack is unreachable: ${(e as Error).message}`);
  }
  if (res.status === 429) {
    await res.body?.cancel();
    throw new Error(`Slack is rate limiting: try again in ${res.headers.get("retry-after") ?? "a few"} seconds`);
  }
  const body = await res.json().catch(() => undefined) as { ok?: boolean; error?: string; needed?: string };
  if (!body) throw new Error(`Slack answered ${res.status}`);
  if (!body.ok) throw slackError(body);
  return body as T;
}

/** Follows `response_metadata.next_cursor` up to `max` results. */
export async function paged<T>(
  token: string,
  method: string,
  key: string,
  params: Record<string, unknown>,
  max: number,
  signal?: AbortSignal,
): Promise<T[]> {
  const out: T[] = [];
  let cursor = "";
  do {
    const page = await slack<Record<string, unknown> & { response_metadata?: { next_cursor?: string } }>(
      token,
      method,
      { ...params, limit: 200, cursor: cursor || undefined },
      signal,
    );
    out.push(...((page[key] as T[] | undefined) ?? []));
    cursor = page.response_metadata?.next_cursor ?? "";
  } while (cursor && out.length < max);
  return out;
}

export const tokenOf = (ctx: Pick<Context, "preferences">) => userToken(ctx.preferences);

export interface Team {
  team_id: string;
  team: string;
  url: string;
  user_id: string;
  user: string;
}

export const whoAmI = (token: string, signal?: AbortSignal) => slack<Team>(token, "auth.test", {}, signal);

export async function getStatus(token: string, signal?: AbortSignal): Promise<Status> {
  const { profile } = await slack<
    { profile: { status_text?: string; status_emoji?: string; status_expiration?: number } }
  >(token, "users.profile.get", {}, signal);
  return {
    text: profile.status_text ?? "",
    emoji: profile.status_emoji ?? "",
    expiration: profile.status_expiration ?? 0,
  };
}

export async function setStatus(token: string, status: Status): Promise<void> {
  await slack(token, "users.profile.set", {
    profile: { status_text: status.text, status_emoji: status.emoji, status_expiration: status.expiration },
  });
}

export const clearStatus = (token: string) => setStatus(token, { text: "", emoji: "", expiration: 0 });

export async function setStatusFor(
  token: string,
  status: { text: string; emoji: string },
  duration: Duration,
): Promise<Status> {
  const full = { ...status, expiration: expiryFor(duration) };
  await setStatus(token, full);
  return full;
}

export interface Dnd {
  dnd_enabled: boolean;
  next_dnd_start_ts?: number;
  next_dnd_end_ts?: number;
  snooze_enabled?: boolean;
  snooze_endtime?: number;
  snooze_remaining?: number;
}

export const getDnd = (token: string, signal?: AbortSignal) => slack<Dnd>(token, "dnd.info", {}, signal);

export async function snooze(token: string, minutes: number): Promise<number> {
  const res = await slack<{ snooze_endtime: number }>(token, "dnd.setSnooze", { num_minutes: minutes });
  return res.snooze_endtime;
}

export const endSnooze = (token: string) => slack(token, "dnd.endSnooze");

export function conversations(token: string, signal?: AbortSignal): Promise<Conversation[]> {
  return paged<Conversation>(
    token,
    "users.conversations",
    "channels",
    { types: "public_channel,private_channel,mpim,im", exclude_archived: true },
    1000,
    signal,
  );
}

/** Everyone in the workspace (for names and pictures in direct messages), up to 2000. */
export async function users(token: string, signal?: AbortSignal): Promise<Map<string, User>> {
  const all = await paged<User>(token, "users.list", "members", {}, 2000, signal);
  return new Map(all.map((u) => [u.id, u]));
}

export async function done(message: string) {
  await toast(message, { style: "success" });
}
