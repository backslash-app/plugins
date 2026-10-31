// Loading workspaces: the GitHub API for Codespaces, the coder and devpod CLIs.

import { exec } from "@backslash/api";
import {
  coderUrl,
  devpodState,
  parseCoder,
  parseCodespaces,
  parseDevpod,
  parseDevpodStatus,
  type Provider,
  type Workspace,
} from "./lib.ts";

export const HOME = Deno.env.get("HOME") ?? "";
const API = "https://api.github.com";

/** A provider that isn't set up: shown as a hint, not an error. */
export class SetupError extends Error {}

export interface Loaded {
  provider: Provider;
  workspaces: Workspace[];
  /** Not installed or not signed in. */
  setup?: string;
  error?: string;
  /** Coder's deployment, for web links. */
  base?: string;
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Runs a CLI; undefined when it isn't installed. */
async function cli(program: string, args: string[], timeout = 20_000): Promise<string | undefined> {
  try {
    return await exec(program, args, { signal: AbortSignal.timeout(timeout) });
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) return undefined;
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Codespaces

export async function githubToken(prefs: Record<string, unknown>): Promise<string | undefined> {
  const token = String(prefs.githubToken ?? "").trim();
  if (token) return token;
  try {
    return (await cli("gh", ["auth", "token"], 5000)) || undefined;
  } catch {
    return undefined;
  }
}

export async function github<T>(
  token: string,
  path: string,
  options: { method?: string; signal?: AbortSignal } = {},
): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method: options.method ?? "GET",
    signal: options.signal,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (res.status === 401) throw new SetupError("GitHub refused the token: check it in the extension's preferences");
  const body = await res.json().catch(() => undefined) as { message?: string } | undefined;
  if (res.status === 403 || res.status === 404) {
    throw new SetupError(
      `GitHub refused it${body?.message ? ` (${body.message})` : ""}: the token needs the codespace scope ` +
        "(gh auth refresh -h github.com -s codespace)",
    );
  }
  if (!res.ok) throw new Error(`GitHub answered ${res.status}${body?.message ? `: ${body.message}` : ""}`);
  return body as T;
}

async function codespaces(prefs: Record<string, unknown>, signal?: AbortSignal): Promise<Loaded> {
  const token = await githubToken(prefs);
  if (!token) return { provider: "codespaces", workspaces: [], setup: "Add a GitHub token, or sign in with gh" };
  try {
    const body = await github<unknown>(token, "/user/codespaces?per_page=100", { signal });
    return { provider: "codespaces", workspaces: parseCodespaces(body) };
  } catch (e) {
    if (signal?.aborted) throw e;
    return { provider: "codespaces", workspaces: [], [e instanceof SetupError ? "setup" : "error"]: message(e) };
  }
}

// ---------------------------------------------------------------------------
// Coder

async function coder(): Promise<Loaded> {
  try {
    const out = await cli("coder", ["list", "--output", "json"]);
    if (out === undefined) return { provider: "coder", workspaces: [], setup: "not installed" };
    const base = coderUrl(await Deno.readTextFile(`${HOME}/.config/coderv2/url`).catch(() => undefined));
    return { provider: "coder", workspaces: parseCoder(out), base };
  } catch (e) {
    const text = message(e);
    if (/not logged in|coder login|unauthorized|session token/i.test(text)) {
      return { provider: "coder", workspaces: [], setup: "Not signed in: run coder login <your deployment URL>" };
    }
    return { provider: "coder", workspaces: [], error: text.replace(/^coder exited with \d+: /, "") };
  }
}

// ---------------------------------------------------------------------------
// DevPod

async function devpodStatus(w: Workspace): Promise<Workspace> {
  try {
    const raw = parseDevpodStatus((await cli("devpod", ["status", w.id, "--output", "json"], 15_000)) ?? "");
    return { ...w, state: devpodState(raw), rawState: raw };
  } catch {
    return w;
  }
}

async function devpod(withStatus: boolean): Promise<Loaded> {
  try {
    const out = await cli("devpod", ["list", "--output", "json"]);
    if (out === undefined) return { provider: "devpod", workspaces: [], setup: "not installed" };
    const list = parseDevpod(out);
    return { provider: "devpod", workspaces: withStatus ? await Promise.all(list.map(devpodStatus)) : list };
  } catch (e) {
    return { provider: "devpod", workspaces: [], error: message(e).replace(/^devpod exited with \d+: /, "") };
  }
}

/** Each provider as it answers; DevPod's states take a call per workspace. */
export async function* load(prefs: Record<string, unknown>, signal?: AbortSignal): AsyncGenerator<Loaded[]> {
  const done = new Map<Provider, Loaded>();
  const pending = new Map<string, Promise<[string, Loaded]>>([
    ["codespaces", codespaces(prefs, signal).then((l) => ["codespaces", l])],
    ["coder", coder().then((l) => ["coder", l])],
    ["devpod", devpod(false).then((l) => ["devpod", l])],
  ]);
  while (pending.size) {
    const [key, loaded] = await Promise.race(pending.values());
    pending.delete(key);
    done.set(loaded.provider, loaded);
    if (key === "devpod" && loaded.workspaces.length) {
      pending.set("devpod-status", devpod(true).then((l) => ["devpod-status", l]));
    }
    yield [...done.values()];
  }
}

/** Starts a CLI that keeps working after the launcher closes (coder start, devpod up…). */
export function background(program: string, args: string[]): void {
  try {
    new Deno.Command(program, { args, stdin: "null", stdout: "null", stderr: "null" }).spawn().unref();
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) throw new Error(`${program} isn't installed`);
    throw e;
  }
}

/** `coder open vscode`, which signs the VS Code extension in. */
export async function coderOpenVscode(id: string): Promise<void> {
  await exec("coder", ["open", "vscode", id], { signal: AbortSignal.timeout(30_000) });
}
