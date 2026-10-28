// Calls to the Trello REST API with the user's key and token.

import type { Item } from "@backslash/api";
import { type Account, account, API, AuthError, setupItem, trelloError } from "./lib.ts";

export async function trello<T>(
  a: Account,
  path: string,
  options: { method?: string; params?: Record<string, string | number | boolean | undefined>; signal?: AbortSignal } =
    {},
): Promise<T> {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(options.params ?? {})) if (v !== undefined) params.set(k, String(v));
  const sep = path.includes("?") ? "&" : "?";
  let res: Response;
  try {
    res = await fetch(`${API}${path}${params.size ? `${sep}${params}` : ""}`, {
      method: options.method ?? "GET",
      signal: options.signal,
      headers: {
        // The documented header form, which keeps the token out of URLs and logs.
        Authorization: `OAuth oauth_consumer_key="${a.key}", oauth_token="${a.token}"`,
        Accept: "application/json",
      },
    });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw new Error(`Trello is unreachable: ${(e as Error).message}`);
  }
  const text = await res.text();
  if (!res.ok) throw trelloError(res.status, text);
  return (text ? JSON.parse(text) : undefined) as T;
}

export const CARD_FIELDS =
  "name,desc,due,dueComplete,start,idList,idBoard,idMembers,labels,url,shortUrl,pos,dateLastActivity,badges";
export const MEMBER_FIELDS = "fullName,username,avatarUrl,initials";

export async function guarded(prefs: Record<string, unknown>, load: (a: Account) => Promise<Item[]>): Promise<Item[]> {
  try {
    return await load(account(prefs));
  } catch (e) {
    if (e instanceof AuthError) return [setupItem(e, prefs)];
    throw e;
  }
}
