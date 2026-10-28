// Notion API with an internal integration secret.

import { Icons, type Item, open } from "@backslash/api";

export const API = "https://api.notion.com/v1";
/** The stable API version whose shapes this extension reads (databases, not data sources). */
export const VERSION = "2022-06-28";
export const TOKEN_URL = "https://www.notion.so/profile/integrations";

export class AuthError extends Error {}

export function needToken(preferences: Record<string, unknown>): string {
  const token = String(preferences.token ?? "").trim();
  if (!token) throw new AuthError("Add a Notion integration secret");
  return token;
}

export async function notion<T>(
  token: string,
  path: string,
  options: { method?: string; body?: unknown; signal?: AbortSignal } = {},
): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method: options.method ?? "GET",
    signal: options.signal,
    headers: {
      Authorization: `Bearer ${token}`,
      "Notion-Version": VERSION,
      ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  if (res.status === 401) throw new AuthError("Notion rejected the integration secret");
  const body = await res.json().catch(() => ({})) as { code?: string; message?: string };
  if (!res.ok) {
    if (body.code === "object_not_found") {
      throw new Error("Notion can't see this page: share it with your integration (••• → Connections)");
    }
    if (body.code === "restricted_resource") {
      throw new Error("The integration lacks a capability: enable “Insert content” in its settings");
    }
    throw new Error(`Notion: ${body.message ?? `answered ${res.status}`}`);
  }
  return body as T;
}

const SHARE_HINT =
  "Notion only shows an integration the pages shared with it: open a page, ••• → Connections → add it.";

export function setupItems(error: AuthError): Item[] {
  return [{
    id: "setup",
    title: error.message,
    subtitle: "Create an internal integration and share pages with it",
    icon: { source: Icons.key, tint: "orange" },
    detail: {
      markdown: [
        "## Connect Notion",
        "",
        "1. Open **Notion → Settings → Connections → Develop or manage integrations** (Enter opens it).",
        "2. Create an **internal integration** for your workspace, with the *Read content*, *Insert content*",
        "   and *Update content* capabilities, and copy its **Internal Integration Secret**.",
        "3. Paste it in **Settings → Extensions → Notion → Configure**.",
        "4. Share pages with it: in Notion, open a page or database → **••• → Connections → add your integration**.",
        "   Sub-pages are included.",
      ].join("\n"),
    },
    actions: [open(TOKEN_URL, "Create Integration", { icon: Icons.key })],
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

export const EMPTY = { title: "Nothing found", description: SHARE_HINT, icon: Icons.search };
