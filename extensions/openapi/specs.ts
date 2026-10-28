// Finding spec files, downloading saved spec URLs, and loading a spec with the files its $refs point to.

import { storage } from "@backslash/api";
// Imported by URL: the launcher runs extensions without the repository's import map.
// deno-lint-ignore no-import-prefix
import { parse as parseYaml } from "jsr:@std/yaml@^1";
import {
  type Docs,
  docUri,
  externalRefs,
  isSpecFileName,
  kindLabel,
  looksLikeSpec,
  operations,
  servers,
  SKIP_DIRS,
  specKind,
} from "./lib.ts";

export const HOME = Deno.env.get("HOME") ?? "";

type Json = Parameters<typeof storage.set>[1];
// deno-lint-ignore no-explicit-any
type Obj = Record<string, any>;

export interface Source {
  /** `file:///…` or `https://…`: the spec's base URI. */
  uri: string;
  /** The file's path, for files. */
  path?: string;
  /** The saved URL, for downloaded specs. */
  url?: string;
}

/** What the specs list shows, kept in storage so files are parsed again only when they change. */
export interface Summary {
  uri: string;
  path?: string;
  url?: string;
  title: string;
  version?: string;
  kind: string;
  description?: string;
  operations: number;
  tags: number;
  server?: string;
  /** Unix milliseconds: file change, or download. */
  modified: number;
  error?: string;
}

export interface Spec {
  source: Source;
  doc: Obj;
  docs: Docs;
  /** Where the spec came from when downloaded (for relative server URLs). */
  specUrl?: string;
  /** Downloaded copy used because the URL couldn't be reached. */
  offline?: boolean;
}

const MAX_FILE = 20 * 1024 * 1024;
const MAX_DOCS = 40;

export const fileUri = (path: string) => new URL(`file://${path.split("/").map(encodeURIComponent).join("/")}`).href;
export const uriPath = (uri: string) => decodeURIComponent(new URL(uri).pathname);

/** JSON or YAML, whichever the text is. */
export function parseText(text: string, name: string): unknown {
  const t = text.replace(/^﻿/, "");
  if (/\.json$/i.test(name) || /^\s*[{[]/.test(t)) {
    try {
      return JSON.parse(t);
    } catch (e) {
      if (/\.json$/i.test(name)) throw new Error(`${name} is not valid JSON: ${(e as Error).message}`);
    }
  }
  try {
    return parseYaml(t);
  } catch (e) {
    throw new Error(`${name} is not valid YAML: ${(e as Error).message.split("\n")[0]}`);
  }
}

// ---------------------------------------------------------------------------
// Downloads

const CACHE = (url: string) => `cache:${url}`;

async function download(url: string, signal?: AbortSignal): Promise<{ text: string; offline: boolean; at: number }> {
  try {
    const res = await fetch(url, {
      signal,
      headers: { Accept: "application/json, application/yaml, text/yaml, */*" },
    });
    if (!res.ok) {
      throw new Error(
        res.status === 401 || res.status === 403
          ? `${new URL(url).host} refused to give the spec (HTTP ${res.status}): it needs a sign-in`
          : res.status === 404
          ? `No spec at ${url} (HTTP 404): check the URL`
          : `${new URL(url).host} answered HTTP ${res.status}`,
      );
    }
    const text = await res.text();
    const at = Date.now();
    if (text.length < 4 * 1024 * 1024) await storage.set(CACHE(url), { text, at }).catch(() => {});
    return { text, offline: false, at };
  } catch (e) {
    if (signal?.aborted) throw e;
    const cached = await storage.get(CACHE(url)) as unknown as { text: string; at: number } | undefined;
    if (cached?.text) return { text: cached.text, offline: true, at: cached.at };
    if (e instanceof TypeError) throw new Error(`Cannot reach ${new URL(url).host}: check your connection or the URL`);
    throw e;
  }
}

async function readSource(uri: string, signal?: AbortSignal): Promise<{ text: string; offline: boolean; at: number }> {
  if (uri.startsWith("file:")) {
    const path = uriPath(uri);
    const st = await Deno.stat(path);
    if (st.size > MAX_FILE) throw new Error(`${path} is too big to read (${Math.round(st.size / 1e6)} MB)`);
    return { text: await Deno.readTextFile(path), offline: false, at: st.mtime?.getTime() ?? 0 };
  }
  return download(uri, signal);
}

/** The spec and every document its `$ref`s reach (relative files, other URLs). */
export async function loadSpec(source: Source, signal?: AbortSignal): Promise<Spec> {
  const main = await readSource(source.uri, signal);
  const doc = parseText(main.text, source.path ?? source.url ?? source.uri);
  if (!specKind(doc)) throw new Error("Not an OpenAPI 3 or Swagger 2.0 document: no openapi or swagger version");
  const docs: Docs = { [docUri(source.uri)]: doc };
  const queue = externalRefs(doc, source.uri);
  while (queue.length && Object.keys(docs).length < MAX_DOCS) {
    const uri = queue.shift()!;
    if (docs[uri] !== undefined) continue;
    // A file spec only reads other files; a downloaded one only other URLs.
    if (uri.startsWith("file:") !== source.uri.startsWith("file:")) continue;
    try {
      const sub = parseText((await readSource(uri, signal)).text, uri);
      docs[uri] = sub;
      queue.push(...externalRefs(sub, uri).filter((u) => docs[u] === undefined));
    } catch {
      // Left unresolved: those $refs show as missing.
    }
  }
  return { source, doc: doc as Obj, docs, specUrl: source.url, offline: main.offline };
}

export function summarize(spec: Spec, modified: number): Summary {
  const { doc, docs, source } = spec;
  const ops = operations(doc, source.uri, docs);
  return {
    uri: source.uri,
    path: source.path,
    url: source.url,
    title: String(doc.info?.title ?? "").trim() || (source.path ?? source.url ?? "").split("/").pop() || "API",
    version: doc.info?.version !== undefined ? String(doc.info.version) : undefined,
    kind: kindLabel(doc),
    description: typeof doc.info?.description === "string" ? doc.info.description : undefined,
    operations: ops.length,
    tags: new Set(ops.flatMap((o) => o.tags)).size,
    server: servers(doc, spec.specUrl)[0] || undefined,
    modified,
  };
}

// ---------------------------------------------------------------------------
// Finding files

/** Spec files at most `depth` folders below each root; roots that can't be read are returned apart. */
export async function findSpecFiles(
  roots: string[],
  depth: number,
  signal?: AbortSignal,
): Promise<{ files: string[]; denied: string[] }> {
  const files: string[] = [];
  const denied: string[] = [];
  await Promise.all(roots.map(async (root) => {
    const queue: [string, number][] = [[root, 0]];
    while (queue.length) {
      signal?.throwIfAborted();
      const [dir, level] = queue.shift()!;
      try {
        for await (const e of Deno.readDir(dir)) {
          if (e.isFile && isSpecFileName(e.name)) files.push(`${dir}/${e.name}`);
          else if (e.isDirectory && level < depth && !SKIP_DIRS.has(e.name) && !e.name.startsWith(".")) {
            queue.push([`${dir}/${e.name}`, level + 1]);
          }
        }
      } catch (e) {
        if (dir !== root) continue;
        if (e instanceof Deno.errors.NotCapable || e instanceof Deno.errors.PermissionDenied) denied.push(root);
        break;
      }
    }
  }));
  return { files: files.sort(), denied };
}

const SUMMARIES = "summaries";

interface Cached {
  [uri: string]: Summary & { size: number };
}

/** Summaries of the spec files, from storage when the file hasn't changed. Files that aren't specs are left out. */
export async function fileSummaries(paths: string[]): Promise<Summary[]> {
  const cache = (await storage.get(SUMMARIES).catch(() => undefined) ?? {}) as unknown as Cached;
  const next: Cached = {};
  const out = await Promise.all(paths.map(async (path): Promise<Summary | undefined> => {
    const uri = fileUri(path);
    let st: Deno.FileInfo;
    try {
      st = await Deno.stat(path);
    } catch {
      return undefined;
    }
    const modified = st.mtime?.getTime() ?? 0;
    const hit = cache[uri];
    if (hit && hit.modified === modified && hit.size === st.size) {
      next[uri] = hit;
      return hit.operations >= 0 ? hit : undefined;
    }
    try {
      if (st.size > MAX_FILE) return undefined;
      const text = await Deno.readTextFile(path);
      if (!looksLikeSpec(text)) {
        next[uri] = { uri, title: "", kind: "", operations: -1, tags: 0, modified, size: st.size };
        return undefined;
      }
      const spec = await loadSpec({ uri, path });
      const summary = summarize(spec, modified);
      next[uri] = { ...summary, size: st.size };
      return summary;
    } catch (e) {
      const summary: Summary = {
        uri,
        path,
        title: path.split("/").pop() ?? path,
        kind: "Invalid",
        operations: 0,
        tags: 0,
        modified,
        error: (e as Error).message,
      };
      next[uri] = { ...summary, size: st.size };
      return summary;
    }
  }));
  await storage.set(SUMMARIES, next as unknown as Json).catch(() => {});
  return out.filter((s): s is Summary => !!s);
}

// ---------------------------------------------------------------------------
// Saved URLs

const URLS = "urls";

export async function savedUrls(): Promise<string[]> {
  return (await storage.get(URLS) as unknown as string[] | undefined) ?? [];
}

export async function saveUrls(urls: string[]): Promise<void> {
  await storage.set(URLS, [...new Set(urls)]);
}

export async function urlSummary(url: string, signal?: AbortSignal): Promise<Summary> {
  try {
    const spec = await loadSpec({ uri: url, url }, signal);
    const cached = await storage.get(CACHE(url)) as unknown as { at: number } | undefined;
    return summarize(spec, cached?.at ?? Date.now());
  } catch (e) {
    if (signal?.aborted) throw e;
    return {
      uri: url,
      url,
      title: new URL(url).host,
      kind: "Unavailable",
      operations: 0,
      tags: 0,
      modified: 0,
      error: (e as Error).message,
    };
  }
}

export function sourceOf(s: Summary): Source {
  return { uri: s.uri, path: s.path, url: s.url };
}
