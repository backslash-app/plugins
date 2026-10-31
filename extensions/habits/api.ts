// Habitica's API (v3): the user's dailies and habits, and scoring them.

import { habiticaHeaders, type HabiticaTask, isUuid, parseHabiticaTasks } from "./lib.ts";

export const API = "https://habitica.com/api/v3";

export interface Credentials {
  user: string;
  key: string;
}

/** The Habitica credentials from the preferences, if both are set. */
export function credentials(preferences: Record<string, unknown>): Credentials | undefined {
  const user = String(preferences.habiticaUser ?? "").trim();
  const key = String(preferences.habiticaToken ?? "").trim();
  if (!user || !key) return undefined;
  if (!isUuid(user)) throw new Error("The Habitica user ID looks wrong: copy it from Habitica → Settings → Site Data");
  return { user, key };
}

async function call(c: Credentials, path: string, init: RequestInit = {}): Promise<unknown> {
  const res = await fetch(`${API}${path}`, { ...init, headers: habiticaHeaders(c.user, c.key) });
  const body = await res.json().catch(() => ({}));
  if (res.status === 401) throw new Error("Habitica refused the user ID or API token: check them in Settings");
  if (res.status === 429) throw new Error("Habitica asks to slow down: try again in a minute");
  if (!res.ok) throw new Error(`Habitica: ${(body as { message?: string }).message ?? res.statusText}`);
  return body;
}

export async function tasks(c: Credentials, signal?: AbortSignal): Promise<HabiticaTask[]> {
  const [dailies, habits] = await Promise.all([
    call(c, "/tasks/user?type=dailys", { signal }),
    call(c, "/tasks/user?type=habits", { signal }),
  ]);
  return [...parseHabiticaTasks(dailies), ...parseHabiticaTasks(habits)];
}

export async function score(c: Credentials, id: string, direction: "up" | "down"): Promise<void> {
  await call(c, `/tasks/${encodeURIComponent(id)}/score/${direction}`, { method: "POST", body: "{}" });
}
