// GitHub REST and GraphQL helpers shared by the commands.

import { type Color, exec } from "@backslash/api";

const HEADERS = { "User-Agent": "backslash-launcher", "X-GitHub-Api-Version": "2022-11-28" };

/** The token from the preferences, else the GitHub CLI's (`gh auth token`), if any. */
export async function token(preferences: Record<string, unknown>): Promise<string | undefined> {
  const saved = (preferences.token as string | undefined)?.trim();
  if (saved) return saved;
  try {
    return (await exec("gh", ["auth", "token"])) || undefined;
  } catch {
    return undefined;
  }
}

export async function needToken(preferences: Record<string, unknown>): Promise<string> {
  const t = await token(preferences);
  if (!t) {
    throw new Error("Sign in with `gh auth login`, or add a token in Settings → Extensions → GitHub");
  }
  return t;
}

function check(res: Response) {
  if (res.status === 401) throw new Error("GitHub rejected the token: check it in Settings → Extensions → GitHub");
  if (res.status === 403 || res.status === 429) {
    if (res.headers.get("x-ratelimit-remaining") === "0") {
      throw new Error("GitHub rate limit reached: add a token in Settings → Extensions → GitHub");
    }
    throw new Error(`GitHub refused the request (${res.status})`);
  }
  if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
}

export async function github<T>(path: string, token: string | undefined, signal?: AbortSignal): Promise<T> {
  const res = await fetch(`https://api.github.com${path}`, {
    signal,
    headers: {
      ...HEADERS,
      Accept: "application/vnd.github+json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  check(res);
  return await res.json() as T;
}

export async function graphql<T>(
  token: string,
  query: string,
  variables: Record<string, unknown> = {},
  signal?: AbortSignal,
): Promise<T> {
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    signal,
    headers: { ...HEADERS, "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ query, variables }),
  });
  check(res);
  const body = await res.json() as { data?: T; errors?: { message: string }[] };
  if (body.errors?.length) throw new Error(`GitHub: ${body.errors[0].message}`);
  return body.data as T;
}

export async function readme(fullName: string, token: string | undefined): Promise<string> {
  const res = await fetch(`https://api.github.com/repos/${fullName}/readme`, {
    headers: {
      ...HEADERS,
      Accept: "application/vnd.github.raw",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  return res.ok ? await res.text() : "_No README._";
}

/** "today", "yesterday", "3d", "25 Oct". */
export function ago(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const days = Math.floor((now.getTime() - d.getTime()) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days}d`;
  if (days < 365) return d.toLocaleDateString("en", { day: "numeric", month: "short" });
  return d.toLocaleDateString("en", { month: "short", year: "numeric" });
}

/** 1234 → "1.2k". */
export function compact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k`;
  return String(n);
}

/** The palette color closest to a GitHub color (labels, languages). */
export function colorOf(hex: string | null | undefined): Color {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex ?? "");
  if (!m) return "gray";
  const [r, g, b] = [m[1], m[2], m[3]].map((h) => parseInt(h, 16) / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  if (max - min < 0.12) return "gray";
  let h = 0;
  if (max === r) h = ((g - b) / (max - min)) % 6;
  else if (max === g) h = (b - r) / (max - min) + 2;
  else h = (r - g) / (max - min) + 4;
  const hue = (h * 60 + 360) % 360;
  if (hue < 15 || hue >= 345) return "red";
  if (hue < 40) return "orange";
  if (hue < 65) return "yellow";
  if (hue < 160) return "green";
  if (hue < 195) return "teal";
  if (hue < 250) return "blue";
  if (hue < 300) return "purple";
  return "pink";
}

/** Colors GitHub gives the most common languages. */
const LANGUAGES: Record<string, string> = {
  Rust: "#dea584",
  TypeScript: "#3178c6",
  JavaScript: "#f1e05a",
  Python: "#3572a5",
  Go: "#00add8",
  C: "#555555",
  "C++": "#f34b7d",
  Java: "#b07219",
  Kotlin: "#a97bff",
  Swift: "#f05138",
  Ruby: "#701516",
  PHP: "#4f5d95",
  Shell: "#89e051",
  Lua: "#000080",
  Zig: "#ec915c",
  Nix: "#7e7eff",
  HTML: "#e34c26",
  CSS: "#563d7c",
  Vue: "#41b883",
  Dart: "#00b4ab",
  Elixir: "#6e4a7e",
  Haskell: "#5e5086",
  "C#": "#178600",
};

export const languageColor = (language: string | null | undefined): Color => colorOf(LANGUAGES[language ?? ""]);
