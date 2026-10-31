// Bundlephobia, Packagephobia and npm search answers, sizes and download times. No I/O here.

import type { Color } from "@backslash/api";

// ---------------------------------------------------------------------------
// Package specs

export interface Spec {
  name: string;
  /** An exact version, a range or a dist-tag, as typed. */
  version?: string;
}

const NAME = /^(@[a-z0-9][\w.~-]*\/)?[a-z0-9][\w.~-]*$/i;

/**
 * `react`, `react@18.2.0`, `@scope/pkg@^1`, `npm i lodash`, a bundlephobia or
 * npm URL → `{ name, version }`; undefined when it can't be a package name.
 */
export function parseSpec(input: string): Spec | undefined {
  let text = input.trim()
    .replace(/^(npm|pnpm|yarn|bun)\s+(i|install|add)\s+(-[\w-]+\s+)*/i, "")
    .replace(/^https?:\/\/(www\.)?(bundlephobia\.com\/(package\/|result\?p=)|npmjs\.com\/package\/)/i, "")
    .replace(/^https?:\/\/packagephobia\.com\/result\?p=/i, "")
    .split(/\s+/)[0] ?? "";
  try {
    text = decodeURIComponent(text);
  } catch {
    // Keep it as typed.
  }
  // npmjs.com/package/react/v/18.2.0
  text = text.replace(/^((?:@[^/]+\/)?[^/@]+)\/v\/(.+)$/, "$1@$2").replace(/\/+$/, "");
  if (!text) return undefined;
  const at = text.indexOf("@", 1);
  const name = (at === -1 ? text : text.slice(0, at)).toLowerCase();
  const version = at === -1 ? undefined : text.slice(at + 1).trim() || undefined;
  if (!NAME.test(name) || name.length > 214) return undefined;
  return version ? { name, version } : { name };
}

export const specText = (s: Spec) => s.version ? `${s.name}@${s.version}` : s.name;

// ---------------------------------------------------------------------------
// Bundlephobia

export interface Dependency {
  name: string;
  /** Approximate minified bytes it adds. */
  size: number;
}

export interface BundleSize {
  name: string;
  version: string;
  description?: string;
  repository?: string;
  /** Minified bytes. */
  size: number;
  /** Minified + gzipped bytes. */
  gzip: number;
  dependencyCount: number;
  /** Ships ES modules, so bundlers can drop what isn't imported. */
  treeShakeable: boolean;
  /** `false`: declares no side effects; an array: only these files have some. */
  sideEffects: boolean | string[];
  dependencies: Dependency[];
  /** When it was measured (ms). */
  measuredAt: number;
}

const num = (v: unknown) => typeof v === "number" && Number.isFinite(v) ? v : undefined;
const str = (v: unknown) => typeof v === "string" && v.trim() ? v.trim() : undefined;

/** `/api/size?package=…` → what we show, or undefined when the answer isn't a measurement. */
export function parseSize(json: any, now = Date.now()): BundleSize | undefined {
  if (!json || typeof json !== "object" || json.error) return undefined;
  const size = num(json.size), gzip = num(json.gzip);
  const name = str(json.name), version = str(json.version);
  if (size === undefined || gzip === undefined || !name || !version) return undefined;
  const deps: Dependency[] = Array.isArray(json.dependencySizes)
    ? json.dependencySizes
      .map((d: any) => ({ name: str(d?.name) ?? "", size: num(d?.approximateSize) ?? 0 }))
      .filter((d: Dependency) => d.name)
      .sort((a: Dependency, b: Dependency) => b.size - a.size)
    : [];
  const side = json.hasSideEffects;
  return {
    name,
    version,
    description: str(json.description),
    repository: repoUrl(json.repository),
    size,
    gzip,
    dependencyCount: num(json.dependencyCount) ?? Math.max(0, deps.length - 1),
    treeShakeable: !!(json.hasJSModule || json.hasJSNext || json.isModuleType),
    sideEffects: Array.isArray(side) ? side.map(String) : side !== false,
    dependencies: deps,
    measuredAt: now,
  };
}

/** `git+https://github.com/facebook/react.git` → `https://github.com/facebook/react`. */
export function repoUrl(raw: unknown): string | undefined {
  const text = typeof raw === "object" && raw ? (raw as { url?: unknown }).url : raw;
  let url = str(text);
  if (!url) return undefined;
  url = url.replace(/^git\+/, "").replace(/^git:\/\//, "https://").replace(/\.git$/, "")
    .replace(/^git@([^:]+):/, "https://$1/")
    .replace(/^github:/, "https://github.com/");
  if (/^[\w.-]+\/[\w.-]+$/.test(url)) url = `https://github.com/${url}`;
  return /^https?:\/\//.test(url) ? url : undefined;
}

/** Bundlephobia's `{ error: { code, message } }` as a sentence for the user. */
export function bundlephobiaError(json: any, spec: string): string {
  const code = String(json?.error?.code ?? "");
  const message = str(json?.error?.message)?.replace(/<[^>]+>/g, "");
  switch (code) {
    case "PackageNotFoundError":
      return `No package “${spec}” on npm`;
    case "PackageVersionMismatchError":
      return `${spec}: no such version on npm`;
    case "BlocklistedPackageError":
      return `Bundlephobia doesn't measure ${spec}: it's blocklisted (too big or not meant for the browser)`;
    case "UnsupportedPackageError":
    case "CLIBuildError":
      return `${spec} can't be bundled for the browser${message ? `: ${message}` : ""}`;
    case "EntryPointError":
      return `${spec} has no entry point a bundler can use`;
    case "MissingDependencyError":
      return `${spec} imports a package it doesn't depend on${message ? `: ${message}` : ""}`;
    case "BuildError":
    case "MinifyError":
      return `Bundlephobia couldn't build ${spec}${message ? `: ${message}` : ""}`;
    default:
      return message ?? `Bundlephobia couldn't measure ${spec}`;
  }
}

export interface SimilarPackage {
  name: string;
  description?: string;
  gzip?: number;
  size?: number;
}

/**
 * `/api/similar-packages?package=…`: `{ category: { label, similar: [...] } }`,
 * the entries being names or objects with sizes.
 */
export function parseSimilar(json: any): { category?: string; packages: SimilarPackage[] } {
  const category = json?.category ?? json;
  const list = Array.isArray(category?.similar) ? category.similar : Array.isArray(json) ? json : [];
  const packages: SimilarPackage[] = [];
  for (const entry of list) {
    const p: SimilarPackage | undefined = typeof entry === "string" ? { name: entry } : str(entry?.name)
      ? {
        name: str(entry.name)!,
        description: str(entry.description),
        gzip: num(entry.gzip),
        size: num(entry.size),
      }
      : undefined;
    if (p && !packages.some((q) => q.name === p.name)) packages.push(p);
  }
  const label = str(category?.label);
  return { category: label?.replace(/[-_]/g, " "), packages };
}

/** `/api/package-history?package=…`: `{ "18.2.0": { size, gzip }, "18.1.0": {} }`, newest first. */
export function parseHistory(json: any): { version: string; size: number; gzip: number }[] {
  if (!json || typeof json !== "object" || Array.isArray(json)) return [];
  return Object.entries(json)
    .map(([version, v]: [string, any]) => ({ version, size: num(v?.size), gzip: num(v?.gzip) }))
    .filter((v): v is { version: string; size: number; gzip: number } =>
      v.size !== undefined && v.gzip !== undefined && /^\d+\.\d+\.\d+/.test(v.version)
    )
    .sort((a, b) => compareVersions(b.version, a.version));
}

/** Semver order; pre-releases before their release. */
export function compareVersions(a: string, b: string): number {
  const split = (v: string) => {
    const [core, pre] = v.replace(/^v/, "").split(/-(.*)/s);
    return { core: core.split(".").map((n) => Number.parseInt(n, 10) || 0), pre };
  };
  const x = split(a), y = split(b);
  for (let i = 0; i < 3; i++) {
    const d = (x.core[i] ?? 0) - (y.core[i] ?? 0);
    if (d) return d;
  }
  if (x.pre === y.pre) return 0;
  if (!x.pre) return 1;
  if (!y.pre) return -1;
  return x.pre.localeCompare(y.pre, "en", { numeric: true });
}

// ---------------------------------------------------------------------------
// Packagephobia

export interface InstallSize {
  /** The tarball of this package alone. */
  publishBytes: number;
  /** node_modules after `npm install`, dependencies included. */
  installBytes: number;
  installFiles?: number;
}

/** `/v2/api.json?p=…`: `{ publish: { bytes, files }, install: { bytes, files } }`. */
export function parseInstall(json: any): InstallSize | undefined {
  const publish = num(json?.publish?.bytes), install = num(json?.install?.bytes);
  if (publish === undefined || install === undefined || (publish === 0 && install === 0)) return undefined;
  return { publishBytes: publish, installBytes: install, installFiles: num(json?.install?.files) };
}

// ---------------------------------------------------------------------------
// npm search

export interface Suggestion {
  name: string;
  version: string;
  description?: string;
  /** Weekly downloads, when npm says. */
  downloads?: number;
}

/** `registry.npmjs.org/-/v1/search` → suggestions, in npm's order. */
export function parseSearch(json: any): Suggestion[] {
  const objects = Array.isArray(json?.objects) ? json.objects : [];
  return objects
    .map((o: any) => ({
      name: str(o?.package?.name) ?? "",
      version: str(o?.package?.version) ?? "",
      description: str(o?.package?.description),
      downloads: num(o?.downloads?.weekly),
    }))
    .filter((s: Suggestion) => s.name && s.version);
}

// ---------------------------------------------------------------------------
// Formatting

/** 2_543 → "2.5 kB", as bundlephobia shows them (1 kB = 1024 bytes). */
export function bytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "?";
  if (n < 1024) return `${Math.round(n)} B`;
  const units = ["kB", "MB", "GB"];
  let v = n / 1024, i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 100 ? Math.round(v) : v >= 10 ? v.toFixed(1).replace(/\.0$/, "") : v.toFixed(2).replace(/0$/, "")} ${
    units[i]
  }`;
}

/** 12 → "12 ms", 1_234 → "1.23 s", 61_000 → "1 min 1 s". */
export function duration(ms: number): string {
  if (ms < 1) return "< 1 ms";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1).replace(/\.?0+$/, "")} s`;
  return `${Math.floor(ms / 60_000)} min ${Math.round((ms % 60_000) / 1000)} s`;
}

export function compact(n: number): string {
  if (n < 1000) return String(n);
  for (const [div, unit] of [[1e9, "B"], [1e6, "M"], [1e3, "k"]] as const) {
    if (n >= div) return `${(n / div).toFixed(n / div < 10 ? 1 : 0).replace(/\.0$/, "")}${unit}`;
  }
  return String(n);
}

/** The connections bundlephobia and Chrome's throttling use: bits per second and round trip. */
export const NETWORKS = [
  { id: "slow3g", title: "Slow 3G", bps: 400_000, rtt: 400 },
  { id: "3g", title: "3G", bps: 1_600_000, rtt: 150 },
  { id: "4g", title: "4G", bps: 9_000_000, rtt: 85 },
] as const;

/** Time to download `gzipBytes` on a connection: one round trip plus the transfer. */
export function downloadTime(gzipBytes: number, network: { bps: number; rtt: number }): number {
  return network.rtt + (gzipBytes * 8 * 1000) / network.bps;
}

/** Green when it hardly matters, red when it does. */
export function sizeColor(gzip: number): Color {
  if (gzip < 10 * 1024) return "green";
  if (gzip < 40 * 1024) return "yellow";
  if (gzip < 100 * 1024) return "orange";
  return "red";
}

// ---------------------------------------------------------------------------
// Lighter alternatives

/** Well-known lighter replacements, for when bundlephobia has no category. */
export const ALTERNATIVES: Record<string, string[]> = {
  moment: ["dayjs", "date-fns", "luxon"],
  "moment-timezone": ["dayjs", "date-fns-tz", "luxon"],
  lodash: ["lodash-es", "es-toolkit", "just-pick"],
  underscore: ["es-toolkit", "lodash-es"],
  axios: ["ky", "redaxios", "ofetch"],
  request: ["ky", "got", "undici"],
  "node-fetch": ["ky", "ofetch"],
  jquery: ["cash-dom", "umbrellajs"],
  uuid: ["nanoid", "uuidv7"],
  classnames: ["clsx"],
  chalk: ["picocolors", "kleur", "yoctocolors"],
  colors: ["picocolors", "kleur"],
  "query-string": ["fast-querystring"],
  immutable: ["immer"],
  ramda: ["rambda", "remeda"],
  "core-js": ["core-js-pure"],
  numeral: ["numbro"],
  "chart.js": ["uplot", "frappe-charts"],
  "react-redux": ["zustand", "jotai", "valtio"],
  redux: ["zustand", "nanostores"],
  mobx: ["valtio", "nanostores"],
  "styled-components": ["goober", "@emotion/css"],
  "@emotion/react": ["goober"],
  yup: ["valibot", "superstruct"],
  zod: ["valibot", "@zod/mini"],
  joi: ["valibot", "superstruct"],
  "react-router-dom": ["wouter"],
  "react-use": ["usehooks-ts"],
  "socket.io-client": ["partysocket", "reconnecting-websocket"],
  "highlight.js": ["prismjs"],
  marked: ["snarkdown", "micromark"],
  "markdown-it": ["marked", "snarkdown"],
  "crypto-js": ["@noble/hashes"],
  "deep-equal": ["dequal", "fast-deep-equal"],
  "lodash.isequal": ["dequal", "fast-deep-equal"],
  "lodash.debounce": ["just-debounce-it", "debounce"],
  "lodash.clonedeep": ["klona", "rfdc"],
  "date-fns": ["dayjs", "tinydate"],
  luxon: ["dayjs"],
  qs: ["fast-querystring", "picoquery"],
  "file-saver": ["downloadjs"],
  "animate.css": ["motion"],
  gsap: ["motion", "animejs"],
  "framer-motion": ["motion"],
  sweetalert2: ["notyf"],
  "react-select": ["downshift"],
};

/** Packages to compare with: bundlephobia's similar ones, else our list, never the package itself. */
export function candidates(name: string, similar: SimilarPackage[]): SimilarPackage[] {
  const out = similar.filter((p) => p.name !== name);
  for (const alt of ALTERNATIVES[name] ?? []) {
    if (alt !== name && !out.some((p) => p.name === alt)) out.push({ name: alt });
  }
  return out;
}

/** The candidates measured lighter than `gzip`, lightest first. */
export function lighter(gzip: number, measured: SimilarPackage[]): (SimilarPackage & { gzip: number })[] {
  return measured
    .filter((p): p is SimilarPackage & { gzip: number } => p.gzip !== undefined && p.gzip < gzip)
    .sort((a, b) => a.gzip - b.gzip);
}

/** "-62 %" against the current package. */
export function saving(current: number, other: number): string {
  if (current <= 0) return "";
  const pct = Math.round(((other - current) / current) * 100);
  return pct === 0 ? "same" : `${pct > 0 ? "+" : ""}${pct} %`;
}

// ---------------------------------------------------------------------------
// Recently measured

export type Recent = {
  name: string;
  version: string;
  size: number;
  gzip: number;
  at: number;
};

/** Puts `entry` first, one entry per package, at most `max`. */
export function addRecent(list: Recent[], entry: Recent, max = 30): Recent[] {
  return [entry, ...list.filter((r) => r.name !== entry.name)].slice(0, max);
}

/** A shareable line: "react@18.2.0: 6.4 kB minified, 2.5 kB min+gzip". */
export function summaryLine(b: Pick<BundleSize, "name" | "version" | "size" | "gzip">): string {
  return `${b.name}@${b.version}: ${bytes(b.size)} minified, ${bytes(b.gzip)} min+gzip`;
}

export const bundlephobiaUrl = (spec: string) => `https://bundlephobia.com/package/${spec}`;
export const packagephobiaUrl = (spec: string) => `https://packagephobia.com/result?p=${encodeURIComponent(spec)}`;
export const npmUrl = (name: string, version?: string) =>
  `https://www.npmjs.com/package/${name}${version ? `/v/${version}` : ""}`;
