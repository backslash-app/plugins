// Small GitHub REST helper shared by the commands.

export async function github<T>(path: string, token: string | undefined, signal?: AbortSignal): Promise<T> {
  const res = await fetch(`https://api.github.com${path}`, {
    signal,
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "backslash-launcher",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  if (res.status === 401) throw new Error("GitHub rejected the token: check it in Settings → Extensions → GitHub");
  if (res.status === 403 || res.status === 429) {
    if (res.headers.get("x-ratelimit-remaining") === "0") {
      throw new Error("GitHub rate limit reached: add a token in Settings → Extensions → GitHub");
    }
    throw new Error(`GitHub refused the request (${res.status})`);
  }
  if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
  return await res.json() as T;
}

export async function readme(fullName: string, token: string | undefined): Promise<string> {
  const res = await fetch(`https://api.github.com/repos/${fullName}/readme`, {
    headers: {
      Accept: "application/vnd.github.raw",
      "User-Agent": "backslash-launcher",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  return res.ok ? await res.text() : "_No README._";
}

export function ago(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  return new Date(iso).toLocaleDateString();
}
