// flyctl and the Railway GraphQL API, and the rows shown when one is missing.

import { action, close, copy, exec, Icons, type Item, open, refresh } from "@backslash/api";
import { cliToken, flyInstallCommand, osFamily } from "./lib.ts";
import { holdOpen, runInTerminal } from "./terminal.ts";

export interface Prefs {
  railwayToken?: string;
  terminal?: string;
}

export const HOME = Deno.env.get("HOME") ?? "";

// ---------------------------------------------------------------------------
// Fly.io

export class FlyMissing extends Error {}

let flyBin: Promise<string> | undefined;

/** `flyctl`, or `fly` when only that name is on the PATH. */
export function flyProgram(): Promise<string> {
  return flyBin ??= (async () => {
    for (const p of ["flyctl", "fly"]) {
      try {
        await exec(p, ["version"]);
        return p;
      } catch (e) {
        if (!(e instanceof Deno.errors.NotFound)) return p;
      }
    }
    throw new FlyMissing("flyctl is not installed");
  })();
}

/** flyctl with a deadline, so a slow API doesn't hang the launcher. */
export async function fly(args: string[], signal?: AbortSignal, seconds = 25): Promise<string> {
  const p = await flyProgram();
  const deadline = AbortSignal.timeout(seconds * 1000);
  try {
    return await exec(p, args, { signal: signal ? AbortSignal.any([signal, deadline]) : deadline });
  } catch (err) {
    if (deadline.aborted && !signal?.aborted) throw new Error(`flyctl did not answer within ${seconds} seconds`);
    if (err instanceof Error) err.message = err.message.replace(/^(flyctl|fly) exited with \d+: /, "");
    throw err;
  }
}

export function inTerminal(
  title: string,
  argv: string[],
  prefs: Prefs,
  o: { icon?: string; shortcut?: string; section?: string; hold?: boolean } = {},
) {
  return action(title, () => {
    const term = runInTerminal(o.hold ? holdOpen(argv) : argv, prefs.terminal || undefined);
    return close(`Opened in ${term}`);
  }, { icon: o.icon ?? Icons.terminal, shortcut: o.shortcut, section: o.section ?? "Terminal" });
}

let osHint: Promise<string> | undefined;
const installHint = () =>
  osHint ??= Deno.readTextFile("/etc/os-release").catch(() => "").then((t) => flyInstallCommand(osFamily(t)));

export async function flyMissingItem(): Promise<Item> {
  const cmd = await installHint();
  return {
    id: "setup-fly",
    title: "Install flyctl to see your Fly.io apps",
    subtitle: cmd,
    icon: { source: Icons.download, tint: "purple" },
    section: "Connect",
    detail: {
      markdown: [
        "## Connect Fly.io",
        "",
        "This extension runs **flyctl** with your sign-in.",
        "",
        "```sh",
        cmd,
        "flyctl auth login",
        "```",
        "",
        "The install script puts flyctl in `~/.fly/bin`: add that folder to your `PATH` (in `~/.profile`)",
        "so the launcher finds it, then sign out and back in.",
      ].join("\n"),
    },
    actions: [
      copy(cmd.replace(/\s+#.*$/, ""), "Copy Install Command", { icon: Icons.terminal }),
      open("https://fly.io/docs/flyctl/install/", "Open Install Guide"),
    ],
  };
}

export function flySignInItem(prefs: Prefs, program: string): Item {
  return {
    id: "setup-fly",
    title: "Sign in to Fly.io",
    subtitle: `${program} auth login`,
    icon: { source: Icons.key, tint: "purple" },
    section: "Connect",
    detail: {
      markdown: `flyctl is installed but nobody is signed in. Enter opens \`${program} auth login\` in a terminal.`,
    },
    actions: [
      inTerminal("Sign In with flyctl", [program, "auth", "login"], prefs, { icon: Icons.key, hold: true }),
      action("Retry", () => refresh(), { icon: Icons.refresh, shortcut: "<Ctrl>r" }),
    ],
  };
}

// ---------------------------------------------------------------------------
// Railway

export const RAILWAY_API = "https://backboard.railway.com/graphql/v2";
export const RAILWAY_TOKENS = "https://railway.com/account/tokens";

export class RailwayAuthError extends Error {}

/** The token from the preferences, else the Railway CLI's sign-in. */
export async function railwayToken(prefs: Prefs): Promise<string | undefined> {
  const pref = String(prefs.railwayToken ?? "").trim();
  if (pref) return pref;
  if (!HOME) return undefined;
  return cliToken(await Deno.readTextFile(`${HOME}/.railway/config.json`).catch(() => ""));
}

export async function railway<T>(
  token: string,
  query: string,
  variables: Record<string, unknown> = {},
  signal?: AbortSignal,
): Promise<T> {
  const res = await fetch(RAILWAY_API, {
    method: "POST",
    signal,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  if (res.status === 401 || res.status === 403) throw new RailwayAuthError("Railway rejected the token");
  const body = await res.json().catch(() => undefined) as { data?: T; errors?: { message: string }[] } | undefined;
  const message = body?.errors?.map((e) => e.message).join("; ");
  if (message && /not authorized|unauthorized|authentication/i.test(message)) {
    throw new RailwayAuthError("Railway rejected the token");
  }
  if (!res.ok || !body?.data) throw new Error(`Railway answered ${res.status}${message ? `: ${message}` : ""}`);
  return body.data;
}

export function railwaySetupItem(title = "Connect Railway"): Item {
  return {
    id: "setup-railway",
    title,
    subtitle: "Add an account token, or sign in with railway login",
    icon: { source: Icons.key, tint: "pink" },
    section: "Connect",
    detail: {
      markdown: [
        "## Connect Railway",
        "",
        "1. Create an **account token** in **Account Settings → Tokens** (Enter opens it). Leave the workspace",
        "   empty to see all your projects.",
        "2. Paste it in **Settings → Extensions → Fly.io & Railway → Configure** (Railway token).",
        "",
        "With the Railway CLI, `railway login` works too: its sign-in is used when no token is set.",
      ].join("\n"),
    },
    actions: [open(RAILWAY_TOKENS, "Create Railway Token", { icon: Icons.key })],
  };
}

export function errorRow(provider: "fly" | "railway", err: unknown): Item {
  const name = provider === "fly" ? "Fly.io" : "Railway";
  const message = err instanceof Error ? err.message : String(err);
  return {
    id: `error-${provider}`,
    title: `${name} could not be loaded`,
    subtitle: message.split("\n")[0],
    icon: { source: Icons.alert, tint: "red" },
    section: "Connect",
    detail: { markdown: `## ${name} could not be loaded\n\n\`\`\`\n${message.replace(/```/g, "ʼʼʼ")}\n\`\`\`` },
    actions: [
      action("Retry", () => refresh(), { icon: Icons.refresh, shortcut: "<Ctrl>r" }),
      open(provider === "fly" ? "https://status.flyio.net" : "https://status.railway.com", "Open Status Page"),
      copy(message, "Copy Error", { section: "Copy" }),
    ],
  };
}
