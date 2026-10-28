// Supabase Management API (`api.supabase.com/v1`) with a personal access token.

import { Icons, type Item, open } from "@backslash/api";

export const API = "https://api.supabase.com/v1";
export const TOKEN_URL = "https://supabase.com/dashboard/account/tokens";

export class AuthError extends Error {}

export function tokenOf(preferences: Record<string, unknown>): string {
  const token = String(preferences.token ?? "").trim();
  if (!token) throw new AuthError("Add a Supabase personal access token");
  return token;
}

export async function supabase<T>(
  token: string,
  path: string,
  options: { method?: string; body?: unknown; signal?: AbortSignal } = {},
): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method: options.method ?? "GET",
    signal: options.signal,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  if (res.status === 401) throw new AuthError("Supabase rejected the access token");
  const text = await res.text();
  let body: any;
  try {
    body = text ? JSON.parse(text) : undefined;
  } catch {
    body = undefined;
  }
  if (!res.ok) {
    const message = body?.message ?? body?.error ?? (typeof body === "string" ? body : "");
    if (res.status === 429) throw new Error("Supabase rate limit reached: try again in a minute");
    throw new Error(`Supabase answered ${res.status}${message ? `: ${message}` : ""}`);
  }
  return body as T;
}

export function setupItems(error: AuthError): Item[] {
  return [{
    id: "setup",
    title: error.message,
    subtitle: "Create one in Account → Access Tokens",
    icon: { source: Icons.key, tint: "orange" },
    detail: {
      markdown: [
        "## Connect Supabase",
        "",
        "1. Create a **personal access token** in **Account → Access Tokens** (Enter opens it).",
        "2. Paste it in **Settings → Extensions → Supabase → Configure**.",
        "",
        "The token acts as you on every organization you belong to: it lists projects, reads tables",
        "through SQL, reads edge functions and logs, and pauses or restores projects when you ask.",
      ].join("\n"),
    },
    actions: [open(TOKEN_URL, "Create Access Token", { icon: Icons.key })],
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
