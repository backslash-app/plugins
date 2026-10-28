// Vercel and Netlify REST helpers, and the setup rows shown when a token is missing or rejected.

import { Icons, type Item, open } from "@backslash/api";

export type Provider = "vercel" | "netlify";

export const VERCEL_API = "https://api.vercel.com";
export const NETLIFY_API = "https://api.netlify.com/api/v1";

export const TOKEN_URLS: Record<Provider, string> = {
  vercel: "https://vercel.com/account/settings/tokens",
  netlify: "https://app.netlify.com/user/applications#personal-access-tokens",
};

export const NAMES: Record<Provider, string> = { vercel: "Vercel", netlify: "Netlify" };

export class AuthError extends Error {
  constructor(readonly provider: Provider, message: string) {
    super(message);
  }
}

export function tokenOf(preferences: Record<string, unknown>, provider: Provider): string | undefined {
  const value = String(preferences[provider === "vercel" ? "vercelToken" : "netlifyToken"] ?? "").trim();
  return value || undefined;
}

/** The providers with a token. */
export const configured = (preferences: Record<string, unknown>): Provider[] =>
  (["vercel", "netlify"] as Provider[]).filter((p) => tokenOf(preferences, p));

/** `team_…` is a team id, anything else a team slug. */
export function vercelScope(team: unknown): string {
  const t = String(team ?? "").trim();
  if (!t) return "";
  return t.startsWith("team_") ? `teamId=${encodeURIComponent(t)}` : `slug=${encodeURIComponent(t)}`;
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  signal?: AbortSignal;
}

async function call<T>(provider: Provider, url: string, token: string, options: RequestOptions): Promise<T> {
  const res = await fetch(url, {
    method: options.method ?? "GET",
    signal: options.signal,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  if (res.status === 401) throw new AuthError(provider, `${NAMES[provider]} rejected the access token`);
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  let body: any;
  try {
    body = text ? JSON.parse(text) : undefined;
  } catch {
    body = undefined;
  }
  if (!res.ok) {
    const message = body?.error?.message ?? body?.message ?? (typeof body?.error === "string" ? body.error : "");
    if (res.status === 403 && provider === "vercel" && /scope|team/i.test(message)) {
      throw new Error(`Vercel: ${message}. Set the team in Settings → Extensions → Deployments`);
    }
    throw new Error(`${NAMES[provider]} answered ${res.status}${message ? `: ${message}` : ""}`);
  }
  return body as T;
}

export function vercel<T>(preferences: Record<string, unknown>, path: string, options: RequestOptions = {}) {
  const token = tokenOf(preferences, "vercel");
  if (!token) throw new AuthError("vercel", "Add a Vercel access token");
  const scope = vercelScope(preferences.vercelTeam);
  const url = `${VERCEL_API}${path}${scope ? `${path.includes("?") ? "&" : "?"}${scope}` : ""}`;
  return call<T>("vercel", url, token, options);
}

export function netlify<T>(preferences: Record<string, unknown>, path: string, options: RequestOptions = {}) {
  const token = tokenOf(preferences, "netlify");
  if (!token) throw new AuthError("netlify", "Add a Netlify access token");
  return call<T>("netlify", `${NETLIFY_API}${path}`, token, options);
}

export function setupItem(provider: Provider, title: string): Item {
  const name = NAMES[provider];
  const where = provider === "vercel"
    ? "**Vercel → Account Settings → Tokens**. For a team, also set its slug or id (`team_…`) in the settings."
    : "**Netlify → User settings → Applications → Personal access tokens**.";
  return {
    id: `setup-${provider}`,
    title,
    subtitle: `Create a personal access token on ${name}`,
    icon: { source: Icons.key, tint: "orange" },
    section: "Setup",
    detail: {
      markdown: [
        `## Connect ${name}`,
        "",
        `1. Create a token in ${where} (Enter opens it).`,
        `2. Paste it in **Settings → Extensions → Deployments → Configure** (${name} token).`,
        "",
        "Vercel and Netlify are both optional: set one token or both.",
      ].join("\n"),
    },
    actions: [open(TOKEN_URLS[provider], `Create ${name} Token`, { icon: Icons.key })],
  };
}

/** Rows explaining how to connect each provider, when none has a token. */
export const setupAll = () => [
  setupItem("vercel", "Add a Vercel access token"),
  setupItem("netlify", "Add a Netlify access token"),
];

/** Loads one provider; a problem becomes a row, so the other provider still shows. */
export async function guarded(provider: Provider, load: () => Promise<Item[]>): Promise<Item[]> {
  try {
    return await load();
  } catch (e) {
    if (e instanceof AuthError) return [setupItem(provider, e.message)];
    if (e instanceof DOMException && e.name === "AbortError") throw e;
    const message = e instanceof Error ? e.message : String(e);
    return [{
      id: `error-${provider}`,
      title: `${NAMES[provider]} could not be loaded`,
      subtitle: message,
      icon: { source: Icons.alert, tint: "red" },
      section: "Setup",
      detail: { markdown: `## ${NAMES[provider]} could not be loaded\n\n${message}` },
      actions: [
        open(
          provider === "vercel" ? "https://www.vercel-status.com" : "https://www.netlifystatus.com",
          "Open Status Page",
        ),
      ],
    }];
  }
}

/** Setup and error rows are not deployments. */
export const isProblem = (item: Item) => /^(setup|error)-/.test(item.id ?? "");
