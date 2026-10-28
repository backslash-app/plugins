// The Hugging Face Hub API, with the optional token for private and gated repositories.

import { type Kind, mapRepo, plainSearchUrl, type Query, readmeUrl, type Repo, repoApiUrl, searchUrl } from "./lib.ts";

export class HubError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

const headers = (token?: string): Record<string, string> => ({
  Accept: "application/json",
  ...(token ? { Authorization: `Bearer ${token}` } : {}),
});

async function get(url: string, token: string | undefined, signal?: AbortSignal): Promise<Response> {
  const res = await fetch(url, { signal, headers: headers(token) });
  if (res.ok) return res;
  await res.body?.cancel();
  if (res.status === 401 && token) {
    throw new HubError("Hugging Face rejected the token: check it in Settings → Extensions → Hugging Face", 401);
  }
  if (res.status === 429) throw new HubError("Hugging Face is rate limiting: wait a minute, or add a token", 429);
  throw new HubError(`Hugging Face answered ${res.status}`, res.status);
}

export async function searchHub(kind: Kind, q: Query, token: string | undefined, signal: AbortSignal): Promise<Repo[]> {
  let res: Response;
  try {
    res = await get(searchUrl(kind, q), token, signal);
  } catch (e) {
    // A field the Hub doesn't know any more: search without the extra fields.
    if (!(e instanceof HubError) || e.status !== 400) throw e;
    res = await get(plainSearchUrl(kind, q), token, signal);
  }
  const list = await res.json();
  return (Array.isArray(list) ? list : []).map((r: unknown) => mapRepo(kind, r));
}

/** One repository by id (for an exact id or URL typed), or undefined when it doesn't exist. */
export async function getRepo(kind: Kind, id: string, token: string | undefined, signal?: AbortSignal) {
  try {
    return mapRepo(kind, await (await get(repoApiUrl(kind, id), token, signal)).json());
  } catch (e) {
    if (e instanceof HubError && (e.status === 404 || e.status === 401)) return undefined;
    throw e;
  }
}

/** The README, or why it can't be read. */
export async function readme(
  kind: Kind,
  id: string,
  token: string | undefined,
  signal?: AbortSignal,
): Promise<{ text?: string; problem?: string }> {
  const res = await fetch(readmeUrl(kind, id), { signal, headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (res.ok) return { text: await res.text() };
  await res.body?.cancel();
  if (res.status === 404) return { problem: "This repository has no README." };
  if (res.status === 401 || res.status === 403) {
    return {
      problem: token
        ? "Your token can't read this repository: accept its conditions on its page first."
        : "This repository is gated or private: accept its conditions on its page, then add a token in Settings → Extensions → Hugging Face.",
    };
  }
  return { problem: `Hugging Face answered ${res.status}.` };
}
