// Reading ~/.ssh (public keys only), the SSH agent and GnuPG's keyrings; adding keys.

import { exec } from "@backslash/api";
import {
  agentState,
  type Certificate,
  type Fingerprint,
  freeKeyName,
  type GpgKey,
  keyBits,
  keygenArgs,
  keyType,
  parseAgentList,
  parseCertificate,
  parseFingerprintLine,
  parseGpgColons,
  parsePublicKey,
  privateKeyNames,
  type PublicKey,
  sha256Fingerprint,
  validKeyName,
} from "./lib.ts";

export const HOME = (() => {
  try {
    return Deno.env.get("HOME") ?? "";
  } catch {
    return "";
  }
})();

export const SSH_DIR = `${HOME}/.ssh`;

export interface SshKey {
  /** File name of the private key (without .pub), or of the .pub when the private one isn't here. */
  name: string;
  pubPath: string;
  privatePath?: string;
  key: PublicKey;
  /** The .pub file's text, trimmed: what to paste on GitHub. */
  publicText: string;
  fp: Fingerprint;
  certificate?: Certificate;
  modified?: number;
}

const isNotFound = (e: unknown) => e instanceof Deno.errors.NotFound;

async function listSshDir(): Promise<string[]> {
  const names: string[] = [];
  try {
    for await (const f of Deno.readDir(SSH_DIR)) if (f.isFile || f.isSymlink) names.push(f.name);
  } catch (e) {
    if (!isNotFound(e)) throw e;
  }
  return names;
}

/** `ssh-keygen -lf` when installed, else the same values computed here. */
async function fingerprint(path: string, key: PublicKey, signal?: AbortSignal): Promise<Fingerprint> {
  try {
    const fp = parseFingerprintLine((await exec("ssh-keygen", ["-lf", path], { signal })).split("\n")[0]);
    if (fp) return fp;
  } catch {
    // Missing ssh-keygen or an odd file: compute it ourselves.
  }
  return {
    bits: keyBits(key),
    fingerprint: await sha256Fingerprint(key.blob),
    comment: key.comment,
    type: keyType(key.algorithm),
  };
}

/** The key pairs of ~/.ssh, read from their .pub files only: private keys are never opened. */
export async function sshKeys(signal?: AbortSignal): Promise<{ keys: SshKey[]; orphans: string[]; names: string[] }> {
  const names = await listSshDir();
  const set = new Set(names);
  const keys = (await Promise.all(
    names.filter((n) => n.endsWith(".pub")).map(async (pub): Promise<SshKey | undefined> => {
      const pubPath = `${SSH_DIR}/${pub}`;
      let text: string;
      try {
        text = await Deno.readTextFile(pubPath);
      } catch {
        return undefined;
      }
      const key = parsePublicKey(text);
      if (!key) return undefined;
      const base = pub.replace(/\.pub$/, "");
      const privName = base.replace(/-cert$/, "");
      const cert = key.algorithm.includes("-cert-v01@");
      const [fp, certificate, stat] = await Promise.all([
        fingerprint(pubPath, key, signal),
        cert
          ? exec("ssh-keygen", ["-Lf", pubPath], { signal }).then(parseCertificate).catch(() => undefined)
          : Promise.resolve(undefined),
        Deno.stat(pubPath).catch(() => undefined),
      ]);
      return {
        name: cert ? base : privName,
        pubPath,
        privatePath: set.has(privName) ? `${SSH_DIR}/${privName}` : undefined,
        key,
        publicText: text.trim().split("\n")[0],
        fp,
        certificate,
        modified: stat?.mtime?.getTime(),
      };
    }),
  )).filter((k): k is SshKey => !!k);
  const withPub = new Set(keys.map((k) => k.privatePath).filter(Boolean));
  const orphans = privateKeyNames(names).filter((n) => !withPub.has(`${SSH_DIR}/${n}`) && !set.has(`${n}.pub`));
  return { keys: keys.sort((a, b) => a.name.localeCompare(b.name)), orphans, names };
}

export interface Agent {
  state: "ok" | "empty" | "no-agent" | "unknown" | "missing";
  keys: Fingerprint[];
  /** `ssh-add -L`, for keys loaded from elsewhere (a hardware token, another folder). */
  publicKeys: string[];
  error?: string;
}

export async function agent(signal?: AbortSignal): Promise<Agent> {
  try {
    const [list, pubs] = await Promise.all([
      exec("ssh-add", ["-l"], { signal }),
      exec("ssh-add", ["-L"], { signal }).catch(() => ""),
    ]);
    return { state: "ok", keys: parseAgentList(list), publicKeys: pubs.split("\n").filter(Boolean) };
  } catch (e) {
    if (isNotFound(e)) return { state: "missing", keys: [], publicKeys: [] };
    const text = e instanceof Error ? e.message : String(e);
    return { state: agentState(text), keys: [], publicKeys: [], error: text };
  }
}

export async function gpgKeys(signal?: AbortSignal): Promise<{ keys: GpgKey[]; installed: boolean }> {
  try {
    const [secret, pub] = await Promise.all([
      exec("gpg", ["--batch", "--list-secret-keys", "--with-colons", "--fixed-list-mode"], { signal }),
      exec("gpg", ["--batch", "--list-keys", "--with-colons", "--fixed-list-mode"], { signal }),
    ]);
    const secrets = parseGpgColons(secret);
    const mine = new Set(secrets.map((k) => k.fingerprint));
    const others = parseGpgColons(pub).filter((k) => !mine.has(k.fingerprint));
    return { keys: [...secrets, ...others], installed: true };
  } catch (e) {
    if (isNotFound(e)) return { keys: [], installed: false };
    throw new Error(`gpg could not list the keys: ${e instanceof Error ? e.message : e}`);
  }
}

/**
 * `ssh-add` without a terminal: works for keys without a passphrase, or
 * through the desktop's askpass dialog. Returns false when it needs a terminal.
 */
export async function addToAgent(privatePath: string): Promise<boolean> {
  const signal = AbortSignal.timeout(120_000);
  try {
    await exec("ssh-add", [privatePath], { signal });
    return true;
  } catch (e) {
    const text = e instanceof Error ? e.message : String(e);
    if (agentState(text) === "no-agent") {
      throw new Error("No SSH agent is running: start one (ssh-agent, GNOME Keyring, KeePassXC…) first");
    }
    if (/passphrase|askpass|read_passphrase|bad permissions|timed out|abort/i.test(text) || signal.aborted) {
      return false;
    }
    throw new Error(`ssh-add failed: ${text}`);
  }
}

export async function removeFromAgent(pubPath: string): Promise<void> {
  await exec("ssh-add", ["-d", pubPath]);
}

export async function suggestedName(): Promise<string> {
  return freeKeyName(await listSshDir());
}

/** Creates `~/.ssh/<name>` (and its .pub) with ssh-keygen; returns the .pub's text. */
export async function generate(name: string, comment: string, passphrase: string): Promise<string> {
  const problem = validKeyName(name);
  if (problem) throw new Error(problem);
  const names = await listSshDir();
  if (names.includes(name) || names.includes(`${name}.pub`)) {
    throw new Error(`~/.ssh/${name} already exists: pick another name`);
  }
  try {
    await Deno.stat(SSH_DIR);
  } catch (e) {
    if (!isNotFound(e)) throw e;
    await exec("mkdir", ["-p", "-m", "700", SSH_DIR]);
  }
  const path = `${SSH_DIR}/${name}`;
  try {
    await exec("ssh-keygen", keygenArgs(path, comment, passphrase));
  } catch (e) {
    if (isNotFound(e)) throw new Error("ssh-keygen is not installed: install OpenSSH (openssh-client) first");
    throw e;
  }
  return (await Deno.readTextFile(`${path}.pub`)).trim();
}
