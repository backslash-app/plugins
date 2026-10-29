// Copied files and text, recipients (preferences, ~/.ssh, the GPG keyring),
// identities, and running age and gpg.

import { clipboard } from "@backslash/api";
import {
  ageDecryptArgs,
  ageEncryptArgs,
  decryptError,
  gpgDecryptArgs,
  gpgEncryptArgs,
  type GpgKey,
  identityKind,
  parseEncTo,
  parseFileList,
  parseGpgKeys,
  parsePublicKeys,
  parseRecipients,
  parseSshKey,
  type Recipient,
  type Scheme,
  schemeOf,
} from "./lib.ts";

const env = (key: string): string | undefined => {
  try {
    return Deno.env.get(key);
  } catch {
    return undefined;
  }
};

export const HOME = env("HOME") ?? "";
export const tilde = (p: string) => (HOME && p.startsWith(HOME) ? `~${p.slice(HOME.length)}` : p);
export const expandHome = (p: string) => p.trim().replace(/^~(?=\/|$)/, HOME);
const wayland = () =>
  env("XDG_SESSION_TYPE") === "wayland" || (!!env("WAYLAND_DISPLAY") && env("XDG_SESSION_TYPE") !== "x11");

async function output(program: string, args: string[], timeout = 3000): Promise<string | undefined> {
  try {
    const out = await new Deno.Command(program, {
      args,
      stdin: "null",
      stdout: "piped",
      stderr: "null",
      signal: AbortSignal.timeout(timeout),
    }).output();
    return out.success ? new TextDecoder().decode(out.stdout) : undefined;
  } catch {
    return undefined;
  }
}

const has = async (program: string, args = ["--version"]) => {
  try {
    await new Deno.Command(program, { args, stdin: "null", stdout: "null", stderr: "null" }).output();
    return true;
  } catch {
    return false;
  }
};

export interface Tools {
  age: boolean;
  ageKeygen: boolean;
  gpg: boolean;
}

let found: Promise<Tools> | undefined;
export function tools(): Promise<Tools> {
  found ??= Promise.all([has("age"), has("age-keygen", ["--version"]), has("gpg")]).then(([age, ageKeygen, gpg]) => ({
    age,
    ageKeygen,
    gpg,
  }));
  return found;
}

/** Files copied in the file manager, or the copied text. */
export async function clipboardContent(): Promise<{ paths: string[]; text: string }> {
  const tries: [string, string[]][] = [
    ["wl-paste", ["--no-newline", "--type", "text/uri-list"]],
    ["wl-paste", ["--no-newline", "--type", "x-special/gnome-copied-files"]],
    ["xclip", ["-selection", "clipboard", "-t", "text/uri-list", "-o"]],
    ["xclip", ["-selection", "clipboard", "-t", "x-special/gnome-copied-files", "-o"]],
  ];
  if (!wayland()) tries.push(...tries.splice(0, 2));
  for (const [program, args] of tries) {
    const out = await output(program, args, 1500);
    const paths = out ? parseFileList(out, HOME) : [];
    if (paths.length) return { paths, text: "" };
  }
  try {
    const text = await clipboard.read();
    const paths = parseFileList(text, HOME);
    return { paths, text: paths.length ? "" : text };
  } catch {
    return { paths: [], text: "" };
  }
}

export interface FileEntry {
  path: string;
  name: string;
  size: number;
  dir: boolean;
  /** How it is encrypted, from its first bytes. */
  scheme: Scheme;
}

async function head(path: string, n = 4096): Promise<Uint8Array> {
  const file = await Deno.open(path, { read: true }).catch(() => undefined);
  if (!file) return new Uint8Array();
  try {
    const buf = new Uint8Array(n);
    let got = 0;
    while (got < n) {
      const r = await file.read(buf.subarray(got));
      if (!r) break;
      got += r;
    }
    return buf.subarray(0, got);
  } finally {
    file.close();
  }
}

export async function fileEntry(path: string): Promise<FileEntry | undefined> {
  const st = await Deno.stat(path).catch(() => undefined);
  if (!st || !(st.isFile || st.isDirectory)) return undefined;
  return {
    path,
    name: path.split("/").pop()!,
    size: st.size,
    dir: st.isDirectory,
    scheme: st.isFile ? schemeOf(await head(path)) : "unknown",
  };
}

export const exists = (p: string) => {
  try {
    Deno.lstatSync(p);
    return true;
  } catch {
    return false;
  }
};

// ---------------------------------------------------------------------------
// Recipients and identities

/** The public keys in ~/.ssh that age can encrypt to. */
export async function sshRecipients(): Promise<Recipient[]> {
  const out: Recipient[] = [];
  try {
    for await (const e of Deno.readDir(`${HOME}/.ssh`)) {
      if (!e.isFile || !e.name.endsWith(".pub")) continue;
      const text = await Deno.readTextFile(`${HOME}/.ssh/${e.name}`).catch(() => "");
      const r = parseSshKey(text.split("\n")[0] ?? "", `~/.ssh/${e.name}`);
      if (r) out.push({ ...r, label: r.label ? `${r.label} (${e.name})` : e.name });
    }
  } catch {
    // No ~/.ssh.
  }
  return out.sort((a, b) => (a.label ?? "").localeCompare(b.label ?? ""));
}

export function prefRecipients(text: unknown): { recipients: Recipient[]; invalid: string[] } {
  return parseRecipients(String(text ?? ""));
}

/** Identity files for decrypting: the preference, else the usual places. */
export async function identities(pref: unknown): Promise<string[]> {
  const wanted = String(pref ?? "").split(/[,\n]/).map((p) => expandHome(p)).filter(Boolean);
  const candidates = wanted.length ? wanted : [
    `${HOME}/.config/age/keys.txt`,
    `${HOME}/.age/keys.txt`,
    `${HOME}/.config/sops/age/keys.txt`,
    `${HOME}/.ssh/id_ed25519`,
    `${HOME}/.ssh/id_rsa`,
  ];
  const found: string[] = [];
  for (const p of candidates) if (await Deno.stat(p).then((s) => s.isFile).catch(() => false)) found.push(p);
  return found;
}

/** The public keys of your own identities: encrypting to yourself too keeps the file readable by you. */
export async function selfRecipients(ids: string[]): Promise<string[]> {
  const t = await tools();
  const out: string[] = [];
  for (const id of ids) {
    const text = await Deno.readTextFile(id).catch(() => "");
    const kind = identityKind(text);
    if (kind === "age" && t.ageKeygen) {
      out.push(...parsePublicKeys((await output("age-keygen", ["-y", id])) ?? ""));
    } else if (kind === "ssh") {
      const pub = parseSshKey((await Deno.readTextFile(`${id}.pub`).catch(() => "")).split("\n")[0] ?? "");
      if (pub) out.push(pub.key);
    }
  }
  return [...new Set(out)];
}

let keyring: Promise<GpgKey[]> | undefined;
let secretKeys: Promise<GpgKey[]> | undefined;

export function gpgKeys(): Promise<GpgKey[]> {
  keyring ??= output("gpg", ["--batch", "--list-keys", "--with-colons", "--fixed-list-mode"], 10_000).then((o) =>
    parseGpgKeys(o ?? "")
  );
  return keyring;
}

export function gpgSecretKeys(): Promise<GpgKey[]> {
  secretKeys ??= output("gpg", ["--batch", "--list-secret-keys", "--with-colons", "--fixed-list-mode"], 10_000).then((
    o,
  ) => parseGpgKeys(o ?? ""));
  return secretKeys;
}

/** Who a GPG message is encrypted to, without decrypting it. */
export async function gpgRecipients(path: string): Promise<string[]> {
  const out = await new Deno.Command("gpg", {
    args: [
      "--batch",
      "--no-tty",
      "--list-only",
      "--pinentry-mode",
      "cancel",
      "--status-fd",
      "1",
      "--decrypt",
      "--",
      path,
    ],
    stdin: "null",
    stdout: "piped",
    stderr: "null",
    signal: AbortSignal.timeout(10_000),
  }).output().catch(() => undefined);
  return out ? parseEncTo(new TextDecoder().decode(out.stdout)) : [];
}

// ---------------------------------------------------------------------------
// Running age and gpg

interface Ran {
  code: number;
  stdout: Uint8Array;
  stderr: string;
}

async function run(program: string, args: string[], stdin?: string): Promise<Ran> {
  try {
    const child = new Deno.Command(program, {
      args,
      stdin: stdin === undefined ? "null" : "piped",
      stdout: "piped",
      stderr: "piped",
      signal: AbortSignal.timeout(120_000),
    }).spawn();
    if (stdin !== undefined) {
      const w = child.stdin.getWriter();
      await w.write(new TextEncoder().encode(stdin));
      await w.close();
    }
    const { code, stdout, stderr } = await child.output();
    return { code, stdout, stderr: new TextDecoder().decode(stderr) };
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) throw new Error(`${program} is not installed`);
    throw e;
  }
}

const lastLine = (s: string) =>
  s.split("\n").map((l) => l.replace(/^(age: error: |gpg: )/, "").trim()).filter((l) =>
    l && !/^\[GNUPG:\]|report unexpected/.test(l)
  )
    .at(-1);

/** Encrypts a file to `output` (which doesn't exist); a partial output is removed on failure. */
export async function encryptFile(
  tool: "age" | "gpg",
  input: string,
  outputPath: string,
  recipients: string[],
  o: { armor?: boolean; self?: string[] } = {},
): Promise<void> {
  const all = [...recipients, ...(tool === "age" ? (o.self ?? []).filter((s) => !recipients.includes(s)) : [])];
  const args = tool === "age"
    ? ageEncryptArgs(all, { input, output: outputPath, armor: o.armor })
    : gpgEncryptArgs(recipients, { input, output: outputPath, armor: o.armor, self: o.self?.[0] });
  const r = await run(tool, args);
  if (r.code !== 0) {
    await Deno.remove(outputPath).catch(() => {});
    throw new Error(lastLine(r.stderr) ?? `${tool} exited with ${r.code}`);
  }
}

/** Encrypts text to armored text. */
export async function encryptText(
  tool: "age" | "gpg",
  text: string,
  recipients: string[],
  self: string[] = [],
): Promise<string> {
  const args = tool === "age"
    ? ageEncryptArgs([...recipients, ...self.filter((s) => !recipients.includes(s))], { armor: true })
    : gpgEncryptArgs(recipients, { armor: true, self: self[0] });
  const r = await run(tool, args, text);
  if (r.code !== 0) throw new Error(lastLine(r.stderr) ?? `${tool} exited with ${r.code}`);
  return new TextDecoder().decode(r.stdout);
}

/** Decrypts to a file (output) or to memory (no output): the bytes, for showing a secret text. */
export async function decrypt(
  tool: "age" | "gpg",
  o: { input?: string; text?: string; output?: string; identities?: string[] },
): Promise<Uint8Array> {
  if (tool === "age" && !o.identities?.length) {
    throw new Error("No age identity found: set its path in the extension's preferences");
  }
  const args = tool === "age"
    ? ageDecryptArgs(o.identities ?? [], { input: o.input, output: o.output })
    : gpgDecryptArgs({ input: o.input, output: o.output });
  const r = await run(tool, args, o.text);
  if (r.code !== 0) {
    if (o.output) await Deno.remove(o.output).catch(() => {});
    throw new Error(decryptError(r.stderr || `${tool} exited with ${r.code}`));
  }
  return r.stdout;
}
