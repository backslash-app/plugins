// The running inhibitor: a transient systemd user unit, so it survives the launcher.

import { exec, storage } from "@backslash/api";
import { type Session, systemdRunArgs, UNIT } from "./lib.ts";

const desktop = () => {
  try {
    return Deno.env.get("XDG_CURRENT_DESKTOP");
  } catch {
    return undefined;
  }
};

async function active(): Promise<boolean> {
  try {
    const state = await exec("systemctl", ["--user", "is-active", UNIT]);
    return state === "active" || state === "activating";
  } catch {
    return false; // is-active exits non-zero when inactive
  }
}

/** The current session, if the computer is kept awake. */
export async function current(): Promise<Session | undefined> {
  const saved = (await storage.get("session")) as unknown as Session | undefined;
  if (!(await active())) {
    if (saved) await storage.delete("session");
    return undefined;
  }
  if (saved && (saved.until === null || saved.until > Date.now())) return saved;
  // Started elsewhere, or our record is gone: awake, end unknown.
  return { started: Date.now(), until: null };
}

export async function start(seconds?: number): Promise<Session> {
  await stop();
  try {
    await exec("systemd-run", systemdRunArgs(seconds, desktop()));
  } catch (e) {
    if (String(e).includes("Failed to connect to bus")) {
      throw new Error("No systemd user session: Caffeine runs with systemd-run --user");
    }
    throw e;
  }
  const session = { started: Date.now(), until: seconds ? Date.now() + seconds * 1000 : null };
  await storage.set("session", session as any);
  return session;
}

export async function stop(): Promise<void> {
  await exec("systemctl", ["--user", "stop", UNIT]).catch(() => {});
  await storage.delete("session");
}
