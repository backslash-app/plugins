// Saved shares, and mounting them: gio (GVfs, like the file manager), sshfs,
// or mount for /etc/fstab entries.

import { exec, storage } from "@backslash/api";
import {
  explain,
  type GioMount,
  kindOf,
  type Mounted,
  parseGioMounts,
  parseLocalPath,
  parseMounts,
  parseUri,
  pendingQuestion,
  type Question,
  type Share,
  sshfsArgs,
  type SystemMount,
} from "./lib.ts";
import { runInTerminal, shellLine } from "./terminal.ts";

const env = (key: string) => {
  try {
    return Deno.env.get(key);
  } catch {
    return undefined;
  }
};

export const HOME = env("HOME") ?? "";
export const tilde = (p: string) => (HOME && p.startsWith(`${HOME}/`) ? `~${p.slice(HOME.length)}` : p);
export const expandHome = (p: string) => p.trim().replace(/^~(?=\/|$)/, HOME);

const notFound = (e: unknown) => e instanceof Deno.errors.NotFound;

// ---------------------------------------------------------------------------
// Storage

export async function shares(): Promise<Share[]> {
  return (await storage.get<Share[] & never>("shares")) ?? [];
}

export async function saveShares(list: Share[]): Promise<void> {
  await storage.set("shares", list as never);
}

export async function upsert(s: Share): Promise<void> {
  const list = await shares();
  const i = list.findIndex((x) => x.id === s.id);
  if (i >= 0) list[i] = s;
  else list.push(s);
  await saveShares(list);
}

// ---------------------------------------------------------------------------
// What is mounted

export async function gioMounts(signal?: AbortSignal): Promise<GioMount[]> {
  try {
    return parseGioMounts(await exec("gio", ["mount", "-l"], { signal }));
  } catch {
    return [];
  }
}

export async function systemMounts(): Promise<SystemMount[]> {
  return parseMounts(await Deno.readTextFile("/proc/mounts").catch(() => ""));
}

export async function fstab(): Promise<SystemMount[]> {
  return parseMounts(await Deno.readTextFile("/etc/fstab").catch(() => ""));
}

/** The folder GVfs serves a mounted URI from (/run/user/1000/gvfs/…), when gvfs-fuse runs. */
export async function localPath(uri: string): Promise<string | undefined> {
  try {
    return parseLocalPath(
      await exec("gio", ["info", "-a", "standard::name", uri], { signal: AbortSignal.timeout(4000) }),
    );
  } catch {
    return undefined;
  }
}

/** Where to open a mounted share: its local folder when there is one (every file manager), else the URI. */
export async function openTarget(m: Mounted): Promise<string> {
  if (!/^[a-z]+:\/\//.test(m.location)) return m.location;
  return (await localPath(m.location)) ?? m.location;
}

// ---------------------------------------------------------------------------
// Mounting

export interface Credentials {
  user?: string;
  domain?: string;
  password?: string;
}

/** Thrown when gio asks a question we have no answer for: show the sign-in form. */
export class NeedsCredentials extends Error {
  constructor(public question: Question) {
    super("The server wants a user name and password");
  }
}

/**
 * `gio mount uri`, answering its questions (User, Domain, Password) from
 * `creds`. Asked twice means refused. Without an answer, NeedsCredentials.
 */
export async function gioMount(uri: string, creds?: Credentials): Promise<void> {
  let child: Deno.ChildProcess;
  try {
    child = new Deno.Command("gio", {
      args: ["mount", uri],
      stdin: "piped",
      stdout: "piped",
      stderr: "piped",
      env: { LC_ALL: "C", LANGUAGE: "C" },
    }).spawn();
  } catch (e) {
    if (notFound(e)) throw new Error("gio (GLib) is needed to mount shares: install glib2 / libglib2.0-bin and gvfs");
    throw e;
  }
  const writer = child.stdin.getWriter();
  const decoder = new TextDecoder();
  const asked = new Set<Question>();
  let output = "";
  let problem: Error | undefined;
  const timer = setTimeout(() => {
    problem = new Error("The server didn't answer within a minute");
    child.kill();
  }, 60_000);

  const stderr = new Response(child.stderr).text();
  try {
    for await (const chunk of child.stdout) {
      output += decoder.decode(chunk, { stream: true });
      const q = pendingQuestion(output);
      if (!q) continue;
      output = "";
      const answer = q === "user" ? creds?.user : q === "domain" ? creds?.domain ?? "" : creds?.password;
      if (asked.has(q)) {
        problem = new Error("The server refused the user name or password");
      } else if (answer === undefined) {
        problem = new NeedsCredentials(q);
      }
      if (problem) {
        child.kill();
        break;
      }
      asked.add(q);
      await writer.write(new TextEncoder().encode(`${answer}\n`));
    }
  } finally {
    clearTimeout(timer);
  }
  const status = await child.status;
  await writer.close().catch(() => {});
  const err = await stderr;
  if (problem) throw problem;
  if (!status.success) {
    const why = explain(err || output, kindOf(uri));
    if (why === "Already mounted") return;
    throw new Error(why);
  }
}

export async function gioUnmount(root: string): Promise<void> {
  try {
    await exec("gio", ["mount", "-u", root]);
  } catch (e) {
    throw new Error(explain(e instanceof Error ? e.message : String(e)));
  }
}

async function mkdirp(path: string) {
  try {
    await exec("mkdir", ["-p", path]);
  } catch (e) {
    throw new Error(`Couldn't create the mount point ${tilde(path)}: ${explain(String((e as Error).message ?? e))}`);
  }
}

/**
 * sshfs into the share's mount point. Without a password, keys or the SSH
 * agent are used (BatchMode, so it never waits for a question).
 */
export async function sshfsMount(s: Share, password?: string): Promise<void> {
  const mountpoint = expandHome(s.mountpoint ?? "");
  if (!mountpoint) throw new Error("Set a mount point for this share (Ctrl+E)");
  await mkdirp(mountpoint);
  const args = [
    ...sshfsArgs(s.uri, mountpoint),
    "-o",
    password === undefined ? "BatchMode=yes" : "password_stdin",
    "-o",
    "StrictHostKeyChecking=accept-new",
  ];
  let child: Deno.ChildProcess;
  try {
    child = new Deno.Command("sshfs", {
      args,
      stdin: password === undefined ? "null" : "piped",
      stdout: "null",
      stderr: "piped",
    }).spawn();
  } catch (e) {
    if (notFound(e)) throw new Error("sshfs is not installed: install it, or mount this share with gio (Ctrl+E)");
    throw e;
  }
  if (password !== undefined) {
    const w = child.stdin.getWriter();
    await w.write(new TextEncoder().encode(`${password}\n`));
    await w.close();
  }
  // sshfs goes to the background once mounted, but ssh keeps stderr open: wait for
  // the exit, not the end of the output.
  const status = await child.status;
  if (status.success) {
    child.stderr.cancel().catch(() => {});
    return;
  }
  const err = await Promise.race([
    new Response(child.stderr).text(),
    new Promise<string>((r) => setTimeout(() => r(""), 2000)),
  ]);
  const why = explain(err || `sshfs exited with ${status.code}`, "SFTP");
  if (why.startsWith("The server refused") && password === undefined) throw new NeedsCredentials("password");
  throw new Error(why);
}

/** `mount <mountpoint>`: works for /etc/fstab lines with the user option. */
export async function fstabMount(mountpoint: string): Promise<void> {
  try {
    await exec("mount", [expandHome(mountpoint)]);
  } catch (e) {
    throw new Error(explain(e instanceof Error ? e.message : String(e)));
  }
}

/** Unmounts a FUSE (sshfs, rclone…) or kernel mount at `target`. */
export async function unmountPath(target: string, fuse: boolean): Promise<void> {
  const tries: [string, string[]][] = fuse
    ? [["fusermount3", ["-u", target]], ["fusermount", ["-u", target]], ["umount", [target]]]
    : [["umount", [target]]];
  let last: unknown;
  for (const [program, args] of tries) {
    try {
      await exec(program, args);
      return;
    } catch (e) {
      last = e;
      if (!notFound(e)) break;
    }
  }
  throw new Error(explain(last instanceof Error ? last.message : String(last)));
}

/** Mounts in a terminal, where gio or ssh can ask anything (host keys, two-factor codes…). */
export function mountInTerminal(s: Share, terminal?: string): string {
  const argv = s.method === "sshfs"
    ? ["sshfs", ...sshfsArgs(s.uri, expandHome(s.mountpoint ?? ""))]
    : s.method === "fstab"
    ? ["mount", expandHome(s.mountpoint ?? "")]
    : ["gio", "mount", s.uri];
  const pre = s.method === "sshfs" ? `mkdir -p ${shellLine([expandHome(s.mountpoint ?? "")])} && ` : "";
  const script = `${pre}${
    shellLine(argv)
  } && echo 'Mounted.' || echo 'Mounting failed.'; printf 'Press Enter to close.'; read _`;
  return runInTerminal(["sh", "-c", script], terminal || undefined);
}

/** The user in a share's address, to fill the sign-in form. */
export const userOf = (uri: string) => parseUri(uri).user;
export const domainOf = (uri: string) => parseUri(uri).domain;
