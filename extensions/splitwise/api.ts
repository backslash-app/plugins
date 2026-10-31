// Calls to the Splitwise API v3.0 with the personal API key (Bearer).

import { storage } from "@backslash/api";
import {
  API,
  errorText,
  type Expense,
  expenseBody,
  type FriendBalance,
  friendBalance,
  fromExpense,
  fullName,
  type GroupBalance,
  groupBalance,
  type NewExpense,
  splitwiseError,
  type SwExpense,
  type SwFriend,
  type SwGroup,
  type SwUser,
} from "./lib.ts";

export async function splitwise<T>(
  key: string,
  path: string,
  o: { method?: string; body?: unknown; signal?: AbortSignal } = {},
): Promise<T> {
  const timeout = AbortSignal.timeout(20_000);
  let res: Response;
  try {
    res = await fetch(`${API}${path}`, {
      method: o.method ?? "GET",
      headers: {
        Authorization: `Bearer ${key}`,
        Accept: "application/json",
        ...(o.body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: o.body === undefined ? undefined : JSON.stringify(o.body),
      signal: o.signal ? AbortSignal.any([o.signal, timeout]) : timeout,
    });
  } catch (e) {
    if (o.signal?.aborted) throw e;
    throw new Error(`Splitwise is unreachable: ${(e as Error).message}`);
  }
  const json = await res.json().catch(() => undefined);
  if (!res.ok) throw splitwiseError(res.status, json);
  return json as T;
}

export interface Me {
  id: number;
  name: string;
  currency: string;
}

/** You, kept for next time (the id never changes, the currency rarely). */
export async function me(key: string, signal?: AbortSignal): Promise<Me> {
  const cacheKey = `me:${key.slice(-6)}`;
  const saved = await storage.get(cacheKey).catch(() => undefined) as Me | undefined;
  const load = splitwise<{ user: SwUser }>(key, "/get_current_user", { signal }).then(async ({ user }) => {
    const m = { id: user.id, name: fullName(user), currency: user.default_currency || "EUR" };
    await storage.set(cacheKey, m).catch(() => {});
    return m;
  });
  if (saved?.id) {
    load.catch(() => {});
    return saved;
  }
  return await load;
}

export interface Overview {
  me: Me;
  friends: FriendBalance[];
  groups: GroupBalance[];
}

export async function overview(key: string, signal?: AbortSignal): Promise<Overview> {
  const [user, f, g] = await Promise.all([
    me(key, signal),
    splitwise<{ friends: SwFriend[] }>(key, "/get_friends", { signal }),
    splitwise<{ groups: SwGroup[] }>(key, "/get_groups", { signal }),
  ]);
  const names = new Map(g.groups.map((x) => [x.id, x.name]));
  const result = {
    me: user,
    friends: f.friends.map((x) => friendBalance(x, names)),
    groups: g.groups.map((x) => groupBalance(x, user.id)),
  };
  await saveChoices(key, result);
  return result;
}

export async function expenses(key: string, signal?: AbortSignal): Promise<{ me: Me; list: Expense[] }> {
  const [user, r] = await Promise.all([
    me(key, signal),
    splitwise<{ expenses: SwExpense[] }>(key, "/get_expenses?limit=60", { signal }),
  ]);
  return {
    me: user,
    list: r.expenses.map((e) => fromExpense(e, user.id)).filter((e): e is Expense => e !== undefined)
      .sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id),
  };
}

export async function deleteExpense(key: string, id: number): Promise<void> {
  const r = await splitwise<{ success?: boolean; errors?: unknown }>(key, `/delete_expense/${id}`, { method: "POST" });
  if (r.success === false) throw new Error(`Splitwise didn't delete it${errorText(r) ? `: ${errorText(r)}` : ""}`);
}

/** Splitwise answers 200 with `errors` when the expense is refused. */
export async function createExpense(key: string, user: Me, e: NewExpense): Promise<SwExpense> {
  const r = await splitwise<{ expenses?: SwExpense[]; errors?: unknown }>(key, "/create_expense", {
    method: "POST",
    body: expenseBody(e, user.id),
  });
  const problem = errorText({ errors: r.errors });
  if (!r.expenses?.length) throw new Error(`Splitwise refused the expense${problem ? `: ${problem}` : ""}`);
  await storage.set("lastWith", e.with.kind === "group" ? `g:${e.with.id}` : `f:${e.with.id}`).catch(() => {});
  await storage.set("lastCurrency", e.currency).catch(() => {});
  return r.expenses[0];
}

// ---------------------------------------------------------------------------
// Form choices, saved so the form opens at once

export interface Choices {
  friends: { id: number; name: string }[];
  groups: { id: number; name: string }[];
  currency: string;
  me: Me;
}

const choicesKey = (key: string) => `choices:${key.slice(-6)}`;

function choicesOf(o: Overview): Choices {
  return {
    friends: o.friends.map((f) => ({ id: f.id, name: f.name })).sort((a, b) => a.name.localeCompare(b.name)),
    groups: o.groups.filter((g) => g.id !== 0).map((g) => ({ id: g.id, name: g.name })),
    currency: o.me.currency,
    me: o.me,
  };
}

async function saveChoices(key: string, o: Overview): Promise<void> {
  await storage.set(choicesKey(key), choicesOf(o) as unknown as Parameters<typeof storage.set>[1]).catch(() => {});
}

/** The friends and groups saved last time (refreshed in the background), else loaded now. */
export async function choices(key: string): Promise<Choices> {
  const saved = await storage.get(choicesKey(key)).catch(() => undefined) as Choices | undefined;
  if (saved?.me) {
    overview(key).catch(() => {});
    return saved;
  }
  return choicesOf(await overview(key));
}

export async function lastChoice(): Promise<{ with?: string; currency?: string }> {
  const [w, c] = await Promise.all([
    storage.get<string>("lastWith").catch(() => undefined),
    storage.get<string>("lastCurrency").catch(() => undefined),
  ]);
  return { with: w, currency: c };
}
