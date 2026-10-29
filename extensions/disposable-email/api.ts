// mail.tm's API (domains, accounts, tokens, messages) and the accounts kept in storage.

import { storage } from "@backslash/api";
import {
  type Account,
  addAccount,
  API,
  type Domain,
  members,
  type Message,
  pickDomain,
  randomLocalPart,
  randomPassword,
  removeAccount,
  type Summary,
} from "./lib.ts";

type Json = Parameters<typeof storage.set>[1];

export class GoneError extends Error {}

class Unauthorized extends Error {}

async function mailtm<T>(
  path: string,
  o: { method?: string; body?: unknown; token?: string; signal?: AbortSignal; contentType?: string } = {},
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API}${path}`, {
      method: o.method ?? "GET",
      signal: o.signal,
      headers: {
        Accept: "application/json",
        ...(o.token ? { Authorization: `Bearer ${o.token}` } : {}),
        ...(o.body === undefined ? {} : { "Content-Type": o.contentType ?? "application/json" }),
      },
      body: o.body === undefined ? undefined : JSON.stringify(o.body),
    });
  } catch (e) {
    if (o.signal?.aborted) throw e;
    throw new Error("Cannot reach mail.tm: check your connection");
  }
  const text = await res.text();
  let data: any;
  try {
    data = text ? JSON.parse(text) : undefined;
  } catch {
    data = undefined;
  }
  if (res.status === 401) throw new Unauthorized("mail.tm refused the sign-in");
  if (res.status === 404) throw new GoneError("mail.tm doesn't have it anymore");
  if (res.status === 429) throw new Error("mail.tm asks to slow down: try again in a few seconds");
  if (!res.ok) {
    const msg = data?.detail ?? data?.["hydra:description"] ?? data?.message ?? "";
    throw new Error(`mail.tm answered ${res.status}${msg ? `: ${msg}` : ""}`);
  }
  return data as T;
}

// ---------------------------------------------------------------------------
// Accounts in storage

export async function accounts(): Promise<Account[]> {
  return (await storage.get("accounts").catch(() => undefined) as Account[] | undefined) ?? [];
}

async function saveAccounts(all: Account[]) {
  await storage.set("accounts", all as unknown as Json);
}

/** The account in use: the one picked if it still exists, else the newest. */
export async function current(): Promise<Account | undefined> {
  const all = await accounts();
  const picked = await storage.get<string>("current").catch(() => undefined);
  return all.find((a) => a.id === picked) ?? all[0];
}

export async function pick(id: string): Promise<void> {
  await storage.set("current", id);
}

/** A new address on a random public domain; retried with another name when it's taken. */
export async function createAccount(): Promise<Account> {
  const domains = members<Domain>(await mailtm("/domains?page=1"));
  const password = randomPassword();
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    const address = `${randomLocalPart()}@${pickDomain(domains)}`;
    try {
      const created = await mailtm<{ id: string; address: string }>("/accounts", {
        method: "POST",
        body: { address, password },
      });
      const { token } = await mailtm<{ token: string }>("/token", { method: "POST", body: { address, password } });
      const account: Account = { id: created.id, address: created.address, password, token, created: Date.now() };
      await saveAccounts(addAccount(await accounts(), account));
      await pick(account.id);
      return account;
    } catch (e) {
      lastError = e;
      // 422: the address exists or the domain refused it; anything else won't get better.
      if (!/answered 422/.test(String(e))) throw e;
    }
  }
  throw lastError;
}

async function refreshToken(a: Account): Promise<string> {
  const { token } = await mailtm<{ token: string }>("/token", {
    method: "POST",
    body: { address: a.address, password: a.password },
  });
  await saveAccounts((await accounts()).map((x) => x.id === a.id ? { ...x, token } : x));
  a.token = token;
  return token;
}

/** Calls with the account's token, signing in again when it expired. */
async function authed<T>(a: Account, path: string, o: Parameters<typeof mailtm>[1] = {}): Promise<T> {
  try {
    return await mailtm<T>(path, { ...o, token: a.token ?? await refreshToken(a) });
  } catch (e) {
    if (!(e instanceof Unauthorized)) throw e;
    try {
      return await mailtm<T>(path, { ...o, token: await refreshToken(a) });
    } catch (again) {
      if (again instanceof Unauthorized) throw new GoneError("mail.tm no longer knows this address");
      throw again;
    }
  }
}

export const messages = async (a: Account, signal?: AbortSignal) =>
  members<Summary>(await authed(a, "/messages?page=1", { signal }));

export const message = (a: Account, id: string, signal?: AbortSignal) =>
  authed<Message>(a, `/messages/${id}`, { signal });

export async function markSeen(a: Account, id: string): Promise<void> {
  await authed(a, `/messages/${id}`, {
    method: "PATCH",
    body: { seen: true },
    contentType: "application/merge-patch+json",
  });
}

export async function deleteMessage(a: Account, id: string): Promise<void> {
  await authed(a, `/messages/${id}`, { method: "DELETE" });
}

/** Deletes the address on mail.tm (if it still exists) and forgets it. */
export async function deleteAccount(a: Account): Promise<void> {
  try {
    await authed(a, `/accounts/${a.id}`, { method: "DELETE" });
  } catch (e) {
    if (!(e instanceof GoneError)) throw e;
  }
  await forget(a.id);
}

export async function forget(id: string): Promise<void> {
  await saveAccounts(removeAccount(await accounts(), id));
}
