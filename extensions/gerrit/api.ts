// The Gerrit REST API of the user's server, authenticated (`/a/…`) with the HTTP password.

import { Icons, type Item, open } from "@backslash/api";
import { basicAuth, type Change, changesPath, normalizeUrl, parseChanges, parseGerritJson } from "./lib.ts";

export class SetupError extends Error {}

export interface Server {
  base: string;
  host: string;
  user: string;
  password: string;
  scheme?: string;
}

export function server(p: Record<string, unknown>): Server {
  const base = normalizeUrl(p.url);
  if (!base) throw new SetupError("Add the address of your Gerrit server");
  let host: string;
  try {
    host = new URL(base).host;
  } catch {
    throw new SetupError(`“${p.url}” is not an address`);
  }
  const user = String(p.username ?? "").trim();
  const password = String(p.password ?? "").trim();
  if (!user || !password) throw new SetupError(`Add your user name and HTTP password for ${host}`);
  return { base, host, user, password, scheme: String(p.scheme ?? "").trim() || undefined };
}

export async function get<T>(s: Server, path: string, signal?: AbortSignal): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${s.base}/a${path}`, {
      signal,
      headers: { Accept: "application/json", Authorization: basicAuth(s.user, s.password) },
    });
  } catch (e) {
    if (signal?.aborted) throw e;
    throw new SetupError(`Can't reach ${s.host}: check the address (${e instanceof Error ? e.message : e})`);
  }
  const text = await res.text();
  if (res.status === 401) {
    throw new SetupError(
      `${s.host} refused the user name or HTTP password: generate one in Settings → HTTP Credentials`,
    );
  }
  if (res.status === 403) {
    throw new SetupError(`${s.host} refused the request: ${text.trim().slice(0, 160) || "forbidden"}`);
  }
  if (res.status === 404 && /^\s*</.test(text)) {
    throw new SetupError(`${s.host} doesn't look like Gerrit: check the address`);
  }
  if (res.status === 429) throw new Error(`${s.host} is rate limiting: try again in a minute`);
  if (!res.ok) {
    // Gerrit's errors are plain text: "Must be signed-in to use this operator".
    const why = text.trim().split("\n")[0].slice(0, 200);
    throw new Error(`${s.host} answered ${res.status}${why && !why.startsWith("<") ? `: ${why}` : ""}`);
  }
  try {
    return parseGerritJson<T>(text);
  } catch {
    throw new SetupError(`${s.host} doesn't look like Gerrit: check the address`);
  }
}

export async function changes(
  s: Server,
  query: string,
  signal?: AbortSignal,
): Promise<{ changes: Change[]; more: boolean }> {
  return parseChanges(await get(s, changesPath(query), signal));
}

export function setupItem(e: SetupError, base?: string): Item {
  return {
    id: "setup",
    title: e.message,
    subtitle: "Settings → Extensions → Gerrit → Configure",
    icon: { source: Icons.key, tint: "orange" },
    detail: {
      markdown: [
        "## Connect your Gerrit",
        "",
        "1. **Address**: the server as you open it in the browser, like `https://review.opendev.org`",
        "   (keep a path prefix such as `/r` if it has one).",
        "2. **User name**: Gerrit → *Settings* → *Profile* → *Username*.",
        "3. **HTTP password**: Gerrit → *Settings* → *HTTP Credentials* → *Generate new password*.",
        "   It is not the password you sign in with (single sign-on servers don't have one).",
        "",
        "The HTTP password is kept in your system keyring.",
      ].join("\n"),
    },
    actions: base ? [open(`${base}/settings/#HTTPCredentials`, "Open HTTP Credentials", { icon: Icons.key })] : [
      open(
        "https://gerrit-review.googlesource.com/Documentation/user-upload.html#http",
        "Gerrit HTTP Credentials Help",
      ),
    ],
  };
}
