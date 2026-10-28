// Calls to the TickTick Open API, signed in with the user's own TickTick app.

import { action, Icons, type Item, oauth, open, refresh } from "@backslash/api";
import {
  API,
  AuthError,
  DEFAULT_PORT,
  DEVELOPER_URL,
  INBOX,
  type Project,
  provider,
  type Task,
  tickError,
} from "./lib.ts";

export interface Client {
  call<T>(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<T>;
  signOut(): Promise<void>;
}

/** Signs in through the browser the first time (the launcher handles the redirect). */
export async function client(prefs: Record<string, unknown>): Promise<Client> {
  const p = provider(prefs);
  const token = await oauth.token(p);
  return {
    async call<T>(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
      let res: Response;
      try {
        res = await fetch(`${API}${path}`, {
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
        throw new Error(`TickTick is unreachable: ${(e as Error).message}`);
      }
      const text = await res.text();
      if (!res.ok) {
        if (res.status === 401) await oauth.signOut(p).catch(() => {});
        throw tickError(res.status, text);
      }
      return (text ? JSON.parse(text) : undefined) as T;
    },
    signOut: () => oauth.signOut(p),
  };
}

/** Runs `fn` on every item, `limit` at a time. */
async function pool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  }));
  return out;
}

/** Every list (the inbox first) and its open tasks. */
export async function everything(api: Client, signal?: AbortSignal): Promise<{ projects: Project[]; tasks: Task[] }> {
  const lists = (await api.call<Project[]>("GET", "/project", undefined, signal)).filter((p) => !p.closed);
  type Data = { project?: Project; tasks?: Task[] };
  const data = await pool([INBOX, ...lists], 5, async (p): Promise<Data> => {
    try {
      return await api.call<Data>("GET", `/project/${p.id}/data`, undefined, signal);
    } catch (e) {
      // The inbox isn't served to every account; the other lists are.
      if (p === INBOX && !(e instanceof AuthError) && (e as Error).name !== "AbortError") return { tasks: [] };
      throw e;
    }
  });
  const inboxId = data[0].tasks?.[0]?.projectId ?? data[0].project?.id;
  const projects = [{ ...INBOX, id: inboxId ?? INBOX.id }, ...lists];
  const tasks = data.flatMap((d) => d.tasks ?? []).filter((t) => t.status === 0);
  return { projects, tasks };
}

export function setupItems(error: AuthError, prefs: Record<string, unknown>): Item[] {
  if (error.message === "TickTick signed you out") {
    return [{
      id: "setup",
      title: "TickTick signed you out",
      subtitle: "Sign in again in the browser",
      icon: { source: Icons.key, tint: "orange" },
      actions: [action("Sign In", () => refresh(), { icon: Icons.key })],
    }];
  }
  const port = Number(prefs.redirectPort) || DEFAULT_PORT;
  return [{
    id: "setup",
    title: error.message,
    subtitle: "TickTick signs in with an app of your own",
    icon: { source: Icons.key, tint: "orange" },
    detail: {
      markdown: [
        "## Connect TickTick",
        "",
        "TickTick's Open API has no personal tokens: you sign in through an app you register (free):",
        "",
        "1. Open **developer.ticktick.com → Manage Apps** (Enter) and sign in with your TickTick account.",
        "2. **+ App Name**: call it *Backslash*, then edit it and set the **OAuth redirect URL** to",
        `   \`http://127.0.0.1:${port}/callback\``,
        "3. Copy its **Client ID** and **Client Secret** to **Settings → Extensions → TickTick → Configure**.",
        "4. Open **TickTick Tasks** again: your browser asks you to allow access, then the launcher comes back.",
        "",
        `Using another port? Change **Redirect port** too; it must match the redirect URL exactly.`,
        "Dida365 (the Chinese service) is not supported.",
      ].join("\n"),
    },
    actions: [open(DEVELOPER_URL, "Open TickTick Developer", { icon: Icons.key })],
  }];
}

export async function guarded(prefs: Record<string, unknown>, load: (api: Client) => Promise<Item[]>): Promise<Item[]> {
  try {
    return await load(await client(prefs));
  } catch (e) {
    if (e instanceof AuthError) return setupItems(e, prefs);
    throw e;
  }
}
