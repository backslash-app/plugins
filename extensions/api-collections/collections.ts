// Finding request files in the code folders and loading them as collections:
// a Bruno collection is a folder with a bruno.json, a .http or .hurl file is a
// collection of its own. Environments, .env files and remembered choices too.

import { storage } from "@backslash/api";
import {
  type BruDefaults,
  bruDefaults,
  bruEnvironment,
  bruRequest,
  fileFormat,
  type Format,
  parseDotenv,
  parseHttpEnvironments,
  parseHttpFile,
  parseHurl,
  type RequestDef,
  SKIP_DIRS,
  sortRequests,
} from "./lib.ts";

export const HOME = Deno.env.get("HOME") ?? "";

type Json = Parameters<typeof storage.set>[1];

export interface Entry {
  def: RequestDef;
  /** The file the request is written in. */
  file: string;
}

export interface Collection {
  /** The Bruno folder, or the .http / .hurl file. */
  path: string;
  name: string;
  format: Format;
  requests: Entry[];
  /** Environment name → variables. */
  environments: Record<string, Record<string, string>>;
  /** Secret variable names of Bruno environments (their values live in Bruno, not in files). */
  secrets: string[];
  /** Variables of the file itself (.http `@name = value`, collection.bru, .env). */
  vars: Record<string, string>;
  error?: string;
}

const MAX_FILE = 2 * 1024 * 1024;

async function readSmall(path: string): Promise<string> {
  try {
    const st = await Deno.stat(path);
    if (st.size > MAX_FILE) return "";
    return await Deno.readTextFile(path);
  } catch {
    return "";
  }
}

export interface Found {
  bruno: string[];
  files: string[];
  denied: string[];
}

/** Bruno collection folders and .http/.rest/.hurl files at most `depth` folders below each root. */
export async function findCollections(roots: string[], depth: number, signal?: AbortSignal): Promise<Found> {
  const bruno: string[] = [];
  const files: string[] = [];
  const denied: string[] = [];
  await Promise.all(roots.map(async (root) => {
    const queue: [string, number][] = [[root, 0]];
    while (queue.length) {
      signal?.throwIfAborted();
      const [dir, level] = queue.shift()!;
      const subdirs: string[] = [];
      let isBruno = false;
      try {
        for await (const e of Deno.readDir(dir)) {
          if (e.isFile && e.name === "bruno.json") isBruno = true;
          else if (e.isFile) {
            const f = fileFormat(e.name);
            if (f === "http" || f === "hurl") files.push(`${dir}/${e.name}`);
          } else if (e.isDirectory && !SKIP_DIRS.has(e.name) && !e.name.startsWith(".")) {
            subdirs.push(`${dir}/${e.name}`);
          }
        }
      } catch (e) {
        if (dir === root && (e instanceof Deno.errors.NotCapable || e instanceof Deno.errors.PermissionDenied)) {
          denied.push(root);
        }
        continue;
      }
      // A Bruno collection is read whole by loadBruno; its own .http files stay listed.
      if (isBruno) bruno.push(dir);
      else if (level < depth) queue.push(...subdirs.map((d) => [d, level + 1] as [string, number]));
    }
  }));
  return { bruno: bruno.sort(), files: files.sort(), denied };
}

async function bruFiles(dir: string, level = 0): Promise<string[]> {
  const out: string[] = [];
  try {
    for await (const e of Deno.readDir(dir)) {
      if (e.isFile && e.name.endsWith(".bru")) out.push(`${dir}/${e.name}`);
      else if (e.isDirectory && level < 6 && !e.name.startsWith(".") && !SKIP_DIRS.has(e.name)) {
        if (level === 0 && e.name === "environments") continue;
        out.push(...await bruFiles(`${dir}/${e.name}`, level + 1));
      }
    }
  } catch {
    // Unreadable folder: skipped.
  }
  return out;
}

const merge = (outer: BruDefaults, inner: BruDefaults): BruDefaults => ({
  headers: [
    ...outer.headers.filter(([k]) => !inner.headers.some(([h]) => h.toLowerCase() === k.toLowerCase())),
    ...inner.headers,
  ],
  auth: inner.auth ?? outer.auth,
  vars: { ...outer.vars, ...inner.vars },
});

export async function loadBruno(dir: string): Promise<Collection> {
  let name = dir.split("/").pop() ?? dir;
  try {
    const meta = JSON.parse(await readSmall(`${dir}/bruno.json`));
    if (typeof meta?.name === "string" && meta.name.trim()) name = meta.name.trim();
  } catch {
    // Keep the folder name.
  }
  const root = bruDefaults(await readSmall(`${dir}/collection.bru`));
  const environments: Record<string, Record<string, string>> = {};
  const secrets = new Set<string>();
  try {
    for await (const e of Deno.readDir(`${dir}/environments`)) {
      if (!e.isFile || !e.name.endsWith(".bru")) continue;
      const env = bruEnvironment(await readSmall(`${dir}/environments/${e.name}`));
      environments[e.name.replace(/\.bru$/, "")] = env.vars;
      env.secrets.forEach((s) => secrets.add(s));
    }
  } catch {
    // No environments.
  }
  const folderDefaults = new Map<string, Promise<BruDefaults>>();
  const defaultsFor = (folder: string): Promise<BruDefaults> => {
    if (folder === dir || !folder.startsWith(`${dir}/`)) return Promise.resolve(root);
    if (!folderDefaults.has(folder)) {
      folderDefaults.set(
        folder,
        (async () => {
          const parent = await defaultsFor(folder.replace(/\/[^/]+$/, ""));
          const own = await readSmall(`${folder}/folder.bru`);
          return own ? merge(parent, bruDefaults(own)) : parent;
        })(),
      );
    }
    return folderDefaults.get(folder)!;
  };
  const requests: Entry[] = [];
  for (const file of await bruFiles(dir)) {
    const base = file.split("/").pop()!;
    if (base === "collection.bru" || base === "folder.bru") continue;
    const defaults = await defaultsFor(file.replace(/\/[^/]+$/, ""));
    const def = bruRequest(await readSmall(file), base, defaults);
    if (def) {
      def.vars = { ...defaults.vars, ...def.vars };
      requests.push({ def, file });
    }
  }
  return {
    path: dir,
    name,
    format: "bruno",
    requests: sortRequests(requests),
    environments,
    secrets: [...secrets],
    vars: parseDotenv(await readSmall(`${dir}/.env`)),
  };
}

/** A .http/.rest or .hurl file; bodies read from files (`< ./body.json`) are loaded next to it. */
export async function loadFile(path: string): Promise<Collection> {
  const format = fileFormat(path)!;
  const dir = path.replace(/\/[^/]+$/, "");
  const name = path.split("/").pop()!;
  const text = await readSmall(path);
  const base = { path, name, format, environments: {}, secrets: [], vars: {} as Record<string, string> };
  try {
    if (format === "hurl") {
      return { ...base, requests: parseHurl(text).map((def) => ({ def, file: path })) };
    }
    const parsed = parseHttpFile(text);
    // JetBrains looks for the environment files next to the requests; projects often keep them one level up.
    let environments: Record<string, Record<string, string>> = {};
    for (const d of [dir, dir.replace(/\/[^/]+$/, "")]) {
      const pub = await readSmall(`${d}/http-client.env.json`);
      if (!pub) continue;
      environments = parseHttpEnvironments(pub, await readSmall(`${d}/http-client.private.env.json`));
      break;
    }
    const requests = await Promise.all(parsed.requests.map(async (def) => {
      if (def.bodyFile) {
        const p = def.bodyFile.startsWith("/") ? def.bodyFile : `${dir}/${def.bodyFile.replace(/^\.\//, "")}`;
        const body = await readSmall(p);
        if (body) def.body = body;
        else (def.notes ??= []).push(`The body file ${def.bodyFile} can't be read`);
      }
      return { def, file: path };
    }));
    return {
      ...base,
      requests,
      environments,
      vars: { ...parseDotenv(await readSmall(`${dir}/.env`)), ...parsed.vars },
    };
  } catch (e) {
    return { ...base, requests: [], error: (e as Error).message };
  }
}

/** Every collection under the roots, Bruno ones first, files with no request left out. */
export async function loadAll(
  roots: string[],
  depth: number,
  signal?: AbortSignal,
): Promise<{ collections: Collection[]; denied: string[] }> {
  const found = await findCollections(roots, depth, signal);
  const collections = await Promise.all([...found.bruno.map(loadBruno), ...found.files.map(loadFile)]);
  return { collections: collections.filter((c) => c.requests.length || c.error), denied: found.denied };
}

// ---------------------------------------------------------------------------
// Remembered per collection: the environment picked, and values typed for missing variables.

const ENV_KEY = (c: Collection) => `env:${c.path}`;
const VARS_KEY = (c: Collection) => `vars:${c.path}`;

/** The environment in use: the one picked, else the only one, else none. */
export async function currentEnvironment(c: Collection): Promise<string | undefined> {
  const names = Object.keys(c.environments);
  if (!names.length) return undefined;
  const picked = await storage.get<string>(ENV_KEY(c)).catch(() => undefined);
  if (picked === "") return undefined;
  if (picked && names.includes(picked)) return picked;
  return names.length === 1 ? names[0] : undefined;
}

export async function pickEnvironment(c: Collection, name: string | undefined): Promise<void> {
  await storage.set(ENV_KEY(c), name ?? "");
}

export async function typedVariables(c: Collection): Promise<Record<string, string>> {
  return (await storage.get(VARS_KEY(c)).catch(() => undefined) as Record<string, string> | undefined) ?? {};
}

export async function saveTypedVariables(c: Collection, values: Record<string, string>): Promise<void> {
  const next = { ...await typedVariables(c), ...values };
  for (const [k, v] of Object.entries(next)) if (v === "") delete next[k];
  await storage.set(VARS_KEY(c), next as Json);
}

export async function forgetTypedVariables(c: Collection): Promise<void> {
  await storage.delete(VARS_KEY(c));
}

/** All the variables a request of `c` sees: environment, file (they take precedence), then what the user typed. */
export async function variables(c: Collection): Promise<{ env?: string; vars: Record<string, string> }> {
  const env = await currentEnvironment(c);
  return { env, vars: { ...(env ? c.environments[env] : {}), ...c.vars, ...await typedVariables(c) } };
}
