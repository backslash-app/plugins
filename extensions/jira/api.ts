// Jira Cloud REST v3: Basic auth with the account email and an API token.

import { Icons, type Item, open, storage } from "@backslash/api";

export const TOKEN_URL = "https://id.atlassian.com/manage-profile/security/api-tokens";

/** Something to fix in the settings: shown as a row with a link instead of an error. */
export class AuthError extends Error {}

export interface Account {
  /** `acme.atlassian.net` */
  site: string;
  email: string;
  token: string;
}

/**
 * `acme`, `acme.atlassian.net` or `https://acme.atlassian.net/jira/…` → `acme.atlassian.net`.
 * Only Jira Cloud: the extension may reach `*.atlassian.net` and nothing else.
 */
export function normalizeSite(input: string): string {
  let host = input.trim().toLowerCase().replace(/^[a-z]+:\/\//, "").split(/[/?#]/)[0];
  if (host && !host.includes(".")) host = `${host}.atlassian.net`;
  return host;
}

export function account(preferences: Record<string, unknown>): Account {
  const site = normalizeSite(String(preferences.site ?? ""));
  const email = String(preferences.email ?? "").trim();
  const token = String(preferences.token ?? "").trim();
  if (!site || !email || !token) throw new AuthError("Add your Jira site, email and API token");
  if (!/^[a-z0-9-]+\.atlassian\.net$/.test(site)) {
    throw new AuthError(`${site} is not a Jira Cloud site (*.atlassian.net)`);
  }
  return { site, email, token };
}

export const baseUrl = (a: Account) => `https://${a.site}`;
export const issueUrl = (a: Account, key: string) => `${baseUrl(a)}/browse/${key}`;

/** Jira's errors: `{ errorMessages: [...], errors: { field: message } }`. */
export function errorText(body: unknown): string {
  const b = (body ?? {}) as { errorMessages?: string[]; errors?: Record<string, string>; message?: string };
  const parts = [...(b.errorMessages ?? []), ...Object.entries(b.errors ?? {}).map(([k, v]) => `${k}: ${v}`)];
  if (b.message) parts.push(b.message);
  return parts.join("; ");
}

export async function jira<T>(
  a: Account,
  path: string,
  options: { method?: string; body?: unknown; signal?: AbortSignal } = {},
): Promise<T> {
  const res = await fetch(`${baseUrl(a)}${path}`, {
    method: options.method ?? "GET",
    signal: options.signal,
    headers: {
      Authorization: `Basic ${btoa(`${a.email}:${a.token}`)}`,
      Accept: "application/json",
      ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  if (res.status === 401) throw new AuthError("Jira rejected the email or API token");
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => undefined);
  if (!res.ok) {
    const message = errorText(body);
    if (res.status === 403 && !message) throw new AuthError("Jira refused the API token (403)");
    throw new JiraError(res.status, message || `Jira answered ${res.status}`);
  }
  return body as T;
}

export class JiraError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

/** The id of the Sprint custom field (usually customfield_10020), looked up once per site. */
export async function sprintField(a: Account, signal?: AbortSignal): Promise<string | undefined> {
  const key = `sprintField:${a.site}`;
  const saved = await storage.get<string>(key).catch(() => undefined);
  if (saved !== undefined) return saved || undefined;
  const fields = await jira<{ id: string; schema?: { custom?: string } }[]>(a, "/rest/api/3/field", { signal })
    .catch(() => []);
  const id = fields.find((f) => f.schema?.custom === "com.pyxis.greenhopper.jira:gh-sprint")?.id ?? "";
  await storage.set(key, id).catch(() => {});
  return id || undefined;
}

export async function myAccountId(a: Account): Promise<string> {
  const key = `me:${a.site}:${a.email}`;
  const saved = await storage.get<string>(key).catch(() => undefined);
  if (saved) return saved;
  const me = await jira<{ accountId: string }>(a, "/rest/api/3/myself");
  await storage.set(key, me.accountId).catch(() => {});
  return me.accountId;
}

export function setupItems(error: AuthError): Item[] {
  return [{
    id: "setup",
    title: error.message,
    subtitle: "Jira Cloud: site, account email and API token",
    icon: { source: Icons.key, tint: "orange" },
    detail: {
      markdown: [
        "## Connect Jira",
        "",
        "1. Create an API token at **id.atlassian.com → Security → API tokens** (Enter opens it).",
        "2. In **Settings → Extensions → Jira → Configure**, set:",
        "   - **Site**: `your-team.atlassian.net`",
        "   - **Email**: the email of your Atlassian account",
        "   - **API token**: the token you just created",
        "",
        "Only Jira Cloud (`*.atlassian.net`) is supported, not Jira Server or Data Center.",
      ].join("\n"),
    },
    actions: [open(TOKEN_URL, "Create API Token", { icon: Icons.key })],
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

export function countStatus(items: Item[], one: string, many = `${one}s`): string {
  if (items[0]?.id === "setup") return "Not connected";
  if (items[0]?.id === "error") return "Jira could not run this search";
  return `${items.length} ${items.length === 1 ? one : many}`;
}
