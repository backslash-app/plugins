// Authenticated calls to Microsoft Graph, and the "connect" row shown until the app is set up.

import { action, copy, Icons, type Item, oauth, open, refresh } from "@backslash/api";
import { AuthError, ENTRA_DOCS, ENTRA_URL, GRAPH, graphError, provider, REDIRECT_URI } from "./lib.ts";

export interface Client {
  get<T>(path: string, options?: { signal?: AbortSignal; headers?: Record<string, string> }): Promise<T>;
  send<T = unknown>(method: "POST" | "PATCH" | "DELETE", path: string, body?: unknown): Promise<T>;
  signOut(): Promise<void>;
}

/** Signs in through the browser the first time (the launcher handles the redirect). */
export async function client(prefs: Record<string, unknown>): Promise<Client> {
  const p = provider(prefs);
  const token = await oauth.token(p);
  const call = async (
    method: string,
    path: string,
    body?: unknown,
    options: { signal?: AbortSignal; headers?: Record<string, string> } = {},
  ) => {
    const url = path.startsWith("https://") ? path : `${GRAPH}${path}`;
    let res: Response;
    try {
      res = await fetch(url, {
        method,
        signal: options.signal,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
          ...options.headers,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (e) {
      if ((e as Error).name === "AbortError") throw e;
      throw new Error(`Microsoft Graph is unreachable: ${(e as Error).message}`);
    }
    const text = await res.text();
    if (!res.ok) {
      if (res.status === 401) await oauth.signOut(p).catch(() => {});
      throw graphError(res.status, text, res.headers.get("retry-after"));
    }
    return text ? JSON.parse(text) : undefined;
  };
  return {
    get: (path, options) => call("GET", path, undefined, options),
    send: (method, path, body) => call(method, path, body),
    signOut: () => oauth.signOut(p),
  };
}

/** Every page of a collection, up to `max` items. */
export async function all<T>(api: Client, path: string, signal?: AbortSignal, max = 500): Promise<T[]> {
  const out: T[] = [];
  let next: string | undefined = path;
  while (next && out.length < max) {
    const page: { value: T[]; "@odata.nextLink"?: string } = await api.get(next, { signal });
    out.push(...page.value);
    next = page["@odata.nextLink"];
  }
  return out;
}

export function setupItems(error: AuthError): Item[] {
  if (error.message === "Microsoft signed you out") {
    return [{
      id: "setup",
      title: "Microsoft signed you out",
      subtitle: "Sign in again in the browser",
      icon: { source: Icons.key, tint: "orange" },
      actions: [action("Sign In", () => refresh(), { icon: Icons.key })],
    }];
  }
  return [{
    id: "setup",
    title: error.message,
    subtitle: "Microsoft 365 signs in with an app you register in Entra (free)",
    icon: { source: Icons.key, tint: "orange" },
    detail: {
      markdown: [
        "## Connect Microsoft 365",
        "",
        "Backslash has no shared Microsoft app yet, so you sign in through one of your own. It takes two minutes:",
        "",
        "1. Open **Microsoft Entra → App registrations** (Enter) and sign in, then **New registration**.",
        "2. Name it *Backslash*. Under **Supported account types** pick",
        "   *Accounts in any organizational directory and personal Microsoft accounts*.",
        "3. **Authentication → Add a platform → Mobile and desktop applications**, and add the custom redirect URI",
        `   \`${REDIRECT_URI}\` (any port is accepted on 127.0.0.1).`,
        "4. Still in **Authentication**, set **Allow public client flows** to **Yes**, then **Save**.",
        "5. Copy the **Application (client) ID** from **Overview** to",
        "   **Settings → Extensions → Microsoft 365 → Configure**.",
        "",
        "The first command you open asks you to sign in and to allow mail, tasks, files and calendar access.",
        "",
        "Work accounts: your administrator may have to approve the app. Signing in to one directory only?",
        "Put its tenant ID in **Tenant** instead of *common*.",
      ].join("\n"),
    },
    actions: [
      open(ENTRA_URL, "Open App Registrations", { icon: Icons.key }),
      open(ENTRA_DOCS, "Read Microsoft's Guide", { icon: Icons.book }),
      copy(REDIRECT_URI, "Copy Redirect URI", { section: "Copy" }),
    ],
  }];
}

/** Runs `load`, or shows how to connect when the app isn't set up or the token was refused. */
export async function guarded(prefs: Record<string, unknown>, load: (api: Client) => Promise<Item[]>): Promise<Item[]> {
  try {
    return await load(await client(prefs));
  } catch (e) {
    if (e instanceof AuthError) return setupItems(e);
    throw e;
  }
}

/** The sign-out action every list offers. */
export function signOutAction(prefs: Record<string, unknown>, after: () => void) {
  return action("Sign Out of Microsoft", async () => {
    await oauth.signOut(provider(prefs));
    after();
  }, { icon: Icons.power, section: "Account" });
}
