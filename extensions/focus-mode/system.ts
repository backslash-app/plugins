// Starting and ending sessions: Do Not Disturb, /etc/hosts through pkexec, Slack and the timers.

import { type Context, exec, storage } from "@backslash/api";
import {
  appendLog,
  BLOCK_SCRIPT,
  blockedIn,
  blockLines,
  detectDnd,
  type DndBackend,
  dndCommand,
  dndQuery,
  type Done,
  encodeParams,
  endScript,
  hostsProblem,
  minutesOf,
  parseServerInfo,
  parseSites,
  pkexecError,
  type Session,
  slackError,
  type SlackStatus,
  slackStatus,
  statusToRestore,
  timerArgs,
  UNBLOCK_SCRIPT,
} from "./lib.ts";

const env = (key: string): string | undefined => {
  try {
    return Deno.env.get(key) || undefined;
  } catch {
    return undefined;
  }
};

/** Passed to the end-of-session timer, so the notification tools find the session. */
const timerEnv = () =>
  Object.fromEntries(
    ["WAYLAND_DISPLAY", "DISPLAY", "DBUS_SESSION_BUS_ADDRESS", "SWAYSOCK"].map((k) => [k, env(k)]),
  );

// ---------------------------------------------------------------------------
// Preferences

export interface Options {
  minutes: number;
  dnd: boolean;
  block: boolean;
  sites: string[];
  slack: boolean;
}

export function optionsOf(ctx: Pick<Context, "preferences">, minutes?: unknown): Options {
  const p = ctx.preferences;
  return {
    minutes: minutesOf(minutes ?? p.minutes, minutesOf(p.minutes)),
    dnd: p.dnd !== false,
    block: p.block === true,
    sites: parseSites(String(p.sites ?? "")),
    slack: !!slackToken(ctx),
  };
}

export const slackToken = (ctx: Pick<Context, "preferences">) => String(ctx.preferences.slackToken ?? "").trim();

// ---------------------------------------------------------------------------
// Do Not Disturb

export async function dndBackend(): Promise<DndBackend | undefined> {
  const server = await exec("gdbus", [
    "call",
    "--session",
    "--timeout",
    "3",
    "--dest",
    "org.freedesktop.Notifications",
    "--object-path",
    "/org/freedesktop/Notifications",
    "--method",
    "org.freedesktop.Notifications.GetServerInformation",
  ]).then(parseServerInfo).catch(() => undefined);
  const found = detectDnd(server, env("XDG_CURRENT_DESKTOP") ?? "");
  if (found) return found;
  // Daemons start on the first notification: try their tools.
  for (const b of ["mako", "dunst", "swaync"] as const) {
    const [program, ...args] = dndQuery(b)!.args;
    if (await exec(program, args).then(() => true, () => false)) return b;
  }
  return undefined;
}

export async function dndOn(b: DndBackend): Promise<boolean | undefined> {
  const query = dndQuery(b);
  if (!query) return undefined;
  const [program, ...args] = query.args;
  return await exec(program, args).then(query.on, () => undefined);
}

export async function setDnd(b: DndBackend, on: boolean): Promise<void> {
  const cmd = dndCommand(b, on);
  if (!cmd) throw new Error("Plasma doesn't let other apps keep Do Not Disturb on");
  const [program, ...args] = cmd;
  try {
    await exec(program, args);
  } catch (e) {
    // mako before 1.8, SwayNC before 0.8.
    if (b === "mako") await exec("makoctl", ["set-mode", on ? "do-not-disturb" : "default"]);
    else if (b === "swaync" && (await dndOn(b)) !== on) await exec("swaync-client", ["-d", "-sw"]);
    else throw e;
  }
}

// ---------------------------------------------------------------------------
// /etc/hosts

export async function readHosts(): Promise<string> {
  return await Deno.readTextFile("/etc/hosts").catch(() => "");
}

async function asRoot(script: string, args: string[] = [], stdin?: string): Promise<void> {
  let child: Deno.ChildProcess;
  try {
    child = new Deno.Command("pkexec", {
      args: ["/bin/sh", "-c", script, "sh", ...args],
      stdin: stdin === undefined ? "null" : "piped",
      stdout: "piped",
      stderr: "piped",
      // Two minutes to type the password.
      signal: AbortSignal.timeout(120_000),
    }).spawn();
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) throw new Error("pkexec (polkit) is needed to block sites");
    throw e;
  }
  if (stdin !== undefined) {
    const w = child.stdin.getWriter();
    await w.write(new TextEncoder().encode(stdin));
    await w.close();
  }
  const { code, stderr } = await child.output();
  const err = new TextDecoder().decode(stderr).trim();
  const denied = pkexecError(code, err);
  if (denied) throw new Error(denied);
  if (code !== 0) throw new Error(err.split("\n").filter(Boolean).pop() || `Changing /etc/hosts failed (${code})`);
}

/** Blocks the sites until `seconds` from now; a root timer removes the block. */
export async function block(sites: string[], seconds: number): Promise<void> {
  const problem = hostsProblem(await readHosts());
  if (problem) throw new Error(problem);
  await asRoot(BLOCK_SCRIPT, [String(Math.max(1, Math.round(seconds)))], blockLines(sites).join("\n") + "\n");
}

export async function unblock(): Promise<void> {
  await asRoot(UNBLOCK_SCRIPT);
}

export const blockedNow = async () => blockedIn(await readHosts());

// ---------------------------------------------------------------------------
// Slack

async function slack<T>(token: string, method: string, params: Record<string, unknown> = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`https://slack.com/api/${method}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: encodeParams(params),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (e) {
    throw new Error(`Slack is unreachable: ${(e as Error).message}`);
  }
  const body = await res.json().catch(() => undefined) as { ok?: boolean; error?: string; needed?: string };
  if (!body) throw new Error(`Slack answered ${res.status}`);
  if (!body.ok) throw new Error(slackError(body.error, body.needed));
  return body as T;
}

async function getSlackStatus(token: string): Promise<SlackStatus> {
  const { profile } = await slack<
    { profile: { status_text?: string; status_emoji?: string; status_expiration?: number } }
  >(
    token,
    "users.profile.get",
  );
  return {
    text: profile.status_text ?? "",
    emoji: profile.status_emoji ?? "",
    expiration: profile.status_expiration ?? 0,
  };
}

const putSlackStatus = (token: string, s: SlackStatus) =>
  slack(token, "users.profile.set", {
    profile: { status_text: s.text, status_emoji: s.emoji, status_expiration: s.expiration },
  });

/** Sets the status and pauses notifications; both end on their own with the session. */
async function slackStart(ctx: Pick<Context, "preferences">, ends: number, warnings: string[]) {
  const token = slackToken(ctx);
  const out: NonNullable<Session["slack"]> = { status: false, snoozed: false };
  try {
    out.previous = await getSlackStatus(token);
    await putSlackStatus(
      token,
      slackStatus(String(ctx.preferences.slackStatus ?? ""), String(ctx.preferences.slackEmoji ?? ""), ends),
    );
    out.status = true;
  } catch (e) {
    warnings.push(`Slack status: ${(e as Error).message}`);
  }
  try {
    await slack(token, "dnd.setSnooze", { num_minutes: Math.max(1, Math.ceil((ends - Date.now()) / 60_000)) });
    out.snoozed = true;
  } catch (e) {
    warnings.push(`Slack notifications: ${(e as Error).message}`);
  }
  return out;
}

async function slackStop(ctx: Pick<Context, "preferences">, s: NonNullable<Session["slack"]>, warnings: string[]) {
  const token = slackToken(ctx);
  if (!token) return;
  if (s.snoozed) await slack(token, "dnd.endSnooze").catch((e) => warnings.push((e as Error).message));
  if (s.status) {
    await putSlackStatus(token, statusToRestore(s.previous)).catch((e) => warnings.push((e as Error).message));
  }
}

// ---------------------------------------------------------------------------
// Sessions

const KEY = "session";

async function timerActive(unit: string): Promise<boolean | undefined> {
  const out = await exec("systemctl", ["--user", "is-active", `${unit}.timer`]).catch((e) =>
    String((e as Error).message)
  );
  if (/\bactive\b/.test(out) && !/inactive/.test(out)) return true;
  if (/inactive|failed|unknown/.test(out)) return false;
  return undefined;
}

/** The session running now, if any. One that ended by itself is logged and forgotten. */
export async function current(): Promise<Session | undefined> {
  const s = (await storage.get(KEY).catch(() => undefined)) as unknown as Session | undefined;
  if (!s) return undefined;
  const alive = s.ends > Date.now() && (await timerActive(s.unit)) !== false;
  if (alive) return s;
  await storage.delete(KEY);
  await log({ started: s.started, seconds: Math.round((s.ends - s.started) / 1000), completed: true });
  return undefined;
}

export async function history(): Promise<Done[]> {
  return ((await storage.get("log").catch(() => undefined)) ?? []) as unknown as Done[];
}

async function log(d: Done) {
  await storage.set("log", appendLog(await history(), d) as any).catch(() => {});
}

export interface Started {
  session: Session;
  warnings: string[];
}

async function schedule(unit: string, seconds: number, dnd: DndBackend | undefined, minutes: number) {
  try {
    await exec("systemd-run", timerArgs(unit, seconds, endScript({ dnd, minutes }), timerEnv()));
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) throw new Error("systemd-run is needed to end the session on time");
    if (String(e).includes("Failed to connect to bus")) {
      throw new Error("No systemd user session: Focus Mode ends sessions with a systemd user timer");
    }
    throw e;
  }
}

export async function start(ctx: Pick<Context, "preferences">, o: Options): Promise<Started> {
  const running = await current();
  if (running) throw new Error("A focus session is already running");
  const warnings: string[] = [];
  const started = Date.now();
  const ends = started + o.minutes * 60_000;
  const session: Session = { unit: `backslash-focus-${started}`, started, ends };
  // The password prompt first: dismissing it starts nothing.
  if (o.block) {
    if (!o.sites.length) throw new Error("No site to block: list some in Settings → Extensions → Focus Mode");
    await block(o.sites, o.minutes * 60);
    session.blocked = o.sites;
  }
  if (o.dnd) {
    const b = await dndBackend();
    if (!b) warnings.push("No notification daemon found for Do Not Disturb");
    else if (!dndCommand(b, true)) warnings.push("Plasma: turn on Do Not Disturb in the Notifications applet");
    else if ((await dndOn(b)) !== true) {
      await setDnd(b, true).then(() => session.dnd = b, (e) => warnings.push(`Do Not Disturb: ${e.message}`));
    }
  }
  if (o.slack) session.slack = await slackStart(ctx, ends, warnings);
  try {
    await schedule(session.unit, o.minutes * 60, session.dnd, o.minutes);
  } catch (e) {
    // Without a timer nothing would end the session: undo it.
    await undo(ctx, session, []);
    throw e;
  }
  await storage.set(KEY, session as any);
  return { session, warnings };
}

async function undo(ctx: Pick<Context, "preferences">, s: Session, warnings: string[]) {
  if (s.dnd) await setDnd(s.dnd, false).catch((e) => warnings.push(`Do Not Disturb: ${e.message}`));
  if (s.slack) await slackStop(ctx, s.slack, warnings);
  if (s.blocked?.length) {
    await unblock().catch((e) =>
      warnings.push(`${e.message}: sites stay blocked until ${new Date(s.ends).toLocaleTimeString()}`)
    );
  }
}

/** Ends the session now and undoes what it changed. */
export async function stop(ctx: Pick<Context, "preferences">): Promise<{ session?: Session; warnings: string[] }> {
  const s = await current();
  if (!s) return { warnings: [] };
  const warnings: string[] = [];
  await exec("systemctl", ["--user", "stop", `${s.unit}.timer`]).catch(() => {});
  await storage.delete(KEY);
  await undo(ctx, s, warnings);
  await log({ started: s.started, seconds: Math.round((Date.now() - s.started) / 1000), completed: false });
  return { session: s, warnings };
}

/** Adds minutes to the session: a new end timer, and the block and Slack moved too. */
export async function extend(ctx: Pick<Context, "preferences">, minutes: number): Promise<Started> {
  const s = await current();
  if (!s) throw new Error("No focus session is running");
  const warnings: string[] = [];
  const ends = Math.max(s.ends, Date.now()) + minutes * 60_000;
  const left = (ends - Date.now()) / 1000;
  if (s.blocked?.length) await block(s.blocked, left);
  const unit = `backslash-focus-${Date.now()}`;
  await schedule(unit, left, s.dnd, Math.round((ends - s.started) / 60_000));
  await exec("systemctl", ["--user", "stop", `${s.unit}.timer`]).catch(() => {});
  if (s.slack) {
    const token = slackToken(ctx);
    if (s.slack.status) {
      await putSlackStatus(
        token,
        slackStatus(String(ctx.preferences.slackStatus ?? ""), String(ctx.preferences.slackEmoji ?? ""), ends),
      ).catch((e) => warnings.push((e as Error).message));
    }
    if (s.slack.snoozed) {
      await slack(token, "dnd.setSnooze", { num_minutes: Math.ceil(left / 60) })
        .catch((e) => warnings.push((e as Error).message));
    }
  }
  const next = { ...s, unit, ends };
  await storage.set(KEY, next as any);
  return { session: next, warnings };
}
