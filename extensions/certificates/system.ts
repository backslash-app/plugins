// openssl and mkcert calls, and the search for certificate files. openssl reads
// the files itself, so the extension never opens a private key.

import { exec } from "@backslash/api";
import {
  type Cert,
  connectError,
  expandHome,
  type Fingerprints,
  fingerprints,
  FOLDERS,
  type Handshake,
  isIp,
  looksLikeCert,
  parseCertText,
  parseHandshake,
  pemBlocks,
  SKIP_DIRS,
  type Target,
} from "./lib.ts";

export const HOME = Deno.env.get("HOME") ?? "";

export class MissingTool extends Error {
  constructor(readonly tool: "openssl" | "mkcert") {
    super(`${tool} is not installed`);
  }
}

async function run(tool: "openssl" | "mkcert", args: string[], o: { stdin?: string; signal?: AbortSignal } = {}) {
  try {
    return await exec(tool, args, o);
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) throw new MissingTool(tool);
    throw e;
  }
}

export interface Loaded {
  pem: string;
  /** `openssl x509 -text` output, for "Show Full Text". */
  text: string;
  cert: Cert;
  fp: Fingerprints;
}

/** One PEM block, read by openssl. */
export async function readPem(pem: string, signal?: AbortSignal): Promise<Loaded> {
  const text = await run("openssl", ["x509", "-noout", "-text"], { stdin: pem, signal });
  return { pem, text, cert: parseCertText(text), fp: await fingerprints(pem) };
}

export const readPems = (pems: string[], signal?: AbortSignal) => Promise.all(pems.map((p) => readPem(p, signal)));

export interface Connection {
  target: Target;
  chain: Loaded[];
  handshake: Handshake;
}

/** The chain a server sends, with `openssl s_client -showcerts`. */
export async function connect(target: Target, signal: AbortSignal, timeoutS = 15): Promise<Connection> {
  const both = AbortSignal.any([signal, AbortSignal.timeout(timeoutS * 1000)]);
  const ip = isIp(target.host);
  const args = [
    "s_client",
    "-connect",
    `${target.host.includes(":") ? `[${target.host}]` : target.host}:${target.port}`,
    "-showcerts",
    ...(ip ? ["-verify_ip", target.host] : ["-servername", target.host, "-verify_hostname", target.host]),
  ];
  let out: string;
  try {
    // An empty stdin makes s_client close right after the handshake.
    out = await run("openssl", args, { stdin: "", signal: both });
  } catch (e) {
    if (e instanceof MissingTool || signal.aborted) throw e;
    if (both.aborted) throw new Error(`No answer from ${target.host}:${target.port} in ${timeoutS} s`);
    throw new Error(connectError(e instanceof Error ? e.message : String(e)));
  }
  const pems = pemBlocks(out);
  if (!pems.length) throw new Error("The server sent no certificate");
  return { target, chain: await readPems(pems, signal), handshake: parseHandshake(out) };
}

/** Every certificate of a file: a PEM bundle, or a single DER certificate. */
export async function readFile(path: string, signal?: AbortSignal): Promise<Loaded[]> {
  let pems: string[] = [];
  try {
    const p7 = await run("openssl", ["crl2pkcs7", "-nocrl", "-certfile", path], { signal });
    pems = pemBlocks(await run("openssl", ["pkcs7", "-print_certs"], { stdin: p7, signal }));
  } catch (e) {
    if (e instanceof MissingTool) throw e;
  }
  if (!pems.length) {
    try {
      pems = pemBlocks(await run("openssl", ["x509", "-inform", "DER", "-in", path], { signal }));
    } catch (e) {
      if (e instanceof MissingTool) throw e;
      const message = e instanceof Error ? e.message : String(e);
      if (/No such file|cannot open|Could not open/i.test(message)) throw new Error(`${path} does not exist`);
      throw new Error(`${path} holds no certificate (a private key, a request or another format?)`);
    }
  }
  return await readPems(pems, signal);
}

/** The first certificate of a file and openssl's reading of it, or undefined if it has none. */
async function readFirst(path: string, signal?: AbortSignal): Promise<Loaded | undefined> {
  try {
    // Without -noout, openssl prints the text then the PEM.
    const out = await run("openssl", ["x509", "-in", path, "-text"], { signal });
    const pem = pemBlocks(out)[0];
    if (!pem) return undefined;
    const text = out.slice(0, out.indexOf("-----BEGIN"));
    return { pem, text, cert: parseCertText(text), fp: await fingerprints(pem) };
  } catch (e) {
    if (e instanceof MissingTool) throw e;
    return undefined;
  }
}

/** mkcert's CA folder (`mkcert -CAROOT`), else its Linux default. */
export async function caroot(): Promise<{ path: string; mkcert: boolean }> {
  try {
    const path = (await run("mkcert", ["-CAROOT"])).trim();
    if (path) return { path, mkcert: true };
  } catch {
    // Not installed: look where it would be.
  }
  return { path: Deno.env.get("CAROOT") || `${HOME}/.local/share/mkcert`, mkcert: false };
}

export interface Found {
  path: string;
  /** "mkcert CA", or the folder searched. */
  origin: string;
}

/** Certificate files under the folders, a few levels deep, at most `max`. */
export async function findFiles(max = 300, depth = 5): Promise<{ files: Found[]; truncated: boolean }> {
  const files: Found[] = [];
  const seen = new Set<string>();
  let truncated = false;
  const walk = async (dir: string, origin: string, level: number) => {
    if (files.length >= max) return void (truncated = true);
    let entries: Deno.DirEntry[];
    try {
      entries = await Array.fromAsync(Deno.readDir(dir));
    } catch {
      return; // Missing or unreadable folder.
    }
    for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const path = `${dir}/${e.name}`;
      if (e.isDirectory && level < depth && !SKIP_DIRS.has(e.name) && !e.name.startsWith(".")) {
        await walk(path, origin, level + 1);
      } else if (e.isFile && looksLikeCert(e.name) && !seen.has(path)) {
        if (files.length >= max) return void (truncated = true);
        seen.add(path);
        files.push({ path, origin });
      }
    }
  };
  for (const folder of FOLDERS) await walk(expandHome(folder, HOME), folder, 0);
  return { files, truncated };
}

export interface LocalCert extends Loaded {
  path: string;
  origin: string;
  /** mkcert's `-key.pem` sits next to it. */
  hasKey: boolean;
}

/** Reads files eight at a time; files without a certificate are left out. */
export async function readLocal(found: Found[], signal?: AbortSignal): Promise<LocalCert[]> {
  const out: LocalCert[] = [];
  for (let i = 0; i < found.length; i += 8) {
    const batch = await Promise.all(
      found.slice(i, i + 8).map(async (f) => {
        const loaded = await readFirst(f.path, signal);
        if (!loaded) return undefined;
        const key = f.path.replace(/(\.pem|\.crt)$/i, "-key.pem");
        const hasKey = key !== f.path && await Deno.stat(key).then(() => true, () => false);
        return { ...loaded, path: f.path, origin: f.origin, hasKey };
      }),
    );
    out.push(...batch.filter((x): x is LocalCert => !!x));
  }
  return out;
}

/** The mkcert root, read by openssl wherever CAROOT is. */
export async function mkcertRoot(signal?: AbortSignal): Promise<LocalCert | undefined> {
  const root = await caroot();
  const path = `${root.path}/rootCA.pem`;
  const loaded = await readFirst(path, signal);
  return loaded ? { ...loaded, path, origin: "mkcert CA", hasKey: true } : undefined;
}

export interface Generated {
  cert: string;
  key: string;
  p12?: string;
  output: string;
}

/** `mkcert -cert-file … -key-file … names…`, in `folder` (created if needed). */
export async function generate(
  names: string[],
  folder: string,
  base: string,
  o: { ecdsa?: boolean; client?: boolean; pkcs12?: boolean } = {},
): Promise<Generated> {
  await exec("mkdir", ["-p", folder]);
  const cert = `${folder}/${base}.pem`;
  const key = `${folder}/${base}-key.pem`;
  const p12 = `${folder}/${base}.p12`;
  const args = [
    ...(o.ecdsa ? ["-ecdsa"] : []),
    ...(o.client ? ["-client"] : []),
    ...(o.pkcs12 ? ["-pkcs12", "-p12-file", p12] : ["-cert-file", cert, "-key-file", key]),
    ...names,
  ];
  const output = await run("mkcert", args);
  return o.pkcs12 ? { cert: p12, key: p12, p12, output } : { cert, key, output };
}
