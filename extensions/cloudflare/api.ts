// Cloudflare API v4 with an API token, and the "connect" row shown without one.

import { action, copy, Icons, type Item, open, refresh } from "@backslash/api";
import { apiError, type Envelope, hasNextPage, mapZone, type Zone } from "./lib.ts";

export const API = "https://api.cloudflare.com/client/v4";
export const TOKEN_URL = "https://dash.cloudflare.com/profile/api-tokens";

export class AuthError extends Error {}

/** The token from the preference, else `$CLOUDFLARE_API_TOKEN`. */
export function token(preferences: Record<string, unknown>): string {
  const t = String(preferences.token ?? "").trim() || Deno.env.get("CLOUDFLARE_API_TOKEN")?.trim() || "";
  if (!t) throw new AuthError("Connect your Cloudflare account");
  return t;
}

export async function cf<T>(
  tok: string,
  path: string,
  options: { method?: string; body?: unknown; signal?: AbortSignal } = {},
): Promise<Envelope<T>> {
  const res = await fetch(`${API}${path}`, {
    method: options.method ?? "GET",
    signal: options.signal,
    headers: {
      Authorization: `Bearer ${tok}`,
      ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const body = await res.json().catch(() => undefined) as Envelope<T> | undefined;
  if (res.status === 401 || body?.errors?.some((e) => e.code === 10000 || e.code === 6003 || e.code === 9109)) {
    throw new AuthError("Cloudflare rejected the API token");
  }
  if (!res.ok || !body?.success) {
    const msg = apiError(body, res.status);
    if (res.status === 403) throw new Error(`${msg}. The token lacks a permission for this (see its scopes)`);
    throw new Error(msg);
  }
  return body;
}

/** Every page of a list endpoint (up to `max` items). */
export async function cfAll<T>(
  tok: string,
  path: string,
  signal?: AbortSignal,
  perPage = 50,
  max = 2000,
): Promise<T[]> {
  const out: T[] = [];
  for (let page = 1; out.length < max; page++) {
    const sep = path.includes("?") ? "&" : "?";
    const res = await cf<T[]>(tok, `${path}${sep}page=${page}&per_page=${perPage}`, { signal });
    out.push(...res.result);
    if (!hasNextPage(res.result_info) || !res.result.length) break;
  }
  return out;
}

export async function zones(tok: string, signal?: AbortSignal): Promise<Zone[]> {
  return (await cfAll<any>(tok, "/zones?order=name", signal)).map(mapZone);
}

export function setupItem(error: AuthError): Item {
  return {
    id: "setup",
    title: error.message,
    subtitle: "Create an API token, then paste it in the extension's preferences",
    icon: { source: Icons.key, tint: "orange" },
    detail: {
      markdown: [
        "## Connect Cloudflare",
        "",
        "1. Open **My Profile → API Tokens** (Enter) and **Create Token** → **Create Custom Token** with:",
        "   - Zone → **Zone** → Read",
        "   - Zone → **DNS** → Edit",
        "   - Zone → **Cache Purge** → Purge",
        "   - Account → **Cloudflare Pages** → Read (Edit to retry deployments)",
        "   - Account → **Account Settings** → Read",
        "2. Paste it in **Settings → Extensions → Cloudflare → Configure → API token**",
        "   (or export `CLOUDFLARE_API_TOKEN` before starting Backslash).",
      ].join("\n"),
    },
    actions: [
      open(TOKEN_URL, "Create API Token", { icon: Icons.key }),
      copy("Zone:Read, DNS:Edit, Cache Purge:Purge, Pages:Read, Account Settings:Read", "Copy Needed Permissions", {
        section: "Copy",
      }),
    ],
  };
}

export function errorItem(err: unknown): Item {
  const message = err instanceof Error ? err.message : String(err);
  return {
    id: "error",
    title: /fetch|network|dns|connect/i.test(message) ? "Cannot reach Cloudflare" : "Cloudflare failed",
    subtitle: message,
    icon: { source: Icons.alert, tint: "red" },
    detail: { markdown: `\`\`\`\n${message}\n\`\`\`` },
    actions: [
      action("Retry", () => refresh(), { icon: Icons.refresh }),
      open("https://www.cloudflarestatus.com", "Open Cloudflare Status", { icon: Icons.activity }),
      copy(message, "Copy Error", { section: "Copy" }),
    ],
  };
}

/** Turns a missing token or an API failure into one helpful row. */
export async function guarded(load: () => Promise<Item[]>, signal?: AbortSignal): Promise<Item[]> {
  try {
    return await load();
  } catch (e) {
    if (e instanceof AuthError) return [setupItem(e)];
    if (signal?.aborted) throw e;
    return [errorItem(e)];
  }
}
