// Sentry Web API (`/api/0`) with a user auth token, on sentry.io or its US/EU region.

import { Icons, type Item, open } from "@backslash/api";

export const TOKEN_URL = "https://sentry.io/settings/account/api/auth-tokens/";

/** The hosts in `[permissions] net`; self-hosted Sentry would need its own. */
export const REGIONS = ["sentry.io", "us.sentry.io", "de.sentry.io"];

export class AuthError extends Error {}

export interface Account {
  host: string;
  org: string;
  token: string;
}

/** `https://de.sentry.io/` → `de.sentry.io`; empty → `sentry.io`. */
export function normalizeRegion(input: unknown): string {
  const host = String(input ?? "").trim().toLowerCase().replace(/^[a-z]+:\/\//, "").split(/[/?#]/)[0];
  return host || "sentry.io";
}

/** `https://acme.sentry.io/issues/` or `acme` → `acme`. */
export function normalizeOrg(input: unknown): string {
  const text = String(input ?? "").trim();
  const sub = /^(?:https?:\/\/)?([a-z0-9-]+)\.sentry\.io/i.exec(text);
  if (sub && !["us", "de", "www"].includes(sub[1].toLowerCase())) return sub[1].toLowerCase();
  const path = /sentry\.io\/organizations\/([^/]+)/i.exec(text);
  return (path ? path[1] : text).toLowerCase();
}

export function account(preferences: Record<string, unknown>): Account {
  const org = normalizeOrg(preferences.organization);
  const token = String(preferences.token ?? "").trim();
  const host = normalizeRegion(preferences.region);
  if (!org || !token) throw new AuthError("Add your Sentry organization and auth token");
  if (!REGIONS.includes(host)) {
    throw new AuthError(`${host} is not a Sentry region (use sentry.io, us.sentry.io or de.sentry.io)`);
  }
  return { host, org, token };
}

export const apiBase = (a: Account) => `https://${a.host}/api/0`;

export async function sentry<T>(
  a: Account,
  path: string,
  options: { method?: string; body?: unknown; signal?: AbortSignal } = {},
): Promise<T> {
  const res = await fetch(`${apiBase(a)}${path}`, {
    method: options.method ?? "GET",
    signal: options.signal,
    headers: {
      Authorization: `Bearer ${a.token}`,
      ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  if (res.status === 401) throw new AuthError("Sentry rejected the auth token");
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => undefined) as { detail?: unknown } | undefined;
  if (!res.ok) {
    const detail = typeof body?.detail === "string" ? body.detail : "";
    if (res.status === 403) {
      throw new Error(
        `Sentry refused it${detail ? `: ${detail}` : ""}. The token needs event:read, event:write, org:read`,
      );
    }
    if (res.status === 404 && path.startsWith(`/organizations/${a.org}/issues/?`)) {
      throw new AuthError(`No Sentry organization “${a.org}” on ${a.host}`);
    }
    throw new Error(`Sentry answered ${res.status}${detail ? `: ${detail}` : ""}`);
  }
  return body as T;
}

export function setupItems(error: AuthError): Item[] {
  return [{
    id: "setup",
    title: error.message,
    subtitle: "Organization slug, user auth token and region",
    icon: { source: Icons.key, tint: "orange" },
    detail: {
      markdown: [
        "## Connect Sentry",
        "",
        "1. Create a **user auth token** in **User settings → Personal Tokens** (Enter opens it) with the",
        "   scopes `event:read`, `event:write`, `project:read`, `org:read` and `member:read`.",
        "2. In **Settings → Extensions → Sentry → Configure**, set:",
        "   - **Organization**: the slug in your Sentry URLs (`acme` in `acme.sentry.io`)",
        "   - **Auth token**: the token you just created",
        "   - **Region**: `sentry.io` (US) or `de.sentry.io` (EU data region)",
        "",
        "Self-hosted Sentry is not supported: extensions declare the hosts they reach.",
      ].join("\n"),
    },
    actions: [open(TOKEN_URL, "Create Auth Token", { icon: Icons.key })],
  }];
}

export async function guarded(load: () => Promise<Item[]>): Promise<Item[]> {
  try {
    return await load();
  } catch (e) {
    if (e instanceof AuthError) return setupItems(e);
    throw e;
  }
}
