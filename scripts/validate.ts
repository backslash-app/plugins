// Validates registry entries: `deno run -A scripts/validate.ts [registry/x.toml…]`
//
// For each entry, clones the repository at the pinned commit and checks that
// the files, manifest and permissions match what the entry says. This is the
// same verification Backslash does before installing, run at review time.

import { parse } from "@std/toml";

interface Entry {
  id: string;
  title: string;
  version: string;
  repository: string;
  path?: string;
  commit: string;
  checksum: string;
  permissions?: string[];
  commands?: string[];
}

interface Manifest {
  extension: { id: string; title: string; version?: string };
  runtime?: { kind: string };
  permissions?: {
    net?: string[];
    run?: string[];
    read?: string[];
    write?: string[];
    env?: string[];
    "clipboard-read"?: boolean;
  };
  commands?: { title: string }[];
}

async function git(args: string[], cwd?: string): Promise<string> {
  const out = await new Deno.Command("git", { args, cwd, stdout: "piped", stderr: "piped" }).output();
  if (!out.success) throw new Error(`git ${args[0]}: ${new TextDecoder().decode(out.stderr).trim()}`);
  return new TextDecoder().decode(out.stdout).trim();
}

/** Same algorithm as `backslash_core::catalog::checksum`. */
async function checksum(dir: string): Promise<string> {
  const files: string[] = [];
  async function walk(rel: string) {
    for await (const e of Deno.readDir(rel ? `${dir}/${rel}` : dir)) {
      if ([".git", "node_modules", ".backslash-install.json"].includes(e.name)) continue;
      const path = rel ? `${rel}/${e.name}` : e.name;
      if (e.isSymlink) throw new Error(`${path} is a symbolic link`);
      if (e.isDirectory) await walk(path);
      else if (e.isFile) files.push(path);
    }
  }
  await walk("");
  // Rust sorts strings by bytes; so does this comparison on UTF-8 bytes.
  const enc = new TextEncoder();
  files.sort((a, b) => {
    const [x, y] = [enc.encode(a), enc.encode(b)];
    for (let i = 0; i < Math.min(x.length, y.length); i++) if (x[i] !== y[i]) return x[i] - y[i];
    return x.length - y.length;
  });
  const parts: Uint8Array[] = [];
  for (const name of files) {
    const content = await Deno.readFile(`${dir}/${name}`);
    parts.push(enc.encode(name), new Uint8Array([0]), enc.encode(String(content.length)), new Uint8Array([0]), content);
  }
  const total = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    total.set(p, offset);
    offset += p.length;
  }
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", total));
  return "sha256:" + [...digest].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Same lines as `backslash_core::approvals::requested`. */
function requested(m: Manifest): string[] {
  const p = m.permissions ?? {};
  const lines: string[] = [];
  // Bubblewrap (exec and python runtimes) confines files, not hosts or programs.
  if (m.runtime?.kind && m.runtime.kind !== "deno") {
    lines.push("Run its own program, in a sandbox that lets it start any installed program");
    if ((p.net ?? []).length > 0) lines.push("Access any website");
  } else {
    for (const host of p.net ?? []) lines.push(host === "*" ? "Access any website" : `Access ${host}`);
    for (const x of p.run ?? []) lines.push(`Run ${x}`);
  }
  for (const x of p.read ?? []) lines.push(`Read ${x}`);
  for (const x of p.write ?? []) lines.push(`Write ${x}`);
  for (const x of p.env ?? []) lines.push(`Read the environment variable ${x}`);
  if (p["clipboard-read"]) lines.push("Read the clipboard");
  return lines;
}

async function validate(file: string): Promise<string[]> {
  const errors: string[] = [];
  const entry = parse(await Deno.readTextFile(file)) as unknown as Entry;
  const id = file.split("/").pop()!.replace(/\.toml$/, "");
  if (entry.id !== id) errors.push(`id "${entry.id}" does not match the file name`);
  if (!/^[a-z0-9-]+$/.test(entry.id ?? "")) errors.push("id must match [a-z0-9-]+");
  for (const field of ["title", "version", "repository", "commit", "checksum"] as const) {
    if (!entry[field]) errors.push(`missing ${field}`);
  }
  if (!/^[0-9a-f]{40}$/.test(entry.commit ?? "")) errors.push("commit must be a full 40-character hash");
  if (!/^https:\/\//.test(entry.repository ?? "")) errors.push("repository must be an https URL");
  if (errors.length) return errors;

  const tmp = await Deno.makeTempDir();
  try {
    await git(["init", "-q"], tmp);
    await git(["remote", "add", "origin", entry.repository], tmp);
    await git(["fetch", "-q", "--depth", "1", "origin", entry.commit], tmp)
      .catch(() => git(["fetch", "-q", "origin"], tmp));
    await git(["-c", "advice.detachedHead=false", "checkout", "-q", entry.commit], tmp);
    const dir = entry.path ? `${tmp}/${entry.path}` : tmp;
    const manifest = parse(await Deno.readTextFile(`${dir}/backslash.toml`)) as unknown as Manifest;
    if (manifest.extension.id !== entry.id) errors.push(`manifest id is "${manifest.extension.id}"`);
    if ((manifest.extension.version ?? "0.0.0") !== entry.version) {
      errors.push(`manifest version is ${manifest.extension.version}, entry says ${entry.version}`);
    }
    const asked = requested(manifest).sort();
    const listed = [...(entry.permissions ?? [])].sort();
    if (JSON.stringify(asked) !== JSON.stringify(listed)) {
      errors.push(`permissions differ: the extension asks for ${JSON.stringify(asked)}`);
    }
    const sum = await checksum(dir);
    if (sum !== entry.checksum) errors.push(`checksum is ${sum}`);
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err));
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
  return errors;
}

const files = Deno.args.length
  ? Deno.args
  : [...Deno.readDirSync("registry")].filter((e) => e.name.endsWith(".toml")).map((e) => `registry/${e.name}`).sort();
let failed = false;
for (const file of files) {
  const errors = await validate(file);
  console.log(`${errors.length ? "✗" : "✓"} ${file}`);
  for (const e of errors) console.log(`    ${e}`);
  failed ||= errors.length > 0;
}
if (failed) Deno.exit(1);
