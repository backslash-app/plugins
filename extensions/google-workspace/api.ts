// Authenticated calls to the Drive and Tasks APIs, and the "connect" row shown until the client is set up.

import { action, copy, Icons, type Item, oauth, open, refresh } from "@backslash/api";
import { AuthError, CONSENT_URL, CONSOLE_URL, ENABLE_URL, googleError, provider } from "./lib.ts";

export interface Client {
  get<T>(url: string, params?: Record<string, string>, signal?: AbortSignal): Promise<T>;
  send<T = unknown>(method: "POST" | "PATCH" | "DELETE", url: string, body?: unknown): Promise<T>;
  signOut(): Promise<void>;
}

/** Signs in through the browser the first time (the launcher handles the redirect). */
export async function client(prefs: Record<string, unknown>): Promise<Client> {
  const p = provider(prefs);
  const token = await oauth.token(p);
  const call = async (method: string, url: string, body?: unknown, signal?: AbortSignal) => {
    let res: Response;
    try {
      res = await fetch(url, {
        method,
        signal,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (e) {
      if ((e as Error).name === "AbortError") throw e;
      throw new Error(`Google is unreachable: ${(e as Error).message}`);
    }
    const text = await res.text();
    if (!res.ok) {
      const error = googleError(res.status, text);
      if (error instanceof AuthError) await oauth.signOut(p).catch(() => {});
      throw error;
    }
    return text ? JSON.parse(text) : undefined;
  };
  return {
    get: (url, params, signal) =>
      call("GET", params ? `${url}?${new URLSearchParams(params)}` : url, undefined, signal),
    send: (method, url, body) => call(method, url, body),
    signOut: () => oauth.signOut(p),
  };
}

export function setupItems(error: AuthError): Item[] {
  if (error.message === "Google signed you out" || error.message.startsWith("Sign in again")) {
    return [{
      id: "setup",
      title: error.message,
      subtitle: "Sign in again in the browser",
      icon: { source: Icons.key, tint: "orange" },
      actions: [action("Sign In", () => refresh(), { icon: Icons.key })],
    }];
  }
  return [{
    id: "setup",
    title: error.message,
    subtitle: "Google signs in with an OAuth client of your own (free)",
    icon: { source: Icons.key, tint: "orange" },
    detail: {
      markdown: [
        "## Connect Google Drive & Tasks",
        "",
        "Backslash has no shared Google app, so you sign in through a client in your own Google Cloud project:",
        "",
        "1. In **Google Cloud Console**, pick or create a project, then **enable the Google Drive API and",
        "   the Google Tasks API** (Ctrl+Enter opens that page).",
        "2. **Google Auth platform → Audience**: if it asks, configure the consent screen (External),",
        "   and add your own address under **Test users**.",
        "3. **APIs & Services → Credentials** (Enter) → **Create credentials → OAuth client ID**,",
        "   **Application type: Desktop app**, name it *Backslash*. No redirect URI to add: desktop",
        "   clients accept the loopback address Backslash uses.",
        "4. Copy the **Client ID** and the **Client secret** to",
        "   **Settings → Extensions → Google Drive & Tasks → Configure**.",
        "",
        "The first command you open asks you to sign in and to allow read-only Drive access and Tasks.",
        "Google says “Google hasn't verified this app” for a test app: it's yours, **Continue**.",
      ].join("\n"),
    },
    actions: [
      open(CONSOLE_URL, "Open Google Cloud Credentials", { icon: Icons.key }),
      open(ENABLE_URL, "Enable Drive and Tasks APIs", { icon: Icons.plug }),
      open(CONSENT_URL, "Open Consent Screen Settings", { icon: Icons.shield }),
      copy(CONSOLE_URL, "Copy Console Link", { section: "Copy" }),
    ],
  }];
}

/** Runs `load`, or shows how to connect when the client isn't set up or the token was refused. */
export async function guarded(prefs: Record<string, unknown>, load: (api: Client) => Promise<Item[]>): Promise<Item[]> {
  try {
    return await load(await client(prefs));
  } catch (e) {
    if (e instanceof AuthError) return setupItems(e);
    throw e;
  }
}

export function signOutAction(prefs: Record<string, unknown>, after: () => void) {
  return action("Sign Out of Google", async () => {
    await oauth.signOut(provider(prefs));
    after();
  }, { icon: Icons.power, section: "Account" });
}
