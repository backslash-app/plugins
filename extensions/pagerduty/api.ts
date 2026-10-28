// PagerDuty REST API v2 with an API key, in the US or EU service region.

import { Icons, type Item, open } from "@backslash/api";
import { apiHost, appHost } from "./lib.ts";

export class SetupError extends Error {}

export interface Account {
  token: string;
  email?: string;
  host: string;
  app: string;
}

export function account(preferences: Record<string, unknown>): Account {
  const token = String(preferences.token ?? "").trim();
  if (!token) throw new SetupError("Add a PagerDuty API key");
  const email = String(preferences.email ?? "").trim() || undefined;
  return { token, email, host: apiHost(preferences.region), app: appHost(preferences.region) };
}

export async function pd<T>(
  a: Account,
  path: string,
  options: { method?: string; body?: unknown; signal?: AbortSignal; write?: boolean } = {},
): Promise<T> {
  const write = options.write ?? (options.method !== undefined && options.method !== "GET");
  if (write && !a.email) {
    throw new SetupError("Add your PagerDuty email: it is needed to change incidents");
  }
  const res = await fetch(`https://${a.host}${path}`, {
    method: options.method ?? "GET",
    signal: options.signal,
    headers: {
      Authorization: `Token token=${a.token}`,
      Accept: "application/vnd.pagerduty+json;version=2",
      ...(write && a.email ? { From: a.email } : {}),
      ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  if (res.status === 401) throw new SetupError("PagerDuty rejected the API key");
  const text = await res.text();
  let body: any;
  try {
    body = text ? JSON.parse(text) : undefined;
  } catch {
    body = undefined;
  }
  if (!res.ok) {
    const e = body?.error;
    const message = [e?.message, ...(e?.errors ?? [])].filter(Boolean).join(": ");
    if (res.status === 403) throw new Error(`PagerDuty refused it${message ? `: ${message}` : ""}`);
    if (res.status === 429) throw new Error("PagerDuty rate limit reached: try again in a minute");
    throw new Error(`PagerDuty answered ${res.status}${message ? `: ${message}` : ""}`);
  }
  return body as T;
}

export function setupItems(error: SetupError, app = "app.pagerduty.com"): Item[] {
  return [{
    id: "setup",
    title: error.message,
    subtitle: "API key and your email",
    icon: { source: Icons.key, tint: "orange" },
    detail: {
      markdown: [
        "## Connect PagerDuty",
        "",
        "1. Create a key (Enter opens your profile):",
        "   - a **user token**: **My Profile → User Settings → Create API User Token**, which acts as you;",
        "   - or an **account API key**: **Integrations → API Access Keys** (admins).",
        "2. In **Settings → Extensions → PagerDuty → Configure**, paste it, and set **your email**:",
        "   PagerDuty records who acknowledged, resolved or wrote a note from it.",
        "3. For an EU account (`app.eu.pagerduty.com`), set the region to `eu`.",
      ].join("\n"),
    },
    actions: [
      open(`https://${app}/users/me`, "Open My Profile", { icon: Icons.person }),
      open(`https://${app}/api_keys`, "Open API Access Keys", { icon: Icons.key }),
    ],
  }];
}

export async function guarded(preferences: Record<string, unknown>, load: () => Promise<Item[]>): Promise<Item[]> {
  try {
    return await load();
  } catch (e) {
    if (e instanceof SetupError) return setupItems(e, appHost(preferences.region));
    throw e;
  }
}

/** The signed-in user: `/users/me` with a user token, else found by the email preference. */
let me: Promise<{ id: string; name: string } | undefined> | undefined;
export function currentUser(a: Account): Promise<{ id: string; name: string } | undefined> {
  return me ??= (async () => {
    try {
      const { user } = await pd<{ user: { id: string; name: string } }>(a, "/users/me");
      return user;
    } catch (e) {
      if (e instanceof SetupError) throw e;
      if (!a.email) return undefined;
      const { users } = await pd<{ users: { id: string; name: string; email: string }[] }>(
        a,
        `/users?query=${encodeURIComponent(a.email)}&limit=5`,
      );
      return users.find((u) => u.email.toLowerCase() === a.email!.toLowerCase());
    }
  })();
}
